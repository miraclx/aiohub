// The site's own API: managers' accounts, the hub they run, and what an invited person may change about themselves.
// What reaches the streaming server goes through ./native.
import {carry, mdblist, plan} from './carry';
import {fix, looked, skip, skippedOf} from './drift';
import {FOR_YOU_KINDS, PICKABLE, defaultAddons, defaultRows, defaultSettings, isPlace, pickable, slug, traktRows} from '../src/data';
import type {Addon, Hub, Overrides, Row, Settings} from '../src/data';
import {challenge, created, signed} from './passkeys';
import {HUB_OWNER, MOST_PEOPLE, previews, removePlayers, syncPlayers} from './native';
import {forgetHub, forgetSeats} from './front';
import {LINK, brief, disconnect, forgetTrakt, keepLink, links, read} from './trakt';
import {rows} from './rows';
import {PAIRS, copy, forgetShown, moving, shown} from './places';
import {because} from './suggest';
import {STAND_INS, kindsOf, namesOf, pickHour} from './foryou';
import {SHELF_ROW} from './shelf';
import type {Env} from './util';
import {blocked, checkPassword, failed, getSecret, guesses, hashPassword, hosted, newCode, newId, newPassword, newPin, newRecoveryCode, newToken, now, putSecret, same, sha, stamp, unseal} from './util';

const TAKEN = 'Someone in this hub already has that name';
class Bad extends Error {constructor(public status: number, message: string) {super(message);}}
const bad = (status: number, message: string): never => {throw new Bad(status, message);};
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...headers}});
// AS + person id: a person's session that their manager opened from that person's link, held beside the manager's own (COOKIE), so
// the manager's view and the person's view can be open side by side. A tab in the person's view says so with the x-as header.
// KEPT: older browsers that swapped the manager's session aside instead, to go back to.
const COOKIE = 'hub_s', KEPT = 'hub_m', AS = 'hub_p_', MONTH = 30 * 86400;
const cookieOf = (request: Request, name: string) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
const asOf = (request: Request) => {const id = request.headers.get('x-as') ?? ''; return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : '';};
const heldOf = (request: Request) => [...(request.headers.get('cookie') ?? '').matchAll(/(?:^|;\s*)hub_p_([a-z0-9-]+)=([^;]+)/g)].map(m => ({person: m[1], token: m[2]}));
const cookie = (value: string, age: number, name = COOKIE) => ({'set-cookie': `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`});

/* ---------- what may be stored ---------- */
const text = (value: unknown, max: number, what: string): string => typeof value === 'string' && value.length <= max ? value : bad(400, `${what} is not valid`);
const flag = (value: unknown) => value === true;
const list = (value: unknown, max: number, each: number, what: string) => Array.isArray(value) && value.length <= max ? value.map(item => text(item, each, what)) : bad(400, `${what} is not valid`);
const oneOf = <T extends string>(value: unknown, options: readonly T[], what: string): T => options.includes(value as T) ? value as T : bad(400, `${what} is not valid`);
function cleanRows(value: unknown): Row[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 200) bad(400, 'Home rows are not valid');
  const seen = new Set<string>();
  return (value as Record<string, unknown>[]).map(item => {
    const id = text(item?.id, 120, 'Row'); if (seen.has(id)) bad(400, 'A row is listed twice'); seen.add(id);
    // A For you place is named by what is picked for it each day, never by a name saved with it.
    const row: Row = {id, title: isPlace(id) ? 'For you' : text(item.title, 160, 'Row title'), kind: text(item.kind, 80, 'Row'), source: isPlace(id) ? 'Picked daily' : text(item.source, 400, 'Row'), origin: oneOf(item.origin, ['hub', 'group', 'own'] as const, 'Row'), on: flag(item.on)};
    if (item.core === true) row.core = true;
    if (item.watched !== undefined) row.watched = oneOf(item.watched, ['hide', 'show'] as const, 'Row');
    if (item.covers !== undefined) row.covers = Array.isArray(item.covers) && item.covers.length <= 80 ? (item.covers as Record<string, unknown>[]).map(cover => ({title: text(cover?.title, 120, 'Folder name'), image: text(cover.image, 400, 'Folder')})) : bad(400, 'Folders are not valid');
    return row;
  });
}
const CHECK: {[K in keyof Settings]-?: (value: unknown) => Settings[K]} = {
  quality: value => oneOf(value, ['saver', 'balanced', 'best'] as const, 'Quality'),
  maxSizeGb: value => typeof value === 'number' && value >= 1 && value <= 500 ? value : bad(400, 'File size is not valid'),
  languages: value => list(value, 30, 40, 'Languages'), cachedFirst: flag,
  search: value => oneOf(value, ['fast', 'balanced', 'thorough'] as const, 'Search'),
  subtitles: value => list(value, 30, 40, 'Subtitles'), skip: flag,
  limit: value => oneOf(value, ['all', 'teen', 'kids'] as const, 'Content limit'),
  hideWatched: flag, spoilers: flag, unreleased: flag,
  posters: value => oneOf(value, ['better', 'plain'] as const, 'Posters'),
  ageBadge: flag,
  debrid: value => text(value, 40, 'Account'), sources: value => list(value, 60, 80, 'Sources'),
  forYouOff: value => list(value, 20, 20, 'For you').filter(id => FOR_YOU_KINDS.some(kind => kind.id === id)),
  formatter: value => ({name: text((value as Record<string, unknown>)?.name, 20_000, 'Stream label'), description: text((value as Record<string, unknown>).description, 20_000, 'Stream label')}),
};
const LATER = new Set<keyof Settings>(['ageBadge', 'forYouOff']);
function cleanSettings(value: unknown, whole: boolean): Overrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(400, 'Settings are not valid');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CHECK) as (keyof Settings)[]) {
    const given = (value as Record<string, unknown>)[key];
    // Settings added later may be missing from a hub saved before them: they keep their default.
    if (given === undefined) {if (whole && !LATER.has(key)) bad(400, 'Settings are incomplete');} else out[key] = CHECK[key](given);
  }
  return out;
}
const cleanAddons = (value: unknown): Addon[] => Array.isArray(value) && value.length <= 60 ? (value as Record<string, unknown>[]).map(item => ({id: text(item?.id, 400, 'Source'), name: text(item.name, 80, 'Source'), note: text(item.note, 400, 'Source'), ...(item.locked === true ? {locked: true} : {}), ...(item.custom === true ? {custom: true} : {}), ...(item.url !== undefined ? {url: /^https:\/\/[^\s"\\]+\/manifest\.json(\?[^\s"\\]*)?$/.test(text(item.url, 600, 'Source link')) ? item.url as string : bad(400, 'A source link is the https address of its manifest.json')} : {})})) : bad(400, 'Sources are not valid');
const cleanName = (value: unknown) => {const name = text(value, 60, 'Name').trim(); return name || bad(400, 'A name is needed');};
const cleanId = (value: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : bad(400, 'That name cannot be used');
const cleanPassword = (value: unknown) => typeof value === 'string' && value.length >= 8 && value.length <= 200 ? value : bad(400, 'Use a password of at least 8 characters');

/* ---------- rows as stored ---------- */
interface HubData {host: string; hostUrl: string; serverName?: string; metaUrl?: string; missing?: string[]; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]; order?: string[]}
interface GroupData {rows: Row[] | null; settings: Overrides; paused?: boolean}
// picks: Trakt rows they switched on or off while following the Home above (see rowsOf in data.ts).
interface PersonData {rows: Row[] | null; picks?: Record<string, boolean>; settings: Overrides; can: {arrange: boolean; add: boolean; playback: boolean; limit?: boolean}; trakt: boolean; lists: boolean}
interface HubRow {id: string; code: string; owner: string; data: string; version: number}
interface GroupRow {id: string; name: string; data: string; version: number}
interface PersonRow {id: string; grp: string; name: string; data: string; joined: number; paused: number; version: number}
interface DeviceRow {ref: string; person: string; app: string; name: string; seen: number; place: string; net: string}
interface SignIn {password: string; pin: string | null}
const TRAKT_ROWS = [...PICKABLE], HERE = 6 * 3600;
const cleanPicks = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([id, on]) => pickable(id) && typeof on === 'boolean')) as Record<string, boolean> : undefined;

function ago(seen: number) {
  const gap = now() - seen;
  return gap < 300 ? 'Now' : gap < 3600 ? `${Math.floor(gap / 60)} min ago` : gap < 86400 ? `${Math.floor(gap / 3600)} h ago` : gap < 172800 ? 'Yesterday' : `${Math.floor(gap / 86400)} days ago`;
}
const groupDto = (row: GroupRow) => ({id: row.id, name: row.name, ...(JSON.parse(row.data) as GroupData), v: row.version});
// moving: their MDBList key is kept while they move where progress is kept, to MDBList or back Here (see places.ts).
// listsKept: they have an MDBList key saved. With progress kept Here it is kept but not used for progress, only to read their lists.
const personDto = (row: PersonRow, devices: DeviceRow[], ready: boolean, history: {username: string; again: boolean} | null, aiomTrakt: boolean, listsName = '', drift: ReturnType<typeof looked> = null, moving: string | null = null, listsKept = false, played = false) => ({
  ready, history, listsName, drift, moving, listsKept, played,
  id: row.id, name: row.name, groupId: row.grp, joined: !!row.joined, paused: !!row.paused, ...(JSON.parse(row.data) as PersonData), v: row.version,
  // AIOMetadata's own Trakt connection (a Token ID). Once Trakt is connected to the hub it is no longer used and can go.
  aiomTrakt,
  // Sign-in details are never part of what a page loads; they are asked for one person at a time.
  pin: null, password: '', devices: devices.filter(device => device.person === row.id).map(device => ({id: device.ref, app: device.app || 'Player app', name: device.name || 'A device', seen: ago(device.seen), place: device.place, net: device.net})),
});

/* ---------- who is asking ---------- */
// manager: in a person's view, the manager's own session set aside in this browser (and its cookie value, to go back with).
// beside: the person's session is held next to the manager's (AS), rather than having swapped it aside (KEPT).
interface Who {session: string; account?: {id: string; username: string; name: string; theme: string}; hub: HubRow; person?: string; manager?: {session: string; token: string; beside?: boolean}}
async function whoIs(request: Request, env: Env): Promise<Who | null> {
  // A tab in a person's view asks as that person, and only with the session held for them; without it, it is not signed in.
  const as = asOf(request), held = as ? cookieOf(request, AS + as) : undefined;
  if (as && !held) return null;
  const token = held ?? cookieOf(request, COOKIE);
  if (!token) return null;
  // The session, its account and its hub in one trip to the database: every request starts here, and each trip is slow from afar.
  const session = await sha(token), at = now(), [rows, accounts, hubs] = await env.DB.batch([
    env.DB.prepare('SELECT account, hub, person FROM sessions WHERE id = ?1 AND expires > ?2').bind(session, at),
    env.DB.prepare('SELECT a.id, a.username, a.name, a.theme FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.id = ?1 AND s.expires > ?2').bind(session, at),
    env.DB.prepare(`SELECT h.id, h.code, h.owner, h.data, h.version FROM sessions s JOIN hubs h ON h.owner = s.account WHERE s.id = ?1 AND s.expires > ?2
      UNION ALL SELECT h.id, h.code, h.owner, h.data, h.version FROM sessions s JOIN hubs h ON h.id = s.hub WHERE s.id = ?1 AND s.expires > ?2 AND s.account IS NULL`).bind(session, at),
  ]);
  const row = rows.results[0] as {account: string | null; hub: string | null; person: string | null} | undefined;
  if (!row) return null;
  if (row.account) return accounts.results[0] && hubs.results[0] ? {session, account: accounts.results[0] as Who['account'], hub: hubs.results[0] as HubRow} : null;
  const hub = hubs.results[0] as HubRow | undefined;
  if (!hub || !row.person || (as && row.person !== as)) return null;
  // Only this hub's own manager's session counts as one to go back to.
  const kept = held ? cookieOf(request, COOKIE) : cookieOf(request, KEPT), manager = kept ? await env.DB.prepare('SELECT id FROM sessions WHERE id = ? AND account = ? AND expires > ?').bind(await sha(kept), hub.owner, now()).first<{id: string}>() : null;
  return {session, hub, person: row.person, ...(manager ? {manager: {session: manager.id, token: kept!, ...(held ? {beside: true} : {})}} : {})};
}
async function startSession(env: Env, subject: {account: string} | {hub: string; person: string}) {
  return cookie(await newSession(env, subject), MONTH);
}
async function newSession(env: Env, subject: {account: string} | {hub: string; person: string}) {
  const token = newToken('s');
  await env.DB.prepare('INSERT INTO sessions (id, account, hub, person, expires) VALUES (?, ?, ?, ?, ?)').bind(await sha(token), 'account' in subject ? subject.account : null, 'hub' in subject ? subject.hub : null, 'person' in subject ? subject.person : null, now() + MONTH).run();
  return token;
}

/* ---------- what a page loads ---------- */
async function state(env: Env, who: Who) {
  const hub = who.hub, data = JSON.parse(hub.data) as HubData, mine = who.person;
  const [groups, people, devices, owner, ready, keys, passkeys, traktLinks, oldTrakt, listKeys, drifts, jobs, plays, picked] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, data, version FROM groups WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(hub.id, mine) : env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? AND person = ? ORDER BY seen DESC').bind(hub.id, mine) : env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? ORDER BY seen DESC').bind(hub.id),
    env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(hub.owner),
    env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind IN ('upstream', 'upstream-aiom')").bind(hub.id),
    env.DB.prepare("SELECT kind FROM secrets WHERE hub = ? AND owner = ? AND kind IN ('key:tmdb', 'key:mdblist', 'key:posters')").bind(hub.id, HUB_OWNER),
    env.DB.prepare('SELECT substr(id, 1, 16) AS id, name, created FROM passkeys WHERE account = ? ORDER BY created').bind(who.account?.id ?? ''),
    env.DB.prepare('SELECT owner, value FROM secrets WHERE hub = ? AND kind = ? AND owner = coalesce(?, owner)').bind(hub.id, LINK, mine ?? null),
    env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind = 'trakt'").bind(hub.id),
    env.DB.prepare("SELECT owner, value FROM secrets WHERE hub = ? AND kind = 'mdblist' AND owner = coalesce(?, owner)").bind(hub.id, mine ?? null),
    // Where Trakt and MDBList disagree is someone's own watching: only they see it, on their own page.
    env.DB.prepare('SELECT result, skipped, at FROM drift WHERE hub = ? AND person = ?').bind(hub.id, mine ?? ''),
    // The background work, for the manager: when it last ran, how often it has, what waits for Trakt, the last daily check.
    env.DB.prepare(`SELECT (SELECT at FROM runs WHERE job = 'cron') AS last, (SELECT count FROM runs WHERE job = 'cron') AS runs, (SELECT since FROM runs WHERE job = 'cron') AS since,
      (SELECT max(at) FROM drift WHERE hub = ?1 AND work IS NULL AND result IS NOT NULL) AS ran, (SELECT count(*) FROM trakt_outbox WHERE hub = ?1) AS waiting,
      (SELECT max(day) FROM drift WHERE hub = ?1 AND work IS NULL) AS checked, (SELECT count(*) FROM drift WHERE hub = ?1 AND day = (SELECT max(day) FROM drift WHERE hub = ?1) AND work IS NULL) AS people, (SELECT count(*) FROM drift WHERE hub = ?1 AND work IS NOT NULL) AS checking,
      (SELECT count(*) FROM foryou WHERE hub = ?1 AND day = ?2) AS picked, (SELECT max(at) FROM foryou WHERE hub = ?1) AS pickedAt, (SELECT count(*) FROM people WHERE hub = ?1) AS everyone, (SELECT count(*) FROM foryou_sync WHERE hub = ?1) AS syncing, (SELECT max(at) FROM rows_cache WHERE hub = ?1 AND kind = 'shelf') AS shelved, (SELECT count(*) FROM rows_cache WHERE hub = ?1 AND kind = 'shelf') AS shelves, (SELECT min(at) FROM rows_cache WHERE hub = ?1 AND kind = 'shelf') AS shelfDue`).bind(hub.id, new Date().toISOString().slice(0, 10)),
    // Who has played something here: their Recently Watched has something in it even without Trakt or MDBList.
    env.DB.prepare('SELECT DISTINCT person FROM plays WHERE hub = ? AND person = coalesce(?, person)').bind(hub.id, mine ?? null),
    // What each For you place holds today, by name only (the manager sees them on that person's Home tab).
    env.DB.prepare('SELECT person, picks FROM foryou WHERE hub = ? AND person = coalesce(?, person)').bind(hub.id, mine ?? null),
  ]);
  const forYou = new Map((picked.results as {person: string; picks: string}[]).map(row => [row.person, {names: namesOf(row.picks), kinds: kindsOf(row.picks)}]));
  // Which MDBList account each person's progress goes to (the name only; the key never leaves the vault).
  const listsName: Record<string, string> = {};
  const moves: Record<string, string> = {}, keyed = new Set<string>();
  for (const row of listKeys.results as {owner: string; value: string}[]) {const kept = await unseal<{key?: string; username?: string; moving?: string}>(env, `${hub.id}/${row.owner}/mdblist`, row.value); if (kept?.key) keyed.add(row.owner); if (kept?.username) listsName[row.owner] = kept.username; if (kept?.moving) moves[row.owner] = kept.moving;}
  const aiomTrakt = new Set((oldTrakt.results as {owner: string}[]).map(row => row.owner));
  const history = env.TRAKT_CLIENT_ID ? await links(env, hub.id, traktLinks.results as {owner: string; value: string}[]) : {};
  const linked = new Set((ready.results as {owner: string}[]).map(row => row.owner)), playedHere = new Set((plays.results as {person: string}[]).map(row => row.person));
  const persons = people.results as unknown as PersonRow[];
  if (mine && !persons.length) return null;
  // An invited person gets themselves, their group and the defaults. Never the other people, the server choice or the manager's account.
  const rank = (id: string) => {const at = data.order?.indexOf(id) ?? -1; return at < 0 ? Infinity : at;};
  const shown = (groups.results as unknown as GroupRow[]).filter(group => !mine || group.id === persons[0].grp).map((group, at) => ({group, at})).sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.at - b.at).map(item => item.group);
  return {
    role: mine ? 'person' : 'owner', personId: mine ?? null,
    hub: {
      name: '', serverName: data.serverName ?? '', code: hub.code, host: mine ? '' : data.host, hostUrl: mine ? '' : data.hostUrl, metaUrl: mine ? '' : data.metaUrl ?? '', missing: data.missing ?? [], traktLink: env.AIOM_ORIGIN || data.metaUrl ? `${data.metaUrl || env.AIOM_ORIGIN}/api/auth/trakt/authorize` : '', services: data.services, addons: data.addons, defaults: data.defaults, rows: data.rows, v: hub.version, tmdb: keys.results.some(row => (row as {kind: string}).kind === 'key:tmdb'), mdblist: keys.results.some(row => (row as {kind: string}).kind === 'key:mdblist'), scrobble: !!env.TRAKT_CLIENT_ID, traktClient: env.TRAKT_CLIENT_ID ?? '', front: env.FRONT === 'aiometadata',
      ...(mine ? {manager: !!who.manager} : {jobs: {...jobs.results[0] as object, forYouHour: pickHour(env)} as Hub['jobs']}),
      groups: shown.map(groupDto), people: persons.map(row => personDto(row, devices.results as unknown as DeviceRow[], linked.has(row.id), history[row.id] ?? null, aiomTrakt.has(row.id), listsName[row.id] ?? '', mine ? looked(drifts.results[0] as {result: string | null; skipped: string | null; at: number} | undefined) : null, moves[row.id] ?? null, keyed.has(row.id), playedHere.has(row.id))).map(person => {const picked = forYou.get(person.id); return picked ? {...person, forYou: {...STAND_INS, ...picked.names}, forYouKinds: picked.kinds} : person;}),
      me: who.account ? {name: who.account.name, theme: who.account.theme, passkeys: (passkeys.results as {id: string; name: string; created: number}[]).map(row => ({id: row.id, name: row.name, added: new Date(row.created * 1000).toISOString().slice(0, 10)}))} : {name: (owner.results[0] as {name: string} | undefined)?.name ?? '', theme: 'dark', passkeys: []},
    },
  };
}

/* ---------- writes ---------- */
type Body = Record<string, unknown>;
const versioned = (changes: number) => {if (!changes) bad(409, 'This changed somewhere else. The page has been refreshed.');};
async function saveHub(env: Env, who: Who, body: Body) {
  const was = JSON.parse(who.hub.data) as HubData, data: HubData = {
    // Which servers the hub uses is changed on its own, after they have been checked; never as part of a page save.
    host: was.host, hostUrl: was.hostUrl, metaUrl: was.metaUrl, missing: was.missing,
    // Accounts are added and removed with their key, one at a time, never as part of a page save.
    services: was.services,
    // What apps and Trakt call the hub. Empty means the usual name.
    serverName: typeof body.serverName === 'string' ? body.serverName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || undefined : was.serverName,
    addons: cleanAddons(body.addons), defaults: cleanSettings(body.defaults, true) as Settings, rows: cleanRows(body.rows) ?? bad(400, 'Home rows are needed'),
    // The order groups are shown in. Groups not named yet go after the rest, oldest first.
    order: Array.isArray(body.order) ? body.order.filter((id): id is string => typeof id === 'string').slice(0, 40).map(id => id.slice(0, 40)) : was.order,
  };
  const done = await env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(data), who.hub.id, Number(body.v)).run();
  versioned(done.meta.changes); forgetHub(who.hub.code); return {v: Number(body.v) + 1};
}
async function saveGroup(env: Env, who: Who, id: string, body: Body) {
  const data: GroupData = {rows: cleanRows(body.rows), settings: cleanSettings(body.settings ?? {}, false), ...(flag(body.paused) ? {paused: true} : {})}, name = cleanName(body.name);
  if (body.v === undefined) {
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM groups WHERE hub = ?').bind(who.hub.id).first<{n: number}>())!.n >= 40) bad(400, 'That is the most groups a hub can have');
    await env.DB.prepare('INSERT INTO groups (hub, id, name, data, created) VALUES (?, ?, ?, ?, ?)').bind(who.hub.id, cleanId(id), name, JSON.stringify(data), now()).run().catch(() => bad(409, 'A group with that name already exists'));
    return {v: 1};
  }
  const done = await env.DB.prepare('UPDATE groups SET name = ?, data = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, JSON.stringify(data), who.hub.id, id, Number(body.v)).run();
  versioned(done.meta.changes); return {v: Number(body.v) + 1};
}
async function removeGroup(env: Env, who: Who, id: string) {
  const counts = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM people WHERE hub = ?1 AND grp = ?2) AS members, (SELECT COUNT(*) FROM groups WHERE hub = ?1) AS groups').bind(who.hub.id, id).first<{members: number; groups: number}>();
  if (counts!.members) bad(400, 'Move or remove its people first');
  if (counts!.groups < 2) bad(400, 'A hub needs at least one group');
  await env.DB.prepare('DELETE FROM groups WHERE hub = ? AND id = ?').bind(who.hub.id, id).run(); return {};
}
const inviteLink = (origin: string, token: string) => `${origin}/#/join/${token}`;
async function savePerson(env: Env, who: Who, id: string, body: Body) {
  const hub = who.hub.id, current = await env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<PersonRow>();
  const name = cleanName(body.name), rows = cleanRows(body.rows), settings = cleanSettings(body.settings ?? {}, false);
  if (who.person) {
    // An invited person changes only themselves, and only what the manager allowed.
    if (who.person !== id || !current) bad(403, 'Not allowed');
    const before = JSON.parse(current!.data) as PersonData, next: PersonData = {...before};
    if (JSON.stringify(rows) !== JSON.stringify(before.rows)) {
      if (!before.can.arrange) bad(403, 'Arranging Home is turned off for you');
      if (rows && !before.can.add) {
        const group = await env.DB.prepare('SELECT data FROM groups WHERE hub = ? AND id = ?').bind(hub, current!.grp).first<{data: string}>();
        const known = new Set([...TRAKT_ROWS, ...(before.rows ?? []).map(row => row.id), ...((JSON.parse(group!.data) as GroupData).rows ?? (JSON.parse(who.hub.data) as HubData).rows).map(row => row.id)]);
        // A For you place is the hub's, not a row of their own: moving or switching one is arranging.
        if (rows.some(row => !known.has(row.id) && !isPlace(row.id))) bad(403, 'Adding rows is turned off for you');
      }
      next.rows = rows;
    }
    const picks = body.picks === undefined ? before.picks : cleanPicks(body.picks);
    if (JSON.stringify(picks) !== JSON.stringify(before.picks)) {if (!before.can.arrange) bad(403, 'Arranging Home is turned off for you'); next.picks = picks;}
    if (JSON.stringify(settings) !== JSON.stringify(before.settings)) {
      if (!before.can.playback) bad(403, 'Changing playback is turned off for you');
      // The content limit is theirs to change only when the manager said so as well.
      if ((settings as Overrides).limit !== (before.settings as Overrides).limit && !before.can.limit) bad(403, 'Your content limit is set for you');
      next.settings = settings;
    }
    const done = await env.DB.prepare('UPDATE people SET name = ?, login = ?, data = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, slug(name), JSON.stringify(next), hub, id, Number(body.v)).run().catch(() => bad(409, TAKEN));
    versioned(done.meta.changes); return {v: Number(body.v) + 1};
  }
  const can = body.can as Record<string, unknown> | undefined, grp = text(body.groupId, 40, 'Group');
  const was = current ? JSON.parse(current.data) as PersonData : null;
  // Adding a row changes Home, so it goes with arranging, as the content limit goes with playback.
  const data: PersonData = {rows, ...(body.picks !== undefined ? {picks: cleanPicks(body.picks)} : was?.picks ? {picks: was.picks} : {}), settings, can: {arrange: flag(can?.arrange), add: flag(can?.arrange) && flag(can?.add), playback: flag(can?.playback), limit: flag(can?.playback) && flag(can?.limit)},
    // Connections are made and undone on their own, after a check; a page save never changes them.
    trakt: was?.trakt ?? false, lists: was?.lists ?? false};
  if (!await env.DB.prepare('SELECT 1 FROM groups WHERE hub = ? AND id = ?').bind(hub, grp).first()) bad(400, 'That group is gone');
  if (!current) {
    if (body.v !== undefined) bad(409, 'This person was removed somewhere else');
    // Someone just removed under the same name still has setups being taken down: a new person waits, so they never inherit them.
    if (await env.DB.prepare("SELECT 1 FROM secrets WHERE hub = ? AND owner = ? LIMIT 1").bind(hub, id).first()) bad(409, 'Someone with this name was just removed and is still being cleared away. Try again in a minute.');
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM people WHERE hub = ?').bind(hub).first<{n: number}>())!.n >= MOST_PEOPLE) bad(403, `A hub carries up to ${MOST_PEOPLE} people for now.`);
    const invite = newToken('i');
    // The name is what they sign in with, so it has to be theirs alone in this hub.
    if (await env.DB.prepare('SELECT 1 FROM people WHERE hub = ? AND login = ?').bind(hub, slug(name)).first()) bad(409, TAKEN);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO people (hub, id, grp, name, login, data, jf, invite, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(hub, cleanId(id), grp, name, slug(name), JSON.stringify(data), newId(), await sha(invite), now()),
      await putSecret(env, hub, id, 'signin', {password: newPassword(), pin: newPin()} satisfies SignIn), await putSecret(env, hub, id, 'invite', invite),
    ]);
    return {v: 1};
  }
  const done = await env.DB.prepare('UPDATE people SET name = ?, login = ?, grp = ?, data = ?, paused = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, slug(name), grp, JSON.stringify(data), flag(body.paused) ? 1 : 0, hub, id, Number(body.v)).run().catch(() => bad(409, TAKEN));
  versioned(done.meta.changes); return {v: Number(body.v) + 1};
}
const forget = (env: Env, hub: string, id: string) => [
  env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ?').bind(hub, id),
];
async function removePerson(env: Env, who: Who, id: string) {
  forgetSeats(who.hub.id, id);
  await env.DB.batch([...forget(env, who.hub.id, id), env.DB.prepare('DELETE FROM plays WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM starts WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM sittings WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM rows_keys WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM foryou WHERE hub = ? AND person = ?').bind(who.hub.id, id), ...forgetTrakt(env, who.hub.id, id), env.DB.prepare("DELETE FROM ops WHERE hub = ? AND target = ? AND kind = 'carry'").bind(who.hub.id, id), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind NOT IN ('catalogs', 'catalogs-pending', 'aiom', 'aiom-pending')").bind(who.hub.id, id), env.DB.prepare('DELETE FROM people WHERE hub = ? AND id = ?').bind(who.hub.id, id)]);
  return {};
}
/* A person's stored choices, read fresh, and written back as a new version. */
const personData = async (env: Env, hub: string, id: string) => JSON.parse((await env.DB.prepare('SELECT data FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{data: string}>())!.data) as PersonData;
const savePersonData = (env: Env, hub: string, id: string, next: PersonData) => env.DB.prepare('UPDATE people SET data = ?, version = version + 1 WHERE hub = ? AND id = ?').bind(JSON.stringify(next), hub, id);
const hasSecret = async (env: Env, hub: string, id: string, kind: string) => !!await env.DB.prepare('SELECT 1 FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, id, kind).first();
/* Trakt connected to the hub, and Trakt has not asked for it to be connected again. */
const tracked = async (env: Env, hub: string, id: string) => !!env.TRAKT_CLIENT_ID && !((await getSecret<{again?: boolean}>(env, hub, id, LINK)) ?? {again: true}).again;
/* Trakt rows on or off. Someone with a Home of their own gets the rows added at the top, or taken out again. Recently Watched and
   the MDBList watchlist do not need Trakt, so they stay where they are. */
function withTraktRows(data: PersonData, on: boolean): PersonData {
  const shipped = traktRows().filter(item => item.id !== 'mdblist-watchlist'), needs = shipped.map(item => item.id).filter(id => id !== 'recently-watched');
  return {...data, trakt: on, rows: data.rows ? on ? [...shipped.filter(item => !data.rows!.some(row => row.id === item.id)), ...data.rows] : data.rows.filter(row => !needs.includes(row.id)) : null};
}
/* Checks a person's own password. People who joined before the two passwords were split are checked against the old shared one. */
const ownPassword = (given: string, stored: string, signin: SignIn) => stored ? checkPassword(given, stored) : same(given, signin.password);
/* Sign-in details for one person: the manager's view of them, or their own. */
async function person(env: Env, who: Who, id: string) {
  if (who.person && who.person !== id) bad(403, 'Not allowed');
  return await env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(who.hub.id, id).first<PersonRow>() ?? bad(404, 'This person is gone');
}
async function personAction(request: Request, env: Env, who: Who, id: string, action: string, rest: string | undefined, body: Body, origin: string) {
  const hub = who.hub.id, row = await person(env, who, id);
  const signin = await getSecret<SignIn>(env, hub, id, 'signin') ?? bad(500, 'Sign-in details are missing');
  if (action === 'signin' && request.method === 'GET') {
    const invite = await getSecret<string>(env, hub, id, 'invite');
    return {username: row.name, password: signin.password, pin: signin.pin, link: invite ? inviteLink(origin, invite) : ''};
  }
  if (action === 'trakt') {
    // Trakt is connected on AIOMetadata's own page, which hands the person a Token ID. Here it is checked and kept for their Home.
    // (The way it used to be done. Connecting Trakt to the hub, under 'scrobble', does all of it now.)
    const data = await personData(env, hub, id), save = (next: PersonData) => savePersonData(env, hub, id, next);
    if (request.method === 'POST') {
      const tokenId = /^[\w-]{16,80}$/.test(String(body.tokenId ?? '').trim()) ? String(body.tokenId).trim() : bad(400, 'Paste the Token ID from the “Trakt connected” page');
      const answer = await fetch(`${hosted(env, JSON.parse(who.hub.data) as HubData).AIOM_ORIGIN}/api/oauth/token/info`, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, body: JSON.stringify({tokenId})}).catch(() => null);
      const info = answer?.status === 200 ? await answer.json().catch(() => null) as {provider?: string; username?: string} | null : null;
      if (!answer || answer.status >= 500) bad(502, 'AIOMetadata did not answer. Try again in a moment.');
      if (!info || info.provider !== 'trakt') bad(400, 'That Token ID is not a Trakt connection on this hub’s AIOMetadata server. Copy it again from the “Trakt connected” page.');
      const username = String(info!.username ?? '').slice(0, 80);
      await env.DB.batch([await putSecret(env, hub, id, 'trakt', {tokenId, username}), save(withTraktRows(data, true))]);
      return {username};
    }
    if (request.method === 'DELETE') {
      // The Trakt rows stay while Trakt is still connected to the hub.
      const kept = await hasSecret(env, hub, id, LINK);
      await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'trakt'").bind(hub, id), save(withTraktRows(data, kept))]);
      return {};
    }
  }
  if (action === 'mdblist') {
    // A person's own MDBList key: it is what records their plays and knows what they have watched. Checked with MDBList, kept in the vault.
    const stored = await env.DB.prepare('SELECT data FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{data: string}>(), data = JSON.parse(stored!.data) as PersonData;
    const save = (lists: boolean) => env.DB.prepare('UPDATE people SET data = ?, version = version + 1 WHERE hub = ? AND id = ?').bind(JSON.stringify({...data, lists}), hub, id);
    if (request.method === 'POST') {
      // `reuse`: the key they saved before (kept while progress is Here) is taken up again, so nothing needs pasting.
      const before = body.reuse === true ? await getSecret<{key: string}>(env, hub, id, 'mdblist') : null;
      const key = before?.key ?? (text(body.key ?? '', 200, 'Key').trim() || bad(400, body.reuse === true ? 'There’s no MDBList key saved. Paste one.' : 'Paste the key'));
      const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}/user?apikey=${encodeURIComponent(key)}`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
      if (!answer || answer.status >= 500) bad(502, 'MDBList did not answer. Try again in a moment.');
      if (answer!.status !== 200) bad(400, 'MDBList did not accept that key. Copy it from Preferences, API Access.');
      const username = String(((await answer!.json().catch(() => null)) as {username?: string} | null)?.username ?? '').slice(0, 80);
      // Someone on Here choosing MDBList on their own page: the key is kept, and progress moves over only once their plays have
      // (the card on their page, places.ts). Anyone else's choice, or a new key for someone already on MDBList, takes effect at once.
      // `keep`: connecting MDBList from the accounts list only saves the key; where progress is kept is chosen apart from it.
      const moving = body.moving === true && who.person === id && !data.lists, keep = body.keep === true && !data.lists;
      await env.DB.batch([await putSecret(env, hub, id, 'mdblist', {key, username, ...(moving ? {moving: 'mdblist'} : {})}), save(!moving && !keep),env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'lists' OR kind LIKE 'mdb_%')").bind(hub, id)]);
      return {username};
    }
    // Removing the key itself: nothing of MDBList is kept or read for them any more.
    if (request.method === 'DELETE' && rest === 'key') {await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'mdblist'").bind(hub, id), env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'lists' OR kind LIKE 'mdb_%')").bind(hub, id), save(false)]); return {};}
    // Progress kept Here: the key stays saved for their lists, and the next sync turns MDBList's tracking and reporting off.
    if (request.method === 'DELETE' && !rest) {await moving(env, hub, id, null); await env.DB.batch([env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), save(false)]); return {};}
  }
  if (action === 'scrobble' && env.TRAKT_CLIENT_ID) {
    // Trakt, connected by the person or by the manager with them, on Trakt's own sign-in page. The page does the sign-in with
    // Trakt itself (Trakt turns away the shared addresses Workers call from for a while at times) and hands the login over to be
    // kept and renewed here. Once connected, the hub also serves their Trakt rows on Home (rows.ts), added to a Home of their own.
    if (request.method === 'POST' && rest === 'link') {
      const access = text(body.access, 4000, 'Login').trim(), refresh = text(body.refresh, 4000, 'Login').trim(), redirect = text(body.redirect ?? '', 300, 'Address');
      if (!access || !refresh || (redirect && !/^https?:\/\/[^/]+\/api\/trakt\/callback$/.test(redirect))) bad(400, 'Trakt did not finish connecting. Try again.');
      await keepLink(env, hub, id, {access, refresh, expires: Math.floor(Number(body.created) || now()) + Math.floor(Number(body.lasts) || 7 * 86400), username: text(body.username ?? '', 80, 'Name').trim(), ...(redirect ? {redirect} : {})});
      forgetSeats(hub, id);
      // What was watched here before is worked out again against Trakt too, the next time their card looks.
      await env.DB.batch([env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'lists'").bind(hub, id)]);
      const data = await personData(env, hub, id); if (!data.trakt) await savePersonData(env, hub, id, withTraktRows(data, true)).run();
      return {state: 'connected'};
    }
    if (request.method === 'DELETE') {
      await disconnect(env, hub, id); forgetSeats(hub, id);
      // The Trakt rows stay only while AIOMetadata's own Trakt connection is still there to fill them.
      if (!await hasSecret(env, hub, id, 'trakt')) await savePersonData(env, hub, id, withTraktRows(await personData(env, hub, id), false)).run();
      return {};
    }
  }
  if (action === 'drift' && request.method === 'POST') {
    // "Add what's missing", from their own page: the plays they left out are kept out for good, then each side gets what it lacks
    // (Trakt and MDBList from the day's look, and what was watched here copied to MDBList, a pass at a time).
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const leave = Array.isArray(body.leave) ? body.leave.slice(0, 200).map(key => text(key, 200, 'Play')) : body.skip !== undefined ? [text(body.skip, 200, 'Play')] : [];
    await skip(env, hub, id, leave);
    if (body.skip !== undefined) return {};
    const fixed = await fix(env, hub, id);
    if ('error' in fixed) return bad(409, fixed.error);
    return {trakt: fixed.trakt, mdblist: fixed.mdblist, more: false};
  }
  if (action === 'because' && request.method === 'GET') {
    // Suggested rows their own watching points to: on their own page only, from their own plays and Trakt pages.
    if (who.person !== id) bad(403, 'Only they can see these, from their own page');
    return {because: await because(env, hub, id)};
  }
  if (action === 'lists' && request.method === 'GET') {
    // Their own lists, to add as Home rows: on their own page only, never shown to anyone else.
    if (who.person !== id) bad(403, 'Only they can see these, from their own page');
    const lists = await ownLists(env, hub, id), trakts = lists.filter(item => item.id.startsWith('trakt-')).length;
    // All their Trakt lists as one row, a tile each (shelf.ts): a collection, which only AIOMetadata in front can show.
    return {lists: trakts && env.FRONT === 'aiometadata' ? [{id: SHELF_ROW, title: 'My Trakt lists', kind: `Collection · ${trakts} ${trakts === 1 ? 'list' : 'lists'}`, source: 'Trakt · all your lists'}, ...lists] : lists};
  }
  if (action === 'compare') {
    // The Trakt and MDBList card: two places side by side (places.ts). Someone's own watching: only they see or move it.
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const pair = oneOf(rest, PAIRS, 'Pair');
    if (request.method === 'GET') {const got = await shown(env, hub, id, pair, await skippedOf(env, hub, id), new URL(request.url).searchParams.get('fresh') === '1'); return 'error' in got ? bad(409, got.error) : got;}
    if (request.method !== 'POST') bad(404, 'Not found');
    const leave = Array.isArray(body.leave) ? body.leave.slice(0, 500).map(key => text(key, 200, 'Play')) : [];
    await skip(env, hub, id, leave);
    // Moving where progress is kept: only from the state the person's page started it in.
    const kept = await getSecret<{moving?: string}>(env, hub, id, 'mdblist'), switching = body.switch === true;
    if (switching && !((pair === 'here-mdblist' && kept?.moving === 'mdblist') || (pair === 'mdblist-here' && kept?.moving === 'here'))) bad(409, 'That move isn’t under way. The page has been refreshed.');
    if (pair === 'mdblist-here' && kept?.moving !== 'here') bad(409, 'That move isn’t under way. The page has been refreshed.');
    const got = await copy(env, hub, id, pair, await skippedOf(env, hub, id));
    // Read again next time: what was just sent is on the other side now.
    await env.DB.batch([forgetShown(env, hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'playback'").bind(hub, id)]);
    if ('error' in got) return bad(409, got.error);
    if (!switching || got.more) return {...got, switched: false};
    // Everything is across: the switch itself. Then the page syncs, which turns MDBList's reporting on (or leaves it off).
    const data = await personData(env, hub, id);
    if (pair === 'here-mdblist') {await moving(env, hub, id, null); await savePersonData(env, hub, id, {...data, lists: true}).run();}
    // Back on Here: the key stays saved, used only to read their lists; switching to MDBList again needs no new paste.
    else {await moving(env, hub, id, null); await env.DB.batch([env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), savePersonData(env, hub, id, {...data, lists: false})]);}
    return {...got, switched: true};
  }
  if (action === 'moving' && request.method === 'POST') {
    // Starting the move back Here (their MDBList stops hearing of plays once the page syncs), or staying on MDBList after all.
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const to = body.to === 'here' ? 'here' : body.to === null ? null : bad(400, 'Not valid');
    if (to && !(await personData(env, hub, id)).lists) bad(409, 'Progress is already kept here.');
    if (!await moving(env, hub, id, to)) bad(409, 'MDBList isn’t connected.');
    await forgetShown(env, hub, id).run();
    return {};
  }
  if (action === 'carry') {
    // Someone's own watching: only they can look at it or move it, from their own page.
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    if (request.method === 'POST') {
      const got = await carry(env, hub, id, await skippedOf(env, hub, id));
      await env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, id).run();
      if ('error' in got) bad(409, got.error);
      return got;
    }
    // What was watched here and their Trakt or MDBList lacks, worked out when their page asks and kept for a few hours: MDBList
    // allows a person 1,000 calls a day, and one look costs about twenty.
    const kept = await env.DB.prepare('SELECT here, here_at FROM drift WHERE hub = ? AND person = ?').bind(hub, id).first<{here: string | null; here_at: number | null}>();
    if (kept?.here && now() - (kept.here_at ?? 0) < HERE) return JSON.parse(kept.here);
    const got = await plan(env, hub, id, await skippedOf(env, hub, id));
    if ('error' in got) bad(409, got.error);
    await env.DB.batch([env.DB.prepare("INSERT INTO drift (hub, person, day) VALUES (?, ?, '') ON CONFLICT (hub, person) DO NOTHING").bind(hub, id), env.DB.prepare('UPDATE drift SET here = ?, here_at = ? WHERE hub = ? AND person = ?').bind(JSON.stringify(got), now(), hub, id)]);
    return got;
  }
  if (action === 'rotate' && request.method === 'POST') {
    // A fresh player-app password. Every app is signed out; the person's own page is untouched.
    const password = newPassword();
    await env.DB.batch([await putSecret(env, hub, id, 'signin', {...signin, password}), env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id)]);
    return {password};
  }
  if (action === 'password' && request.method === 'POST' && who.person) {
    // Their own password for this site. Only they can change it, and only knowing the current one.
    const key = guesses(request, `own:${hub}:${id}`), stored = (await env.DB.prepare('SELECT pass FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{pass: string}>())!.pass;
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await ownPassword(String(body.old ?? ''), stored, signin)) {await failed(env, key); bad(403, 'That is not your current password');}
    await env.DB.batch([env.DB.prepare('UPDATE people SET pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(cleanPassword(body.password)), hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ? AND id != ?').bind(hub, id, who.session)]);
    return {};
  }
  if (action === 'reset' && request.method === 'POST' && !who.person) {
    // They forgot it. Nobody can read it back, so the invite link lets them choose a new one. Their apps stay signed in.
    await env.DB.batch([env.DB.prepare("UPDATE people SET pass = '', joined = 0 WHERE hub = ? AND id = ?").bind(hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ?').bind(hub, id)]);
    return {};
  }
  if (action === 'pin' && request.method === 'POST') {
    const pin = body.pin === null ? null : body.pin === '' ? newPin() : /^\d{6,8}$/.test(String(body.pin)) ? String(body.pin) : bad(400, 'A PIN is 6 to 8 digits');
    await env.DB.batch([await putSecret(env, hub, id, 'signin', {...signin, pin}), ...(pin && signin.pin && pin !== signin.pin ? [env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id)] : [])]);
    return {pin};
  }
  if (action === 'quick' && request.method === 'POST') {
    // Approving the code a TV shows: the TV becomes this person. Asked by the manager for them, or by the person themselves.
    const key = guesses(request, `quick:${hub}:${id}`), code = String(body.code ?? '').replace(/\D/g, '');
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    const done = await env.DB.prepare('UPDATE quick SET person = ? WHERE hub = ? AND code = ? AND person IS NULL AND expires > ?').bind(id, hub, code, now()).run();
    if (!done.meta.changes) {await failed(env, key); bad(404, 'No TV is showing that code right now. Check the code, or start again on the TV.');}
    return {};
  }
  if (action === 'signout' && request.method === 'POST') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id).run(); return {};}
  // A device's name as the app sent it, or whatever is easier to recognise.
  if (action === 'devices' && rest && request.method === 'PUT') {const name = text(body.name, 60, 'Name').trim() || bad(400, 'Give it a name'); await env.DB.prepare('UPDATE devices SET name = ? WHERE hub = ? AND person = ? AND ref = ?').bind(name, hub, id, rest).run(); forgetSeats(hub, id); return {};} // what it plays is noted under its new name at once
  if (action === 'devices' && rest && request.method === 'DELETE') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ? AND ref = ?').bind(hub, id, rest).run(); return {};}
  return bad(404, 'Not found');
}

/* A person's own lists: on their Trakt (theirs, and ones they liked) through the hub's Trakt connection, and on their MDBList with
   their own key. Kept for a quarter of an hour, by hub and person, so opening Add row again asks neither. */
const LISTS_KEPT = 900;
interface OwnList {id: string; title: string; kind: string; source: string}
async function ownLists(env: Env, hub: string, id: string): Promise<OwnList[]> {
  const kept = await env.DB.prepare("SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'lists'").bind(hub, id).first<{at: number; items: string}>();
  if (kept && now() - kept.at < LISTS_KEPT) return JSON.parse(kept.items) as OwnList[];
  const out: OwnList[] = [], count = (n: unknown) => `List · ${Number(n) || 0} ${Number(n) === 1 ? 'title' : 'titles'}`, name = (text: unknown) => String(text ?? 'A list').slice(0, 80);
  let whole = true;
  if (await tracked(env, hub, id)) {
    type TraktList = {name?: string; item_count?: number; ids?: {trakt?: number}};
    const mine = await read<TraktList[]>(env, hub, id, '/users/me/lists'), liked = await read<{list?: TraktList}[]>(env, hub, id, '/users/likes/lists?limit=50');
    whole &&= Array.isArray(mine) && Array.isArray(liked);
    for (const list of Array.isArray(mine) ? mine : []) if (Number.isInteger(list.ids?.trakt)) out.push({id: `trakt-mine.${list.ids!.trakt}`, title: name(list.name), kind: count(list.item_count), source: 'Trakt · your list'});
    for (const like of Array.isArray(liked) ? liked : []) if (Number.isInteger(like.list?.ids?.trakt) && !out.some(item => item.id.endsWith(`.${like.list!.ids!.trakt}`))) out.push({id: `trakt-liked.${like.list!.ids!.trakt}`, title: name(like.list!.name), kind: count(like.list!.item_count), source: 'Trakt · liked'});
  }
  const lists = await getSecret<{key: string}>(env, hub, id, 'mdblist');
  if (lists?.key) {
    const got = await mdblist(env, lists.key)('/lists/user');
    whole &&= got.status === 200 && Array.isArray(got.body);
    for (const list of (Array.isArray(got.body) ? got.body : []) as {id?: number; name?: string; items?: number; mediatype?: string | null}[]) {
      if (!Number.isInteger(list.id)) continue;
      const type = list.mediatype === 'movie' ? 'movie' : list.mediatype === 'show' ? 'series' : 'all';
      out.push({id: `mdblist.${list.id}.${type}`, title: name(list.name), kind: count(list.items), source: 'MDBList · your list'});
    }
  }
  // Only a complete answer is kept; one where Trakt or MDBList did not answer is asked again next time.
  if (whole) await env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, 'lists', ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items").bind(hub, id, now(), JSON.stringify(out.slice(0, 100))).run();
  return out.slice(0, 100);
}

/* ---------- signing in ---------- */
const NOBODY = 'pbkdf2.50000.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const hubCount = async (env: Env) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM hubs').first<{n: number}>())!.n;
async function signUp(request: Request, env: Env, body: Body) {
  if (await hubCount(env) >= Number(env.MAX_HUBS ?? 1)) bad(403, 'This site is full. You can run your own copy instead.');
  const key = guesses(request, 'claim');
  if (env.CLAIM_CODE) {
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await same(String(body.code ?? ''), env.CLAIM_CODE)) {await failed(env, key); bad(403, 'That setup code is not right');}
  }
  // No username to invent: the hub gets a short code, and the code plus the password is the sign-in. The same code is in the player address.
  // The site hands out the hub code before the hub exists, so the page can show it and a password manager can save it with the password.
  // Only a code the site itself issued is accepted back; nobody gets to choose theirs.
  if (body.hub !== undefined && !await same(String(body.proof ?? ''), await stamp(env, `hub:${String(body.hub)}`))) bad(400, 'That did not work. Refresh the page and try again.');
  const password = cleanPassword(body.password), id = newId(), hub = newId(), code = body.hub === undefined ? newCode() : String(body.hub);
  const data: HubData = {host: 'ForTheWeak', hostUrl: '', services: [], addons: defaultAddons(), defaults: defaultSettings(), rows: defaultRows()};
  const pass = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, username, name, pass, created) VALUES (?, ?, ?, ?, ?)').bind(id, code, '', pass, now()),
    env.DB.prepare('INSERT INTO hubs (id, code, owner, data, created) VALUES (?, ?, ?, ?, ?)').bind(hub, code, id, JSON.stringify(data), now()),
  ]).catch(() => bad(409, 'That did not work. Try again.'));
  return reply({code}, 200, await startSession(env, {account: id}));
}
async function signIn(request: Request, env: Env, body: Body) {
  const username = String(body.username ?? '').trim().toLowerCase(), key = guesses(request, `site:${username}`);
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const account = await env.DB.prepare('SELECT id, pass, recovery FROM accounts WHERE username = ?').bind(username).first<{id: string; pass: string; recovery: string}>();
  // A recovery code signs in once and sets the new password in the same step.
  if (account && body.recovery !== undefined) {
    const codes = JSON.parse(account.recovery) as string[], used = await sha(String(body.recovery).trim().toLowerCase());
    if (!codes.includes(used)) {await failed(env, key); bad(403, 'That hub code or recovery code is not right');}
    await env.DB.batch([env.DB.prepare('UPDATE accounts SET pass = ?, recovery = ? WHERE id = ?').bind(await hashPassword(cleanPassword(body.password)), JSON.stringify(codes.filter(code => code !== used)), account.id), env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(account.id)]);
    return reply({}, 200, await startSession(env, {account: account.id}));
  }
  // An unknown username costs the same work as a known one, so the answer does not give away which names exist.
  if (!await checkPassword(String(body.password ?? ''), account?.pass ?? NOBODY) || !account) {await failed(env, key); bad(403, 'That hub code or password is not right');}
  return reply({}, 200, await startSession(env, {account: account!.id}));
}
/* An invite link. Opening it shows who it is for; choosing a password joins; after that the link asks for the password. */
async function join(request: Request, env: Env, body: Body, who: Who | null) {
  const token = String(body.token ?? ''), key = guesses(request, `join:${(await sha(token)).slice(0, 24)}`);
  const row = await env.DB.prepare('SELECT p.hub, p.id, p.name, p.joined, p.pass, a.name AS owner FROM people p JOIN hubs h ON h.id = p.hub JOIN accounts a ON a.id = h.owner WHERE p.invite = ?').bind(await sha(token)).first<{hub: string; id: string; name: string; joined: number; pass: string; owner: string}>();
  if (!row) return reply({gone: true});
  const about = {name: row.name, username: row.name, owner: row.owner, joined: !!row.joined};
  if (who?.person === row.id && who.hub.id === row.hub) return reply({ok: true});
  // Their manager, in the same browser: once they have joined, the link opens their own view as if they had signed in (the
  // manager could set their password anyway). Their session is held beside the manager's, so the manager's own view stays signed
  // in, in other tabs too; the tab that opened the link asks as them (as). Before they join it waits for them, so their password
  // stays theirs to choose.
  if (who?.account && who.hub.id === row.hub) {
    if (!row.joined) return reply({waiting: about});
    return reply({ok: true, as: row.id}, 200, cookie(await newSession(env, {hub: row.hub, person: row.id}), MONTH, AS + row.id));
  }
  if (body.password === undefined) return reply({ask: about});
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const signin = await getSecret<SignIn>(env, row.hub, row.id, 'signin') ?? bad(500, 'Sign-in details are missing');
  if (row.joined) {
    if (!await ownPassword(String(body.password), row.pass, signin)) {await failed(env, key); bad(403, 'That password is not right');}
    if (!row.pass) await env.DB.prepare('UPDATE people SET pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(String(body.password)), row.hub, row.id).run();
  } else await env.DB.prepare('UPDATE people SET joined = 1, pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(cleanPassword(body.password)), row.hub, row.id).run();
  return reply({ok: true}, 200, await startSession(env, {hub: row.hub, person: row.id}));
}
async function account(request: Request, env: Env, who: Who, action: string | undefined, extra: string | undefined, body: Body, origin: string) {
  const me = who.account!;
  if (!action && request.method === 'PUT') {
    await env.DB.prepare('UPDATE accounts SET name = ?, theme = ? WHERE id = ?').bind(text(body.name ?? '', 60, 'Name').trim(), oneOf(body.theme, ['dark', 'light', 'auto'] as const, 'Theme'), me.id).run(); return {};
  }
  if (action === 'password' && request.method === 'POST') {
    const key = guesses(request, `site:${me.username}`), stored = await env.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(me.id).first<{pass: string}>();
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await checkPassword(String(body.old ?? ''), stored!.pass)) {await failed(env, key); bad(403, 'That is not your current password');}
    await env.DB.batch([env.DB.prepare('UPDATE accounts SET pass = ? WHERE id = ?').bind(await hashPassword(cleanPassword(body.password)), me.id), env.DB.prepare('DELETE FROM sessions WHERE account = ? AND id != ?').bind(me.id, who.session)]);
    return {};
  }
  if (action === 'recovery' && request.method === 'POST') {
    // Only the hashes are kept, so codes can be shown once: when they are made. Making new ones retires the old.
    const codes = Array.from({length: 10}, () => newRecoveryCode());
    await env.DB.prepare('UPDATE accounts SET recovery = ? WHERE id = ?').bind(JSON.stringify(await Promise.all(codes.map(code => sha(code)))), me.id).run();
    return {codes};
  }
  // Passkeys: the browser is given a challenge, makes a key pair on the device, and the site keeps the public half.
  if (action === 'passkeys' && request.method === 'POST' && extra === 'options') {
    const held = await env.DB.prepare('SELECT id FROM passkeys WHERE account = ?').bind(me.id).all<{id: string}>();
    return {...await challenge(env), user: me.id, name: me.username, exclude: held.results.map(row => row.id)};
  }
  if (action === 'passkeys' && request.method === 'POST' && !extra) {
    if (!await created(env, origin, body)) bad(400, 'That passkey could not be checked. Try again.');
    const id = text(body.id, 1400, 'Passkey'), key = text(body.key, 2000, 'Passkey'), alg = body.alg === -7 || body.alg === -257 ? body.alg : bad(400, 'This device makes a kind of passkey the site cannot check');
    if (((await env.DB.prepare('SELECT count(*) AS n FROM passkeys WHERE account = ?').bind(me.id).first<{n: number}>())?.n ?? 0) >= 10) bad(400, 'Ten passkeys is the most. Remove one first.');
    await env.DB.prepare('INSERT INTO passkeys (id, account, name, key, alg, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(id, me.id, text(body.name ?? '', 60, 'Name').trim() || 'A device', key, alg, now()).run();
    return {};
  }
  if (action === 'passkeys' && request.method === 'DELETE' && extra) {
    await env.DB.prepare('DELETE FROM passkeys WHERE account = ? AND substr(id, 1, 16) = ?').bind(me.id, extra).run(); return {};
  }
  if (action === 'recovery' && request.method === 'GET') return {left: (JSON.parse((await env.DB.prepare('SELECT recovery FROM accounts WHERE id = ?').bind(me.id).first<{recovery: string}>())!.recovery) as string[]).length};
  return bad(404, 'Not found');
}
/* A debrid account for the hub. The key goes into the vault and is never sent back. */
async function service(request: Request, env: Env, who: Who, name: string, body: Body) {
  const data = JSON.parse(who.hub.data) as HubData, id = text(name, 40, 'Account');
  if (request.method === 'PUT') {
    const key = text(body.key, 400, 'Key').trim() || bad(400, 'Paste the key');
    const next = {...data, services: [...new Set([...data.services, id])]};
    await env.DB.batch([await putSecret(env, who.hub.id, HUB_OWNER, `debrid:${id}`, key), env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id)]);
    return {v: who.hub.version + 1};
  }
  if (request.method === 'DELETE') {
    const next = {...data, services: data.services.filter(item => item !== id)};
    await env.DB.batch([env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, `debrid:${id}`), env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id)]);
    return {v: who.hub.version + 1};
  }
  return bad(404, 'Not found');
}
/* The hub's catalog keys: TMDB builds the plain Home rows, MDBList reads the lists behind the collection rows. Each is checked with
   its service once, kept in the vault, and never sent back. */
const KEYS: Record<string, {check?: (env: Env, key: string) => string; shape?: RegExp; refused: string}> = {
  tmdb: {check: (env, key) => `${env.TMDB_CHECK ?? 'https://api.themoviedb.org/3/configuration'}?api_key=${encodeURIComponent(key)}`, refused: 'TMDB did not accept that key. Copy the one labelled "API Key", not the long "Read Access Token".'},
  mdblist: {check: (env, key) => `${env.MDBLIST_API ?? 'https://api.mdblist.com'}/user?apikey=${encodeURIComponent(key)}`, refused: 'MDBList did not accept that key. Copy it from Preferences, API Access.'},
};
async function catalogKey(env: Env, who: Who, name: string, body: Body) {
  const key = text(body.key, 200, 'Key').trim() || bad(400, 'Paste the key');
  if (KEYS[name].shape && !KEYS[name].shape!.test(key)) bad(400, KEYS[name].refused);
  const check = KEYS[name].check ? await fetch(KEYS[name].check!(env, key), {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null) : null;
  if (check && [400, 401, 403, 404].includes(check.status)) bad(400, KEYS[name].refused);
  await (await putSecret(env, who.hub.id, HUB_OWNER, `key:${name}`, key)).run();
  return {};
}
/* A list someone pastes the link of, checked with the service it is on, so it can be a Home row. MDBList with the hub's MDBList key
   (or the person's own); Trakt with the site's Trakt app (public lists only); Letterboxd through the hub's AIOMetadata server, which
   is what fills it later; TMDB with the hub's TMDB key. Each answer is a row id homeOf (native.ts) knows how to build. */
const PASTE = 'Paste the link of a public list on Trakt, Letterboxd, MDBList or TMDB.';
const kindOf = (type: string) => type === 'movie' ? 'Movies' : type === 'series' ? 'Series' : 'Movies & shows';
async function findList(env: Env, who: Who, body: Body) {
  const link = text(body.link, 400, 'Link').trim(), site = hosted(env, JSON.parse(who.hub.data) as HubData);
  const ask = async (url: string, init: RequestInit = {}) => {const answer = await fetch(url, {...init, headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0', ...(init.headers ?? {})}}).catch(() => null); return {status: answer?.status ?? 0, body: answer?.ok ? await answer.json().catch(() => null) as Record<string, any> | Record<string, any>[] | null : null};};
  const mdb = /mdblist\.com\/lists\/([\w.-]+)\/([\w.-]+)/.exec(link);
  if (mdb) {
    const key = await getSecret<string>(env, who.hub.id, HUB_OWNER, 'key:mdblist') ?? (who.person ? (await getSecret<{key: string}>(env, who.hub.id, who.person, 'mdblist'))?.key : null) ?? bad(400, 'MDBList lists need the hub’s MDBList key first. It goes under Hub, Sources.');
    const got = await ask(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}/lists/${mdb[1]}/${mdb[2]}?apikey=${encodeURIComponent(key)}`), list = Array.isArray(got.body) ? got.body[0] : got.body;
    if (got.status >= 500 || !got.status) bad(502, 'MDBList isn’t answering just now. Try again in a moment.');
    if (!list || !Number.isInteger(list.id)) bad(404, 'MDBList has no public list at that link.');
    const type = list!.mediatype === 'movie' ? 'movie' : list!.mediatype === 'show' ? 'series' : 'all';
    return {id: `mdblist.${list!.id}.${type}`, title: String(list!.name ?? 'A list').slice(0, 80), kind: kindOf(type), source: 'MDBList'};
  }
  const trakt = /trakt\.tv\/users\/([\w.-]+)\/lists\/([\w.-]+)/.exec(link) ?? /trakt\.tv\/lists\/(\d+)/.exec(link);
  if (trakt) {
    if (!env.TRAKT_CLIENT_ID) bad(400, 'Trakt lists can’t be added on this site.');
    const path = trakt[2] ? `/users/${trakt[1]}/lists/${trakt[2]}` : `/lists/${trakt[1]}`;
    const got = await ask(`${env.TRAKT_API ?? 'https://api.trakt.tv'}${path}`, {headers: {'content-type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': env.TRAKT_CLIENT_ID!}}), list = got.body as {name?: string; privacy?: string; ids?: {trakt?: number}} | null;
    if (got.status === 429 || got.status === 420 || got.status >= 500 || !got.status) bad(502, 'Trakt isn’t answering just now. Try again in a few minutes.');
    if (got.status === 401 || got.status === 403 || (list && list.privacy && list.privacy !== 'public')) bad(400, 'That Trakt list isn’t public. Its owner can add it from their own lists, once their Trakt is connected here.');
    if (!list || !Number.isInteger(list.ids?.trakt)) bad(404, 'Trakt has no list at that link.');
    return {id: `trakt.list.${list!.ids!.trakt}`, title: String(list!.name ?? 'A list').slice(0, 80), kind: 'Movies & shows', source: 'Trakt'};
  }
  if (/letterboxd\.com\/[\w.-]+\/list\/[\w.-]+/.test(link)) {
    if (!site.AIOM_ORIGIN) bad(400, 'Letterboxd lists can’t be added on this site.');
    const url = `https://${/letterboxd\.com\/[\w.-]+\/list\/[\w.-]+/.exec(link)![0]}/`, post = {method: 'POST', headers: {'content-type': 'application/json'}};
    const found = await ask(`${site.AIOM_ORIGIN}/api/letterboxd/extract-identifier`, {...post, body: JSON.stringify({url})}), identifier = String((found.body as {identifier?: string} | null)?.identifier ?? '');
    if (found.status === 404 || (found.status === 400)) bad(404, 'Letterboxd has no public list at that link.');
    if (!/^[\w-]{1,60}$/.test(identifier)) bad(502, 'Letterboxd isn’t answering just now. Try again in a moment.');
    const list = await ask(`${site.AIOM_ORIGIN}/api/letterboxd/list`, {...post, body: JSON.stringify({identifier, isWatchlist: false})}), data = (list.body as {data?: {title?: string; items?: unknown[]}} | null)?.data;
    if (!data) bad(502, 'Letterboxd isn’t answering just now. Try again in a moment.');
    if (!data!.items?.length) bad(400, 'That Letterboxd list is empty.');
    return {id: `letterboxd.${identifier}`, title: String(data!.title ?? 'A list').slice(0, 80), kind: 'Movies', source: 'Letterboxd'};
  }
  const tmdb = /themoviedb\.org\/list\/(\d{1,12})/.exec(link);
  if (tmdb) {
    const key = await getSecret<string>(env, who.hub.id, HUB_OWNER, 'key:tmdb') ?? bad(400, 'TMDB lists need the hub’s TMDB key first. It goes under Hub, Sources.');
    const got = await ask(`${env.TMDB_API ?? 'https://api.themoviedb.org/3'}/list/${tmdb[1]}?api_key=${encodeURIComponent(key)}`), list = got.body as {name?: string; item_count?: number} | null;
    if (got.status >= 500 || !got.status) bad(502, 'TMDB isn’t answering just now. Try again in a moment.');
    if (!list) bad(404, 'TMDB has no public list at that link.');
    if (!list!.item_count) bad(400, 'That TMDB list is empty.');
    return {id: `tmdb.list.${tmdb[1]}`, title: String(list!.name ?? 'A list').slice(0, 80), kind: 'Movies & shows', source: 'TMDB'};
  }
  if (/trakt\.tv|letterboxd\.com|themoviedb\.org|mdblist\.com/.test(link)) bad(400, `That’s not a list link. ${PASTE}`);
  return bad(400, PASTE);
}
/* Which AIOStreams and AIOMetadata servers the hub uses. Each address is asked what it is before it is kept, and the sources the
   AIOStreams server does not offer are noted so they are never asked of it. Blank means the site's own choice. */
const STREAM_TYPES: Record<string, string> = {library: 'stremthruStore', torrentio: 'torrentio', comet: 'comet', meteor: 'meteor', torz: 'stremthruTorz'};
function origin(value: unknown, what: string): string {
  const typed = text(value ?? '', 300, what).trim(); if (!typed) return '';
  let url: URL; try {url = new URL(typed);} catch {return bad(400, `${what} is not a web address`);}
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || url.username || url.port) bad(400, `${what} must be a public https address`);
  return url.origin;
}
async function setHost(env: Env, who: Who, body: Body) {
  const data = JSON.parse(who.hub.data) as HubData, up = origin(body.aiostreams, 'The AIOStreams address'), meta = origin(body.aiometadata, 'The AIOMetadata address');
  const ask = (address: string) => fetch(address, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, redirect: 'manual'}).then(answer => answer.status === 200 ? answer.json() : null, () => null) as Promise<Record<string, any> | null>;
  let missing: string[] = [];
  if (up) {
    const status = await ask(`${up}/api/v1/status`), presets = status?.data?.settings?.presets as {ID: string; DISABLED?: unknown}[] | undefined;
    if (!Array.isArray(presets)) bad(400, 'That address did not answer as an AIOStreams server');
    if (status!.data.settings.protected) bad(400, 'That AIOStreams server asks for a password to make new setups, which the hub cannot give.');
    const offered = new Set(presets!.filter(item => !item.DISABLED).map(item => item.ID));
    if (!offered.has('custom')) bad(400, 'That AIOStreams server does not allow addons by link, which Home rows need.');
    missing = Object.entries(STREAM_TYPES).filter(([, type]) => !offered.has(type)).map(([id]) => id);
  }
  if (meta && typeof (await ask(`${meta}/api/config`))?.addonVersion !== 'string') bad(400, 'That address did not answer as an AIOMetadata server');
  const next: HubData = {...data, hostUrl: up, metaUrl: meta, missing, host: up ? new URL(up).hostname : 'ForTheWeak'};
  await env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id).run();
  return {v: who.hub.version + 1, missing};
}
async function dropKey(env: Env, who: Who, name: string) {
  await env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, `key:${name}`).run();
  return {};
}
/* Deletes the hub and everything in it, here and on the streaming server. The password is asked for again: there is no undo. */
/* Advanced: the way into the hub's own setups on AIOStreams and AIOMetadata, for the manager only and only after their password
   again. These are the real keys to those setups, so they are handed over one deliberate time and never ride in page data. */
async function advanced(request: Request, site: Env, who: Who, body: Body) {
  const key = guesses(request, `site:${who.account!.username}`), stored = await site.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(who.account!.id).first<{pass: string}>();
  if (await blocked(site, key)) bad(429, 'Too many tries. Wait ten minutes.');
  if (!await checkPassword(String(body.password ?? ''), stored!.pass)) {await failed(site, key); bad(403, 'That is not your password');}
  const env = hosted(site, JSON.parse(who.hub.data) as HubData);
  const players = await getSecret<{uuid: string; password: string; at?: string}>(env, who.hub.id, HUB_OWNER, 'players'), home = await getSecret<{uuid: string; password: string; at?: string}>(env, who.hub.id, HUB_OWNER, 'catalogs');
  // AIOStreams opens a setup already signed in from the address Stremio's own Configure button uses; it needs the password in AIOStreams' sealed form.
  const up = players?.at ?? env.UP_ORIGIN, sealed = players ? await fetch(`${up}/api/v1/user`, {headers: {authorization: `Basic ${btoa(`${players.uuid}:${players.password}`)}`, accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).then(r => r.ok ? r.json() as Promise<{data?: {encryptedPassword?: string}}> : null, () => null).then(j => j?.data?.encryptedPassword) : undefined;
  return {
    aiostreams: players ? {open: sealed ? `${up}/stremio/${players.uuid}/${encodeURIComponent(sealed)}/configure` : `${up}/stremio/configure`, id: players.uuid, password: players.password} : null,
    aiometadata: home ? {open: `${home.at ?? env.AIOM_ORIGIN}/stremio/${home.uuid}/configure`, id: home.uuid, password: home.password} : null,
    // The separate AIOMetadata setups a group or a person has while their Home, looks or accounts differ from the shared one.
    own: await ownDoors(env, who.hub.id),
    front: env.FRONT === 'aiometadata',
  };
}
async function ownDoors(env: Env, hub: string) {
  const owners = (await env.DB.prepare("SELECT s.owner, s.kind, coalesce(p.name, g.name) AS name FROM secrets s LEFT JOIN people p ON p.hub = s.hub AND p.id = s.owner LEFT JOIN groups g ON g.hub = s.hub AND s.owner = '#g:' || g.id WHERE s.hub = ? AND s.kind IN ('catalogs', 'aiom') AND s.owner != ?").bind(hub, HUB_OWNER).all<{owner: string; name: string | null; kind: string}>()).results;
  const doors = [];
  for (const row of owners) {
    const made = await getSecret<{uuid: string; password: string; at?: string}>(env, hub, row.owner, row.kind);
    if (made) doors.push({name: row.name ?? 'Someone removed', group: row.owner.startsWith('#g:'), player: row.kind === 'aiom', open: `${made.at ?? env.AIOM_ORIGIN}/stremio/${made.uuid}/configure`, id: made.uuid, password: made.password});
  }
  return doors;
}
async function removeHub(request: Request, env: Env, who: Who, body: Body) {
  const key = guesses(request, `site:${who.account!.username}`), stored = await env.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(who.account!.id).first<{pass: string}>();
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  if (!await checkPassword(String(body.password ?? ''), stored!.pass)) {await failed(env, key); bad(403, 'That is not your password');}
  if (!await removePlayers(env, who.hub)) bad(502, 'The streaming server did not confirm the removal, so nothing was deleted. Try again in a moment.');
  const hub = who.hub.id;
  await env.DB.batch([...['devices', 'plays', 'sittings', 'starts', 'heard_fields', 'quick', 'secrets', 'rows_keys', 'trakt_outbox', 'rows_cache', 'drift', 'foryou', 'foryou_sync', 'people', 'groups', 'ops'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ?`).bind(hub)), env.DB.prepare('DELETE FROM sessions WHERE hub = ? OR account = ?').bind(hub, who.account!.id),
    env.DB.prepare('DELETE FROM hubs WHERE id = ?').bind(hub), env.DB.prepare('DELETE FROM passkeys WHERE account = ?').bind(who.account!.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(who.account!.id)]);
  // Player apps stop reaching it at once, not when this copy of the Worker next looks the hub up.
  forgetHub(who.hub.code);
  return {};
}

export async function api(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const path = url.pathname.slice(5).split('/').map(decodeURIComponent), [first, second, third, fourth] = path, method = request.method;
    // Anything that changes something must come from this site's own pages.
    if (method !== 'GET' && request.headers.get('origin') !== url.origin) bad(403, 'Not allowed');
    const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => bad(400, 'Not valid')) as Body;
    if (!body || typeof body !== 'object') bad(400, 'Not valid');
    if (first === 'open' && method === 'GET') {
      const signup = await hubCount(env) < Number(env.MAX_HUBS ?? 1), hub = newCode();
      return reply({signup, code: !!env.CLAIM_CODE, ...(signup ? {hub, proof: await stamp(env, `hub:${hub}`)} : {})});
    }
    if (first === 'signup' && method === 'POST') return await signUp(request, env, body);
    if (first === 'signin' && method === 'POST') return await signIn(request, env, body);
    if (first === 'passkey' && method === 'GET') return reply(await challenge(env));
    if (first === 'passkey' && method === 'POST') {
      const key = guesses(request, 'passkey').slice(1);
      if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
      const held = await env.DB.prepare('SELECT account, key, alg FROM passkeys WHERE id = ?').bind(String(body.id ?? '')).first<{account: string; key: string; alg: number}>();
      if (!held || !await signed(env, url.origin, body, held.key, held.alg)) {await failed(env, key); bad(403, 'That passkey is not one this site knows');}
      return reply({}, 200, await startSession(env, {account: held!.account}));
    }
    // Back from Trakt's sign-in: straight on to the page, which finishes it (see Trakt in pages.tsx). The code is single-use and
    // worthless without the proof the page kept, and it travels in the fragment, which browsers never send anywhere.
    if (first === 'trakt' && path[1] === 'callback' && method === 'GET') {
      const back = new URLSearchParams(); for (const name of ['code', 'state', 'error']) {const value = url.searchParams.get(name); if (value) back.set(name, value.slice(0, 4000));}
      return new Response(null, {status: 302, headers: {location: `/#/trakt?${back}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}});
    }
    // A person's Trakt rows, read by their AIOMetadata setup. The token in the address is the only key (see rows.ts).
    if (first === 'rows' && method === 'GET') return await rows(env, path.slice(1));
    const who = await whoIs(request, env);
    if (first === 'join' && method === 'POST') return await join(request, env, body, who);
    if (first === 'signout' && method === 'POST') {
      // From a person's view held beside the manager's: only that person's session ends; the manager stays signed in.
      if (who?.manager?.beside) {await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(who.session).run(); return reply({}, 200, cookie('', 0, AS + who.person));}
      // Otherwise this browser signs out altogether, with any person's view it was holding.
      const held = heldOf(request), ends = [who?.session ?? '', who?.manager?.session ?? '', ...await Promise.all(held.map(h => sha(h.token)))];
      await env.DB.batch(ends.map(id => env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id)));
      const out = reply({}, 200, cookie('', 0)); out.headers.append('set-cookie', cookie('', 0, KEPT)['set-cookie']);
      for (const h of held) out.headers.append('set-cookie', cookie('', 0, AS + h.person)['set-cookie']);
      return out;
    }
    // From a person's view back to the manager's own, which was set aside when their link was opened.
    if (first === 'back' && method === 'POST') {
      if (!who?.person || !who.manager) return reply({message: 'Sign in first'}, 401);
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(who.session).run();
      const out = reply({}, 200, cookie(who.manager.token, MONTH)); out.headers.append('set-cookie', cookie('', 0, KEPT)['set-cookie']); return out;
    }
    if (!who) return reply({message: 'Sign in first'}, 401);
    // Anyone signed in may ask for the players to be brought in step; what is sent comes only from what the hub has stored.
    if (first === 'lists' && method === 'POST') return reply(await findList(env, who, body));
    if (first === 'sync' && method === 'POST') return reply(await syncPlayers(env, who.hub, url.origin));
    // An invited person gets their own rows; the manager can ask for anyone's.
    if (first === 'previews' && method === 'GET') {
      // A group's Home as someone in it starts with comes from the group's own setup (see homes in native.ts), for its manager.
      const group = !who.person ? url.searchParams.get('group') || undefined : undefined;
      return reply({rows: await previews(env, who.hub, who.person ?? (group ? undefined : url.searchParams.get('person') || undefined), group)});
    }
    if (first === 'activity' && method === 'GET') {
      // The manager sees everyone; an invited person sees only themselves. Each sitting of the last week (front.ts), with its title.
      const rows = await env.DB.prepare(`SELECT s.person, s.item, s.started, p.title, p.detail, s.position, p.duration, s.device, s.playing, s.paused, s.since, s.updated, p.art, s.place, s.net, s.parts, s.pauses, s.idle FROM sittings s JOIN plays p ON p.hub = s.hub AND p.person = s.person AND p.item = s.item WHERE s.hub = ?1 AND s.updated > ?2 ${who.person ? 'AND s.person = ?3' : ''} ORDER BY s.updated DESC LIMIT 1000`).bind(...(who.person ? [who.hub.id, now() - 7 * 86400, who.person] : [who.hub.id, now() - 7 * 86400])).all();
      // One with too little played is left out once it is over (see brief); while it may still be playing, it shows.
      const time = now(), kept = (rows.results as {playing: number; updated: number; parts: string | null; started: number; duration: number}[]).filter(row => (row.playing && time - row.updated < 900) || !brief(row, row.duration));
      return reply({now: time, sittings: kept});
    }
    if (first === 'state' && method === 'GET') return reply(await state(env, who) ?? bad(401, 'Sign in first'));
    if (first === 'people' && second && third) return reply(await personAction(request, env, who, second, third, fourth, body, url.origin));
    if (first === 'people' && second && method === 'PUT') return reply(await savePerson(env, who, second, body));
    if (who.person) bad(403, 'Not allowed');
    if (first === 'hub' && method === 'PUT') return reply(await saveHub(env, who, body));
    if (first === 'hub' && method === 'POST' && second === 'advanced') return reply(await advanced(request, env, who, body));
    if (first === 'host' && method === 'PUT') return reply(await setHost(env, who, body));
    if (first === 'hub' && method === 'POST' && second === 'delete') return reply(await removeHub(request, env, who, body), 200, cookie('', 0));
    if (first === 'groups' && second && method === 'PUT') return reply(await saveGroup(env, who, second, body));
    if (first === 'groups' && second && method === 'DELETE') return reply(await removeGroup(env, who, second));
    if (first === 'people' && second && method === 'DELETE') return reply(await removePerson(env, who, second));
    if (first === 'services' && second) return reply(await service(request, env, who, second, body));
    if (first === 'keys' && second && KEYS[second] && method === 'PUT') return reply(await catalogKey(env, who, second, body));
    if (first === 'keys' && second === 'mdblist' && method === 'DELETE') return reply(await dropKey(env, who, second));
    if (first === 'account') return reply(await account(request, env, who, second, third, body, url.origin));
    return reply({message: 'Not found'}, 404);
  } catch (error) {
    if (error instanceof Bad) return reply({message: error.message}, error.status);
    console.error('api', url.pathname, (error as Error).message);
    return reply({message: 'Something went wrong on our side'}, 500);
  }
}
