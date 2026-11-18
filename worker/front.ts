// The sign-in front. People point any Jellyfin app at  https://<site>/h/<code>  and type their hub username and password.
// The hub keeps one AIOStreams sign-in per person, and gives each app its own token that it can look up and take away.
// An app never sees the AIOStreams sign-in, token, user id or player address. Video links and poster links pass through
// untouched, so video and artwork go straight from the device to where they are kept and never through here. (Some
// poster links point at the AIOStreams host's public image cache; they carry no sign-in.)
// Taking a token away (sign-out, pause) reaches every running copy of the Worker within about twenty seconds.
import {slug} from '../src/data';
import type {Env} from './util';
import {blocked, failed, getSecret, guesses, newId, newToken, now, putSecret, same, sha, unseal} from './util';

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
/* Roughly where a request came from, as Cloudflare places it: city and country, and the network's name. The address is not kept. */
function whereOf(request: Request) {
  const cf = (request.cf ?? {}) as {city?: string; country?: string; asOrganization?: string};
  return {place: [cf.city, cf.country].filter(Boolean).join(', ').slice(0, 60), net: String(cf.asOrganization ?? '').slice(0, 60)};
}

// Where each picture lives. Asking AIOStreams costs 0.2-1.8 s per poster (measured 2026-11-18), and the answer is a redirect that
// rarely changes, so each running copy of the Worker remembers it for an hour and browsers keep it for a day. Adds no requests.
const pictures = new Map<string, {location: string; until: number}>(), PICTURE = /^\/items\/[^/]+\/images\//, PICTURE_KEEP = 'public, max-age=86400';
interface Upstream {user: string; pass: string; auth?: string}
interface Answer {AccessToken: string; User: {Id: string; Name?: string}; SessionInfo?: Record<string, unknown>}
interface Seat {person: string; jf: string; paused: boolean; seen: number; up: string; upId: string; at: number; on: string}
// Kept for a few seconds per running copy of the Worker, so a page of posters is one lookup, not fifty.
const hubs = new Map<string, {id: string; up: string; at: number}>(), seats = new Map<string, Seat>();

async function hubOf(env: Env, code: string) {
  const known = hubs.get(code); if (known && Date.now() - known.at < 60_000) return known;
  const row = await env.DB.prepare('SELECT id, data FROM hubs WHERE code = ?').bind(code).first<{id: string; data: string}>();
  if (!row) return null;
  // Each hub can use its own AIOStreams server; everything below talks to that one.
  const found = {id: row.id, up: (JSON.parse(row.data) as {hostUrl?: string}).hostUrl || env.UP_ORIGIN, at: Date.now()};
  hubs.set(code, found); return found;
}
/* Signs in to AIOStreams as this person and keeps the answer, so it happens once and not on every app sign-in. */
async function mint(env: Env, hub: string, person: string, jf: string, upstream: Upstream): Promise<Answer | null> {
  // A brake: AIOStreams allows only a few sign-ins per address, so one person gets at most two in ten minutes, however often it says no.
  const brake: [string, number][] = [[`mint:${hub}:${person}`, 2]];
  if (await blocked(env, brake)) return null;
  await failed(env, brake);
  const answer = await fetch(`${env.UP_ORIGIN}${MOUNT}/Users/AuthenticateByName`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="hub-${jf}", Version="1"`}, body: JSON.stringify({Username: upstream.user, Pw: upstream.pass})});
  if (answer.status !== 200) return null;
  const auth = await answer.text();
  await (await putSecret(env, hub, person, 'upstream', {...upstream, auth})).run();
  return JSON.parse(auth) as Answer;
}
async function seatOf(env: Env, hub: string, id: string): Promise<Seat | null> {
  const known = seats.get(id); if (known && Date.now() - known.at < REMEMBER) return known;
  const row = await env.DB.prepare("SELECT d.person, d.seen, d.app, d.name, p.paused OR coalesce(json_extract(g.data, '$.paused'), 0) AS paused, p.jf, s.value FROM devices d JOIN people p ON p.hub = d.hub AND p.id = d.person LEFT JOIN groups g ON g.hub = p.hub AND g.id = p.grp LEFT JOIN secrets s ON s.hub = d.hub AND s.owner = d.person AND s.kind = 'upstream' WHERE d.id = ? AND d.hub = ?")
    .bind(id, hub).first<{person: string; seen: number; app: string; name: string; paused: number; jf: string; value: string | null}>();
  seats.delete(id); if (!row) return null;
  const upstream = await unseal<Upstream>(env, `${hub}/${row.person}/upstream`, row.value), answer = upstream?.auth ? JSON.parse(upstream.auth) as Answer : null;
  if (!answer) return null;
  const seat = {person: row.person, jf: row.jf, paused: !!row.paused, seen: row.seen, up: answer.AccessToken, upId: answer.User.Id, at: Date.now(), on: [row.app, row.name].filter(Boolean).join(' · ')};
  if (seats.size > 2000) seats.clear(); seats.set(id, seat); return seat;
}
/* Activity: players report what they are playing and how far in. The hub notes the latest state per person and title as those
   reports pass through: on start, on stop, and at most once a minute in between. Nothing is ever sent on a person's behalf. */
const REPORTS: Record<string, 'start' | 'progress' | 'stop'> = {'/sessions/playing': 'start', '/sessions/playing/progress': 'progress', '/sessions/playing/stopped': 'stop'};
const noted = new Map<string, number>();
async function note(env: Env, hub: string, seat: Seat, kind: 'start' | 'progress' | 'stop', text: string) {
  let report: {ItemId?: string; PositionTicks?: number; IsPaused?: boolean};
  try {report = JSON.parse(text);} catch {return;}
  const item = String(report.ItemId ?? '').slice(0, 200), key = `${hub}/${seat.person}/${item}`, last = noted.get(key) ?? 0;
  if (!item || (kind === 'progress' && Date.now() - last < 60_000)) return;
  if (noted.size > 5000) noted.clear(); noted.set(key, Date.now());
  if (kind === 'start') {
    await env.DB.prepare('INSERT INTO starts (hub, person, item, device, at) VALUES (?, ?, ?, ?, ?)').bind(hub, seat.person, item, seat.on, now()).run();
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM starts WHERE hub = ? AND at < ?').bind(hub, now() - 180 * 86400).run();
  }
  const position = Math.max(0, Math.round(Number(report.PositionTicks ?? 0) / 1e7)), playing = kind === 'stop' ? 0 : 1;
  const known = await env.DB.prepare('SELECT art FROM plays WHERE hub = ? AND person = ? AND item = ?').bind(hub, seat.person, item).first<{art: string}>();
  // Rows from before pictures were kept are looked up once more, on their next start.
  if (known && (known.art || kind !== 'start')) {await env.DB.prepare('UPDATE plays SET position = ?, playing = ?, device = ?, updated = ? WHERE hub = ? AND person = ? AND item = ?').bind(position, playing, seat.on, now(), hub, seat.person, item).run(); return;}
  // First report for this title: ask AIOStreams what it is called, as this person.
  const about = await fetch(`${env.UP_ORIGIN}${MOUNT}/Users/${seat.upId}/Items/${encodeURIComponent(item)}`, {headers: {accept: 'application/json', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="hub-${seat.jf}", Version="1", Token="${seat.up}"`}}).then(answer => answer.status === 200 ? answer.json() : null).catch(() => null) as {Name?: string; Type?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number; RunTimeTicks?: number; SeriesId?: string} | null;
  if (!about?.Name) return;
  const episode = about.Type === 'Episode', title = (episode ? about.SeriesName : '') || about.Name, pictured = String((episode && about.SeriesId) || item), art = /^[\w-]{1,80}$/.test(pictured) ? pictured : '';
  const detail = episode ? [about.ParentIndexNumber != null ? `Season ${about.ParentIndexNumber}` : '', about.IndexNumber != null ? `Episode ${about.IndexNumber}` : about.Name].filter(Boolean).join(' · ') : 'Movie';
  await env.DB.prepare('INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person, item) DO UPDATE SET position = excluded.position, playing = excluded.playing, device = excluded.device, updated = excluded.updated, art = excluded.art')
    .bind(hub, seat.person, item, title.slice(0, 200), detail.slice(0, 120), position, Math.round(Number(about.RunTimeTicks ?? 0) / 1e7), seat.on, playing, now(), art).run();
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
  return letIn(env, hub, person, clientOf(request), whereOf(request), base);
}
/* Lets one app in as a person: its own token, a line under Devices, and the sign-in answer a Jellyfin app expects. */
async function letIn(env: Env, hub: string, person: {id: string; jf: string; name: string}, client: {device: string; name: string; app: string}, where: {place: string; net: string}, base: string): Promise<Response> {
  const upstream = await getSecret<Upstream>(env, hub, person.id, 'upstream');
  if (!upstream) return json(401, {Message: 'This profile is not ready to play yet'});
  const answer = upstream.auth ? JSON.parse(upstream.auth) as Answer : await mint(env, hub, person.id, person.jf, upstream);
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
  return new Response(swap(JSON.stringify(answer), [[up, token], [upId, person.jf], [env.UP_ORIGIN + MOUNT, base]]), {status: 200, headers: {'content-type': 'application/json', ...CORS}});
}


/* Quick Connect. The TV starts a request and shows its code; whoever types that code on the site decides who the TV becomes. */
const quickView = (row: {code: string; person: string | null; device: string; app: string; name: string}, secret: string) => ({Authenticated: !!row.person, Secret: secret, Code: row.code, DeviceId: row.device, DeviceName: row.name, AppName: row.app, AppVersion: '', DateAdded: new Date().toISOString()});
async function quick(request: Request, env: Env, hub: string, url: URL, lower: string, base: string): Promise<Response> {
  if (lower === '/quickconnect/initiate') {
    const key = guesses(request, `quick-start:${hub}`);
    if (await blocked(env, [[key[1][0], 20]])) return json(429, {Message: 'Too many tries. Wait ten minutes.'});
    await failed(env, [[key[1][0], 20]]);
    const secret = newToken('q'), client = clientOf(request), code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
    await env.DB.batch([env.DB.prepare('DELETE FROM quick WHERE expires < ?').bind(now()), env.DB.prepare('INSERT INTO quick (secret, hub, code, device, app, name, expires) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await sha(secret), hub, code, client.device, client.app, client.name, now() + 600)]);
    return json(200, quickView({code, person: null, ...client}, secret));
  }
  const sent = lower === '/quickconnect/connect' ? {Secret: url.searchParams.get('secret') ?? url.searchParams.get('Secret') ?? ''} : await request.json().catch(() => ({})) as {Secret?: string};
  const secret = String(sent.Secret ?? ''), row = secret ? await env.DB.prepare('SELECT code, person, device, app, name FROM quick WHERE secret = ? AND hub = ? AND expires > ?').bind(await sha(secret), hub, now()).first<{code: string; person: string | null; device: string; app: string; name: string}>() : null;
  if (!row) return json(404, {Message: 'This request has run out. Start again on the TV.'});
  if (lower === '/quickconnect/connect') return json(200, quickView(row, secret));
  if (!row.person) return json(401, {Message: 'Not approved yet'});
  const person = await env.DB.prepare('SELECT id, jf, name FROM people WHERE hub = ? AND id = ?').bind(hub, row.person).first<{id: string; jf: string; name: string}>();
  if (!person) return json(401, {Message: 'Not approved'});
  await env.DB.prepare('DELETE FROM quick WHERE secret = ?').bind(await sha(secret)).run();
  return letIn(env, hub, person, {device: row.device, app: row.app, name: row.name}, whereOf(request), base);
}

export async function front(request: Request, site: Env, ctx: ExecutionContext, url: URL, code: string, path: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
  const found = await hubOf(site, code); if (!found) return json(404, {Message: 'Not found'});
  const hub = found.id, env: Env = {...site, UP_ORIGIN: found.up};
  const lower = path.toLowerCase(), base = `${url.origin}/h/${code}`, started = Date.now(), reading = request.method === 'GET' || request.method === 'HEAD';
  // Things the hub answers itself.
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

  const token = tokenOf(request, url), id = token ? await sha(token) : '', seat = token ? await seatOf(env, hub, id) : null;
  if (token && !seat) return json(401, {Message: 'Unauthorized'});
  if (!seat && !reading) return json(401, {Message: 'Unauthorized'});
  if (seat) {
    if (lower === '/sessions/logout') {seats.delete(id); await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run(); return new Response(null, {status: 204, headers: CORS});}
    // Deliberately vague: it says nothing about who switched it off, or why.
    if (seat.paused && PLAYS.test(lower)) return json(403, {Message: 'Meh, can’t play right now.'});
    if (now() - seat.seen > SEEN_EVERY) {const where = whereOf(request); seat.seen = now(); ctx.waitUntil(env.DB.prepare('UPDATE devices SET seen = ?, place = ?, net = ? WHERE id = ?').bind(seat.seen, where.place, where.net, id).run());}
  }
  const body = reading ? undefined : await request.text();
  if (seat && body && REPORTS[lower]) ctx.waitUntil(note(env, hub, seat, REPORTS[lower], body).catch(() => {}));
  const send = (live: Seat | null) => {
    const headers = new Headers(), inbound: [string, string][] = live ? [[token, live.up], [live.jf, live.upId]] : [];
    for (const name of [...AUTH_HEADERS, 'content-type', 'accept', 'user-agent', 'range', 'accept-language']) {const value = request.headers.get(name); if (value) headers.set(name, swap(value, AUTH_HEADERS.includes(name) ? inbound : []));}
    const target = env.UP_ORIGIN + MOUNT + swap(path, inbound) + swap(url.search, inbound);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return fetch(target, {headers: {upgrade: 'websocket'}});
    return fetch(target, {method: request.method, headers, body: body === undefined ? undefined : swap(body, inbound), redirect: 'manual'});
  };
  let live = seat, upstream = await send(live);
  if (upstream.status === 101) return upstream;
  if (live && upstream.status === 401) {
    // AIOStreams no longer accepts the kept sign-in (its password or PIN changed). Sign in again once and retry.
    // Another request may already have done so; only sign in again if the kept one is the one that was just refused.
    seats.delete(id);
    const kept = await getSecret<Upstream>(env, hub, live.person, 'upstream');
    let fresh = kept?.auth ? JSON.parse(kept.auth) as Answer : null;
    if (kept && (!fresh || fresh.AccessToken === live.up)) fresh = await mint(env, hub, live.person, live.jf, kept);
    if (fresh && fresh.AccessToken !== live.up) {live = {...live, up: fresh.AccessToken, upId: fresh.User.Id}; upstream = await send(live);}
  }
  const out = new Headers(CORS), type = upstream.headers.get('content-type') ?? '';
  if (type) out.set('content-type', type);
  for (const name of ['cache-control', 'etag', 'last-modified', 'content-range', 'accept-ranges']) {const value = upstream.headers.get(name); if (value) out.set(name, value);}
  const location = upstream.headers.get('location');
  if (location) out.set('location', location.startsWith(env.UP_ORIGIN + MOUNT) ? base + location.slice((env.UP_ORIGIN + MOUNT).length) : location);
  out.set('x-hub-upstream-ms', String(Date.now() - started));
  if (picture && upstream.status === 302 && location && !location.startsWith(env.UP_ORIGIN)) {
    if (pictures.size > 5000) pictures.clear();
    pictures.set(picture, {location, until: Date.now() + 3_600_000}); out.set('cache-control', PICTURE_KEEP);
    return new Response(null, {status: 302, headers: out});
  }
  if (!/json|text/.test(type)) return new Response(upstream.body, {status: upstream.status, headers: out});

  let text = await upstream.text();
  if (live) {
    text = swap(text, [[live.upId, live.jf], [live.up, token]]);
    // Only ever show a person themselves, never the rest of the household.
    if (lower === '/users' || lower === '/aiostreams/users') {try {const users = JSON.parse(text) as {Id: string}[]; text = JSON.stringify(users.filter(user => user.Id === live!.jf));} catch {/* leave as is */}}
    if (live.paused && type.includes('json')) {try {text = JSON.stringify(noSources(JSON.parse(text)));} catch {/* leave as is */}}
  }
  text = swap(text, [[env.UP_ORIGIN + MOUNT, base]]);
  // Server info also names the AIOStreams host in a couple of extra fields. Drop any that still do.
  // And it must not say sign-in is by a setup's id: here people sign in with their own name.
  if (lower.startsWith('/system/info') && text.includes('configSignIn')) {try {const info = JSON.parse(text) as {aiostreams?: {features?: Record<string, unknown>}}; if (info.aiostreams?.features) delete info.aiostreams.features.configSignIn; text = JSON.stringify(info);} catch {/* leave as is */}}
  if (lower.startsWith('/system/info') && text.includes(env.UP_ORIGIN)) {
    const strip = (value: unknown): unknown => typeof value === 'string' ? (value.includes(env.UP_ORIGIN) ? undefined : value) : Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, strip(item)])) : value;
    try {text = JSON.stringify(strip(JSON.parse(text)));} catch {/* leave as is */}
  }
  out.set('x-hub-total-ms', String(Date.now() - started));
  return new Response(text, {status: upstream.status, headers: out});
}
