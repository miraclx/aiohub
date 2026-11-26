/* A person's Trakt lists as Home rows: their own as one (SHELF_ROW, "My Trakt lists") and the ones they liked as another
   (LIKED_ROW, "Trakt lists I liked"). Each is a collection with a wide tile for each list, pictured by the backdrop (TMDB) of its
   best-known title: the one most people rated on Trakt, of its first hundred. Both are worked out together and kept as one
   (`shelf`); a row holds the lists of its kind. Opening a tile shows the list, served by
   the hub as any of their own lists is (rows.ts). Which lists there are, and their pictures, are worked out ahead by the cron
   (refreshShelf, run from foryou.ts) and kept per hub and person, so a sync only reads what was kept and every sync writes the
   same. Worked out again once a day; a list whose best-known title is unchanged keeps its picture without asking TMDB again. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {read} from './trakt';

export const SHELF_ROW = 'trakt-lists', LIKED_ROW = 'trakt-liked-lists', SHELF = 'shelf';
// At most this many lists between the two rows, so one run's calls (two for the lists, one for each list's titles, one for each
// new picture) stay well inside what a Worker may make.
export const MOST = 16;
/* Which of their lists the two rows hold, from all of them in Trakt's order (ids as `trakt-mine.<id>` and `trakt-liked.<id>`):
   their own first, with up to half of MOST kept for the ones they liked, so many of one kind never leave the other row empty. */
export function shelved<T extends {id: string}>(lists: T[]): T[] {
  const mine = lists.filter(list => list.id.startsWith('trakt-mine.')), liked = lists.filter(list => list.id.startsWith('trakt-liked.'));
  const others = Math.min(liked.length, Math.max(MOST - mine.length, MOST / 2));
  return [...mine.slice(0, MOST - others), ...liked.slice(0, others)];
}
/* The lists a row holds, of those kept. */
export const shelfOn = (row: string, shelf: Shelf[]) => shelf.filter(list => list.id.startsWith(row === LIKED_ROW ? 'trakt-liked.' : 'trakt-mine.'));
const DAY = 86400, RETRY = 3600, HUB = '#hub';
export interface Shelf {id: string; title: string; first: string; cover: string}
type TraktList = {name?: string; ids?: {trakt?: number}};
type Media = {ids?: {tmdb?: number | null}; votes?: number};
type Listed = {movie?: Media; show?: Media};

/* The lists as kept: [] when none were worked out yet. */
export function shelfFrom(items: string | null | undefined): Shelf[] {
  try {return items ? JSON.parse(items) as Shelf[] : [];} catch {return [];}
}
/* Whether someone's own Home has either row on. */
export const wantsShelf = (rows: {id: string; on: boolean}[] | null | undefined) => !!rows?.some(row => (row.id === SHELF_ROW || row.id === LIKED_ROW) && row.on);

/* Their lists and pictures, worked out again. null when Trakt did not answer, so what was kept stays. */
export async function shelfOf(env: Env, hub: string, person: string, before: Shelf[]): Promise<Shelf[] | null> {
  const mine = await read<TraktList[]>(env, hub, person, '/users/me/lists'), liked = await read<{list?: TraktList}[]>(env, hub, person, '/users/likes/lists?limit=50');
  if (!Array.isArray(mine) || !Array.isArray(liked)) return null;
  const name = (text: unknown) => String(text ?? 'A list').slice(0, 80), lists: {id: string; title: string; ask: string}[] = [];
  for (const list of mine) if (Number.isInteger(list.ids?.trakt)) lists.push({id: `trakt-mine.${list.ids!.trakt}`, title: name(list.name), ask: `/users/me/lists/${list.ids!.trakt}/items?limit=100&extended=full`});
  for (const like of liked) {
    const id = like.list?.ids?.trakt;
    if (Number.isInteger(id) && !lists.some(list => list.id.endsWith(`.${id}`))) lists.push({id: `trakt-liked.${id}`, title: name(like.list!.name), ask: `/lists/${id}/items?limit=100&extended=full`});
  }
  const key = await getSecret<string>(env, hub, HUB, 'key:tmdb'), had = new Map(before.map(item => [item.id, item])), out: Shelf[] = [];
  for (const list of shelved(lists)) {
    // Its best-known film or show (a person on a list has no picture; the earlier of two as well known); a list Trakt did not
    // answer for keeps what it had.
    const items = await read<Listed[]>(env, hub, person, list.ask), kept = had.get(list.id);
    const first = Array.isArray(items) ? bestOf(items) : kept?.first ?? '';
    const cover = kept && kept.first === first && kept.cover ? kept.cover : first && key ? await backdrop(env, key, first) : '';
    out.push({id: list.id, title: list.title, first, cover});
  }
  return out;
}
const pathOf = (item: Listed) => Number(item.movie?.ids?.tmdb) > 0 ? `movie/${item.movie!.ids!.tmdb}` : Number(item.show?.ids?.tmdb) > 0 ? `tv/${item.show!.ids!.tmdb}` : '';
function bestOf(items: Listed[]) {
  let best = '', most = -1;
  for (const item of items) {const path = pathOf(item), votes = Number((item.movie ?? item.show)?.votes) || 0; if (path && votes > most) {best = path; most = votes;}}
  return best;
}
/* A title's main backdrop on TMDB, as a picture address, or '' when it has none. */
async function backdrop(env: Env, key: string, path: string) {
  const got = await fetch(`${env.TMDB_API ?? 'https://api.themoviedb.org/3'}/${path}?api_key=${encodeURIComponent(key)}`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
  const body = got?.status === 200 ? await got.json().catch(() => null) as {backdrop_path?: string | null} | null : null;
  return body?.backdrop_path && /^\/[\w.-]{1,80}$/.test(body.backdrop_path) ? `https://image.tmdb.org/t/p/w780${body.backdrop_path}` : '';
}

/* A cron step: one person with either row on whose lists were not worked out in the last day (or ever, just added) has them
   worked out and kept; their hub's setups are flagged to be brought in step when anything changed. true when there was one.
   When Trakt does not answer it is tried again in an hour. */
export async function refreshShelf(env: Env, people: {hub: string; id: string; data: string}[], flag: (hub: string) => D1PreparedStatement): Promise<boolean> {
  const kept = await env.DB.prepare('SELECT hub, person, at, items FROM rows_cache WHERE kind = ?').bind(SHELF).all<{hub: string; person: string; at: number; items: string}>();
  const held = new Map(kept.results.map(row => [`${row.hub}/${row.person}`, row])), time = now();
  const next = people.find(row => {
    let rows: {id: string; on: boolean}[] | null = null; try {rows = (JSON.parse(row.data) as {rows?: {id: string; on: boolean}[] | null}).rows ?? null;} catch {rows = null;}
    return wantsShelf(rows) && time - (held.get(`${row.hub}/${row.id}`)?.at ?? 0) >= DAY;
  });
  if (!next) return false;
  const before = shelfFrom(held.get(`${next.hub}/${next.id}`)?.items), got = await shelfOf(env, next.hub, next.id, before).catch(() => null);
  const shelf = got ?? before, changed = !!got && JSON.stringify(got) !== JSON.stringify(before);
  await env.DB.batch([env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items')
    .bind(next.hub, next.id, SHELF, got ? time : time - DAY + RETRY, JSON.stringify(shelf)), ...(changed ? [flag(next.hub)] : [])]);
  return true;
}
