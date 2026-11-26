/* A person's own Trakt account, connected to the hub. They connect it on Trakt's own sign-in page, from this site's page (Trakt
   in pages.tsx): the browser does the sign-in with Trakt itself, since Trakt often turns away the shared addresses Workers call
   from (429, error 1015), and hands the login here to be kept in the vault and renewed.
   Connecting only reads: it fills their Trakt rows (rows.ts) and writes nothing. What they watch here goes to Trakt as it plays
   only while their sync is on (the `sync` row, `matching`: sync.ts), which is theirs alone to turn on. A call Trakt does not
   take then waits in an outbox and is tried again (below).
   STRICTLY OFF: for someone whose sync is off, no start, pause, stop or tick is sent, kept or tried, whoever asks. The gate is
   here, where every such call passes (deliver, flush, sweep), asked of the database each time and never remembered; front.ts
   and the passes that end here have their own on top. A heart for Favorites (hearts.ts) is the person's other, separate switch
   (their watchlist, not their watching) and is not held by this one.
   Nothing at all while TRAKT_CLIENT_ID is unset. */
import type {Env} from './util';
import {getSecret, now, putSecret, seal, unseal} from './util';

export const LINK = 'trakt-scrobble', PENDING = 'trakt-scrobble-pending';
// Workers Free allows about fifty database queries and fifty outside calls per run, so the cron takes a few at a time.
const DAY = 86400, CLAIM = 60, QUIET = 1800, SWEEP = 4, CLEAR = 5, OOB = 'urn:ietf:wg:oauth:2.0:oob';
// `redirect` is the address the sign-in came back to; Trakt wants the same one when the login is renewed.
// `since`: when it was connected. `on`: when sync was last turned on (not there for someone who turned it on before this was kept:
// then `since` stands for it). A play here from before then never reached Trakt, and goes only if they tick earlier plays.
// `ask`: the person signed in to Trakt themselves and has not yet said whether it is synced (sync.ts): their own page asks.
export interface Link {access: string; refresh: string; expires: number; username: string; redirect?: string; again?: boolean; renewing?: number; since?: number; on?: number; ask?: boolean}
type Ids = {tmdb?: number; imdb?: string};
export type Target = {movie: {ids: Ids}} | {show: {ids: Ids}; episode: {season: number; number: number}};

const api = (env: Env) => env.TRAKT_API ?? 'https://api.trakt.tv';
// Signing in, renewing and revoking are on Trakt's sign-in host.
const auth = (env: Env) => env.TRAKT_AUTH ?? env.TRAKT_API ?? 'https://auth.trakt.tv';
const head = (env: Env, access = '') => ({'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0', 'trakt-api-version': '2', 'trakt-api-key': env.TRAKT_CLIENT_ID ?? '', ...(access ? {authorization: `Bearer ${access}`} : {})});
const post = (env: Env, path: string, body: unknown, access = '') => fetch(api(env) + path, {method: 'POST', headers: head(env, access), body: JSON.stringify(body)}).catch(() => null);
const signin = (env: Env, path: string, body: unknown) => fetch(auth(env) + path, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, body: JSON.stringify(body)}).catch(() => null);
const drop = (env: Env, hub: string, person: string, kind: string) => env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, person, kind);
const sleep = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));
/* Whether Trakt is done with a call: taken, already had (409), or refused for good (it does not know the title). Not done: no
   answer, too many calls (429) or a fault on its side; the outbox tries again. */
export const taken = (status: number | null) => status !== null && status !== 0 && status !== 401 && status !== 429 && status < 500;

/* ---------- connecting ---------- */
/* A login finished on the person's page (see api.ts, 'link'). Anything left from the older code flow goes with it. */
export async function keepLink(env: Env, hub: string, person: string, link: Link) {
  await env.DB.batch([await putSecret(env, hub, person, LINK, {...link, since: link.since ?? now()}), drop(env, hub, person, PENDING)]);
}
/* The person answered whether their Trakt is synced (sync.ts): their page stops asking. `turned`: it went from off to on just
   now, which is noted (`on`), so what was watched here before this moment stays off Trakt unless they tick earlier plays.
   Written only over exactly what was read, so a renewal at the same moment is never undone: it is read and tried once more. */
export async function answered(env: Env, hub: string, person: string, turned: boolean) {
  for (let tries = 0; tries < 2; tries++) {
    const text = (await env.DB.prepare('SELECT value FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, person, LINK).first<{value: string}>())?.value;
    const link = await unseal<Link>(env, `${hub}/${person}/${LINK}`, text);
    if (!link || (!link.ask && !turned) || await swap(env, hub, person, text!, {...link, ask: false, ...(turned ? {on: now()} : {})})) return;
  }
}
/* Whether their sync is on: asked of the database each time, never remembered. */
export const syncOn = async (env: Env, hub: string, person: string) => !!(await env.DB.prepare('SELECT matching FROM sync WHERE hub = ? AND person = ?').bind(hub, person).first<{matching: number}>())?.matching;
/* Sync turned off: nothing more of their watching goes. What was still waiting to be sent is dropped, not left: left, it would go
   out days late if sync came back on, unasked, and meanwhile it would read as "waiting for Trakt" and hold their Favorites step
   up (hearts.ts looks at nobody with a call waiting). A play Trakt was mid-way through hearing of, or whose call was dropped
   here, counts as never sent (as on a disconnect), so it is among the earlier plays they can tick if they turn sync on again.
   A heart waiting for Favorites stays. Rows here only: nothing on Trakt changes. */
const WATCHING = "('start', 'pause', 'stop', 'mark')";
export const stopSending = (env: Env, hub: string, person: string) => [
  env.DB.prepare(`UPDATE plays SET scrobbled = CASE WHEN scrobbled = 'held-watched' THEN 'watched' ELSE NULL END WHERE hub = ?1 AND person = ?2 AND (scrobbled IN ('playing', 'paused', 'held', 'held-watched')
    OR item IN (SELECT item FROM trakt_outbox WHERE hub = ?1 AND person = ?2 AND kind IN ${WATCHING}))`).bind(hub, person),
  env.DB.prepare(`DELETE FROM trakt_outbox WHERE hub = ? AND person = ? AND kind IN ${WATCHING}`).bind(hub, person)];
export async function disconnect(env: Env, hub: string, person: string) {
  const link = await getSecret<Link>(env, hub, person, LINK);
  if (link?.access) await signin(env, '/oauth/revoke', {token: link.access, client_id: env.TRAKT_CLIENT_ID});
  await env.DB.batch([drop(env, hub, person, LINK), drop(env, hub, person, PENDING), ...forgetTrakt(env, hub, person), env.DB.prepare("UPDATE plays SET scrobbled = NULL WHERE hub = ? AND person = ? AND scrobbled IN ('playing', 'paused', 'held')").bind(hub, person)]);
}
/* What waits for or came from a person's Trakt, and whether it is synced: gone with the connection, the person, or the hub.
   What was sent where (`sent`) stays while the person does, so connecting again sends nothing twice. Favorites from the
   watchlist go off and its ledger goes too (`favs`, `hearts`: hearts.ts): only rows here, never a heart on their server or a
   title on Trakt. */
export const forgetTrakt = (env: Env, hub: string, person: string) => ['trakt_outbox', 'rows_cache', 'drift', 'sync', 'favs', 'hearts'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ? AND person = ?`).bind(hub, person));
/* What the page shows: connected as whom, or that Trakt wants connecting again. `since`: since when what is watched here goes to
   Trakt by itself (when sync was last turned on, else when it was connected), which is what tells one set of earlier plays
   from another (api.ts). */
export async function links(env: Env, hub: string, rows: {owner: string; value: string}[]) {
  const out: Record<string, {username: string; again: boolean; ask: boolean; since: number}> = {};
  for (const row of rows) {const link = await unseal<Link>(env, `${hub}/${row.owner}/${LINK}`, row.value); if (link) out[row.owner] = {username: link.username, again: !!link.again, ask: !!link.ask, since: link.on ?? link.since ?? 0};}
  return out;
}

/* ---------- calling as a person ---------- */
/* Writes the connection only if it is still exactly what was read, so two copies of the Worker never both renew it. */
async function swap(env: Env, hub: string, person: string, from: string, link: Link) {
  const text = await seal(env, `${hub}/${person}/${LINK}`, link);
  return (await env.DB.prepare('UPDATE secrets SET value = ? WHERE hub = ? AND owner = ? AND kind = ? AND value = ?').bind(text, hub, person, LINK, from).run()).meta.changes ? text : null;
}
/* An access token that works, renewed first when under a day is left (or when Trakt just refused `failed`). Trakt's refresh
   tokens work once, so whoever renews marks the stored pair first; anyone else meanwhile uses the current token if it still works.
   null: not connected, or Trakt wants it connected again. '': none usable right now (renewing did not get through); try later. */
async function access(env: Env, hub: string, person: string, failed = ''): Promise<string | null> {
  const text = (await env.DB.prepare('SELECT value FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, person, LINK).first<{value: string}>())?.value;
  const link = await unseal<Link>(env, `${hub}/${person}/${LINK}`, text);
  if (!link || link.again) return null;
  if (failed && link.access !== failed) return link.access;
  const usable = !failed && link.expires > now() + 60 ? link.access : '';
  if (!failed && link.expires > now() + DAY) return link.access;
  if (link.renewing && now() - link.renewing < CLAIM) return usable;
  const mine = await swap(env, hub, person, text!, {...link, renewing: now()});
  if (!mine) return usable;
  const answer = await signin(env, '/oauth/token', {refresh_token: link.refresh, client_id: env.TRAKT_CLIENT_ID, redirect_uri: link.redirect || OOB, grant_type: 'refresh_token'});
  const got = answer?.ok ? await answer.json().catch(() => null) as {access_token?: string; refresh_token?: string; expires_in?: number; created_at?: number} | null : null;
  if (got?.access_token && got.refresh_token) {
    await swap(env, hub, person, mine, {access: got.access_token, refresh: got.refresh_token, expires: Number(got.created_at ?? now()) + Number(got.expires_in ?? 7 * DAY), username: link.username, redirect: link.redirect, since: link.since, on: link.on, ask: link.ask});
    return got.access_token;
  }
  // Trakt no longer takes this connection (taken back on Trakt, or long unused): it has to be made again. Anything else is a blip.
  const error = answer?.status === 400 ? (await answer.json().catch(() => null) as {error?: string} | null)?.error ?? '' : '';
  const over = answer?.status === 401 || error === 'invalid_grant';
  if (!answer?.ok) console.error('trakt renew', answer?.status ?? 0, error);
  await swap(env, hub, person, mine, over ? {access: '', refresh: '', expires: 0, username: link.username, again: true} : {...link, renewing: undefined});
  return over ? null : usable;
}
/* One call as this person: Trakt's answer, and how long it asked to wait. status null when nothing was sent (not connected, or
   Trakt wants it connected again); 0 when Trakt did not answer or the login could not be renewed just now. */
async function attempt(env: Env, hub: string, person: string, path: string, body: unknown): Promise<{status: number | null; after: number}> {
  let token = await access(env, hub, person);
  if (!token) return {status: token === null ? null : 0, after: 0};
  let answer = await post(env, path, body, token);
  if (answer?.status === 401) {token = await access(env, hub, person, token); if (!token) return {status: token === null ? null : 0, after: 0}; answer = await post(env, path, body, token);}
  // Only the path and Trakt's answer are noted, never who or what.
  if (!taken(answer?.status ?? 0)) console.error('trakt send', path, answer?.status ?? 0, answer?.headers.get('retry-after') ?? '');
  const after = Math.min(3600, Number(answer?.headers.get('retry-after')) || 0);
  // Told to wait, and for how long: nothing more of theirs is sent before then (sendWait, below).
  if (answer?.status === 429 && after > 0) {
    open.delete(`${hub}/${person}`);
    await env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, '') ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at").bind(hub, person, HELD, now() + after).run();
  }
  return {status: answer?.status ?? 0, after};
}
/* Until when Trakt asked the hub to wait before sending anything more of this person's (a 429 with Retry-After on a write, kept by
   hub and person), or 0 when it did not. Trakt limits writes apart from reads, so this is kept apart from the reads' wait
   (traktWait, below). While it holds, a new call goes straight to the outbox and nothing there is tried: before this, each new
   start or pause from a player was sent at once and turned away again. "Not waiting" is remembered for a few seconds, so a run
   of calls asks the database once. */
const HELD = 'trakt-wait-send', open = new Map<string, number>();
async function sendWait(env: Env, hub: string, person: string): Promise<number> {
  const who = `${hub}/${person}`, time = now();
  if (time - (open.get(who) ?? 0) < CLEAR) return 0;
  const row = await env.DB.prepare('SELECT at FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, HELD).first<{at: number}>();
  if (row && row.at > time) return row.at;
  if (open.size > 500) open.clear();
  open.set(who, time);
  return 0;
}
export const send = async (env: Env, hub: string, person: string, path: string, body: unknown) => (await attempt(env, hub, person, path, body)).status;
/* Until when Trakt asked the hub to wait before reading anything more of this person's (its 429 and Retry-After, kept by hub and
   person), or 0 when it did not. Every read honours it, so one refusal is not followed by more from the cron, a row or an open page. */
const WAITING = 'trakt-wait', clear = new Map<string, number>();
export async function traktWait(env: Env, hub: string, person: string): Promise<number> {
  // "Not waiting" is remembered for a few seconds, so a run of reads (a person's lists, one after another) asks the database once:
  // a Worker may make only so many queries a run.
  const who = `${hub}/${person}`, time = now();
  if (time - (clear.get(who) ?? 0) < CLEAR) return 0;
  const row = await env.DB.prepare('SELECT at FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, WAITING).first<{at: number}>();
  if (row && row.at > time) return row.at;
  if (clear.size > 500) clear.clear();
  clear.set(who, time);
  return 0;
}
/* One read as this person, renewed and retried like `send`. null when not connected, Trakt wants connecting again, or it did not answer.
   `paging`, when given, is told how many pages Trakt says the list has. With `most` in it, an answer longer than that many
   bytes (by what Trakt says its length is, else by its text) is not parsed: null, with `over` set. A Worker on the Free plan
   has about ten milliseconds of processor time a run, and parsing megabytes would end the run. */
export async function read<T>(env: Env, hub: string, person: string, path: string, paging?: {pages: number; most?: number; over?: boolean}): Promise<T | null> {
  if (await traktWait(env, hub, person)) return null;
  let token = await access(env, hub, person);
  if (!token) return null;
  const get = (access: string) => fetch(api(env) + path, {headers: head(env, access)}).catch(() => null);
  let answer = await get(token);
  if (answer?.status === 401) {token = await access(env, hub, person, token); if (!token) return null; answer = await get(token);}
  if (!answer?.ok) console.error('trakt read', path.split('?')[0].replace(/^\/shows\/[^/]+/, '/shows/:id'), answer?.status ?? 0, answer?.headers.get('x-ratelimit') ?? '', answer?.headers.get('retry-after') ?? '');
  // Told to wait: nothing of theirs is read again before then, whoever asks.
  if (answer?.status === 429) clear.delete(`${hub}/${person}`);
  if (answer?.status === 429) await env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, '') ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at")
    .bind(hub, person, WAITING, now() + Math.min(3600, Math.max(30, Number(answer.headers.get('retry-after')) || 120))).run();
  if (paging && answer?.ok) paging.pages = Number(answer.headers.get('x-pagination-page-count')) || 0;
  if (paging?.most && answer?.ok) {
    if (Number(answer.headers.get('content-length')) > paging.most) {paging.over = true; await answer.body?.cancel().catch(() => null); return null;}
    const text = await answer.text().catch(() => '');
    if (text.length > paging.most) {paging.over = true; return null;}
    try {return JSON.parse(text) as T;} catch {return null;}
  }
  return answer?.ok ? await answer.json().catch(() => null) as T | null : null;
}
export const history = (target: Target, at: string) => 'movie' in target ? {movies: [{ids: target.movie.ids, watched_at: at}]}
  : {shows: [{ids: target.show.ids, seasons: [{number: target.episode.season, episodes: [{number: target.episode.number, watched_at: at}]}]}]};
export const progressOf = (position: number, duration: number) => Math.min(100, Math.round(position / duration * 10000) / 100);

/* ---------- the outbox ---------- */
/* A call Trakt did not take is kept and tried again: twice within the next seconds, then by the cron every five minutes, for up
   to a week. When Trakt said how long to wait (429 with Retry-After), nothing of that person's is sent before then (sendWait). Per title, any newer call ends a start or pause still waiting (a newer one replaces it, a stop or tick makes it
   pointless); stops and ticks are kept until Trakt has them. A start still waiting after a few minutes is let go: by then it
   would say something is playing that likely is not. Trakt takes one write a second per person, so a person's calls go one at
   a time, in order. */
// 'heart' and 'unheart': a watchlist add or remove for a heart made or taken away in an app (front.ts, hearted), kept and tried
// like a tick. Their `item` is the title's ledger key, never a play's id, so nothing here mistakes one for a start or pause.
export interface Call {kind: 'start' | 'pause' | 'stop' | 'mark' | 'heart' | 'unheart'; path: string; body: Record<string, unknown>}
interface Waiting {id: number; hub: string; person: string; kind: Call['kind']; path: string; body: string; made: number; tries: number; next: number; doubt: number; synced: number | null}
/* A call that tells Trakt of watching (anything but a heart): only ever for someone whose sync is on. */
const watching = (kind: Call['kind']) => kind !== 'heart' && kind !== 'unheart';
const STALE = 300, WEEK = 7 * DAY, SOON = [2, 5], LATER = 240, BATCH = 8;
const wait = (tries: number, after: number) => Math.max(SOON[tries] ?? LATER, after);
/* A finished watch that had to wait is added to history at the time it ended: a late stop would be stamped when it got through.
   Only when every refusal was a 429 (it never reached Trakt). After a fault that may have got through, it goes again as a stop,
   which Trakt does not count twice. */
function late(call: {kind: string; path: string; body: Record<string, unknown>; made: number; doubt: number}): [string, unknown] {
  if (call.kind !== 'stop' || call.doubt || Number(call.body.progress) < 80 || now() - call.made < 120) return [call.path, call.body];
  const {progress: _, ...target} = call.body;
  return ['/sync/history', history(target as unknown as Target, new Date(call.made * 1000).toISOString())];
}
/* Sends one call as this person, or keeps it to send later. 'off' when they are not connected, or when the call tells of
   watching and their sync is off (asked here, in the one question below, so no caller can get past it); 'kept' when it waits.
   `made` is when it happened, if that was a while ago. */
export async function deliver(env: Env, hub: string, person: string, item: string, call: Call, made = now()): Promise<'sent' | 'kept' | 'off'> {
  const keep = (tries: number, next: number, doubt: number) => env.DB.prepare('INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(hub, person, item, call.kind, call.path, JSON.stringify(call.body), made, tries, next, doubt);
  const ended = env.DB.prepare("DELETE FROM trakt_outbox WHERE hub = ? AND person = ? AND item = ? AND kind IN ('start', 'pause')").bind(hub, person, item);
  // Whether anything of theirs is waiting already, and whether Trakt asked the hub to wait before sending more: one question.
  const line = await env.DB.prepare('SELECT (SELECT 1 FROM trakt_outbox WHERE hub = ?1 AND person = ?2 LIMIT 1) AS queued, (SELECT at FROM rows_cache WHERE hub = ?1 AND person = ?2 AND kind = ?3 AND at > ?4) AS until, (SELECT matching FROM sync WHERE hub = ?1 AND person = ?2) AS synced')
    .bind(hub, person, HELD, now()).first<{queued: number | null; until: number | null; synced: number | null}>();
  if (watching(call.kind) && !line?.synced) return 'off';
  // Trakt asked for a wait: kept without being tried, due when the wait is over, in the order they came.
  if (line?.until) {await env.DB.batch([ended, keep(0, line.until, 0)]); return 'kept';}
  // Something already waiting for them: this one goes behind it, and the line is tried now.
  if (line?.queued) {
    await env.DB.batch([ended, keep(0, 0, 0)]);
    return await flush(env, {hub, person}) ? 'kept' : 'sent';
  }
  const got = await attempt(env, hub, person, call.path, call.body);
  if (got.status === null) return 'off';
  if (taken(got.status)) return 'sent';
  await keep(1, now() + wait(0, got.after), got.status === 429 ? 0 : 1).run();
  return 'kept';
}
/* Twice more soon after a call was kept, within the request it came with (the app has its answer already). */
export async function soon(env: Env, hub: string, person: string) {
  for (const seconds of SOON) {await sleep(seconds + 1); if (!await flush(env, {hub, person})) return;}
}
/* Tries what is waiting and due, oldest first: one person's, or everyone's (the cron). Whether anything is left waiting. */
export async function flush(env: Env, only?: {hub: string; person: string}) {
  // A call waits while one before it for the same person is not due yet, or is being sent: their calls stay in order.
  const first = 'next <= ?1 AND NOT EXISTS (SELECT 1 FROM trakt_outbox o WHERE o.hub = t.hub AND o.person = t.person AND o.id < t.id AND o.next > ?1)';
  const synced = '(SELECT matching FROM sync y WHERE y.hub = t.hub AND y.person = t.person) AS synced';
  const due = only ? env.DB.prepare(`SELECT t.*, ${synced} FROM trakt_outbox t WHERE hub = ?2 AND person = ?3 AND ${first} ORDER BY id LIMIT ?4`).bind(now(), only.hub, only.person, BATCH)
    : env.DB.prepare(`SELECT t.*, ${synced} FROM trakt_outbox t WHERE ${first} ORDER BY id LIMIT ?2`).bind(now(), BATCH);
  const stuck = new Set<string>(), last = new Map<string, number>();
  for (const row of (await due.all<Waiting>()).results) {
    const who = `${row.hub}/${row.person}`;
    // Their sync is off: a call telling of watching is dropped untried (see stopSending), whenever it was kept.
    if (watching(row.kind) && !row.synced) {await env.DB.prepare('DELETE FROM trakt_outbox WHERE id = ?').bind(row.id).run(); continue;}
    if (stuck.has(who)) continue;
    // Trakt asked for a wait before more of theirs is sent: their line stays as it is until then (asked once per person a run).
    const until = await sendWait(env, row.hub, row.person);
    if (until) {stuck.add(who); await env.DB.prepare('UPDATE trakt_outbox SET next = ? WHERE id = ? AND next = ?').bind(until, row.id, row.next).run(); continue;}
    // Claimed first, so the cron and a request at the same moment never both send it.
    if (!(await env.DB.prepare('UPDATE trakt_outbox SET next = ? WHERE id = ? AND next = ?').bind(now() + CLAIM, row.id, row.next).run()).meta.changes) {stuck.add(who); continue;}
    const done = env.DB.prepare('DELETE FROM trakt_outbox WHERE id = ?').bind(row.id), age = now() - row.made;
    if ((row.kind === 'start' && age > STALE) || age > WEEK) {if (row.kind !== 'start') console.error('trakt outbox let go', row.kind, row.tries); await done.run(); continue;}
    const gap = 1.1 - (Date.now() - (last.get(who) ?? 0)) / 1000;
    if (gap > 0) await sleep(gap);
    const [path, body] = late({...row, body: JSON.parse(row.body) as Record<string, unknown>}), got = await attempt(env, row.hub, row.person, path, body);
    last.set(who, Date.now());
    if (got.status === null || taken(got.status)) {await done.run(); continue;}
    stuck.add(who);
    await env.DB.prepare('UPDATE trakt_outbox SET tries = tries + 1, next = ?, doubt = max(doubt, ?) WHERE id = ?').bind(now() + wait(row.tries, got.after), got.status === 429 ? 0 : 1, row.id).run();
  }
  const left = only ? env.DB.prepare('SELECT 1 FROM trakt_outbox WHERE hub = ? AND person = ? LIMIT 1').bind(only.hub, only.person) : env.DB.prepare('SELECT 1 FROM trakt_outbox LIMIT 1');
  return !!await left.first();
}

/* A sitting with too little played to count: under two minutes (under half, for anything shorter than four), as when an episode
   is opened, run to the end and left on realising it was seen. It goes neither to Trakt (nothing at all: its start is held
   until it counts, front.ts; nor a stop, a tick from the app, or the sweep below) nor on Activity once over. Real finishes are not lost: one resumed from 80% or more was counted when it stopped there,
   and getting to 80% from below takes over two minutes of anything longer than ten. An app that says only start and stop leaves
   no parts played (front.ts), so for it the time between the two is what was played. A tick with nothing played (parts
   "marked", from the library) is not a sitting of this kind. */
export function brief(sitting: {parts?: string | null; started: number; updated: number}, duration: number) {
  const held = (sitting.parts ?? '').split(' ').filter(part => part && part !== 'marked');
  if (!held.length) return false;
  const spans = held.map(part => part.split('-').map(Number)).filter(([a, b]) => b > a), least = duration > 0 ? Math.min(120, duration / 2) : 120;
  return (spans.length ? spans.reduce((sum, [a, b]) => sum + b - a, 0) : sitting.updated - sitting.started) < least;
}
/* Players that went quiet without saying stop (closed, crashed, out of battery). After half an hour Trakt is told it stopped where
   it was last seen: from 80% that counts as watched, and below that Trakt keeps the spot (not for a sitting with too little
   played, see brief). A few at a time; the next run takes
   the rest. Then whatever is waiting in the outbox.
   Only for someone whose sync is on. For anyone else nothing is said, a play left as "told" from when it was on counts as never
   sent, and any call of their watching still in the outbox (kept before sync went off, or before sync was what sending went
   by) is dropped in one statement, due or not. */
export async function sweep(env: Env) {
  if (!env.TRAKT_CLIENT_ID) return;
  await env.DB.prepare(`DELETE FROM trakt_outbox WHERE kind IN ${WATCHING} AND NOT EXISTS (SELECT 1 FROM sync y WHERE y.hub = trakt_outbox.hub AND y.person = trakt_outbox.person AND y.matching = 1)`).run();
  const rows = (await env.DB.prepare("SELECT hub, person, item, position, duration, ids, updated, (SELECT matching FROM sync y WHERE y.hub = plays.hub AND y.person = plays.person) AS synced FROM plays WHERE scrobbled IN ('playing', 'paused') AND updated < ? ORDER BY updated LIMIT ?").bind(now() - QUIET, SWEEP)
    .all<{hub: string; person: string; item: string; position: number; duration: number; ids: string | null; updated: number; synced: number | null}>()).results;
  for (const row of rows) {
    if (!row.synced) {await env.DB.prepare('UPDATE plays SET scrobbled = NULL WHERE hub = ? AND person = ? AND item = ?').bind(row.hub, row.person, row.item).run(); continue;}
    const target = row.ids ? JSON.parse(row.ids) as Target : null, progress = row.duration ? progressOf(row.position, row.duration) : 0;
    // Dated by when it was last seen, which a finished watch is added to history at if it has to wait (see `late`).
    // The latest sitting with it: one with too little played is let go without a word to Trakt (see brief).
    const sat = await env.DB.prepare('SELECT parts, started, updated FROM sittings WHERE hub = ? AND person = ? AND item = ? ORDER BY updated DESC LIMIT 1').bind(row.hub, row.person, row.item).first<{parts: string | null; started: number; updated: number}>();
    if (target && progress >= 1 && !(sat && brief(sat, row.duration))) await deliver(env, row.hub, row.person, row.item, {kind: 'stop', path: '/scrobble/stop', body: {...target, progress}}, row.updated);
    await env.DB.prepare("UPDATE plays SET scrobbled = 'stopped', scrobbled_at = ? WHERE hub = ? AND person = ? AND item = ?").bind(now(), row.hub, row.person, row.item).run();
  }
  await flush(env);
}
