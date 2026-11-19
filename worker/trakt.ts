/* Sending what a person plays here to their own Trakt account, as it happens. They connect it with Trakt's device code: the page
   shows a short code to type on Trakt's own page, and the answer is kept in the vault. The device code itself stays here.
   Nothing is sent for anyone who has not connected, and nothing at all while TRAKT_CLIENT_ID is unset. */
import type {Env} from './util';
import {getSecret, now, putSecret, seal, unseal} from './util';

export const LINK = 'trakt-scrobble', PENDING = 'trakt-scrobble-pending';
const DAY = 86400, CLAIM = 60, QUIET = 1800, SWEEP = 10;
interface Link {access: string; refresh: string; expires: number; username: string; again?: boolean; renewing?: number}
interface Pending {device: string; expires: number; interval: number; asked: number}
type Ids = {tmdb?: number; imdb?: string};
export type Target = {movie: {ids: Ids}} | {show: {ids: Ids}; episode: {season: number; number: number}};

const api = (env: Env) => env.TRAKT_API ?? 'https://api.trakt.tv';
const head = (env: Env, access = '') => ({'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0', 'trakt-api-version': '2', 'trakt-api-key': env.TRAKT_CLIENT_ID ?? '', ...(access ? {authorization: `Bearer ${access}`} : {})});
const post = (env: Env, path: string, body: unknown, access = '') => fetch(api(env) + path, {method: 'POST', headers: head(env, access), body: JSON.stringify(body)}).catch(() => null);
const drop = (env: Env, hub: string, person: string, kind: string) => env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, person, kind);
/* Whether Trakt is done with a call: taken, already had (409), or refused for good (it does not know the title). Not done: no
   answer, too many calls (429) or a fault on its side; the next change, or the sweep, tries again. */
export const taken = (status: number | null) => status !== null && status !== 0 && status !== 401 && status !== 429 && status < 500;

/* ---------- connecting ---------- */
export async function begin(env: Env, hub: string, person: string) {
  // Trakt sometimes turns the first asks away (too many calls from the shared addresses Workers send from, or a moment's fault):
  // asked again a couple of times, waiting as long as it says, before telling the person.
  let answer: Response | null = null;
  for (let tries = 0; tries < 3; tries++) {
    answer = await post(env, '/oauth/device/code', {client_id: env.TRAKT_CLIENT_ID});
    if (answer && answer.status !== 429 && answer.status < 500) break;
    if (tries < 2) await new Promise(resolve => setTimeout(resolve, Math.min(3000, 1000 * Math.max(1, Number(answer?.headers.get('retry-after') ?? 1)))));
  }
  if (!answer?.ok) console.error('trakt device code', answer?.status ?? 'no answer', (await answer?.text().catch(() => '') ?? '').slice(0, 160));
  const got = answer?.ok ? await answer.json().catch(() => null) as {device_code?: string; user_code?: string; verification_url?: string; expires_in?: number; interval?: number} | null : null;
  if (!got?.device_code || !got.user_code) return null;
  const interval = Math.max(1, Number(got.interval ?? 5)), expires = Number(got.expires_in ?? 600);
  await (await putSecret(env, hub, person, PENDING, {device: got.device_code, expires: now() + expires, interval, asked: 0} satisfies Pending)).run();
  return {code: got.user_code, url: got.verification_url ?? 'https://trakt.tv/activate', interval, expires};
}
/* A login finished on the person's own page (see api.ts, 'link'). */
export async function keepLink(env: Env, hub: string, person: string, link: Link) {
  await env.DB.batch([await putSecret(env, hub, person, LINK, link), drop(env, hub, person, PENDING)]);
}
async function connected(env: Env, hub: string, person: string) {
  const link = await getSecret<Link>(env, hub, person, LINK);
  return {state: link && !link.again ? 'connected' as const : 'over' as const, username: link?.username};
}
/* Asked by the page every few seconds until the code has been typed. Trakt's own pace is kept here, however many pages ask. */
export async function check(env: Env, hub: string, person: string): Promise<{state: 'waiting' | 'connected' | 'over'; username?: string}> {
  const pending = await getSecret<Pending>(env, hub, person, PENDING);
  if (!pending || pending.expires < now()) {if (pending) await drop(env, hub, person, PENDING).run(); return connected(env, hub, person);}
  if (now() - pending.asked < pending.interval) return {state: 'waiting'};
  await (await putSecret(env, hub, person, PENDING, {...pending, asked: now()})).run();
  const answer = await post(env, '/oauth/device/token', {code: pending.device, client_id: env.TRAKT_CLIENT_ID});
  if (answer?.status === 200) {
    const got = await answer.json() as {access_token: string; refresh_token: string; expires_in?: number; created_at?: number};
    const me = await fetch(`${api(env)}/users/settings`, {headers: head(env, got.access_token)}).then(found => found.ok ? found.json() : null).catch(() => null) as {user?: {username?: string}} | null;
    const link: Link = {access: got.access_token, refresh: got.refresh_token, expires: Number(got.created_at ?? now()) + Number(got.expires_in ?? 7 * DAY), username: String(me?.user?.username ?? '').slice(0, 80)};
    await env.DB.batch([await putSecret(env, hub, person, LINK, link), drop(env, hub, person, PENDING)]);
    return {state: 'connected', username: link.username};
  }
  // Not typed yet, or asked too soon; Trakt asks for a slower pace with 429.
  if (answer?.status === 429) await (await putSecret(env, hub, person, PENDING, {...pending, asked: now(), interval: pending.interval + 5})).run();
  if (!answer || answer.status === 400 || answer.status === 429 || answer.status >= 500) return {state: 'waiting'};
  // Used already (409, likely by another page a moment ago), unknown, run out or turned down: this code is finished either way.
  await drop(env, hub, person, PENDING).run();
  return connected(env, hub, person);
}
export async function disconnect(env: Env, hub: string, person: string) {
  const link = await getSecret<Link>(env, hub, person, LINK);
  if (link?.access) await post(env, '/oauth/revoke', {token: link.access, client_id: env.TRAKT_CLIENT_ID});
  await env.DB.batch([drop(env, hub, person, LINK), drop(env, hub, person, PENDING), env.DB.prepare("UPDATE plays SET scrobbled = NULL WHERE hub = ? AND person = ? AND scrobbled IN ('playing', 'paused')").bind(hub, person)]);
}
/* What the page shows: connected as whom, or that Trakt wants connecting again. */
export async function links(env: Env, hub: string, rows: {owner: string; value: string}[]) {
  const out: Record<string, {username: string; again: boolean}> = {};
  for (const row of rows) {const link = await unseal<Link>(env, `${hub}/${row.owner}/${LINK}`, row.value); if (link) out[row.owner] = {username: link.username, again: !!link.again};}
  return out;
}

/* ---------- calling as a person ---------- */
/* Writes the connection only if it is still exactly what was read, so two copies of the Worker never both renew it. */
async function swap(env: Env, hub: string, person: string, from: string, link: Link) {
  const text = await seal(env, `${hub}/${person}/${LINK}`, link);
  return (await env.DB.prepare('UPDATE secrets SET value = ? WHERE hub = ? AND owner = ? AND kind = ? AND value = ?').bind(text, hub, person, LINK, from).run()).meta.changes ? text : null;
}
/* An access token that works, renewed first when under a day is left (or when Trakt just refused `failed`). Trakt's refresh
   tokens work once, so whoever renews marks the stored pair first; anyone else meanwhile uses the current token if it still works. */
async function access(env: Env, hub: string, person: string, failed = ''): Promise<string | null> {
  const text = (await env.DB.prepare('SELECT value FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, person, LINK).first<{value: string}>())?.value;
  const link = await unseal<Link>(env, `${hub}/${person}/${LINK}`, text);
  if (!link || link.again) return null;
  if (failed && link.access !== failed) return link.access;
  const usable = !failed && link.expires > now() + 60 ? link.access : null;
  if (!failed && link.expires > now() + DAY) return link.access;
  if (link.renewing && now() - link.renewing < CLAIM) return usable;
  const mine = await swap(env, hub, person, text!, {...link, renewing: now()});
  if (!mine) return usable;
  const answer = await post(env, '/oauth/token', {refresh_token: link.refresh, client_id: env.TRAKT_CLIENT_ID, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token'});
  const got = answer?.ok ? await answer.json().catch(() => null) as {access_token?: string; refresh_token?: string; expires_in?: number; created_at?: number} | null : null;
  if (got?.access_token && got.refresh_token) {
    await swap(env, hub, person, mine, {access: got.access_token, refresh: got.refresh_token, expires: Number(got.created_at ?? now()) + Number(got.expires_in ?? 7 * DAY), username: link.username});
    return got.access_token;
  }
  // Trakt no longer takes this connection (taken back on Trakt, or long unused): it has to be made again. Anything else is a blip.
  const over = answer?.status === 400 || answer?.status === 401;
  await swap(env, hub, person, mine, over ? {access: '', refresh: '', expires: 0, username: link.username, again: true} : {...link, renewing: undefined});
  return over ? null : usable;
}
/* One call as this person. null when nothing was sent: not connected, or Trakt wants connecting again. 0 when Trakt did not answer. */
export async function send(env: Env, hub: string, person: string, path: string, body: unknown): Promise<number | null> {
  let token = await access(env, hub, person);
  if (!token) return null;
  let answer = await post(env, path, body, token);
  if (answer?.status === 401) {token = await access(env, hub, person, token); if (!token) return null; answer = await post(env, path, body, token);}
  return answer?.status ?? 0;
}
export const history = (target: Target, at: string) => 'movie' in target ? {movies: [{ids: target.movie.ids, watched_at: at}]}
  : {shows: [{ids: target.show.ids, seasons: [{number: target.episode.season, episodes: [{number: target.episode.number, watched_at: at}]}]}]};
export const progressOf = (position: number, duration: number) => Math.min(100, Math.round(position / duration * 10000) / 100);

/* Players that went quiet without saying stop (closed, crashed, out of battery). After half an hour Trakt is told it stopped where
   it was last seen: from 80% that counts as watched, and below that Trakt keeps the spot. A few at a time: one run may make only
   about fifty calls, and the next run takes the rest. */
export async function sweep(env: Env) {
  if (!env.TRAKT_CLIENT_ID) return;
  const rows = (await env.DB.prepare("SELECT hub, person, item, position, duration, ids, updated FROM plays WHERE scrobbled IN ('playing', 'paused') AND updated < ? ORDER BY updated LIMIT ?").bind(now() - QUIET, SWEEP)
    .all<{hub: string; person: string; item: string; position: number; duration: number; ids: string | null; updated: number}>()).results;
  for (const row of rows) {
    const target = row.ids ? JSON.parse(row.ids) as Target : null, progress = row.duration ? progressOf(row.position, row.duration) : 0;
    const status = target && progress >= 1 ? await send(env, row.hub, row.person, '/scrobble/stop', {...target, progress}) : null;
    // Not connected any more, or a day of Trakt not answering: let it go rather than come round every run.
    if (taken(status) || status === null || row.updated < now() - DAY) await env.DB.prepare("UPDATE plays SET scrobbled = 'stopped', scrobbled_at = ? WHERE hub = ? AND person = ? AND item = ?").bind(now(), row.hub, row.person, row.item).run();
  }
}
