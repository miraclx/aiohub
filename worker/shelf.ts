/* A person's own lists as Home rows: the ones they made as one (SHELF_ROW, "My lists") and the ones they liked as another
   (LIKED_ROW, "Lists I liked"), from their Trakt when it is connected to the hub, their MDBList when they have a key of their
   own, or both together. Each row is a collection with a wide tile for each list, pictured by the backdrop (TMDB) of its
   best-known title: for a Trakt list the one most people rated on Trakt, of its first hundred; for an MDBList list the one
   with the most votes on IMDb, as MDBList sorts it. Both rows are worked out together and kept as one (`shelf`); a row holds
   the lists of its kind. Opening a tile shows the list: a Trakt list served by the hub as any of their own lists is (rows.ts),
   an MDBList list read by their own AIOMetadata setup with their own key (native.ts). MDBList is only ever asked with the
   person's own key, never the hub's shared one. Which lists there are, and their pictures, are worked out ahead by the cron
   (refreshShelf, run from foryou.ts) and kept per hub and person, so a sync only reads what was kept and every sync writes the
   same. Worked out again once a day; a list whose best-known title is unchanged keeps its picture without asking TMDB again.
   MDBList's addresses are as its public API reference gives them (api.mdblist.com/docs, read 2026-11-27): GET /lists/user,
   GET /lists/liked and GET /lists/{id}/items. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK, read} from './trakt';
import {mdblist} from './carry';

// The rows keep the ids they had when only Trakt filled them.
export const SHELF_ROW = 'trakt-lists', LIKED_ROW = 'trakt-liked-lists', SHELF = 'shelf';
// At most this many lists between the two rows and both accounts, so one run's calls (two for each account's lists, one for
// each list's best-known title, one for each new picture) stay well inside what a Worker may make.
export const MOST = 16;
/* A list on the shelf goes by `trakt-mine.<Trakt list id>`, `trakt-liked.<id>`, `mdblist-mine.<MDBList list id>.<type>` or
   `mdblist-liked.<id>.<type>` (type: movie, series or all, as their own MDBList lists are added one by one). */
export const likedList = (id: string) => /^(trakt|mdblist)-liked\./.test(id);
const MDB = /^mdblist-(mine|liked)\.(\d{1,12})\.(movie|series|all)$/;
/* The MDBList list a shelf id stands for, and the kind of title it holds. null for a Trakt list. */
export const mdbOf = (id: string) => {const got = MDB.exec(id); return got ? {list: got[2], type: got[3]} : null;};
/* One of their lists as Add row offers it (api.ts, ownLists), as the shelf knows it. */
export const shelfId = (list: {id: string; source: string}) => /^trakt-(mine|liked)\./.test(list.id) ? list.id : /^mdblist\.\d{1,12}\.(movie|series|all)$/.test(list.id) ? list.id.replace(/^mdblist/, list.source === 'MDBList · liked' ? 'mdblist-liked' : 'mdblist-mine') : '';
/* The first `most` of two lots, the first lot first, with up to half kept for the second, so many of one never leave the other out. */
const share = <T>(first: T[], second: T[], most: number): T[] => {
  const others = Math.min(second.length, Math.max(most - first.length, Math.floor(most / 2)));
  return [...first.slice(0, most - others), ...second.slice(0, others)];
};
/* Which of their lists the two rows hold, from all of them in each account's own order: their own first, with up to half of
   MOST kept for the ones they liked; and within each, Trakt's first, with up to half kept for MDBList's. */
export function shelved<T extends {id: string}>(lists: T[]): T[] {
  const of = (liked: boolean, from: string) => lists.filter(list => likedList(list.id) === liked && list.id.startsWith(from));
  const mine = [...of(false, 'trakt-'), ...of(false, 'mdblist-')], liked = [...of(true, 'trakt-'), ...of(true, 'mdblist-')], others = Math.min(liked.length, Math.max(MOST - mine.length, MOST / 2));
  return [...share(of(false, 'trakt-'), of(false, 'mdblist-'), MOST - others), ...share(of(true, 'trakt-'), of(true, 'mdblist-'), others)];
}
/* The lists a row holds, of those kept. */
export const shelfOn = (row: string, shelf: Shelf[]) => shelf.filter(list => likedList(list.id) === (row === LIKED_ROW));
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

/* Lists as MDBList gives them (a bare array from /lists/user; {lists: [...]} from /lists/liked), each with the kind of title it
   holds: `mediatype` movie or show, else both. null when the answer is neither shape. */
export interface MdbList {id: number; name: string; items: number; type: 'movie' | 'series' | 'all'}
export function mdbLists(body: unknown): MdbList[] | null {
  const all = Array.isArray(body) ? body : Array.isArray((body as {lists?: unknown} | null)?.lists) ? (body as {lists: unknown[]}).lists : null;
  return all && (all as {id?: number; name?: string; items?: number; mediatype?: string | null}[]).filter(list => Number.isInteger(list.id) && Number(list.id) > 0)
    .map(list => ({id: Number(list.id), name: String(list.name ?? 'A list').slice(0, 80), items: Number(list.items) || 0, type: list.mediatype === 'movie' ? 'movie' : list.mediatype === 'show' ? 'series' : 'all'}));
}
/* An MDBList list's best-known title, as a TMDB path: the first of the list sorted by votes on IMDb. MDBList gives a film or
   show by its TMDB id (`id`, or `ids.tmdb`), as one list (asked for with unified=true) or split into movies and shows. '' for
   a list with none; null when MDBList did not answer. */
type MdbItem = {id?: number; mediatype?: string; ids?: {tmdb?: number | null}};
async function mdbBest(ask: ReturnType<typeof mdblist>, list: string): Promise<string | null> {
  const got = await ask(`/lists/${list}/items?limit=1&sort=imdbvotes&order=desc&unified=true`), body = got.body as MdbItem[] | {movies?: MdbItem[]; shows?: MdbItem[]} | null;
  if (got.status !== 200 || !body) return null;
  const [item, show] = Array.isArray(body) ? [body[0], body[0]?.mediatype === 'show'] : body.movies?.[0] ? [body.movies[0], false] : [body.shows?.[0], true], id = Number(item?.ids?.tmdb ?? item?.id);
  return id > 0 ? `${show ? 'tv' : 'movie'}/${id}` : '';
}

/* Their lists and pictures, worked out again, from each account they have. `ok`: every account asked answered. One that did
   not keeps the lists it had, as they were, and is asked again in an hour; the other is worked out all the same. Someone with
   neither account has no lists. */
export async function shelfOf(env: Env, hub: string, person: string, before: Shelf[]): Promise<{shelf: Shelf[]; ok: boolean}> {
  const link = env.TRAKT_CLIENT_ID ? await getSecret<{again?: boolean}>(env, hub, person, LINK) : null, own = (await getSecret<{key?: string}>(env, hub, person, 'mdblist'))?.key ?? '';
  // `first`: the list's best-known title as a TMDB path; null when its account did not answer for it. `kept`: a list left as it was.
  const name = (text: unknown) => String(text ?? 'A list').slice(0, 80), lists: {id: string; title: string; first?: () => Promise<string | null>; kept?: Shelf}[] = [];
  let ok = true;
  // Trakt wanting them to sign in again is not a failure to try again within the hour (each try would ask MDBList for
  // everything again, out of their own daily allowance): the Trakt lists kept stay as they were until they have.
  if (link?.again) {for (const list of before) if (list.id.startsWith('trakt-')) lists.push({id: list.id, title: list.title, kept: list});}
  else if (link) {
    const mine = await read<TraktList[]>(env, hub, person, '/users/me/lists'), liked = Array.isArray(mine) ? await read<{list?: TraktList}[]>(env, hub, person, '/users/likes/lists?limit=50') : null;
    if (Array.isArray(mine) && Array.isArray(liked)) {
      // Its best-known film or show (a person on a list has no picture; the earlier of two as well known).
      const best = (ask: string) => async () => {const items = await read<Listed[]>(env, hub, person, ask); return Array.isArray(items) ? bestOf(items) : null;};
      for (const list of mine) if (Number.isInteger(list.ids?.trakt)) lists.push({id: `trakt-mine.${list.ids!.trakt}`, title: name(list.name), first: best(`/users/me/lists/${list.ids!.trakt}/items?limit=100&extended=full`)});
      for (const like of liked) {
        const id = like.list?.ids?.trakt;
        if (Number.isInteger(id) && !lists.some(list => list.id.endsWith(`.${id}`))) lists.push({id: `trakt-liked.${id}`, title: name(like.list!.name), first: best(`/lists/${id}/items?limit=100&extended=full`)});
      }
    } else {ok = false; for (const list of before) if (list.id.startsWith('trakt-')) lists.push({id: list.id, title: list.title, kept: list});}
  }
  if (own) {
    // With their own key only. The lists they liked are asked for apart: when only that fails, the ones kept stay as they were.
    const ask = mdblist(env, own), mine = await ask('/lists/user'), theirs = mine.status === 200 ? mdbLists(mine.body) : null;
    if (theirs) {
      const liked = await ask('/lists/liked?limit=50'), those = liked.status === 200 ? mdbLists(liked.body) : null;
      for (const list of theirs) lists.push({id: `mdblist-mine.${list.id}.${list.type}`, title: list.name, first: () => mdbBest(ask, String(list.id))});
      if (those) {for (const list of those) if (!theirs.some(mine => mine.id === list.id)) lists.push({id: `mdblist-liked.${list.id}.${list.type}`, title: list.name, first: () => mdbBest(ask, String(list.id))});}
      else for (const list of before) if (list.id.startsWith('mdblist-liked.')) lists.push({id: list.id, title: list.title, kept: list});
    } else {ok = false; for (const list of before) if (list.id.startsWith('mdblist-')) lists.push({id: list.id, title: list.title, kept: list});}
  }
  const key = await getSecret<string>(env, hub, HUB, 'key:tmdb'), had = new Map(before.map(item => [item.id, item])), out: Shelf[] = [];
  for (const list of shelved(lists)) {
    if (list.kept) {out.push(list.kept); continue;}
    // A list its account did not answer for keeps what it had.
    const kept = had.get(list.id), first = await list.first!() ?? kept?.first ?? '';
    const cover = kept && kept.first === first && kept.cover ? kept.cover : first && key ? await backdrop(env, key, first) : '';
    out.push({id: list.id, title: list.title, first, cover});
  }
  return {shelf: out, ok};
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
   When Trakt or MDBList does not answer it is tried again in an hour. */
export async function refreshShelf(env: Env, people: {hub: string; id: string; data: string}[], flag: (hub: string) => D1PreparedStatement): Promise<boolean> {
  const kept = await env.DB.prepare('SELECT hub, person, at, items FROM rows_cache WHERE kind = ?').bind(SHELF).all<{hub: string; person: string; at: number; items: string}>();
  const held = new Map(kept.results.map(row => [`${row.hub}/${row.person}`, row])), time = now();
  const next = people.find(row => {
    let rows: {id: string; on: boolean}[] | null = null; try {rows = (JSON.parse(row.data) as {rows?: {id: string; on: boolean}[] | null}).rows ?? null;} catch {rows = null;}
    return wantsShelf(rows) && time - (held.get(`${row.hub}/${row.id}`)?.at ?? 0) >= DAY;
  });
  if (!next) return false;
  const before = shelfFrom(held.get(`${next.hub}/${next.id}`)?.items), got = await shelfOf(env, next.hub, next.id, before).catch(() => null);
  const shelf = got?.shelf ?? before, changed = !!got && JSON.stringify(got.shelf) !== JSON.stringify(before);
  await env.DB.batch([env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items')
    .bind(next.hub, next.id, SHELF, got?.ok ? time : time - DAY + RETRY, JSON.stringify(shelf)), ...(changed ? [flag(next.hub)] : [])]);
  return true;
}
