// The site's own API: managers' accounts, the hub they run, and what an invited person may change about themselves.
// What reaches the streaming server goes through ./native.
import {NO_ANSWER, carry, earlierPlays, mdblist, plan, sendingSince, synced} from './carry';
import type {Earlier} from './carry';
import {skip, skippedOf} from './drift';
import {FOR_YOU_KINDS, PICKABLE, SHELF_TITLES, WAS, current as currentRows, defaultAddons, defaultRows, defaultSettings, isPlace, pickable, slug, traktRows} from '../src/data';
import type {Addon, Hub, Overrides, Row, Settings} from '../src/data';
import {challenge, created, signed} from './passkeys';
import {HUB_OWNER, MOST_PEOPLE, previews, removePlayers, syncInTurn} from './native';
import {NOTICE, NOTICE_PAGE, cleanAddress, changed as homeChanged} from './notice';
import {forgetHub, forgetSeats} from './front';
import {EARLIER, LINK, answered, brief, deliver, disconnect, forgetTrakt, keepLink, links, read, stopSending, syncOn, traktWait} from './trakt';
import type {Link} from './trakt';
import {pass, turnEvery} from './sync';
import {clearFound, forgetHearts, foundOf, heartsOn, mayHeart, noteHearts, turnHearts} from './hearts';
import {forgetWatchlist, rows} from './rows';
import {PAIRS, copy, forgetShown, moving, shown} from './places';
import {because} from './suggest';
import {STAND_INS, detailOf, flag as setupsDue, kindsOf, namesOf, pickFromAgain, pickHour, placeAsked} from './foryou';
import {LIKED_ROW, SHELF, SHELF_ROW, likedList, mdbLists, shelfFrom, shelfId, shelved, wantsShelf} from './shelf';
import type {Env} from './util';
import {TESTING, blocked, checkPassword, failed, getSecret, guesses, hashPassword, hosted, newCode, newId, newPassword, newPin, newRecoveryCode, newToken, now, putSecret, same, sha, stamp, unseal, webPlayer} from './util';

const TAKEN = 'Someone in this hub already has that name';
class Bad extends Error {constructor(public status: number, message: string, public until = 0) {super(message);}}
/* Says why something of a person's could not be done; when Trakt asked the hub to wait, until when, so the page can say the time. */
const refuse = async (env: Env, hub: string, person: string, got: {error: string; status?: number}): Promise<never> => {
  throw new Bad(got.status ?? 409, got.error, got.error === NO_ANSWER.trakt.error ? await traktWait(env, hub, person) : 0);
};
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
  // A row sent under an id from before is kept as what it is now (current, in data.ts).
  return currentRows((value as Record<string, unknown>[]).map(item => {
    const id = text(item?.id, 120, 'Row'); if (seen.has(id)) bad(400, 'A row is listed twice'); seen.add(id);
    // A For you place is named by what is picked for it each day, never by a name saved with it.
    const row: Row = {id, title: isPlace(id) ? 'For you' : text(item.title, 160, 'Row title'), kind: text(item.kind, 80, 'Row'), source: isPlace(id) ? 'Picked daily' : text(item.source, 400, 'Row'), origin: oneOf(item.origin, ['hub', 'group', 'own'] as const, 'Row'), on: flag(item.on)};
    if (item.core === true) row.core = true;
    if (item.watched !== undefined) row.watched = oneOf(item.watched, ['hide', 'show'] as const, 'Row');
    if (item.covers !== undefined) row.covers = Array.isArray(item.covers) && item.covers.length <= 80 ? (item.covers as Record<string, unknown>[]).map(cover => ({title: text(cover?.title, 120, 'Folder name'), image: text(cover.image, 400, 'Folder')})) : bad(400, 'Folders are not valid');
    return row;
  }));
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
  forYouOrder: value => [...new Set(list(value, 20, 20, 'For you').filter(id => FOR_YOU_KINDS.some(kind => kind.id === id)))],
  forYouBecause: value => oneOf(value, ['lately', 'any'] as const, 'For you'),
  formatter: value => ({name: text((value as Record<string, unknown>)?.name, 20_000, 'Stream label'), description: text((value as Record<string, unknown>).description, 20_000, 'Stream label')}),
};
const LATER = new Set<keyof Settings>(['ageBadge', 'forYouOff', 'forYouOrder', 'forYouBecause']);
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
const cleanPicks = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([id, on]) => (pickable(id) || !!WAS[id]) && typeof on === 'boolean')) as Record<string, boolean> : undefined;

function ago(seen: number) {
  const gap = now() - seen;
  return gap < 300 ? 'Now' : gap < 3600 ? `${Math.floor(gap / 60)} min ago` : gap < 86400 ? `${Math.floor(gap / 3600)} h ago` : gap < 172800 ? 'Yesterday' : `${Math.floor(gap / 86400)} days ago`;
}
const groupDto = (row: GroupRow) => ({id: row.id, name: row.name, ...(JSON.parse(row.data) as GroupData), v: row.version});
// moving: their MDBList key is kept while they move where progress is kept, to MDBList or back Here (see places.ts).
// listsKept: they have an MDBList key saved. With progress kept Here it is kept but not used for progress, only to read their lists.
// matching: whether their Trakt sync is on (sync.ts: with it off nothing of their watching goes to Trakt or comes back), and how
// that stands: `ask` while they have yet to answer
// (they connected it themselves), the last good pass, since when it has been failing and why, and since when a call has waited for
// Trakt (`waiting`), and until when Trakt asked the hub to wait, for reads or for writes (`until`, left out when it did not). Times
// only; nothing of what they watched.
// `passed`: they said "Not now" to adding what they watched here before sync was turned on, for the plays from before this turning
// on (a later turning on offers its own).
type Matching = {on: boolean; earlier: boolean; passed: boolean; ask: boolean; good: number; failing: number | null; why: string | null; waiting: number | null; until?: number};
// hearts: their Watchlist switch on the Sync card, and whether it is on (a row in `favs`). For anyone it can do something for:
// a setup of their own, and Trakt connected to the hub (not while it waits to be signed in to again) or, without Trakt, an
// MDBList key of theirs. null for anyone else. Their manager gets `on` too, to show it (and to set it, while they have not joined).
// `extra`: titles saved on their server that their Trakt watchlist lacks, as the cron step last counted them (hearts.ts), for
// the offer to add them (`more`: there are more than the offer holds). A count only, never which, and only on their own page.
const personDto = (row: PersonRow, devices: DeviceRow[], ready: boolean, history: {username: string; again: boolean} | null, aiomTrakt: boolean, listsName = '', moving: string | null = null, listsKept = false, played = false, matching: Matching | null = null, hearts: {on: boolean; extra?: number; more?: boolean} | null = null) => ({
  ready, history, listsName, moving, listsKept, played, matching, hearts,
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
/* The background work as the manager's page gets it. Trakt sync takes one person each run whichever hub they are in, so how often
   a person's turn comes depends on how many sync across the whole site: only the minutes are given, never that count. */
// `notice`: the address called when Home changes (notice.ts), as a manager is shown it: the address itself (theirs to read and
// change; only a manager's own session gets this at all), its host name, when it was last called and how that went, and whether
// a call is waiting its turn (`again`: the one second try after a call that failed).
const jobsOf = ({syncAll, noticeHost, noticeAt, noticeResult, noticeWanted, noticeRetry, ...rest}: Record<string, unknown>, forYouHour: number, address: string) => ({...rest, syncEvery: turnEvery(Number(syncAll) || 0), forYouHour,
  notice: typeof noticeHost === 'string' ? {address, host: noticeHost, at: Number(noticeAt) || 0, result: noticeResult ?? null, waiting: noticeWanted === 2, again: noticeWanted === 2 && noticeRetry === 1} : null}) as unknown as Hub['jobs'];
async function state(env: Env, who: Who) {
  const hub = who.hub, data = JSON.parse(hub.data) as HubData, mine = who.person;
  const [groups, people, devices, owner, ready, keys, passkeys, traktLinks, oldTrakt, listKeys, jobs, plays, picked, shelves, syncs, waits, tolds, favs, passkeyCounts] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, data, version FROM groups WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(hub.id, mine) : env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? AND person = ? ORDER BY seen DESC').bind(hub.id, mine) : env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? ORDER BY seen DESC').bind(hub.id),
    env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(hub.owner),
    env.DB.prepare("SELECT owner, kind FROM secrets WHERE hub = ? AND kind IN ('upstream', 'upstream-aiom')").bind(hub.id),
    env.DB.prepare("SELECT kind FROM secrets WHERE hub = ? AND owner = ? AND kind IN ('key:tmdb', 'key:mdblist', 'key:posters', ?)").bind(hub.id, HUB_OWNER, NOTICE_PAGE),
    // The passkeys of whoever is signed in: the manager's own, or a person's own. Never a person's in their manager's view of
    // their page (who.manager): a manager is given how many each person has (below), nothing more.
    who.account ? env.DB.prepare('SELECT substr(id, 1, 16) AS id, name, created FROM passkeys WHERE account = ? ORDER BY created').bind(who.account.id)
      : env.DB.prepare('SELECT substr(id, 1, 16) AS id, name, created FROM person_passkeys WHERE hub = ? AND person = ? ORDER BY created').bind(hub.id, who.manager ? '' : mine ?? ''),
    env.DB.prepare('SELECT owner, value FROM secrets WHERE hub = ? AND kind = ? AND owner = coalesce(?, owner)').bind(hub.id, LINK, mine ?? null),
    env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind = 'trakt'").bind(hub.id),
    env.DB.prepare("SELECT owner, value FROM secrets WHERE hub = ? AND kind = 'mdblist' AND owner = coalesce(?, owner)").bind(hub.id, mine ?? null),
    // The background work, for the manager: when it last ran, how often it has, what waits for Trakt, the last daily check. The
    // next My lists row due counts only rows still on a Home: one taken off is never worked out again.
    env.DB.prepare(`SELECT (SELECT at FROM runs WHERE job = 'cron') AS last, (SELECT count FROM runs WHERE job = 'cron') AS runs, (SELECT since FROM runs WHERE job = 'cron') AS since,
      (SELECT max(at) FROM drift WHERE hub = ?1 AND work IS NULL AND result IS NOT NULL) AS ran, (SELECT count(*) FROM trakt_outbox WHERE hub = ?1) AS waiting,
      (SELECT max(day) FROM drift WHERE hub = ?1 AND work IS NULL) AS checked, (SELECT count(*) FROM drift WHERE hub = ?1 AND day = (SELECT max(day) FROM drift WHERE hub = ?1) AND work IS NULL) AS people, (SELECT count(*) FROM drift WHERE hub = ?1 AND work IS NOT NULL) AS checking,
      (SELECT count(*) FROM foryou WHERE hub = ?1 AND day = ?2) AS picked, (SELECT max(at) FROM foryou WHERE hub = ?1) AS pickedAt, (SELECT count(*) FROM people WHERE hub = ?1) AS everyone, (SELECT count(*) FROM foryou_sync WHERE hub = ?1) AS syncing, (SELECT min(at) FROM foryou_sync WHERE hub = ?1) AS syncingSince, (SELECT max(json_extract(items, '$.ran')) FROM rows_cache WHERE hub = ?1 AND kind = 'recs') AS recsAt, (SELECT count(*) FROM rows_cache WHERE hub = ?1 AND kind = 'recs') AS recs, (SELECT min(at) FROM rows_cache WHERE hub = ?1 AND kind = 'recs') AS recsDue, (SELECT max(json_extract(items, '$.ran')) FROM rows_cache WHERE hub = ?1 AND kind = 'ahead') AS aheadAt, (SELECT count(*) FROM rows_cache WHERE hub = ?1 AND kind = 'ahead') AS aheads, (SELECT min(at) FROM rows_cache WHERE hub = ?1 AND kind = 'ahead') AS aheadDue, (SELECT max(json_extract(items, '$.ran')) FROM rows_cache WHERE hub = ?1 AND kind = 'certs') AS ratedAt, (SELECT coalesce(sum(json_array_length(items, '$.want')), 0) FROM rows_cache WHERE hub = ?1 AND kind = 'certs') AS rating, (SELECT max(at) FROM rows_cache WHERE hub = ?1 AND kind = 'shelf') AS shelved, (SELECT count(*) FROM rows_cache WHERE hub = ?1 AND kind = 'shelf') AS shelves, (SELECT max(good) FROM sync WHERE hub = ?1 AND matching = 1) AS matched, (SELECT count(*) FROM sync WHERE hub = ?1 AND matching = 1) AS matching, (SELECT max(good) FROM favs WHERE hub = ?1) AS hearted, (SELECT count(*) FROM favs f WHERE f.hub = ?1 AND EXISTS (SELECT 1 FROM secrets s WHERE s.hub = f.hub AND s.owner = f.person AND s.kind = ?3)) AS hearting, (SELECT count(*) FROM sync y JOIN secrets s ON s.hub = y.hub AND s.owner = y.person AND s.kind = ?3 WHERE y.matching = 1) AS syncAll, (SELECT max(lists_at) FROM drift WHERE hub = ?1) AS listed, (SELECT count(*) FROM people p JOIN secrets s ON s.hub = p.hub AND s.owner = p.id AND s.kind = 'mdblist' WHERE p.hub = ?1 AND json_extract(p.data, '$.lists') = 1) AS listers, (SELECT min(c.at) FROM rows_cache c JOIN people p ON p.hub = c.hub AND p.id = c.person WHERE c.hub = ?1 AND c.kind = 'shelf' AND EXISTS (SELECT 1 FROM json_each(p.data, '$.rows') r WHERE json_extract(r.value, '$.id') IN ('trakt-lists', 'trakt-liked-lists') AND json_extract(r.value, '$.on') = 1)) AS shelfDue,
      (SELECT host FROM notices WHERE hub = ?1) AS noticeHost, (SELECT called FROM notices WHERE hub = ?1) AS noticeAt, (SELECT result FROM notices WHERE hub = ?1) AS noticeResult, (SELECT wanted FROM notices WHERE hub = ?1) AS noticeWanted, (SELECT retry FROM notices WHERE hub = ?1) AS noticeRetry`).bind(hub.id, new Date().toISOString().slice(0, 10), LINK),
    // Who has played something here: their Recently Watched has something in it even without Trakt or MDBList. One look per
    // person (the first of their plays by the table's own key), not a read of every play the hub ever had.
    env.DB.prepare('SELECT p.id AS person FROM people p WHERE p.hub = ? AND p.id = coalesce(?, p.id) AND EXISTS (SELECT 1 FROM plays y WHERE y.hub = p.hub AND y.person = p.id)').bind(hub.id, mine ?? null),
    // What each For you place holds today, by name and what it came from (the manager sees them on that person's Home tab), the
    // day's other options, and when it was picked.
    env.DB.prepare('SELECT person, picks, pool, never, at FROM foryou WHERE hub = ? AND person = coalesce(?, person)').bind(hub.id, mine ?? null),
    // When each My lists row was last worked out (0: asked for again, shelf.ts), for the row's line on their Home.
    // Its tiles too (name and picture of each list), so the row shows them on the site as the apps do.
    env.DB.prepare('SELECT person, at, items FROM rows_cache WHERE hub = ? AND kind = ? AND person = coalesce(?, person)').bind(hub.id, SHELF, mine ?? null),
    // Whether each person's Trakt is synced and how that stands, and how long their oldest call has waited for Trakt.
    // The daily look's own failing counts too (drift.ts): whichever has failed longer is said.
    env.DB.prepare('SELECT y.person, y.matching, y.earlier, y.passed, y.good, y.failing, y.why, d.failing AS stale, d.why AS staleWhy FROM sync y LEFT JOIN drift d ON d.hub = y.hub AND d.person = y.person WHERE y.hub = ? AND y.person = coalesce(?, y.person)').bind(hub.id, mine ?? null),
    env.DB.prepare('SELECT person, min(made) AS since FROM trakt_outbox WHERE hub = ? AND person = coalesce(?, person) GROUP BY person').bind(hub.id, mine ?? null),
    // Until when Trakt asked the hub to wait before reading or sending more of theirs (trakt.ts), so the page can say the time.
    env.DB.prepare("SELECT person, max(at) AS at FROM rows_cache WHERE hub = ? AND kind IN ('trakt-wait', 'trakt-wait-send') AND at > ? AND person = coalesce(?, person) GROUP BY person").bind(hub.id, now(), mine ?? null),
    // Whose Watchlist switch is on, and what the cron counted for the offer under it (given to their own page only, below).
    env.DB.prepare('SELECT person, found FROM favs WHERE hub = ? AND person = coalesce(?, person)').bind(hub.id, mine ?? null),
    // How many passkeys each person has. A count only: which devices, and the keys, are theirs alone.
    env.DB.prepare('SELECT person, count(*) AS n FROM person_passkeys WHERE hub = ? AND person = coalesce(?, person) GROUP BY person').bind(hub.id, mine ?? null),
  ]);
  const passkeyCount = new Map((passkeyCounts.results as {person: string; n: number}[]).map(row => [row.person, row.n]));
  const forYou = new Map((picked.results as {person: string; picks: string; pool: string; never: string; at: number}[]).map(row => [row.person, {names: namesOf(row.picks), kinds: kindsOf(row.picks), at: row.at, detail: detailOf(row.picks, row.pool, row.never)}]));
  const shelfAt = new Map((shelves.results as {person: string; at: number}[]).map(row => [row.person, row.at]));
  const shelfTiles = new Map((shelves.results as {person: string; items: string}[]).map(row => [row.person, shelfFrom(row.items).filter(list => list.cover).map(list => ({title: list.title, image: list.cover, ...(likedList(list.id) ? {liked: true} : {})}))]));
  // Which MDBList account each person's progress goes to (the name only; the key never leaves the vault).
  const listsName: Record<string, string> = {};
  const moves: Record<string, string> = {}, keyed = new Set<string>();
  for (const row of listKeys.results as {owner: string; value: string}[]) {const kept = await unseal<{key?: string; username?: string; moving?: string}>(env, `${hub.id}/${row.owner}/mdblist`, row.value); if (kept?.key) keyed.add(row.owner); if (kept?.username) listsName[row.owner] = kept.username; if (kept?.moving) moves[row.owner] = kept.moving;}
  const aiomTrakt = new Set((oldTrakt.results as {owner: string}[]).map(row => row.owner));
  const traktOf = env.TRAKT_CLIENT_ID ? await links(env, hub.id, traktLinks.results as {owner: string; value: string}[]) : {};
  const history = Object.fromEntries(Object.entries(traktOf).map(([id, link]) => [id, {username: link.username, again: link.again}]));
  const syncOf = new Map((syncs.results as {person: string; matching: number; earlier: number; passed: number | null; good: number; failing: number | null; why: string | null; stale: number | null; staleWhy: string | null}[])
    .map(row => [row.person, row.stale && (!row.failing || row.stale < row.failing) ? {...row, failing: row.stale, why: row.staleWhy} : row]));
  const waitOf = new Map((waits.results as {person: string; since: number}[]).map(row => [row.person, row.since]));
  const toldOf = new Map((tolds.results as {person: string; at: number}[]).map(row => [row.person, row.at]));
  const matchingOf = (id: string): Matching | null => {
    if (!traktOf[id]) return null;
    const row = syncOf.get(id);
    return {on: !!row?.matching, earlier: !!row?.earlier, passed: row?.passed != null && row.passed === traktOf[id].since, ask: traktOf[id].ask && !row, good: row?.good ?? 0, failing: row?.failing ?? null, why: row?.why ?? null, waiting: waitOf.get(id) ?? null, ...(toldOf.has(id) ? {until: toldOf.get(id)} : {})};
  };
  const own = new Set((ready.results as {owner: string; kind: string}[]).filter(row => row.kind === 'upstream-aiom').map(row => row.owner)), heartsOn = new Map((favs.results as {person: string; found: string | null}[]).map(row => [row.person, foundOf(row.found)]));
  const heartsOf = (id: string) => {
    if (!own.has(id) || !(traktOf[id] ? !traktOf[id].again : keyed.has(id))) return null;
    const found = mine === id ? heartsOn.get(id) : null;
    return {on: heartsOn.has(id), ...(found ? {extra: found.list.length, more: found.more} : {})};
  };
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
      // The web player the Devices page links to (WEB_PLAYER, util.ts), '' for none.
      webPlayer: webPlayer(env),
      // The two servers a hub uses unless it names its own (the site's settings), for the manager only, as the hub's own choice
      // is: the Servers card and the first-time setup show them. '' where the site has none.
      ...(mine ? {} : {usual: {aiostreams: env.UP_ORIGIN ?? '', aiometadata: env.AIOM_ORIGIN ?? ''}}),
      // The address called when Home changes is read from the vault for the manager's own session only: never for a person's,
      // the manager's view of a person's page included.
      ...(mine ? {manager: !!who.manager} : {jobs: jobsOf(jobs.results[0] as Record<string, unknown>, pickHour(env), typeof (jobs.results[0] as {noticeHost?: unknown}).noticeHost === 'string' ? await getSecret<string>(env, hub.id, HUB_OWNER, NOTICE) ?? '' : '')}),
      // The page the manager set for people to open (notice.ts, NOTICE_PAGE): a link meant for them, so everyone signed in to
      // this hub gets it.
      setupPage: keys.results.some(row => (row as {kind: string}).kind === NOTICE_PAGE) ? await getSecret<string>(env, hub.id, HUB_OWNER, NOTICE_PAGE) ?? '' : '',
      // The UTC hour the day's For you picking starts, so a Home can say when the next picks come.
      forYouHour: pickHour(env),
      groups: shown.map(groupDto), people: persons.map(row => personDto(row, devices.results as unknown as DeviceRow[], linked.has(row.id), history[row.id] ?? null, aiomTrakt.has(row.id), listsName[row.id] ?? '', moves[row.id] ?? null, keyed.has(row.id), playedHere.has(row.id), matchingOf(row.id), heartsOf(row.id))).map(person => {const picked = forYou.get(person.id), shelved = shelfAt.get(person.id);
        return {...person, passkeys: passkeyCount.get(person.id) ?? 0, ...(picked ? {forYou: {...STAND_INS, ...picked.names}, forYouKinds: picked.kinds, pickedAt: picked.at, forYouDetail: picked.detail} : {}), ...(shelved !== undefined ? {shelfAt: shelved, shelfTiles: shelfTiles.get(person.id) ?? []} : {})};}),
      me: {...(who.account ? {name: who.account.name, theme: who.account.theme} : {name: (owner.results[0] as {name: string} | undefined)?.name ?? '', theme: 'dark'}), passkeys: (passkeys.results as {id: string; name: string; created: number}[]).map(row => ({id: row.id, name: row.name, added: new Date(row.created * 1000).toISOString().slice(0, 10)}))},
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
    // (What they sent is under today's row ids; what was kept may be under ones from before, which is no change of theirs.)
    if (JSON.stringify(rows) !== JSON.stringify(before.rows && currentRows(before.rows))) {
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
  env.DB.prepare('DELETE FROM person_passkeys WHERE hub = ? AND person = ?').bind(hub, id),
];
async function removePerson(env: Env, who: Who, id: string) {
  forgetSeats(who.hub.id, id);
  await env.DB.batch([...forget(env, who.hub.id, id), env.DB.prepare('DELETE FROM plays WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM starts WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM fetches WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM sittings WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM rows_keys WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM foryou WHERE hub = ? AND person = ?').bind(who.hub.id, id), ...forgetTrakt(env, who.hub.id, id), env.DB.prepare("DELETE FROM ops WHERE hub = ? AND target = ? AND kind = 'carry'").bind(who.hub.id, id), env.DB.prepare('DELETE FROM sent WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind NOT IN ('catalogs', 'catalogs-pending', 'aiom', 'aiom-pending')").bind(who.hub.id, id), env.DB.prepare('DELETE FROM people WHERE hub = ? AND id = ?').bind(who.hub.id, id)]);
  return {};
}
/* A person's stored choices, read fresh, and written back as a new version. */
const personData = async (env: Env, hub: string, id: string) => JSON.parse((await env.DB.prepare('SELECT data FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{data: string}>())!.data) as PersonData;
const savePersonData = (env: Env, hub: string, id: string, next: PersonData) => env.DB.prepare('UPDATE people SET data = ?, version = version + 1 WHERE hub = ? AND id = ?').bind(JSON.stringify(next), hub, id);
const hasSecret = async (env: Env, hub: string, id: string, kind: string) => !!await env.DB.prepare('SELECT 1 FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, id, kind).first();
/* Trakt connected to the hub, and Trakt has not asked for it to be connected again. */
const tracked = async (env: Env, hub: string, id: string) => !!env.TRAKT_CLIENT_ID && !((await getSecret<{again?: boolean}>(env, hub, id, LINK)) ?? {again: true}).again;
/* Trakt rows on or off. Someone with a Home of their own gets the rows added at the top. None of them needs Trakt any more
   (Up Next and New for you are worked out from what they watch here without it: ahead.ts), so with Trakt off they stay where
   they are. */
function withTraktRows(data: PersonData, on: boolean): PersonData {
  const shipped = traktRows(), rows = data.rows && currentRows(data.rows);
  return {...data, trakt: on, rows: rows ? on ? [...shipped.filter(item => !rows.some(row => row.id === item.id)), ...rows] : rows : null};
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
  // Their own passkeys, for their page on the site: added, listed (in what their page loads) and removed by them alone, from a
  // session of their own. Never from their manager's view of their page, so a manager cannot put a passkey of their own on it.
  if (action === 'passkeys') {
    if (who.person !== id || who.manager) bad(403, `Only ${row.name} can change their passkeys.`);
    if (request.method === 'POST' && rest === 'options') {
      const held = await env.DB.prepare('SELECT id FROM person_passkeys WHERE hub = ? AND person = ?').bind(hub, id).all<{id: string}>();
      // What the device files the passkey under is a stamp of the site's own: it says nothing of the hub or the person.
      return {...await challenge(env), user: await stamp(env, `passkey-user:${hub}:${id}`), name: row.name, exclude: held.results.map(item => item.id)};
    }
    if (request.method === 'POST' && !rest) {
      const made = await newPasskey(env, origin, body);
      if (((await env.DB.prepare('SELECT count(*) AS n FROM person_passkeys WHERE hub = ? AND person = ?').bind(hub, id).first<{n: number}>())?.n ?? 0) >= 10) bad(400, 'Ten passkeys is the most. Remove one first.');
      const done = await env.DB.prepare('INSERT INTO person_passkeys (id, hub, person, name, key, alg, created) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE NOT EXISTS (SELECT 1 FROM passkeys WHERE id = ?1) ON CONFLICT DO NOTHING').bind(made.id, hub, id, made.name, made.key, made.alg, now()).run();
      if (!done.meta.changes) bad(400, TAKEN_KEY);
      return {};
    }
    if (request.method === 'DELETE' && rest) {await env.DB.prepare('DELETE FROM person_passkeys WHERE hub = ? AND person = ? AND substr(id, 1, 16) = ?').bind(hub, id, rest).run(); return {};}
  }
  const signin = await getSecret<SignIn>(env, hub, id, 'signin') ?? bad(500, 'Sign-in details are missing');
  // One rule for who sets a sync switch of this person's (the Sync card's three). They do, from their own page. Their manager
  // does only while they have not joined (`joined`: they chose a password of their own through their invite link, so they have
  // a page of their own to do it from), and then only MDBList sync and the Watchlist switch: Trakt sync is theirs alone
  // ('matching', below). Asked by every route that moves one of the two, whatever the page shows.
  // The same rule for their accounts (`what` 'accounts'): once they have joined, only they connect, disconnect or reconnect their
  // Trakt (either way of connecting it), and only they save or remove their MDBList key. Their manager still sees whether each is
  // connected, and can remove them from the hub, which removes the hub's copies and sends nothing to any account.
  const theirs = (what: 'sync' | 'accounts' = 'sync') => {if (who.person !== id && row.joined) bad(403, `${row.name} manages their own ${what}.`);};
  if (action === 'signin' && request.method === 'GET') {
    const invite = await getSecret<string>(env, hub, id, 'invite');
    return {username: row.name, password: signin.password, pin: signin.pin, link: invite ? inviteLink(origin, invite) : ''};
  }
  if (action === 'trakt') {
    // Trakt is connected on AIOMetadata's own page, which hands the person a Token ID. Here it is checked and kept for their Home.
    // (The way it used to be done. Connecting Trakt to the hub, under 'scrobble', does all of it now.)
    const data = await personData(env, hub, id), save = (next: PersonData) => savePersonData(env, hub, id, next);
    if (request.method === 'POST' || request.method === 'DELETE') theirs('accounts');
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
      // Saving a key is theirs once they have joined, and so is every way of removing one (below).
      theirs('accounts');
      // Anything but `keep` turns MDBList sync on for someone it is off for (at once, or by starting the copy): a sync switch.
      if (!data.lists && body.keep !== true) theirs();
      // `reuse`: the key they saved before (kept while progress is Here) is taken up again, so nothing needs pasting.
      const before = body.reuse === true ? await getSecret<{key: string}>(env, hub, id, 'mdblist') : null;
      const key = before?.key ?? (text(body.key ?? '', 200, 'Key').trim() || bad(400, body.reuse === true ? 'There’s no MDBList key saved. Paste one.' : 'Paste the key'));
      const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}/user?apikey=${encodeURIComponent(key)}`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
      if (!answer || answer.status >= 500) bad(502, 'MDBList did not answer. Try again in a moment.');
      if (answer!.status !== 200) bad(400, 'MDBList did not accept that key. Copy it from Preferences, API Access.');
      const username = String(((await answer!.json().catch(() => null)) as {username?: string} | null)?.username ?? '').slice(0, 80);
      // MDBList's Sync switch (the page never says so, but it is where progress is kept), turned on by the person or their manager: the key is kept, and progress moves over only once
      // their plays have (the page copies them, places.ts, then switches). A key pasted without either, or a new key for someone
      // already on MDBList, takes effect at once.
      // `keep`: connecting MDBList on the MDBList card only saves the key; Sync is its own switch.
      const moving = body.moving === true && !data.lists, keep = body.keep === true && !data.lists;
      // The watchlist as Favorites (hearts.ts) stays as they set it: with Trakt on the hub, Trakt leads their hearts with or
      // without this key, and MDBList follows only through their own server while MDBList sync is on (native.ts).
      await env.DB.batch([await putSecret(env, hub, id, 'mdblist', {key, username, ...(moving ? {moving: 'mdblist'} : {})}), save(!moving && !keep), env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'lists' OR kind LIKE 'mdb_%')").bind(hub, id), shelfDue(env, hub, id)]);
      return {username};
    }
    // Removing the key itself: nothing of MDBList is kept or read for them any more.
    // Their Watchlist switch
    // goes off with the key when it was MDBList's (no Trakt connected to the hub): connecting again later starts with it off.
    if (request.method === 'DELETE' && rest === 'key') {
      theirs('accounts');
      await env.DB.batch([...(await hasSecret(env, hub, id, LINK) ? [] : [turnHearts(env, hub, id, false)]), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'mdblist'").bind(hub, id), env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'lists' OR kind LIKE 'mdb_%')").bind(hub, id), shelfDue(env, hub, id), save(false)]);
      return {};
    }
    // Progress kept Here: the key stays saved for their lists, and the next sync turns MDBList's tracking and reporting off.
    if (request.method === 'DELETE' && !rest) {theirs(); await moving(env, hub, id, null); await env.DB.batch([env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), save(false)]); return {};}
  }
  if (action === 'scrobble' && env.TRAKT_CLIENT_ID) {
    // Trakt, connected by the person or by the manager with them, on Trakt's own sign-in page. The page does the sign-in with
    // Trakt itself (Trakt turns away the shared addresses Workers call from for a while at times) and hands the login over to be
    // kept and renewed here. Connecting gives their Trakt rows on Home (rows.ts), added to a Home of their own, and writes
    // nothing to Trakt: what they watch moves only once they turn sync on ('matching', below).
    if (request.method === 'POST' && rest === 'link') {
      // Theirs alone once they have joined: a manager can neither connect nor reconnect it, so no sign-in a manager starts is kept.
      theirs('accounts');
      const access = text(body.access, 4000, 'Login').trim(), refresh = text(body.refresh, 4000, 'Login').trim(), redirect = text(body.redirect ?? '', 300, 'Address');
      if (!access || !refresh || (redirect && !/^https?:\/\/[^/]+\/api\/trakt\/callback$/.test(redirect))) bad(400, 'Trakt did not finish connecting. Try again.');
      // Whether it is synced is theirs to say, on their own page, and asked anew for each connection (the sync row goes, so it is
      // off): a person who signed in themselves is asked there at once; one connected by their manager sees "Turn on" there.
      await keepLink(env, hub, id, {access, refresh, expires: Math.floor(Number(body.created) || now()) + Math.floor(Number(body.lasts) || 7 * 86400), username: text(body.username ?? '', 80, 'Name').trim(), ...(text(body.slug ?? '', 80, 'Name').trim() ? {slug: text(body.slug ?? '', 80, 'Name').trim()} : {}), ...(redirect ? {redirect} : {}), ...(who.person === id ? {ask: true} : {})});
      // Favorites from the watchlist too (hearts.ts): off for a new connection, which may be another Trakt account, and its ledger with it.
      await env.DB.batch([env.DB.prepare('DELETE FROM sync WHERE hub = ? AND person = ?').bind(hub, id), ...forgetHearts(env, hub, id)]);
      forgetSeats(hub, id);
      // What was watched here before is worked out again against Trakt too, the next time their card looks.
      await env.DB.batch([env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'lists'").bind(hub, id)]);
      const data = await personData(env, hub, id); if (!data.trakt) await savePersonData(env, hub, id, withTraktRows(data, true)).run();
      return {state: 'connected'};
    }
    if (request.method === 'DELETE') {
      theirs('accounts');
      await disconnect(env, hub, id); forgetSeats(hub, id);
      // The Trakt rows stay only while AIOMetadata's own Trakt connection is still there to fill them.
      if (!await hasSecret(env, hub, id, 'trakt')) await savePersonData(env, hub, id, withTraktRows(await personData(env, hub, id), false)).run();
      return {};
    }
  }
  if (action === 'matching') {
    // Trakt sync, both directions, writes to their own accounts: only they turn it on or off, from their own page. A
    // manager is refused whatever they send, and nothing of it (what was watched before, what was synced) is shown to them.
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const link = env.TRAKT_CLIENT_ID ? await getSecret<Link>(env, hub, id, LINK) : null;
    if (!link) bad(409, 'Connect Trakt first.');
    // What the hub synced for them lately, for What was synced on the Trakt card.
    if (request.method === 'GET' && rest === 'synced') return {synced: await synced(env, hub, id)};
    // What they finished here before sync was turned on, for the line that offers to send it too: how many, and each one (the
    // newest hundred). With sync on (the only time their page asks, and shows it) every one Trakt already has is left out: Trakt
    // is asked once, and what was found is kept an hour by hub and person (let go when sync is turned, Trakt is connected again,
    // or some are sent or passed over). Trakt not answering: nothing is offered, and nothing is kept. With sync off (nothing
    // of theirs is read from Trakt then) it is everything up to now, from the plays kept here alone.
    if (request.method === 'GET' && !rest) {
      const on = await syncOn(env, hub, id), since = on ? sendingSince(link!) : now(), time = now();
      const kept = on ? await env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, id, EARLIER).first<{at: number; items: string}>() : null;
      let had: {since: number; plays: Earlier[]} | null = null;
      try {had = kept && time - kept.at < 3600 ? JSON.parse(kept.items) as {since: number; plays: Earlier[]} : null;} catch {had = null;}
      const plays = had?.since === since ? had.plays : await earlierPlays(env, hub, id, link!, since, await skippedOf(env, hub, id), on);
      if (!plays) return {earlier: 0, plays: []};
      if (on && had?.since !== since) await env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items').bind(hub, id, EARLIER, time, JSON.stringify({since, plays})).run();
      return {earlier: plays.length, plays: plays.slice(0, 100)};
    }
    // "Not now" to adding what they watched here before sync was turned on: kept against this turning on, so the same plays
    // are not offered again (a later turning on offers its own). Nothing is sent and nothing else changes.
    if (request.method === 'POST' && rest === 'later') {await env.DB.batch([env.DB.prepare('UPDATE sync SET passed = ? WHERE hub = ? AND person = ?').bind(sendingSince(link!), hub, id), forgetEarlier(env, hub, id)]); return {};}
    if (request.method === 'POST' && rest === 'pass') {
      const got = await pass(env, hub, id, (JSON.parse(row.data) as PersonData).lists);
      // Looked at again next time: what was just sent is on the other side now.
      await env.DB.batch([forgetShown(env, hub, id), forgetEarlier(env, hub, id)]);
      return 'error' in got ? refuse(env, hub, id, got) : got;
    }
    if (request.method === 'POST' && !rest) {
      // Turned on afresh, the next look goes back two weeks (no stamps kept). `earlier` only goes with it on.
      const on = flag(body.on), earlier = on && flag(body.earlier), was = await syncOn(env, hub, id);
      // Their page stops asking; going from off to on, the moment is noted first, so nothing watched before it goes unless ticked.
      await answered(env, hub, id, on && !was);
      // Next Up starts over with it (sync.ts, nextUp: the latest episode of each show watched on Trakt lately; what was ticked
      // before is never ticked twice): what it kept goes, unless sync was on already.
      await env.DB.batch([forgetEarlier(env, hub, id), env.DB.prepare("DELETE FROM rows_cache WHERE hub = ?1 AND person = ?2 AND kind = 'backfill' AND NOT EXISTS (SELECT 1 FROM sync WHERE hub = ?1 AND person = ?2 AND matching = 1)").bind(hub, id),
        env.DB.prepare(`INSERT INTO sync (hub, person, matching, earlier) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (hub, person) DO UPDATE SET matching = excluded.matching, earlier = excluded.earlier,
        stamps = CASE WHEN sync.matching = 0 THEN NULL ELSE sync.stamps END, checked = 0, failing = NULL, why = NULL`).bind(hub, id, on ? 1 : 0, earlier ? 1 : 0),
        // Off: what was still waiting to reach Trakt is dropped with it (trakt.ts, stopSending), in the same write.
        ...(on ? [] : stopSending(env, hub, id))]);
      // Their apps' sign-ins are read again, so the next report goes by the switch as it is now.
      forgetSeats(hub, id);
      return {};
    }
  }
  if (action === 'favorites' && request.method === 'POST') {
    // The Watchlist switch on the Sync card (a row in `favs`, by hub and person): on, the titles they save in the apps and their
    // watchlist are one list. Which watchlist is not a setting: Trakt's when Trakt is connected to the hub (hearts.ts, and
    // front.ts for what an app saves or un-saves: with it on, an un-save in an app takes the title off their Trakt watchlist),
    // else their own MDBList's, which is only their setup passing saves on (native.ts, and only while MDBList sync is on). Off
    // only takes the switch away: no save moves and nothing leaves an account.
    // The offer for hearts they already had that Trakt lacks (counted by the cron step, never here): theirs to take or leave, once.
    if (rest === 'add' || rest === 'later') {
      // Theirs alone, from their own page: it writes to their Trakt, and its count is shown to nobody else.
      if (who.person !== id) bad(403, 'Only they can do this, from their own page');
      if (!await heartsOn(env, hub, id)) bad(409, 'Turn Watchlist on first.');
      const found = foundOf((await env.DB.prepare('SELECT found FROM favs WHERE hub = ? AND person = ?').bind(hub, id).first<{found: string | null}>())?.found);
      if (!found) return {added: 0};
      // The count may be hours old: a heart the ledger has heard of since (one she took off in an app, above all) is no longer
      // part of the offer, so it is neither sent to Trakt nor noted over.
      const known = new Set((await env.DB.prepare('SELECT key FROM hearts WHERE hub = ? AND person = ?').bind(hub, id).all<{key: string}>()).results.map(heart => heart.key));
      const list = found.list.filter(heart => !known.has(heart.key) && !(heart.ids.imdb && known.has(`${heart.type}:${heart.ids.imdb}`)) && !(heart.ids.tmdb && known.has(`${heart.type}:tmdb:${heart.ids.tmdb}`)));
      // "Not now": each is kept as passed on, so this set is never offered again; nothing is sent.
      if (rest === 'later' || !list.length) {await env.DB.batch([noteHearts(env, hub, id, list, 'pass'), clearFound(env, hub, id)]); return {added: 0};}
      // "Add them": one watchlist add for all of them (the offer holds a few dozen at most), through the outbox like any heart.
      // Only ever an add: nothing here can take a title off Trakt. Each is noted as theirs, to be confirmed once Trakt lists it.
      const body_ = {movies: list.filter(heart => heart.type === 'movie').map(heart => ({ids: heart.ids})), shows: list.filter(heart => heart.type === 'series').map(heart => ({ids: heart.ids}))};
      const got = await deliver(env, hub, id, 'hearts:found', {kind: 'heart', path: '/sync/watchlist', body: Object.fromEntries(Object.entries(body_).filter(([, list]) => list.length))});
      if (got === 'off') bad(409, 'Trakt needs you to sign in again.');
      await env.DB.batch([noteHearts(env, hub, id, list, 'own'), clearFound(env, hub, id), forgetWatchlist(env, hub, id)]);
      return {added: list.length, more: found.more};
    }
    // Set by them, or by their manager only while they have not joined (`theirs`, above).
    theirs();
    // On only for someone it can do something for: a setup of their own, and Trakt connected to the hub (signed in, not waiting
    // to be signed in to again) or, without Trakt, an MDBList key of their own.
    const on = flag(body.on), link = env.TRAKT_CLIENT_ID ? await getSecret<Link>(env, hub, id, LINK) : null;
    if (on && !(link ? !link.again && await mayHeart(env, hub, id) : await hasSecret(env, hub, id, 'upstream-aiom') && !!(await getSecret<{key?: string}>(env, hub, id, 'mdblist'))?.key)) bad(409, link?.again ? 'Sign in to Trakt again first.' : 'Connect Trakt or MDBList first.');
    // Their setup says where saves go (native.ts), so it is saved again: by the page at once (POST /api/sync), and by the cron
    // (the hub's setups flagged here, foryou.ts) if the page was closed first.
    await env.DB.batch([turnHearts(env, hub, id, on), ...(env.FRONT === 'aiometadata' ? [setupsDue(env, hub)] : [])]);
    return {};
  }
  // Only the tests ask this (no page does), so it is open only in the local test run (TEST_WHERE, util.ts).
  if (action === 'drift' && request.method === 'POST' && TESTING(env)) {
    // Plays they leave out, from their own page: kept out for good, of every later look and of sync. (Copying what the day's look
    // found is the cron's alone now, for someone with sync on: drift.ts.)
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const leave = Array.isArray(body.leave) ? body.leave.slice(0, 200).map(key => text(key, 200, 'Play')) : body.skip !== undefined ? [text(body.skip, 200, 'Play')] : [];
    await skip(env, hub, id, leave);
    return {};
  }
  if (action === 'because' && request.method === 'GET') {
    // Suggested rows their own watching points to: on their own page only, from their own plays and Trakt pages.
    if (who.person !== id) bad(403, 'Only they can see these, from their own page');
    return {because: await because(env, hub, id)};
  }
  if (action === 'lists' && request.method === 'GET') {
    // Their own lists, to add as Home rows: on their own page only, never shown to anyone else.
    if (who.person !== id) bad(403, 'Only they can see these, from their own page');
    const {lists, whole} = await ownLists(env, hub, id), tiles = lists.flatMap(item => shelfId(item) ? [{id: shelfId(item), title: item.title}] : []);
    // Their My lists row is worked out once a day (shelf.ts). A list added, removed or renamed since, seen here at no extra
    // cost, has it worked out again on the next run; only from a whole answer with an account connected, so Trakt or MDBList
    // not answering (or Trakt wanting connecting again) never looks like a change.
    if (whole && env.FRONT === 'aiometadata' && wantsShelf((JSON.parse(row.data) as PersonData).rows) && (await tracked(env, hub, id) || !!(await getSecret<{key?: string}>(env, hub, id, 'mdblist'))?.key)) {
      const kept = await env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, id, SHELF).first<{at: number; items: string}>();
      const listed = JSON.stringify(shelved(tiles).map(item => [item.id, item.title]));
      if (!kept || (kept.at && JSON.stringify(shelfFrom(kept.items).map(item => [item.id, item.title])) !== listed)) await shelfAgain(env, hub, id);
    }
    // The lists they made as one row and the ones they liked as another, a tile each (shelf.ts): collections, which only
    // AIOMetadata in front can show. Each says which of their accounts its lists are on.
    const shelf = (id: string, title: string, liked: boolean, what: string) => {
      const those = tiles.filter(item => likedList(item.id) === liked), from = ['Trakt', 'MDBList'].filter(name => those.some(item => item.id.startsWith(name.toLowerCase()))).join(' and ');
      return those.length ? [{id, title, kind: `Collection · ${those.length} ${those.length === 1 ? 'list' : 'lists'}`, source: `${from} · ${what}`}] : [];
    };
    return {lists: env.FRONT === 'aiometadata' ? [...shelf(SHELF_ROW, SHELF_TITLES[SHELF_ROW], false, 'your lists'), ...shelf(LIKED_ROW, SHELF_TITLES[LIKED_ROW], true, 'lists you liked'), ...lists] : lists};
  }
  if (action === 'shelf' && request.method === 'POST') {
    // "Check my lists now", from the My lists row: worked out again on the next run. Once a minute at most, by hub and person.
    if (!wantsShelf((JSON.parse(row.data) as PersonData).rows)) bad(409, 'Neither lists row is on this Home.');
    const kept = await env.DB.prepare('SELECT at FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, id, SHELF).first<{at: number}>();
    if (kept?.at && now() - kept.at < 60) bad(429, 'The lists were just checked. Try again in a minute.');
    await shelfAgain(env, hub, id);
    return {};
  }
  if (action === 'foryou' && request.method === 'POST') {
    // From a For you row's Edit sheet (foryou.ts): one of the day's other options in its place, kept or let change again, or the
    // title it came from never picked from again. Or a title left out that way counts again.
    if (rest === 'never') {await pickFromAgain(env, hub, id, text(body.seed, 20, 'Title')); return {};}
    const place = isPlace(rest ?? '') ? rest! : bad(400, 'That row is not valid');
    const error = await placeAsked(env, hub, id, place, body.use !== undefined ? {use: text(body.use, 200, 'Option')} : body.keep !== undefined ? {keep: flag(body.keep)} : body.never === true ? {never: true} : bad(400, 'Nothing was asked'));
    if (error) bad(409, error);
    return {};
  }
  if (action === 'compare') {
    // Two places side by side (places.ts). Someone's own watching: only they see it or copy it. Switching where progress is kept
    // goes the same way whoever does it (the person, or their manager with them): what is missing is copied first, then the
    // switch, and only counts come back.
    const pair = oneOf(rest, PAIRS, 'Pair'), moves = request.method === 'POST' && body.switch === true && (pair === 'here-mdblist' || pair === 'mdblist-here');
    // The pages only ever ask for that switch. Looking at a pair, copying without switching and anything with Trakt in the pair
    // are asked by the tests alone, so they are open only in the local test run (TEST_WHERE, util.ts).
    if (!moves && !TESTING(env)) bad(404, 'Not found');
    if (who.person !== id && !moves) bad(403, 'Only they can do this, from their own page');
    // The switch itself (MDBList sync on or off) goes by the one rule for sync switches.
    if (moves) theirs();
    // Anything between here (or MDBList) and Trakt, looking included, only while their Trakt sync is on.
    if (pair.endsWith('-trakt') && !await syncOn(env, hub, id)) bad(409, 'Trakt sync is off. Turn it on first.');
    if (request.method === 'GET') {const got = await shown(env, hub, id, pair, await skippedOf(env, hub, id), new URL(request.url).searchParams.get('fresh') === '1'); return 'error' in got ? refuse(env, hub, id, got) : got;}
    if (request.method !== 'POST') bad(404, 'Not found');
    const leave = who.person === id && Array.isArray(body.leave) ? body.leave.slice(0, 500).map(key => text(key, 200, 'Play')) : [];
    await skip(env, hub, id, leave);
    // Moving where progress is kept: only from the state the person's page started it in.
    const kept = await getSecret<{moving?: string}>(env, hub, id, 'mdblist'), switching = body.switch === true;
    if (switching && !((pair === 'here-mdblist' && kept?.moving === 'mdblist') || (pair === 'mdblist-here' && kept?.moving === 'here'))) bad(409, 'That isn’t under way any more. The page has been refreshed.');
    if (pair === 'mdblist-here' && kept?.moving !== 'here') bad(409, 'That isn’t under way any more. The page has been refreshed.');
    const got = await copy(env, hub, id, pair, await skippedOf(env, hub, id));
    // Looked at again next time: what was just sent is on the other side now.
    await forgetShown(env, hub, id).run();
    if ('error' in got) return refuse(env, hub, id, got);
    if (!switching || got.more) return {...got, switched: false};
    // Everything is across: the switch itself. Then the page syncs, which turns MDBList's reporting on (or leaves it off).
    const data = await personData(env, hub, id);
    if (pair === 'here-mdblist') {await moving(env, hub, id, null); await savePersonData(env, hub, id, {...data, lists: true}).run();}
    // Back on Here: the key stays saved, used only to read their lists; switching to MDBList again needs no new paste.
    else {await moving(env, hub, id, null); await env.DB.batch([env.DB.prepare('DELETE FROM drift WHERE hub = ? AND person = ?').bind(hub, id), savePersonData(env, hub, id, {...data, lists: false})]);}
    return {...got, switched: true};
  }
  if (action === 'moving' && request.method === 'POST') {
    // Starting the move back Here (their MDBList stops hearing of plays once the page syncs), or staying on MDBList after all: by
    // the person, or their manager while they have not joined, the same way.
    theirs();
    const to = body.to === 'here' ? 'here' : body.to === null ? null : bad(400, 'Not valid');
    if (to && !(await personData(env, hub, id)).lists) bad(409, 'MDBList sync is already off.');
    if (!await moving(env, hub, id, to)) bad(409, 'MDBList isn’t connected.');
    await forgetShown(env, hub, id).run();
    return {};
  }
  // Only the tests ask this (the cron does this work by itself: sync.ts), so it is open only in the local test run (TEST_WHERE, util.ts).
  if (action === 'carry' && TESTING(env)) {
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
    // They forgot it, or lost the device they sign in on. Nobody can read it back, so the invite link lets them choose a new one,
    // and every passkey of theirs goes with every page they were signed in on. Their apps stay signed in.
    await env.DB.batch([env.DB.prepare("UPDATE people SET pass = '', joined = 0 WHERE hub = ? AND id = ?").bind(hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare('DELETE FROM person_passkeys WHERE hub = ? AND person = ?').bind(hub, id)]);
    return {};
  }
  if (action === 'pin' && request.method === 'POST') {
    const pin = body.pin === null ? null : body.pin === '' ? newPin() : /^\d{6,8}$/.test(String(body.pin)) ? String(body.pin) : bad(400, 'A PIN is 6 to 8 digits');
    await env.DB.batch([await putSecret(env, hub, id, 'signin', {...signin, pin}), ...(pin && signin.pin && pin !== signin.pin ? [env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id)] : [])]);
    return {pin};
  }
  // Approving the code a TV shows, asked by the manager for them or by the person themselves.
  if (action === 'quick' && request.method === 'POST') {await approveTv(request, env, hub, id, body.code); return {};}
  if (action === 'signout' && request.method === 'POST') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id).run(); return {};}
  // A device's name as the app sent it, or whatever is easier to recognise.
  if (action === 'devices' && rest && request.method === 'PUT') {const name = text(body.name, 60, 'Name').trim() || bad(400, 'Give it a name'); await env.DB.prepare('UPDATE devices SET name = ? WHERE hub = ? AND person = ? AND ref = ?').bind(name, hub, id, rest).run(); forgetSeats(hub, id); return {};} // what it plays is noted under its new name at once
  if (action === 'devices' && rest && request.method === 'DELETE') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ? AND ref = ?').bind(hub, id, rest).run(); return {};}
  return bad(404, 'Not found');
}

/* Approving the code a TV shows (Quick Connect, front.ts): the TV becomes this person. Wrong codes count against them, per hub and
   person. */
async function approveTv(request: Request, env: Env, hub: string, id: string, given: unknown) {
  const key = guesses(request, `quick:${hub}:${id}`), code = String(given ?? '').replace(/\D/g, '');
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const done = await env.DB.prepare('UPDATE quick SET person = ? WHERE hub = ? AND code = ? AND person IS NULL AND expires > ?').bind(id, hub, code, now()).run();
  if (!done.meta.changes) {await failed(env, key); bad(404, 'No TV is showing that code right now. Check the code, or start again on the TV.');}
}
/* "Someone else" on a TV's Quick Connect page (TvGate in pages.tsx), signed in or not: the TV becomes the person whose name and
   password for this site are given, in the hub the TV asked. No session is made, so an invite link stays the only way into a
   person's page. An unknown name costs the same work as a known one. */
async function tvAs(request: Request, env: Env, body: Body) {
  const name = text(body.name ?? '', 60, 'Name').trim() || bad(400, 'Type their name');
  const hub = await env.DB.prepare('SELECT id FROM hubs WHERE code = ?').bind(text(body.hub ?? '', 40, 'Hub')).first<{id: string}>() ?? bad(404, 'This hub is gone.');
  const login = slug(name), key = guesses(request, `quick-as:${hub.id}:${login}`);
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const row = await env.DB.prepare('SELECT id, name, pass, joined FROM people WHERE hub = ? AND login = ?').bind(hub.id, login).first<{id: string; name: string; pass: string; joined: number}>();
  const signin = row?.joined ? await getSecret<SignIn>(env, hub.id, row.id, 'signin') : null, password = String(body.password ?? '');
  if (!(row && signin ? await ownPassword(password, row.pass, signin) : await checkPassword(password, NOBODY) && false)) {await failed(env, key); bad(403, 'That name or password isn’t right.');}
  await approveTv(request, env, hub.id, row!.id, body.code);
  return {name: row!.name};
}

/* A person's own lists: on their Trakt (theirs, and ones they liked) through the hub's Trakt connection, and on their MDBList
   (theirs, and ones they liked there) with their own key. Kept for a quarter of an hour, by hub and person, so opening Add row again asks neither. */
const LISTS_KEPT = 900;
interface OwnList {id: string; title: string; kind: string; source: string}
async function ownLists(env: Env, hub: string, id: string): Promise<{lists: OwnList[]; whole: boolean}> {
  const kept = await env.DB.prepare("SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'lists'").bind(hub, id).first<{at: number; items: string}>();
  if (kept && now() - kept.at < LISTS_KEPT) return {lists: JSON.parse(kept.items) as OwnList[], whole: true};
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
    // The lists they liked are asked for apart (shelf.ts does the same): without them the rest still counts as whole.
    const ask = mdblist(env, lists.key), got = await ask('/lists/user'), mine = got.status === 200 ? mdbLists(got.body) : null, liked = mine ? await ask('/lists/liked?limit=50') : null;
    whole &&= !!mine;
    for (const list of mine ?? []) out.push({id: `mdblist.${list.id}.${list.type}`, title: list.name, kind: count(list.items), source: 'MDBList · your list'});
    for (const list of (liked?.status === 200 ? mdbLists(liked.body) : null) ?? []) if (!out.some(item => item.id.startsWith(`mdblist.${list.id}.`))) out.push({id: `mdblist.${list.id}.${list.type}`, title: list.name, kind: count(list.items), source: 'MDBList · liked'});
  }
  // Only a complete answer is kept; one where Trakt or MDBList did not answer is asked again next time.
  if (whole) await env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, 'lists', ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items").bind(hub, id, now(), JSON.stringify(out.slice(0, 100))).run();
  return {lists: out.slice(0, 100), whole};
}
/* A My lists row to be worked out again on the next run (refreshShelf takes anything a day old): its time goes to 0, or one
   with nothing yet is made so. What it holds stays until then. */
/* The same when their MDBList key is saved or removed, for a row worked out before: its MDBList lists come or go on the next run. */
const forgetEarlier = (env: Env, hub: string, id: string) => env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, id, EARLIER);
const shelfDue = (env: Env, hub: string, id: string) => env.DB.prepare('UPDATE rows_cache SET at = 0 WHERE hub = ? AND person = ? AND kind = ?').bind(hub, id, SHELF);
const shelfAgain = (env: Env, hub: string, id: string) => env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, 0, '[]') ON CONFLICT (hub, person, kind) DO UPDATE SET at = 0").bind(hub, id, SHELF).run();

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
  const data: HubData = {host: 'ForTheWeak', hostUrl: '', services: [], addons: defaultAddons(), defaults: defaultSettings(), rows: defaultRows(env.FRONT === 'aiometadata')};
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
/* A passkey as the browser hands it over, checked: made for the site's own challenge, on this site, of a kind the site can read. */
const TAKEN_KEY = 'That passkey is already in use here.';
async function newPasskey(env: Env, origin: string, body: Body) {
  if (!await created(env, origin, body)) bad(400, 'That passkey could not be checked. Try again.');
  const id = text(body.id, 1400, 'Passkey'), key = text(body.key, 2000, 'Passkey'), alg: number = body.alg === -7 || body.alg === -257 ? body.alg : bad(400, 'This device makes a kind of passkey the site cannot check');
  return {id, key, alg, name: text(body.name ?? '', 60, 'Name').trim() || 'A device'};
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
    const made = await newPasskey(env, origin, body);
    if (((await env.DB.prepare('SELECT count(*) AS n FROM passkeys WHERE account = ?').bind(me.id).first<{n: number}>())?.n ?? 0) >= 10) bad(400, 'Ten passkeys is the most. Remove one first.');
    // One the site already holds, for anyone, is not taken again: an id is one passkey's, across managers and people alike.
    const done = await env.DB.prepare('INSERT INTO passkeys (id, account, name, key, alg, created) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM person_passkeys WHERE id = ?1) ON CONFLICT DO NOTHING').bind(made.id, me.id, made.name, made.key, made.alg, now()).run();
    if (!done.meta.changes) bad(400, TAKEN_KEY);
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
/* The address the hub calls after a Home change has reached the apps (notice.ts). It carries a token, so it goes into the vault
   and is never logged; it is sent back only to the manager's own session, with the page (state, above), never in this answer. Nothing is asked of it when it is saved. A new
   address starts with nothing waiting; the time since the last call still counts. */
function typedAddress(env: Env, body: Body, site: URL) {
  const typed = (typeof body.address === 'string' ? body.address : bad(400, 'Address is not valid')).trim() || bad(400, 'Paste the address');
  if (typed.length > 300) bad(400, 'That address is too long.');
  let mine = ''; try {mine = env.SITE_ORIGIN ? new URL(env.SITE_ORIGIN).hostname : '';} catch { /* none */ }
  const clean = cleanAddress(typed, [site.hostname, mine]);
  return 'error' in clean ? bad(400, clean.error) : clean;
}
/* The page beside it (notice.ts, NOTICE_PAGE): taken under the same rules, kept in the vault by itself. Setting or removing
   one leaves the other as it was. */
async function setNoticePage(env: Env, who: Who, body: Body, site: URL) {
  await (await putSecret(env, who.hub.id, HUB_OWNER, NOTICE_PAGE, typedAddress(env, body, site).address)).run();
  return {};
}
async function dropNoticePage(env: Env, who: Who) {
  await env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, NOTICE_PAGE).run();
  return {};
}
async function setNotice(env: Env, who: Who, body: Body, site: URL) {
  const clean = typedAddress(env, body, site);
  await env.DB.batch([await putSecret(env, who.hub.id, HUB_OWNER, NOTICE, clean.address),
    env.DB.prepare('INSERT INTO notices (hub, host) VALUES (?, ?) ON CONFLICT (hub) DO UPDATE SET host = excluded.host, result = NULL, wanted = 0, retry = 0').bind(who.hub.id, clean.host)]);
  return {};
}
async function dropNotice(env: Env, who: Who) {
  await env.DB.batch([env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, NOTICE), env.DB.prepare('DELETE FROM notices WHERE hub = ?').bind(who.hub.id)]);
  return {};
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
  await env.DB.batch([...['devices', 'plays', 'sittings', 'starts', 'fetches', 'heard_fields', 'quick', 'secrets', 'rows_keys', 'trakt_outbox', 'rows_cache', 'drift', 'sync', 'favs', 'hearts', 'sent', 'foryou', 'foryou_sync', 'notices', 'person_passkeys', 'people', 'groups', 'ops'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ?`).bind(hub)), env.DB.prepare('DELETE FROM sessions WHERE hub = ? OR account = ?').bind(hub, who.account!.id),
    env.DB.prepare('DELETE FROM hubs WHERE id = ?').bind(hub), env.DB.prepare('DELETE FROM passkeys WHERE account = ?').bind(who.account!.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(who.account!.id)]);
  // Player apps stop reaching it at once, not when this copy of the Worker next looks the hub up.
  forgetHub(who.hub.code);
  return {};
}

/* A change to one person's accounts that changes their rows (Trakt connected or removed, an MDBList key saved or removed, their
   Watchlist switch turned): the hub's setups are flagged to be saved again (foryou.ts, flag) before it is answered. A page that is
   open saves them at once, as ever (POST /api/sync), and lets the flag go. With no page, the hub does it itself a few seconds
   on (PUSH_AFTER, within the same request's time), if the flag is still there: no cron run needed. The setups are saved as one
   piece of work for the hub (native.ts), which writes only a setup that changed, so this is that person's alone; within a few
   calls (PUSH), the rest left to the cron (foryou.ts, resend), as is everything when other work on the setups is under way. */
const PUSHED = /^(scrobble(\/link)?|mdblist(\/key)?|favorites)$/, PUSH = 16, PUSH_AFTER = 4000;
async function pushed(env: Env, hub: string, origin: string, at: number) {
  await new Promise(done => setTimeout(done, PUSH_AFTER));
  const row = await env.DB.prepare('SELECT h.id, h.data FROM foryou_sync s JOIN hubs h ON h.id = s.hub WHERE s.hub = ?').bind(hub).first<{id: string; data: string}>();
  if (!row) return;
  const got = await syncInTurn(env, row, origin, PUSH).catch(() => null);
  await homeChanged(env, hub, got);
  if (got?.state === 'ok' && !got.more) await env.DB.prepare('DELETE FROM foryou_sync WHERE hub = ? AND at <= ?').bind(hub, at).run();
}
export async function api(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
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
      // One button for everyone: a manager's passkey or a person's. Who is signed in comes only from the row whose key checked the
      // signature (never from anything the page sent), and a person's only while they are still in the hub and have joined.
      const id = String(body.id ?? ''), [managers, persons] = await env.DB.batch([
        env.DB.prepare('SELECT account, key, alg FROM passkeys WHERE id = ?').bind(id),
        env.DB.prepare('SELECT k.hub, k.person, k.key, k.alg, p.invite FROM person_passkeys k JOIN people p ON p.hub = k.hub AND p.id = k.person AND p.joined = 1 WHERE k.id = ?').bind(id),
      ]);
      const held = (managers.results[0] ?? persons.results[0]) as {account?: string; hub?: string; person?: string; invite?: string; key: string; alg: number} | undefined;
      if (!held || !await signed(env, url.origin, body, held.key, held.alg)) {await failed(env, key); bad(403, 'That passkey is not one this site knows');}
      // On someone's invite link (the page sends its token), only that person's passkey opens it. Said only to whoever just
      // proved they hold the passkey, so it tells nobody else anything.
      if (body.token !== undefined && (!held!.person || held!.invite !== await sha(String(body.token)))) bad(403, 'That passkey belongs to someone else. Pick your own, or type your password.');
      return reply({}, 200, await startSession(env, held!.account ? {account: held!.account} : {hub: held!.hub!, person: held!.person!}));
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
    if (first === 'quick' && method === 'POST') return reply(await tvAs(request, env, body));
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
    // (One piece of work on a hub's setups at a time; done, nothing is left for the hub to send by itself: pushed, above.)
    if (first === 'sync' && method === 'POST') {
      const at = now(), {changed, ...got} = (await syncInTurn(env, who.hub, url.origin, 30, true))!;
      if (got.state === 'ok' && !got.more && env.FRONT === 'aiometadata') await env.DB.prepare('DELETE FROM foryou_sync WHERE hub = ? AND at <= ?').bind(who.hub.id, at).run();
      // A change that reached the apps is told to the address the hub's manager set, if any (notice.ts), once the page has its
      // answer. Whether anything was written is the hub's own business, and no part of the answer.
      const told = homeChanged(env, who.hub.id, {...got, changed});
      if (ctx) ctx.waitUntil(told); else await told;
      return reply(got);
    }
    // An invited person gets their own rows; the manager can ask for anyone's.
    if (first === 'previews' && method === 'GET') {
      // A group's Home as someone in it starts with comes from the group's own setup (see homes in native.ts), for its manager.
      const group = !who.person ? url.searchParams.get('group') || undefined : undefined;
      return reply({rows: await previews(env, who.hub, who.person ?? (group ? undefined : url.searchParams.get('person') || undefined), group)});
    }
    if (first === 'activity' && method === 'GET') {
      // The manager sees everyone; an invited person sees only themselves. Each sitting of the last week (front.ts), with its title.
      const rows = await env.DB.prepare(`SELECT s.person, s.item, s.started, p.title, p.detail, s.position, p.duration, s.device, s.playing, s.paused, s.since, s.updated, p.art, s.place, s.net, s.parts, s.pauses, s.idle, p.over, s.reached, s.undone FROM sittings s JOIN plays p ON p.hub = s.hub AND p.person = s.person AND p.item = s.item WHERE s.hub = ?1 AND s.updated > ?2 ${who.person ? 'AND s.person = ?3' : ''} ORDER BY s.updated DESC LIMIT 1000`).bind(...(who.person ? [who.hub.id, now() - 7 * 86400, who.person] : [who.hub.id, now() - 7 * 86400])).all();
      // One with too little played is left out once it is over (see brief); while it may still be playing, it shows.
      // A title marked unwatched after it was played is a line of its own (front.ts, unmarked: `undone`), always shown.
      const time = now(), kept = (rows.results as {playing: number; updated: number; parts: string | null; started: number; duration: number; undone: number}[]).filter(row => row.undone || (row.playing && time - row.updated < 900) || !brief(row, row.duration));
      // A title's file fetched with no sitting to go with it was a download (front.ts, fetched): no sitting of theirs with that title,
      // however short, from ten minutes before the fetch to ten after. One just made waits five minutes, as a play's first report
      // can come after its file was asked for. Asked for at the download address itself, it always was one.
      const downs = await env.DB.prepare(`SELECT f.person, f.item, f.at, f.title, f.detail, f.art, f.device FROM fetches f WHERE f.hub = ?1 AND f.at > ?2 AND f.title IS NOT NULL ${who.person ? 'AND f.person = ?4' : ''}
        AND (f.asked = 1 OR (f.at < ?3 AND NOT EXISTS (SELECT 1 FROM sittings s WHERE s.hub = f.hub AND s.person = f.person AND replace(lower(s.item), '-', '') = f.item AND s.undone = 0 AND s.started <= f.last + 600 AND s.updated >= f.at - 600))) ORDER BY f.at DESC LIMIT 200`)
        .bind(...(who.person ? [who.hub.id, time - 7 * 86400, time - 300, who.person] : [who.hub.id, time - 7 * 86400, time - 300])).all();
      // `over` and `reached` go only with a title known to run longer than listed (front.ts, note): how far any report of it got,
      // and how far it had been reached before this sitting began. The page draws and words such a sitting by those.
      const sittings = kept.map(row => {const {over, reached, undone, ...rest} = row as typeof row & {over: number; reached: number}; return undone ? {...rest, undone: 1} : over ? {...rest, over, reached} : rest;});
      return reply({now: time, sittings, downloads: downs.results});
    }
    if (first === 'state' && method === 'GET') return reply(await state(env, who) ?? bad(401, 'Sign in first'));
    if (first === 'people' && second && third) {
      const done = await personAction(request, env, who, second, third, fourth, body, url.origin);
      if (ctx && env.FRONT === 'aiometadata' && method !== 'GET' && PUSHED.test([third, fourth].filter(Boolean).join('/'))) {
        const at = now(); await setupsDue(env, who.hub.id).run();
        ctx.waitUntil(pushed(env, who.hub.id, url.origin, at).catch(error => console.error('push', (error as Error).message)));
      }
      return reply(done);
    }
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
    if (first === 'notice' && !second && method === 'PUT') return reply(await setNotice(env, who, body, url));
    if (first === 'notice' && !second && method === 'DELETE') return reply(await dropNotice(env, who));
    if (first === 'notice' && second === 'page' && method === 'PUT') return reply(await setNoticePage(env, who, body, url));
    if (first === 'notice' && second === 'page' && method === 'DELETE') return reply(await dropNoticePage(env, who));
    if (first === 'account') return reply(await account(request, env, who, second, third, body, url.origin));
    return reply({message: 'Not found'}, 404);
  } catch (error) {
    if (error instanceof Bad) return reply({message: error.message, ...(error.until ? {until: error.until} : {})}, error.status);
    console.error('api', url.pathname, (error as Error).message);
    return reply({message: 'Something went wrong on our side'}, 500);
  }
}
