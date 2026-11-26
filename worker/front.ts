// The sign-in front. People point any Jellyfin app at  https://<site>/h/<code>  and type their hub username and password.
// The hub keeps one AIOStreams sign-in per person, and gives each app its own token that it can look up and take away.
// An app never sees the AIOStreams sign-in, token, user id or player address. Video links and poster links pass through
// untouched, so video and artwork go straight from the device to where they are kept and never through here. (Some
// poster links point at the AIOStreams host's public image cache; they carry no sign-in.)
// Taking a token away (sign-out, pause) reaches every running copy of the Worker within about twenty seconds.
import {slug} from '../src/data';
import type {Env} from './util';
import {blocked, failed, getSecret, guesses, newId, newToken, now, putSecret, same, sha, unseal} from './util';
import type {Target} from './trakt';
import {LINK, brief, deliver, history, progressOf, soon} from './trakt';
import {heartKey, heartsOn, noteHeart} from './hearts';
import {forgetWatchlist} from './rows';
import {syncPlayers} from './native';
import {finished} from './foryou';

const MOUNT = '/jellyfin', SEEN_EVERY = 600, REMEMBER = 20_000, MOST_DEVICES = 30;
// The headers are named one by one: in a browser, `*` does not cover Authorization.
const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept, range, x-emby-authorization, x-emby-token, x-mediabrowser-token, x-aiostreams-client, x-aiostreams-device, x-aiostreams-platform, x-aiostreams-network, x-aiostreams-purpose', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-max-age': '86400'};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...CORS}});
const swap = (text: string, pairs: [string, string][]) => {for (const [a, b] of pairs) if (a) text = text.split(a).join(b); return text;};
const AUTH_HEADERS = ['authorization', 'x-emby-authorization', 'x-emby-token', 'x-mediabrowser-token'];
function tokenOf(request: Request, url: URL) {
  for (const name of AUTH_HEADERS.slice(0, 2)) {const found = /Token="?([^",\s]+)"?/i.exec(request.headers.get(name) ?? ''); if (found) return found[1];}
  return request.headers.get('x-emby-token') ?? request.headers.get('x-mediabrowser-token') ?? url.searchParams.get('api_key') ?? url.searchParams.get('ApiKey') ?? '';
}
function clientOf(request: Request) {
  const header = request.headers.get('authorization') ?? request.headers.get('x-emby-authorization') ?? '';
  const part = (name: string) => {const found = new RegExp(`${name}="?([^",]+)"?`, 'i').exec(header)?.[1] ?? ''; try {return decodeURIComponent(found).slice(0, 80);} catch {return found.slice(0, 80);}};
  return {device: part('DeviceId'), name: part('Device'), app: part('Client')};
}
/* Roughly where a request came from, as Cloudflare places it: city and country, and the network's name. The address is not kept.
   The test run (tests/run.sh) sets TEST_WHERE so made-up places can be sent in headers; nothing else sets it. */
function whereOf(request: Request, env: Env) {
  const cf = (env.TEST_WHERE === '1' ? {city: request.headers.get('x-test-city') ?? '', country: request.headers.get('x-test-country') ?? '', asOrganization: request.headers.get('x-test-net') ?? ''} : request.cf ?? {}) as {city?: string; country?: string; asOrganization?: string};
  return {place: [cf.city, cf.country].filter(Boolean).join(', ').slice(0, 60), net: String(cf.asOrganization ?? '').slice(0, 60)};
}
/* When a report was made: now. The test run may say it was made some seconds ago (x-test-ago), to play through an evening in seconds. */
const whenOf = (request: Request, env: Env) => Date.now() - (env.TEST_WHERE === '1' ? Number(request.headers.get('x-test-ago')) * 1000 || 0 : 0);

// Where each picture lives. Asking AIOStreams costs 0.2-1.8 s per poster (measured 2026-11-18), and the answer is a redirect that
// rarely changes, so each running copy of the Worker remembers it for an hour and browsers keep it for a day. Adds no requests.
const pictures = new Map<string, {location: string; until: number}>(), PICTURE = /^\/items\/[^/]+\/images\//, PICTURE_KEEP = 'public, max-age=86400';
interface Upstream {user: string; pass: string; auth?: string; base?: string}
interface Answer {AccessToken: string; User: {Id: string; Name?: string}; SessionInfo?: Record<string, unknown>}
// hub: which hub the sign-in belongs to; a remembered seat answers only for that hub.
// trakt: their Trakt is connected to the hub (its rows, and Favorites if they turned that on). scrobble: their Trakt sync is on
// too, so what they play is passed on to Trakt (see scrobble, below, which asks again each time).
interface Seat {hub: string; person: string; jf: string; paused: boolean; seen: number; up: string; upId: string; at: number; on: string; app: string; base: string; kind: string; trakt: boolean; scrobble: boolean}
// Kept for a few seconds per running copy of the Worker, so a page of posters is one lookup, not fifty.
const hubs = new Map<string, {id: string; up: string; at: number; pictures: string; name: string}>(), seats = new Map<string, Seat>();
/* A person's top-level libraries on their own server, asked for once and kept ten minutes per running copy. */
const libraries = new Map<string, {ids: Set<string>; at: number}>();
async function librariesOf(seat: Seat): Promise<Set<string>> {
  const key = `${seat.base}/${seat.upId}`, known = libraries.get(key);
  if (known && Date.now() - known.at < 600_000) return known.ids;
  const answer = await fetch(`${seat.base}/UserViews?userId=${encodeURIComponent(seat.upId)}`, {headers: {accept: 'application/json', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="hub-${seat.jf}", Version="1", Token="${seat.up}"`}})
    .then(found => found.ok ? found.json() : null).catch(() => null) as {Items?: {Id?: string}[]} | null;
  const ids = new Set((answer?.Items ?? []).map(item => String(item.Id ?? '')).filter(Boolean));
  if (libraries.size > 2000) libraries.clear();
  if (ids.size) libraries.set(key, {ids, at: Date.now()});
  return ids;
}

/* With FRONT=aiometadata the hub keeps one AIOMetadata setup per person (see native.ts), and a person with one ('upstream-aiom')
   is served by it; anyone without one yet is served by AIOStreams as before. Its base is that setup's Jellyfin address. In
   AIOMetadata the setup's id is the owner's user id, the ServerId and the server's Id, so the app gets the person's usual id for the
   user and AIOStreams' server id for the server, and never sees the setup's id. AIOMetadata sends picture bytes itself, so the hub
   sends the app there instead of carrying them: always to the hub's own Home setup, which holds nothing personal, never to a
   person's. Its item ids are dashed, which is how such a picture request is told apart without a token. */
const VIA = 'upstream-aiom', AIOM_ITEM = /^\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/images\//;
const AIOM_PRIVATE = /^\/aiostreams\/(users|activity|history)/, servers = new Map<string, {id: string; at: number}>();
async function serverIdOf(env: Env) {
  const known = servers.get(env.UP_ORIGIN); if (known && Date.now() - known.at < 3_600_000) return known.id;
  const info = await fetch(`${env.UP_ORIGIN}${MOUNT}/System/Info/Public`, {headers: {accept: 'application/json'}}).then(answer => answer.ok ? answer.json() : null).catch(() => null) as {Id?: string} | null;
  const id = String(info?.Id ?? ''); if (id) servers.set(env.UP_ORIGIN, {id, at: Date.now()}); return id;
}
/* The config id, as the app should see it: the server's id where it names the server, the person's id everywhere else. */
function outward(text: string, upId: string, jf: string, server: string, info: boolean) {
  if (!server || !upId) return text;
  text = text.split(`"ServerId":"${upId}"`).join(`"ServerId":"${server}"`);
  if (info) text = text.split(`"Id":"${upId}"`).join(`"Id":"${server}"`);
  // A session's id is the config id without its dashes.
  return upId.includes('-') ? text.split(upId.replace(/-/g, '')).join(jf) : text;
}

// What apps and Trakt call the hub. They read it before anyone signs in, so it is the hub's, set under Hub, General.
const DEFAULT_NAME = 'AIOHub';
/* A saved hub is looked up again on its next request here; other running copies catch up within the minute. */
export const forgetHub = (code: string) => hubs.delete(code);
/* Someone's connections changed: their apps here are looked up again on their next request (other copies within twenty seconds). */
export const forgetSeats = (hub: string, person: string) => {for (const [id, seat] of seats) if (seat.hub === hub && seat.person === person) seats.delete(id);};
async function hubOf(env: Env, code: string) {
  const known = hubs.get(code); if (known && Date.now() - known.at < 60_000) return known;
  const row = await env.DB.prepare('SELECT id, data FROM hubs WHERE code = ?').bind(code).first<{id: string; data: string}>();
  if (!row) return null;
  // Each hub can use its own AIOStreams server; everything below talks to that one.
  const data = JSON.parse(row.data) as {hostUrl?: string; metaUrl?: string; serverName?: string}, home = env.FRONT === 'aiometadata' ? await getSecret<{uuid: string; at?: string}>(env, row.id, '#hub', 'catalogs') : null;
  const pictures = home ? `${home.at ?? data.metaUrl ?? env.AIOM_ORIGIN}/jellyfin/${home.uuid}` : '';
  const found = {id: row.id, up: data.hostUrl || env.UP_ORIGIN, at: Date.now(), pictures, name: data.serverName || DEFAULT_NAME};
  hubs.set(code, found); return found;
}
/* Signs in to AIOStreams as this person and keeps the answer, so it happens once and not on every app sign-in. */
async function mint(env: Env, hub: string, person: string, jf: string, upstream: Upstream, kind = 'upstream'): Promise<Answer | null> {
  // A brake: AIOStreams allows only a few sign-ins per address, so one person gets at most two there in ten minutes, however often
  // it says no. Their own AIOMetadata setup has no such limit, so a few more are allowed (each device may need one after a change).
  const brake: [string, number][] = [[`mint:${hub}:${person}`, kind === VIA ? 6 : 2]];
  if (await blocked(env, brake)) return null;
  await failed(env, brake);
  const answer = await fetch(`${upstream.base ?? env.UP_ORIGIN + MOUNT}/Users/AuthenticateByName`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="hub-${jf}", Version="1"`}, body: JSON.stringify({Username: upstream.user, Pw: upstream.pass})});
  if (answer.status !== 200) return null;
  const auth = await answer.text();
  await (await putSecret(env, hub, person, kind, {...upstream, auth})).run();
  return JSON.parse(auth) as Answer;
}
async function seatOf(env: Env, hub: string, id: string): Promise<Seat | null> {
  const known = seats.get(id); if (known && known.hub === hub && Date.now() - known.at < REMEMBER) return known;
  const row = await env.DB.prepare("SELECT d.person, d.seen, d.app, d.name, p.paused OR coalesce(json_extract(g.data, '$.paused'), 0) AS paused, p.jf, s.value, m.value AS via, EXISTS (SELECT 1 FROM secrets t WHERE t.hub = d.hub AND t.owner = d.person AND t.kind = ?) AS trakt, EXISTS (SELECT 1 FROM sync y WHERE y.hub = d.hub AND y.person = d.person AND y.matching = 1) AS synced FROM devices d JOIN people p ON p.hub = d.hub AND p.id = d.person LEFT JOIN groups g ON g.hub = p.hub AND g.id = p.grp LEFT JOIN secrets s ON s.hub = d.hub AND s.owner = d.person AND s.kind = 'upstream' LEFT JOIN secrets m ON m.hub = d.hub AND m.owner = d.person AND m.kind = ? WHERE d.id = ? AND d.hub = ?")
    .bind(LINK, VIA, id, hub).first<{person: string; seen: number; app: string; name: string; paused: number; jf: string; value: string | null; via: string | null; trakt: number; synced: number}>();
  seats.delete(id); if (!row) return null;
  // A device signed in before its person's sign-in changed (moved to their own AIOMetadata setup, renamed) has no session there
  // yet: one is made now, so the app carries on without being signed out.
  const kind = row.via ? VIA : 'upstream', upstream = await unseal<Upstream>(env, `${hub}/${row.person}/${kind}`, row.via ?? row.value);
  const answer = upstream?.auth ? JSON.parse(upstream.auth) as Answer : upstream ? await mint(env, hub, row.person, row.jf, upstream, kind) : null;
  if (!answer) return null;
  const seat = {hub, person: row.person, jf: row.jf, paused: !!row.paused, seen: row.seen, up: answer.AccessToken, upId: answer.User.Id, at: Date.now(), on: [row.app, row.name].filter(Boolean).join(' · '), app: row.app ?? '', base: upstream?.base ?? env.UP_ORIGIN + MOUNT, kind, trakt: !!row.trakt && !!env.TRAKT_CLIENT_ID, scrobble: !!row.trakt && !!row.synced && !!env.TRAKT_CLIENT_ID};
  if (seats.size > 2000) seats.clear(); seats.set(id, seat); return seat;
}
/* Activity: players report what they are playing and how far in. The hub notes the latest state per person and title as those
   reports pass through: on start, on stop, and at most once a minute in between (once in ten minutes while it sits paused).
   Nothing is sent on a person's behalf unless their Trakt is connected and they turned its sync on (scrobble, below). */
const REPORTS: Record<string, 'start' | 'progress' | 'stop'> = {'/sessions/playing': 'start', '/sessions/playing/progress': 'progress', '/sessions/playing/stopped': 'stop'};
const noted = new Map<string, number>(), seen = new Map<string, {pos: number; at: number; paused: boolean}>(), ends = new Set<string>();
// A paused player that keeps reporting is noted once in ten minutes: still heard on Activity (src/activity.tsx), and well inside the
// half hour after which Trakt is told a quiet play stopped (QUIET in trakt.ts).
const EVERY = 60_000, PAUSED_EVERY = 600_000, APART = 1800;
async function note(env: Env, hub: string, seat: Seat, kind: 'start' | 'progress' | 'stop' | 'mark', text: string, where: {place: string; net: string}, origin: string, when = Date.now()) {
  let report: {ItemId?: string; PositionTicks?: number; IsPaused?: boolean};
  try {report = JSON.parse(text);} catch {return;}
  const item = String(report.ItemId ?? '').slice(0, 200), key = `${hub}/${seat.person}/${item}`, last = noted.get(key) ?? 0, paused = report.IsPaused === true;
  // For Trakt, a pause (or carrying on after one) counts as it happens, not at the next once-a-minute note.
  const turned = kind === 'progress' && seat.scrobble && told.get(key) !== (paused ? 'paused' : 'playing');
  // So does a jump forward or back: Trakt counts on from where it was last told, so a skip leaves it behind until told again.
  const at = Math.max(0, Number(report.PositionTicks ?? 0) / 1e7), before = seen.get(key);
  const jumped = kind === 'progress' && !!seat.scrobble && !paused && !!before && Math.abs(at - before.pos - (before.paused ? 0 : (when - before.at) / 1000)) > 60;
  if (kind === 'stop' || kind === 'mark') seen.delete(key); else {if (seen.size > 5000) seen.clear(); seen.set(key, {pos: at, at: when, paused});}
  // A pause or carrying on is noted as it happens too, so Activity knows since when; the reports between still count as heard from.
  const flipped = kind === 'progress' && !!before && before.paused !== paused;
  if (!item || (kind === 'progress' && !turned && !jumped && !flipped && when - last < (paused ? PAUSED_EVERY : EVERY))) return;
  if (noted.size > 5000) noted.clear(); noted.set(key, when);
  const stamp = Math.floor(when / 1000);
  let firstHere = false;
  // The title as last noted, and this device's latest sitting with it, in one trip.
  const [found, sat] = await env.DB.batch([env.DB.prepare('SELECT art, duration, position, playing, paused, since, updated, parts, pauses, idle FROM plays WHERE hub = ? AND person = ? AND item = ?').bind(hub, seat.person, item),
    env.DB.prepare('SELECT started, position, playing, paused, since, updated, parts, pauses, idle FROM sittings WHERE hub = ? AND person = ? AND item = ? AND device = ? ORDER BY started DESC LIMIT 1').bind(hub, seat.person, item, seat.on)]);
  const known = (found.results[0] ?? null) as Noted | null, latest = (sat.results[0] ?? null) as (Noted & {started: number}) | null;
  const position = kind === 'mark' ? known?.duration ?? 0 : Math.max(0, Math.round(Number(report.PositionTicks ?? 0) / 1e7)), playing = kind === 'stop' || kind === 'mark' ? 0 : 1;
  // Played to 90% or more (as Activity says finished), a title can bring new For you picks: by its show for an episode (its art).
  // A tick without playing is not a watch here.
  const done = (length: number, at: number, art: string) => kind !== 'start' && kind !== 'mark' && length > 0 && at >= length * 0.9 ? art || item : '';
  let ended = '';
  // Since when it has been as it is now: kept while a paused (or playing) title stays so, started again on any change.
  const pausedNow = kind === 'progress' && paused ? 1 : 0, since = known && kind === 'progress' && known.paused === pausedNow && known.since ? known.since : stamp;
  const {parts, pauses, idle} = watched(known, kind, position, pausedNow, stamp, before && kind !== 'start' ? before : undefined);
  // Activity shows each sitting as its own play: watched last night, again today and again tonight is three. A report carries on
  // this device's latest sitting with the title while that was heard from in the last half hour, whatever came between: jumps
  // around, a stop and a start again a minute later, a start sent twice. A paused player that keeps reporting is heard every ten
  // minutes, so it stays one sitting; one that goes quiet while paused and carries on hours later starts another. Another device
  // has its own. (Apps make a new PlaySessionId each time the player opens, so it says nothing about a sitting.)
  const sitting = (length: number, at: number) => {
    const goes = latest && stamp - latest.updated <= APART ? latest : null;
    if (goes) {
      const got = watched({...goes, duration: length, art: ''}, kind, at, pausedNow, stamp, before && kind !== 'start' ? before : undefined, true), from = kind === 'progress' && goes.paused === pausedNow && goes.since ? goes.since : stamp;
      return [env.DB.prepare('UPDATE sittings SET position = ?, playing = ?, paused = ?, since = ?, updated = ?, place = ?, net = ?, parts = ?, pauses = ?, idle = ? WHERE hub = ? AND person = ? AND item = ? AND started = ?').bind(at, playing, pausedNow, from, stamp, where.place, where.net, kind === 'mark' ? `${got.parts.replace(/ ?marked/g, '')} marked`.trim() : got.parts, got.pauses, got.idle, hub, seat.person, item, goes.started)];
    }
    // A stop with no sitting under way opens none: nothing was watched just then. A tick as watched is a line of its own
    // (parts "marked"), so Activity still shows it.
    if (kind === 'stop') return [];
    // A new sitting holds the empty part where it began (see watched). Not if another report opened one since this one looked:
    // two can arrive at once.
    return [env.DB.prepare('INSERT OR IGNORE INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, place, net, parts) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?4, ?4, ?9, ?10, ?11 WHERE NOT EXISTS (SELECT 1 FROM sittings WHERE hub = ?1 AND person = ?2 AND item = ?3 AND device = ?5 AND started > ?12)')
      .bind(hub, seat.person, item, stamp, seat.on, at, playing, pausedNow, where.place, where.net, kind === 'mark' ? 'marked' : `${at}-${at}`, latest?.started ?? -1)];
  };
  // Sittings not heard from in 180 days go, now and then (and what is left of the starts once kept, migration 0010).
  const tidy = Math.random() < 0.02 ? [env.DB.prepare('DELETE FROM sittings WHERE hub = ? AND updated < ?').bind(hub, stamp - 180 * 86400), env.DB.prepare('DELETE FROM starts WHERE hub = ? AND at < ?').bind(hub, stamp - 180 * 86400), env.DB.prepare('DELETE FROM fetches WHERE hub = ? AND last < ?').bind(hub, stamp - 180 * 86400)] : [];
  // Rows from before pictures were kept are looked up once more, on their next start.
  if (known && (known.art || kind !== 'start')) {await env.DB.batch([env.DB.prepare('UPDATE plays SET position = ?, playing = ?, paused = ?, since = ?, device = ?, updated = ?, place = ?, net = ?, parts = ?, pauses = ?, idle = ? WHERE hub = ? AND person = ? AND item = ?').bind(position, playing, pausedNow, since, seat.on, stamp, where.place, where.net, parts, pauses, idle, hub, seat.person, item), ...sitting(known.duration, position), ...tidy]); ended = done(known.duration, position, known.art);}
  else {
    // First report for this title: ask AIOStreams what it is called, as this person.
    const called = await calledBy(seat, item);
    if (!called) return;
    const {about, title, detail, art} = called;
    const first = !await env.DB.prepare('SELECT 1 FROM plays WHERE hub = ? AND person = ? LIMIT 1').bind(hub, seat.person).first();
    const length = Math.round(Number(about.RunTimeTicks ?? 0) / 1e7), at = kind === 'mark' ? length : position;
    await env.DB.batch([env.DB.prepare('INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art, place, net, paused, since, parts, pauses, idle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person, item) DO UPDATE SET position = excluded.position, playing = excluded.playing, paused = excluded.paused, since = excluded.since, device = excluded.device, updated = excluded.updated, art = excluded.art, place = excluded.place, net = excluded.net, parts = excluded.parts, pauses = excluded.pauses, idle = excluded.idle')
      .bind(hub, seat.person, item, title.slice(0, 200), detail.slice(0, 120), at, length, seat.on, playing, stamp, art, where.place, where.net, pausedNow, stamp, parts, pauses, idle), ...sitting(length, at), ...tidy]);
    firstHere = first; ended = done(length, at, art);
  }
  // A tick that comes while a sitting is under way (heard in the last minute) is the app's own, as it moves on to the next.
  if (seat.scrobble) await scrobble(env, hub, seat, kind, item, position, paused, jumped, !!latest && stamp - latest.updated <= 60);
  // Once per title here in each running copy: the credits report every minute past 90%.
  if (ended && !ends.has(`${hub}/${seat.person}/${ended}`)) {if (ends.size > 5000) ends.clear(); ends.add(`${hub}/${seat.person}/${ended}`); await finished(env, hub, seat.person, ended);}
  // Their first play here: Recently Watched now has something in it, so their Home gets it without waiting for the site to be opened.
  // Not for someone with Trakt connected to the hub: theirs was there already.
  if (firstHere && !seat.trakt) {const found = await env.DB.prepare('SELECT id, data FROM hubs WHERE id = ?').bind(hub).first<{id: string; data: string}>(); if (found) await syncPlayers(env, found, origin).catch(() => null);}
}
/* Which parts of a title were played, as merged "from-to" seconds. Nothing reports a seek or the playback speed, so a position
   that moved on by about the time that passed (up to twice it, plus 20 s, for faster playback and late reports) was played, and
   anything else was a jump forward or back: the next part starts where it landed. The report just before this one, where this
   running copy saw it, is a step in between, so a jump loses at most the seconds between two reports, not a minute.
   On the title's own row (plays), a rewatch starts over: a start near the beginning of a title last left at 90% or more, or of one
   not heard from in a week. A sitting (`own`) never does: watching again is a sitting of its own. A start sent again mid-play, as
   some apps do, keeps what is there. */
interface Noted {art: string; duration: number; position: number; playing: number; paused: number; since: number; updated: number; parts: string; pauses: number; idle: number}
const MOST_PARTS = 24, WEEK = 7 * 86400;
function watched(row: Noted | null, kind: string, position: number, pausedNow: number, at: number, before?: {pos: number; at: number; paused: boolean}, own = false) {
  // A title just started holds an empty part where it began ("2290-2290"), so the site knows parts are kept for it before the
  // first one is played; anything played replaces it.
  const begun = `${Math.round(position)}-${Math.round(position)}`;
  if (!row) return {parts: begun, pauses: pausedNow, idle: 0};
  const length = row.duration;
  if (!own && kind === 'start' && ((length > 0 && row.position >= length * 0.9 && position < length * 0.1) || at - row.updated > WEEK)) return {parts: begun, pauses: 0, idle: 0};
  // A title noted before parts were kept gets its start mark the next time it is started.
  if (kind === 'start' && !row.parts) return {parts: begun, pauses: row.pauses, idle: row.idle};
  let parts = row.parts.split(' ').map(part => part.split('-').map(Number)).filter(([a, b]) => b > a) as [number, number][];
  // A pause ends when the player carries on, stops or goes quiet (no word for fifteen minutes after it was last heard).
  // Only a pause of a minute or more counts: some apps report one for a moment around every jump (Streamyfin does).
  const ended = row.paused && !pausedNow && row.since ? Math.max(0, Math.min(at, row.updated + 900) - row.since) : 0, long = ended >= 60;
  const pauses = row.pauses + (long ? 1 : 0), idle = row.idle + (long ? ended : 0);
  if ((kind === 'progress' || kind === 'stop') && row.playing) {
    const steps = [{pos: row.position, at: row.updated, paused: !!row.paused}];
    if (before && before.at / 1000 > row.updated && before.at / 1000 < at) steps.push({pos: Math.round(before.pos), at: before.at / 1000, paused: before.paused});
    steps.push({pos: position, at, paused: !!pausedNow});
    for (let i = 1; i < steps.length; i++) {
      const from = steps[i - 1], to = steps[i], moved = to.pos - from.pos, took = to.at - from.at;
      if (moved > 0 && took < 900 && moved <= took * 2 + 20 && !(from.paused && to.paused)) parts = merge([...parts, [from.pos, length ? Math.min(to.pos, length) : to.pos]]);
    }
  }
  const text = parts.map(([a, b]) => `${a}-${b}`).join(' ');
  // Nothing played yet keeps what was there (the empty part a start left).
  return {parts: text && text.length <= 400 ? text : row.parts, pauses, idle};
}
/* Parts in the order they were first played: one that grows into another, or meets it, keeps the earlier one's place. Past
   MOST_PARTS, the two closest along the title are joined (the gap between them counts as played). */
function merge(parts: [number, number][]) {
  const out: [number, number][] = [], meets = (x: [number, number], y: [number, number]) => x[0] <= y[1] + 1 && y[0] <= x[1] + 1;
  for (const part of parts.filter(([a, b]) => b > a)) {
    let at = out.findIndex(held => meets(held, part));
    if (at < 0) {out.push([...part]); continue;}
    out[at] = [Math.min(out[at][0], part[0]), Math.max(out[at][1], part[1])];
    for (let other = out.findIndex((held, k) => k !== at && meets(held, out[at])); other >= 0; other = out.findIndex((held, k) => k !== at && meets(held, out[at]))) {
      const keep = Math.min(at, other), drop = Math.max(at, other);
      out[keep] = [Math.min(out[at][0], out[other][0]), Math.max(out[at][1], out[other][1])]; out.splice(drop, 1); at = keep;
    }
  }
  while (out.length > MOST_PARTS) {
    const along = out.map((part, k) => ({part, k})).sort((x, y) => x.part[0] - y.part[0]);
    let near = 1; for (let i = 2; i < along.length; i++) if (along[i].part[0] - along[i - 1].part[1] < along[near].part[0] - along[near - 1].part[1]) near = i;
    const [x, y] = [along[near - 1], along[near]], keep = Math.min(x.k, y.k), drop = Math.max(x.k, y.k);
    out[keep] = [x.part[0], y.part[1]]; out.splice(drop, 1);
  }
  return out;
}
/* For one week only, to learn what player apps really send (Strand is closed source): the names of the fields in each kind of
   playback report, never their values, except EventName and PlayMethod. One row per hub, app and shape, written when a running
   copy of the Worker first sees that shape, so `count` is how many copies saw it, not how many reports came.
   TEMPORARY: remove this, its call below and the heard_fields table (migration 0022) after HEARD_UNTIL. */
const HEARD_UNTIL = Date.UTC(2026, 11, 2), heard = new Set<string>();
async function listen(env: Env, hub: string, seat: Seat, kind: string, text: string) {
  let report: unknown; try {report = JSON.parse(text);} catch {return;}
  if (Date.now() > HEARD_UNTIL || !report || typeof report !== 'object' || Array.isArray(report)) return;
  const body = report as Record<string, unknown>, word = (value: unknown) => value == null ? '' : typeof value === 'string' && /^[A-Za-z][\w-]{0,39}$/.test(value) ? value : '?';
  const names = Object.keys(body).filter(name => /^[A-Za-z][\w-]{0,59}$/.test(name)).sort().slice(0, 80);
  const sig = `${names.join(',')} EventName=${word(body.EventName)} PlayMethod=${word(body.PlayMethod)}`, app = seat.app.slice(0, 60) || '?', key = `${hub}/${app}/${kind}/${sig}`;
  if (heard.has(key)) return;
  if (heard.size > 2000) heard.clear(); heard.add(key);
  const at = now();
  await env.DB.prepare('INSERT INTO heard_fields (hub, app, kind, sig, first, last) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (hub, app, kind, sig) DO UPDATE SET last = excluded.last, count = count + 1').bind(hub, app, kind, sig, at, at).run();
}
const asPerson = (seat: Seat) => `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="hub-${seat.jf}", Version="1", Token="${seat.up}"`;
/* What is watched here, to Trakt, for a person whose Trakt is connected and whose sync is on (see trakt.ts, sync.ts). With sync
   off none of this runs: the seat says so (kept twenty seconds), the one read below asks the database again (`synced`), so a
   seat remembered from before sync went off sends, holds and notes nothing, and deliver asks a third time.
   Starting, pausing, carrying on, stopping and ticking as watched are
   passed on as they happen, in the background; the app's own request never waits. Progress in between is not sent. A call
   Trakt does not take waits in the outbox; what Trakt was told here counts it as told, so what follows carries on from it.
   Trakt hears nothing of a sitting until enough of it has played to count (brief, in trakt.ts): a start shows there as "watching
   now" for the rest of the running time unless a stop follows, and wipes the spot Trakt kept, so one sent for something opened
   for half a minute and closed would do both. The start (and any pause) is held instead (`scrobbled` 'held'; 'held-watched' when
   Trakt had counted the title as watched before, which a tick straight after still has to know), and goes with the first report
   after the sitting counts, with how far in it is by then; from there on everything is as before. A sitting that ends while still
   brief says nothing at all. Carrying on a sitting that already counts (the same device, within half an hour) is not brief, so it
   starts at once. An app that reports only start and stop has no report in between to send the start with: its stop is sent. */
const told = new Map<string, string>();
async function scrobble(env: Env, hub: string, seat: Seat, kind: 'start' | 'progress' | 'stop' | 'mark', item: string, position: number, paused: boolean, jumped = false, during = false) {
  const key = `${hub}/${seat.person}/${item}`, want = kind === 'start' ? 'playing' : kind === 'progress' ? (paused ? 'paused' : 'playing') : 'stopped';
  if (told.size > 5000) told.clear(); told.set(key, want);
  const row = await env.DB.prepare('SELECT duration, ids, scrobbled, scrobbled_at, (SELECT matching FROM sync WHERE hub = ?1 AND person = ?2) AS synced FROM plays WHERE hub = ?1 AND person = ?2 AND item = ?3').bind(hub, seat.person, item).first<{duration: number; ids: string | null; scrobbled: string | null; scrobbled_at: number | null; synced: number | null}>();
  if (!row?.synced) return;
  // A pause or carrying on only counts inside a play Trakt was told about; a report that arrives after stop starts nothing.
  // A skip while playing is told as a fresh start from the new place.
  const skipped = jumped && want === 'playing' && row?.scrobbled === 'playing';
  // `held`: this title's start is being held back (see above). `live`: Trakt was told of a play of it that is still going.
  const held = !!row?.scrobbled?.startsWith('held'), live = row?.scrobbled === 'playing' || row?.scrobbled === 'paused';
  if (kind === 'progress' && !skipped && !held && (row.scrobbled === want || !live)) return;
  // Whether this device's sitting has too little played to count yet. A tick from the episode list a while later is no sitting.
  if (kind !== 'mark' || during) {
    const sat = await env.DB.prepare('SELECT parts, started, updated FROM sittings WHERE hub = ? AND person = ? AND item = ? AND device = ? ORDER BY started DESC LIMIT 1').bind(hub, seat.person, item, seat.on).first<{parts: string | null; started: number; updated: number}>();
    if (sat && brief(sat, row.duration)) {
      const set = (state: string, stamped: boolean) => env.DB.prepare(`UPDATE plays SET scrobbled = ?${stamped ? ', scrobbled_at = ?' : ''} WHERE hub = ? AND person = ? AND item = ?`).bind(...(stamped ? [state, now()] : [state]), hub, seat.person, item);
      // Still brief as it starts or carries on: held, unless Trakt knows of a play of this title still going (on another device):
      // that one's state is left as it is.
      if (kind === 'start' || kind === 'progress') {if (!held && !live) await set(row.scrobbled === 'watched' ? 'held-watched' : 'held', false).run(); return;}
      // A stop, or the app's own tick during the sitting, ending it while still brief (opened, run to the end, left: seen it) is
      // not a watch, and Trakt never heard of it. What was held is let go, with anything of its own still waiting to be sent, and
      // the title is as Trakt last knew it; a play still going elsewhere is not touched.
      if (held) await env.DB.batch([set(row.scrobbled === 'held-watched' ? 'watched' : 'stopped', row.scrobbled !== 'held-watched'), env.DB.prepare("DELETE FROM trakt_outbox WHERE hub = ? AND person = ? AND item = ? AND kind IN ('start', 'pause')").bind(hub, seat.person, item)]);
      else if (!live && row.scrobbled !== 'watched') await set('stopped', true).run();
      return;
    }
  }
  const ids = row.ids ?? await idsOf(env, hub, seat, item);
  if (!ids) return;
  const target = JSON.parse(ids) as Target, progress = row.duration ? progressOf(position, row.duration) : 0;
  // Many apps tick a title as watched right after a stop that Trakt already counted (or has waiting): that would be a second play.
  if (kind === 'mark' && (row.scrobbled === 'watched' || row.scrobbled === 'held-watched') && now() - (row.scrobbled_at ?? 0) < 12 * 3600) return;
  // Without a length there is no telling how far in; and under 1% there is nothing for Trakt to keep.
  if (kind !== 'mark' && !row.duration) return;
  const call = kind === 'mark' ? {kind, path: '/sync/history', body: history(target, new Date().toISOString())}
    : kind !== 'stop' || progress >= 1 ? {kind: want === 'playing' ? 'start' as const : want === 'paused' ? 'pause' as const : 'stop' as const, path: `/scrobble/${want === 'playing' ? 'start' : want === 'paused' ? 'pause' : 'stop'}`, body: {...target, progress}} : null;
  const got = call ? await deliver(env, hub, seat.person, item, call) : 'sent';
  if (got === 'off') return;
  // A stop at 80% or more is a watch on Trakt's side, as is a tick: remembered as such, so a tick straight after adds nothing.
  const kept = kind === 'mark' || (kind === 'stop' && progress >= 80) ? 'watched' : want;
  await env.DB.prepare('UPDATE plays SET scrobbled = ?, scrobbled_at = ? WHERE hub = ? AND person = ? AND item = ?').bind(kept, now(), hub, seat.person, item).run();
  if (got === 'kept') await soon(env, hub, seat.person);
}
/* What Trakt knows a title by, asked of the person's own server once and kept with the play ('' when there is nothing usable).
   A film by its own ids; an episode by its show's, with its season and number (AIOMetadata episodes carry no ids of their own). */
const aboutOf = async (seat: Seat, id: string) => (await fetch(`${seat.base}/Users/${seat.upId}/Items?Ids=${encodeURIComponent(id)}&Fields=ProviderIds`, {headers: {accept: 'application/json', authorization: asPerson(seat)}})
  .then(answer => answer.ok ? answer.json() : null).catch(() => null) as {Items?: {Type?: string; SeriesId?: string; ParentIndexNumber?: number; IndexNumber?: number; ProviderIds?: Record<string, string>}[]} | null);
const traktIds = (provider: Record<string, string> = {}) => {const tmdb = Number(provider.Tmdb), imdb = /^tt\d+$/.test(provider.Imdb ?? '') ? provider.Imdb : ''; return {...(tmdb > 0 ? {tmdb} : {}), ...(imdb ? {imdb} : {})};};
async function idsOf(env: Env, hub: string, seat: Seat, item: string): Promise<string | null> {
  const ask = (id: string) => aboutOf(seat, id);
  const found = await ask(item);
  if (!found) return null;
  const it = found.Items?.[0], episode = it?.Type === 'Episode', show = episode && it.SeriesId ? await ask(it.SeriesId) : null;
  if (episode && !show) return null;
  const ids = traktIds((episode ? show?.Items?.[0] : it)?.ProviderIds);
  const target: Target | null = !(ids.tmdb || ids.imdb) ? null : it?.Type === 'Movie' ? {movie: {ids}} : episode && it.ParentIndexNumber != null && it.IndexNumber != null ? {show: {ids}, episode: {season: it.ParentIndexNumber, number: it.IndexNumber}} : null;
  const kept = target ? JSON.stringify(target) : '';
  await env.DB.prepare('UPDATE plays SET ids = ? WHERE hub = ? AND person = ? AND item = ?').bind(kept, hub, seat.person, item).run();
  return kept;
}
/* Favorites, for a person who turned on "Show my Trakt watchlist as Favorites in the apps" (hearts.ts): a heart an app made on a
   film or a show, once their own server took it, is passed on to Trakt as a watchlist add, and a heart an app took away as a
   watchlist remove, through the outbox like any other call. THE ONLY PLACE the hub ever takes anything off someone's Trakt: in
   answer to their own app's DELETE of a favourite passing through here, with the switch on. Never from comparing lists, the cron,
   the hub's own un-hearting (which goes straight to their server, never through here), the switch going off, a disconnect or a
   removal (tests/aiom.test.mjs holds each of those to no remove).
   Whether it is on is asked of the database for each heart, never remembered (a seat is kept twenty seconds, and the switch may
   have gone off, or an MDBList key of their own come, since). The title's ids are asked of their server as scrobbling asks
   (idsOf); one with none Trakt can use, or anything but a film or a show, is left alone. What was sent is noted in the ledger:
   'own' for an add, 'gone' for a remove, dated now, so the cron neither takes their heart away nor puts one back that they
   removed. The kept Watchlist row goes, so it is read again with the change. */
const FAVOURITE = /^\/(?:users\/[^/]+\/favoriteitems|userfavoriteitems)\/([\w-]{1,80})$/i;
async function hearted(env: Env, hub: string, seat: Seat, item: string, off: boolean) {
  if (!await heartsOn(env, hub, seat.person)) return;
  const it = (await aboutOf(seat, item))?.Items?.[0], type = it?.Type === 'Movie' ? 'movie' as const : it?.Type === 'Series' ? 'series' as const : null;
  const ids = traktIds(it?.ProviderIds), key = type ? heartKey(type, ids) : '';
  if (!type || !key) return;
  const body = {[type === 'movie' ? 'movies' : 'shows']: [{ids}]};
  // Kept under the title's ledger key, never a play's id: a waiting start or pause of the same title is not ended by it.
  const got = await deliver(env, hub, seat.person, `heart:${key}`, off ? {kind: 'unheart', path: '/sync/watchlist/remove', body} : {kind: 'heart', path: '/sync/watchlist', body});
  if (got === 'off') return;
  await env.DB.batch([noteHeart(env, hub, seat.person, key, item, off ? 'gone' : 'own', now()), forgetWatchlist(env, hub, seat.person)]);
  // Kept to try again: once it has gone (or has been tried twice more), the Watchlist row is read afresh once more.
  if (got === 'kept') {await soon(env, hub, seat.person); await forgetWatchlist(env, hub, seat.person).run();}
}
/* What a title is called, asked of the person's own server as them: its name (the show's, for an episode), which episode or
   "Movie", and the id its picture is under. null when the server does not say. */
async function calledBy(seat: Seat, item: string) {
  const about = await fetch(`${seat.base}/Users/${seat.upId}/Items/${encodeURIComponent(item)}`, {headers: {accept: 'application/json', authorization: asPerson(seat)}}).then(answer => answer.status === 200 ? answer.json() : null).catch(() => null) as {Name?: string; Type?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number; RunTimeTicks?: number; SeriesId?: string} | null;
  if (!about?.Name) return null;
  const episode = about.Type === 'Episode', title = (episode ? about.SeriesName : '') || about.Name, pictured = String((episode && about.SeriesId) || item), art = /^[\w-]{1,80}$/.test(pictured) ? pictured : '';
  const detail = episode ? [about.ParentIndexNumber != null ? `Season ${about.ParentIndexNumber}` : '', about.IndexNumber != null ? `Episode ${about.IndexNumber}` : about.Name].filter(Boolean).join(' · ') : 'Movie';
  return {about, title, detail, art};
}
/* A title's file asked for by an app (migration 0028): noted per person, title and device, in the background. Every play asks for
   the file as well; which fetches were downloads is worked out when Activity is read (api.ts), from whether a sitting goes with
   it. `asked`: the app used the download address itself. Asked again within ten minutes by the same running copy is not noted
   twice; the title's name is asked for once. */
const FETCH = /^\/(?:videos\/([\w-]{1,80})\/stream(?:\.\w{1,8})?|items\/([\w-]{1,80})\/(?:download|file))$/, fetchedAt = new Map<string, number>(), SAME_FETCH = 1800;
async function fetched(env: Env, hub: string, seat: Seat, id: string, asked: boolean, when: number) {
  const item = id.toLowerCase().replace(/-/g, ''), key = `${hub}/${seat.person}/${item}/${seat.on}/${asked ? 1 : 0}`, stamp = Math.floor(when / 1000);
  if (Math.abs(stamp - (fetchedAt.get(key) ?? 0)) < 600) return;
  if (fetchedAt.size > 5000) fetchedAt.clear(); fetchedAt.set(key, stamp);
  const row = await env.DB.prepare(`INSERT INTO fetches (hub, person, item, device, at, last, asked) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6) ON CONFLICT (hub, person, item, device) DO UPDATE SET
    at = CASE WHEN excluded.at - fetches.last > ${SAME_FETCH} THEN excluded.at ELSE fetches.at END, asked = CASE WHEN excluded.at - fetches.last > ${SAME_FETCH} THEN excluded.asked ELSE max(fetches.asked, excluded.asked) END, last = max(fetches.last, excluded.last) RETURNING title`)
    .bind(hub, seat.person, item, seat.on, stamp, asked ? 1 : 0).first<{title: string | null}>();
  if (row?.title) return;
  const called = await calledBy(seat, id);
  if (called) await env.DB.prepare('UPDATE fetches SET title = ?, detail = ?, art = ? WHERE hub = ? AND person = ? AND item = ? AND device = ?').bind(called.title.slice(0, 200), called.detail.slice(0, 120), called.art, hub, seat.person, item, seat.on).run();
}
/* Paused: browsing works, playing does not. */
const PLAYS = /\/playbackinfo|\/mediasources|\/download|^\/(videos|audio)\//;
const noSources = (value: unknown): unknown => Array.isArray(value) ? value.map(noSources) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'MediaSources' && name !== 'MediaStreams').map(([name, item]) => [name, noSources(item)])) : value;

async function signIn(request: Request, env: Env, hub: string, base: string): Promise<Response> {
  const sent = await request.json().catch(() => ({})) as {Username?: string; Pw?: string};
  // People type their own name. Capitals, spaces and punctuation do not matter.
  const username = slug(String(sent.Username ?? '')), wrong = json(401, {Message: 'Invalid username or password'});
  const key = guesses(request, `app:${hub}:${username.slice(0, 40)}`);
  if (await blocked(env, key)) return json(429, {Message: 'Too many tries. Wait ten minutes.'});
  const person = await env.DB.prepare('SELECT id, jf, name FROM people WHERE hub = ? AND login = ?').bind(hub, username).first<{id: string; jf: string; name: string}>();
  const signin = person ? await getSecret<{password: string}>(env, hub, person.id, 'signin') : null;
  if (!person || !signin || !await same(String(sent.Pw ?? ''), signin.password)) {await failed(env, key); return wrong;}
  return letIn(env, hub, person, clientOf(request), whereOf(request, env), base);
}
/* Lets one app in as a person: its own token, a line under Devices, and the sign-in answer a Jellyfin app expects. */
async function letIn(env: Env, hub: string, person: {id: string; jf: string; name: string}, client: {device: string; name: string; app: string}, where: {place: string; net: string}, base: string): Promise<Response> {
  const via = await getSecret<Upstream>(env, hub, person.id, VIA), kind = via ? VIA : 'upstream', upstream = via ?? await getSecret<Upstream>(env, hub, person.id, 'upstream');
  if (!upstream) return json(401, {Message: 'This profile is not ready to play yet'});
  const answer = upstream.auth ? JSON.parse(upstream.auth) as Answer : await mint(env, hub, person.id, person.jf, upstream, kind);
  if (!answer) return json(502, {Message: 'The server behind this hub did not accept the sign-in'});
  const token = newToken('hub'), at = now();
  await env.DB.batch([
    ...(client.device ? [env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ? AND device = ?').bind(hub, person.id, client.device)] : []),
    env.DB.prepare('INSERT INTO devices (id, ref, hub, person, device, app, name, seen, created, place, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(await sha(token), newId().slice(0, 16), hub, person.id, client.device, client.app, client.name, at, at, where.place, where.net),
    env.DB.prepare('DELETE FROM devices WHERE hub = ?1 AND person = ?2 AND id NOT IN (SELECT id FROM devices WHERE hub = ?1 AND person = ?2 ORDER BY seen DESC LIMIT ?3)').bind(hub, person.id, MOST_DEVICES),
  ]);
  const up = answer.AccessToken, upId = answer.User.Id;
  answer.User.Name = person.name;
  if (answer.SessionInfo) Object.assign(answer.SessionInfo, {DeviceId: client.device, DeviceName: client.name, Client: client.app, UserName: person.name});
  const text = outward(JSON.stringify(answer), upId, person.jf, via ? await serverIdOf(env) : '', false);
  return new Response(swap(text, [[upstream.base ?? env.UP_ORIGIN + MOUNT, base], [up, token], [upId, person.jf]]), {status: 200, headers: {'content-type': 'application/json', ...CORS}});
}


/* Quick Connect. The TV starts a request and shows its code; whoever types that code on the site decides who the TV becomes. */
const quickView = (row: {code: string; person: string | null; device: string; app: string; name: string}, secret: string) => ({Authenticated: !!row.person, Secret: secret, Code: row.code, DeviceId: row.device, DeviceName: row.name, AppName: row.app, AppVersion: '', DateAdded: new Date().toISOString()});
async function quick(request: Request, env: Env, hub: string, url: URL, lower: string, base: string): Promise<Response> {
  if (lower === '/quickconnect/initiate') {
    // Counted per address and hub on its own, so starting Quick Connect never uses up anyone's sign-in tries.
    const key: [string, number][] = [[`quick-start:${hub}:${request.headers.get('cf-connecting-ip') ?? 'local'}`, 20]];
    if (await blocked(env, key)) return json(429, {Message: 'Too many tries. Wait ten minutes.'});
    await failed(env, key);
    const secret = newToken('q'), client = clientOf(request), code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
    await env.DB.batch([env.DB.prepare('DELETE FROM quick WHERE expires < ?').bind(now()), env.DB.prepare('INSERT INTO quick (secret, hub, code, device, app, name, expires) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await sha(secret), hub, code, client.device, client.app, client.name, now() + 600)]);
    return json(200, quickView({code, person: null, ...client}, secret));
  }
  // Jellyfin reads names in any case; Streamyfin sends {secret}.
  const sent = lower === '/quickconnect/connect' ? {Secret: url.searchParams.get('secret') ?? url.searchParams.get('Secret') ?? ''} : await request.json().catch(() => ({})) as {Secret?: string; secret?: string};
  const secret = String(sent.Secret ?? sent.secret ?? ''), row = secret ? await env.DB.prepare('SELECT code, person, device, app, name FROM quick WHERE secret = ? AND hub = ? AND expires > ?').bind(await sha(secret), hub, now()).first<{code: string; person: string | null; device: string; app: string; name: string}>() : null;
  if (!row) return json(404, {Message: 'This request has run out. Start again on the TV.'});
  if (lower === '/quickconnect/connect') return json(200, quickView(row, secret));
  if (!row.person) return json(401, {Message: 'Not approved yet'});
  const person = await env.DB.prepare('SELECT id, jf, name FROM people WHERE hub = ? AND id = ?').bind(hub, row.person).first<{id: string; jf: string; name: string}>();
  if (!person) return json(401, {Message: 'Not approved'});
  await env.DB.prepare('DELETE FROM quick WHERE secret = ?').bind(await sha(secret)).run();
  return letIn(env, hub, person, {device: row.device, app: row.app, name: row.name}, whereOf(request, env), base);
}

export async function front(request: Request, site: Env, ctx: ExecutionContext, url: URL, code: string, path: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
  const found = await hubOf(site, code); if (!found) return json(404, {Message: 'Not found'});
  const hub = found.id, env: Env = {...site, UP_ORIGIN: found.up};
  const lower = path.toLowerCase(), base = `${url.origin}/h/${code}`, started = Date.now(), reading = request.method === 'GET' || request.method === 'HEAD';
  // Things the hub answers itself.
  // Player apps link Quick Connect to Jellyfin's web page (/web/#/quickconnect?code=…). Here the site asks who the TV is for: the
  // browser keeps the part after # through the redirect, and the hub code rides along.
  if (lower === '/web' || lower.startsWith('/web/')) return new Response(null, {status: 302, headers: {location: `${url.origin}/?tv=${encodeURIComponent(code)}`, 'cache-control': 'no-store'}});
  if (lower === '/quickconnect/enabled') return json(200, true);
  if (lower === '/quickconnect/initiate' || lower === '/quickconnect/connect' || (lower === '/users/authenticatewithquickconnect' && request.method === 'POST')) return quick(request, env, hub, url, lower, base);
  if (lower.startsWith('/quickconnect/') || /^\/users\/([^/]+\/)?password$/.test(lower) || lower === '/users/new') return json(403, {Message: 'Not available here'});
  if (lower === '/users/public') return json(200, []);
  // AIOStreams' own extras for switching between household users. Its token route would hand out a raw AIOStreams sign-in for
  // anyone in the household, so it is never passed on; nobody switches user here, they sign in as themselves.
  if (lower.startsWith('/aiostreams/token')) return json(403, {Message: 'Not available here'});
  if (lower === '/users/authenticatebyname' && request.method === 'POST') return signIn(request, env, hub, base);
  const picture = request.method === 'GET' && PICTURE.test(lower) ? `${hub}${path}${url.search}` : '', kept = picture ? pictures.get(picture) : undefined;
  if (kept && kept.until > Date.now()) return new Response(null, {status: 302, headers: {...CORS, location: kept.location, 'cache-control': PICTURE_KEEP}});
  if (found.pictures && picture && AIOM_ITEM.test(lower)) return new Response(null, {status: 302, headers: {...CORS, location: found.pictures + path + url.search, 'cache-control': PICTURE_KEEP}});

  const token = tokenOf(request, url), id = token ? await sha(token) : '', seat = token ? await seatOf(env, hub, id) : null;
  if (token && !seat) return json(401, {Message: 'Unauthorized'});
  if (!seat && !reading) return json(401, {Message: 'Unauthorized'});
  if (seat) {
    if (lower === '/sessions/logout') {seats.delete(id); await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run(); return new Response(null, {status: 204, headers: CORS});}
    // Deliberately unbothered: no reason, no blame, nobody to chase. It just isn't on right now.
    if (seat.paused && PLAYS.test(lower)) return json(403, {Message: 'Not playing right now. Try again later.'});
    if (seat.kind === VIA && AIOM_PRIVATE.test(lower)) return json(403, {Message: 'Not available here'});
    if (now() - seat.seen > SEEN_EVERY) {const where = whereOf(request, env); seat.seen = now(); ctx.waitUntil(env.DB.prepare('UPDATE devices SET seen = ?, place = ?, net = ? WHERE id = ?').bind(seat.seen, where.place, where.net, id).run());}
  }
  const body = reading ? undefined : await request.text();
  if (seat && body && REPORTS[lower]) ctx.waitUntil(listen(env, hub, seat, REPORTS[lower], body).catch(() => {}));
  if (seat && body && REPORTS[lower]) ctx.waitUntil(note(env, hub, seat, REPORTS[lower], body, whereOf(request, env), url.origin, whenOf(request, env)).catch(() => {}));
  // Ticked as watched in an app without playing it: kept like a finished play, so it can be copied to MDBList later too.
  const ticked = seat && request.method === 'POST' ? /^\/(?:users\/[^/]+\/playeditems|userplayeditems)\/([\w-]{1,80})$/i.exec(path) : null;
  if (seat && ticked) ctx.waitUntil(note(env, hub, seat, 'mark', JSON.stringify({ItemId: ticked[1]}), whereOf(request, env), url.origin, whenOf(request, env)).catch(() => {}));
  // AIOMetadata's libraries are its catalog rows, so "watched, in this library" only covers what the row shows today. In a real
  // Jellyfin server a library holds everything, which is what history readers (Trakt's own Jellyfin sync) rely on: they ask
  // library by library. So a watched list asked for under one of the person's own top-level libraries is answered from all of
  // what they have watched. Anything else under a parent (a show, a season, a folder) is passed on as asked.
  let search = url.search;
  if (seat?.kind === VIA && reading && /^\/(users\/[^/]+\/)?items$/.test(lower)) {
    const params = new URLSearchParams(url.search), named = (name: string) => [...params.keys()].filter(key => key.toLowerCase() === name);
    const parent = named('parentid').map(key => params.get(key))[0], played = named('isplayed').map(key => params.get(key)?.toLowerCase())[0];
    if (parent && played === 'true' && (await librariesOf(seat)).has(parent)) {for (const key of named('parentid')) params.delete(key); search = `?${params}`;}
  }
  const send = (live: Seat | null) => {
    const headers = new Headers(), inbound: [string, string][] = live ? [[token, live.up], [live.jf, live.upId]] : [];
    for (const name of [...AUTH_HEADERS, 'content-type', 'accept', 'user-agent', 'range', 'accept-language']) {const value = request.headers.get(name); if (value) headers.set(name, swap(value, AUTH_HEADERS.includes(name) ? inbound : []));}
    const target = (live?.base ?? env.UP_ORIGIN + MOUNT) + swap(path, inbound) + swap(search, inbound);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return fetch(target, {headers: {upgrade: 'websocket'}});
    return fetch(target, {method: request.method, headers, body: body === undefined ? undefined : swap(body, inbound), redirect: 'manual'});
  };
  let live = seat, upstream = await send(live);
  if (upstream.status === 101) return upstream;
  if (live && upstream.status === 401) {
    // AIOStreams no longer accepts the kept sign-in (its password or PIN changed). Sign in again once and retry.
    // Another request may already have done so; only sign in again if the kept one is the one that was just refused.
    seats.delete(id);
    const kept = await getSecret<Upstream>(env, hub, live.person, live.kind);
    let fresh = kept?.auth ? JSON.parse(kept.auth) as Answer : null;
    if (kept && (!fresh || fresh.AccessToken === live.up)) fresh = await mint(env, hub, live.person, live.jf, kept, live.kind);
    if (fresh && fresh.AccessToken !== live.up) {live = {...live, up: fresh.AccessToken, upId: fresh.User.Id}; upstream = await send(live);}
  }
  // A heart made or taken away in an app, once their own server took it (2xx): passed on to their Trakt watchlist if they
  // turned that on (see hearted). Only ever from here, after the answer, for a request an app sent.
  const heart = live && live.kind === VIA && live.trakt && upstream.ok && (request.method === 'POST' || request.method === 'DELETE') ? FAVOURITE.exec(path) : null;
  if (live && heart) ctx.waitUntil(hearted(env, hub, live, heart[1], request.method === 'DELETE').catch(() => {}));
  // A title's file handed over: noted, for the download lines on Activity (see fetched).
  const file = live && request.method === 'GET' && upstream.status < 400 ? FETCH.exec(lower) : null;
  if (live && file && (file[2] || [...url.searchParams].some(([name, value]) => name.toLowerCase() === 'static' && value.toLowerCase() === 'true'))) ctx.waitUntil(fetched(env, hub, live, path.split('/')[2], !!file[2], whenOf(request, env)).catch(() => {}));
  const out = new Headers(CORS), type = upstream.headers.get('content-type') ?? '';
  if (type) out.set('content-type', type);
  for (const name of ['cache-control', 'etag', 'last-modified', 'content-range', 'accept-ranges']) {const value = upstream.headers.get(name); if (value) out.set(name, value);}
  const location = upstream.headers.get('location'), from = live?.base ?? env.UP_ORIGIN + MOUNT;
  if (location) out.set('location', location.startsWith(from) ? base + location.slice(from.length) : location);
  out.set('x-hub-upstream-ms', String(Date.now() - started));
  if (picture && upstream.status === 302 && location && !location.startsWith(env.UP_ORIGIN)) {
    if (pictures.size > 5000) pictures.clear();
    pictures.set(picture, {location, until: Date.now() + 3_600_000}); out.set('cache-control', PICTURE_KEEP);
    return new Response(null, {status: 302, headers: out});
  }
  if (!/json|text/.test(type)) return new Response(upstream.body, {status: upstream.status, headers: out});

  let text = await upstream.text();
  if (live) {
    if (live.kind === VIA) text = outward(swap(text, [[live.base, base]]), live.upId, live.jf, await serverIdOf(env), lower.startsWith('/system/info'));
    text = swap(text, [[live.upId, live.jf], [live.up, token]]);
    // Only ever show a person themselves, never the rest of the household.
    if (lower === '/users' || lower === '/aiostreams/users') {try {const users = JSON.parse(text) as {Id: string}[]; text = JSON.stringify(users.filter(user => user.Id === live!.jf));} catch {/* leave as is */}}
    if (live.paused && type.includes('json')) {try {text = JSON.stringify(noSources(JSON.parse(text)));} catch {/* leave as is */}}
  }
  text = swap(text, [[from, base], [env.UP_ORIGIN + MOUNT, base]]);
  // Server info also names the AIOStreams host in a couple of extra fields. Drop any that still do.
  // And it must not say sign-in is by a setup's id: here people sign in with their own name.
  if (lower.startsWith('/system/info') && text.includes('configSignIn')) {try {const info = JSON.parse(text) as {aiostreams?: {features?: Record<string, unknown>}}; if (info.aiostreams?.features) delete info.aiostreams.features.configSignIn; text = JSON.stringify(info);} catch {/* leave as is */}}
  // The app names the server after what it says it is: here that is the hub, whichever setup answered.
  if (lower.startsWith('/system/info') && type.includes('json')) {try {const info = JSON.parse(text) as {ServerName?: string}; if ('ServerName' in info) {info.ServerName = found.name; text = JSON.stringify(info);}} catch {/* leave as is */}}
  const hosts = [env.UP_ORIGIN, ...(live?.kind === VIA ? [new URL(live.base).origin] : [])];
  if (lower.startsWith('/system/info') && hosts.some(host => text.includes(host))) {
    const strip = (value: unknown): unknown => typeof value === 'string' ? (hosts.some(host => value.includes(host)) ? undefined : value) : Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, strip(item)])) : value;
    try {text = JSON.stringify(strip(JSON.parse(text)));} catch {/* leave as is */}
  }
  out.set('x-hub-total-ms', String(Date.now() - started));
  return new Response(text, {status: upstream.status, headers: out});
}
