/* A person's own rows (their watchlist, what they watched lately, recommendations, what's next and what's new), served by the
   hub itself from its own Trakt connection (trakt.ts) and their own MDBList key, as a small Stremio addon that only lists titles. Their AIOMetadata setup reads it as imported catalogs and fills in
   the rest itself (details, art, ratings, the content limit), so AIOMetadata needs no Trakt connection of its own.
   The address carries a random token per person. The token is kept in the vault; only its hash is kept here to find whose it is.
   Answers are kept in the database for a few minutes, and AIOMetadata keeps them as long again, so Trakt is asked rarely. While
   Trakt is not answering (it turns away the shared addresses Workers call from for a while at times), a row shows the last list
   Trakt gave rather than nothing. MDBList is read the same way, on demand only, and kept as long.
   Recently Watched is one row whose source is picked each time it is asked for: their Trakt when it is connected to the hub (the
   fullest record), else their MDBList, else what they played here (the plays table). Its address stays the same either way.
   With Trakt connected and their Trakt sync off, Trakt does not hear of what they watch here, so what they finished or ticked
   here joins Trakt's history in the row (recent, below); with sync on it is Trakt's history alone, which then has both.
   The Watchlist is one row too: Trakt's, MDBList's, or both as one list. Recommended is Trakt's, or else worked out ahead from
   what they watched (recs.ts). */
import type {Env} from './util';
import {FINISHED, getSecret, newToken, now, putSecret, sha} from './util';
import {LINK, read, syncOn} from './trakt';
import {mdblist} from './carry';
import {unpacked} from './here';
import {FOR_YOU_SERVED, served as forYouServed} from './foryou';
import {recommendedOf} from './recs';

export const ROWS = 'rows';
const MANIFEST = 'aiohub.rows', PAGE = 20;
type Kind = 'watchlist' | 'movies' | 'shows' | 'next' | 'fresh' | 'history' | 'list' | 'mdb_watchlist' | 'mdb_history';
// `ask` and `cache`: for one of their own Trakt lists, where Trakt has it and what it is kept as here (by list).
interface Served {id: string; type: 'movie' | 'series' | 'all'; name: string; ttl: number; kind: Kind; ask?: string; cache?: string}
// Each Home row the hub can serve, by the site's row id. Names are only defaults; the person's own row titles are what AIOMetadata shows.
// AIOMetadata leaves watched titles in any row whose id says watchlist, up next or history, as it does with its own Trakt rows.
// New for you says upnext for that: a show they are part way through is what it is for.
export const SERVED: Record<string, Served> = {
  'watchlist': {id: 'watchlist', type: 'all', name: 'Watchlist', ttl: 600, kind: 'watchlist'},
  'recently-watched': {id: 'history', type: 'all', name: 'Recently Watched', ttl: 300, kind: 'history'},
  'recommended-movies': {id: 'recommended', type: 'movie', name: 'Recommended Movies', ttl: 900, kind: 'movies'},
  'recommended-series': {id: 'recommended', type: 'series', name: 'Recommended Shows', ttl: 900, kind: 'shows'},
  'up-next': {id: 'up_next', type: 'series', name: 'Up Next', ttl: 300, kind: 'next'},
  'new-for-you': {id: 'upnext_new', type: 'all', name: 'New for you', ttl: 900, kind: 'fresh'},
};
// Their MDBList watchlist on its own: one side of the Watchlist, kept apart from Trakt's pages.
const MDB_WATCHLIST: Served = {id: 'mdblist_watchlist', type: 'all', name: 'Watchlist', ttl: 600, kind: 'mdb_watchlist'};
/* Addresses from before the MDBList watchlist joined the Watchlist and Recently Aired became New for you (its shows). A setup
   asks for them until it is next brought in step, so they still answer; no manifest lists them. */
const BEFORE: Record<string, Served> = {'all/mdblist_watchlist': MDB_WATCHLIST, 'series/recently_aired': {...SERVED['new-for-you'], id: 'recently_aired', type: 'series'}};
/* One of the person's own Trakt lists, or one they liked, as a row: `trakt-mine.<Trakt list id>` or `trakt-liked.<id>`. Their own
   are read through their login, so a private list works too; a liked list is someone else's public one. In list order. */
export const LIST_ROW = /^trakt-(mine|liked)\.(\d{1,12})$/;
const listServed = (whose: string, id: string): Served => ({id: `list_${whose}_${id}`, type: 'all', name: 'Trakt list', ttl: 900, kind: 'list', cache: `list_${whose}_${id}`,
  ask: whose === 'mine' ? `/users/me/lists/${id}/items?limit=100` : `/lists/${id}/items?limit=100`});
/* Whether the hub fills a row for someone, with their Trakt connected to it (`trakt`) or their MDBList key kept (`lists`): everyone
   has a Recently Watched and the Recommended rows, and the Watchlist needs either account. */
export const fills = (rowId: string, has: {trakt: boolean; lists: boolean}) => has.trakt || rowId === 'recently-watched' || rowId === 'recommended-movies' || rowId === 'recommended-series' || (rowId === 'watchlist' && has.lists);
/* A For you pick the hub fills itself (foryou.ts). Its catalog id carries what fills it, so a row's name and its titles always
   come from the same write of the setup. */
export const forYouRow = (id: string, type: string): Served | undefined => FOR_YOU_SERVED.test(id) && (type === 'movie' || type === 'series') ? {id, type, name: 'For you', ttl: 3600, kind: 'history'} : undefined;
/* What the hub serves for a Home row, if it does. */
export function servedOf(rowId: string): Served | undefined {
  const list = LIST_ROW.exec(rowId);
  return list ? listServed(list[1], list[2]) : SERVED[rowId];
}
/* The id AIOMetadata gives a catalog imported from another addon: custom.<addon id>.<type>.<catalog id>, anything else as _. */
export const customId = (row: Served) => `custom.${MANIFEST.replace(/[^a-zA-Z0-9]/g, '_')}.${row.type}.${row.id}`;
export const CUSTOM = new RegExp(`^custom\\.${MANIFEST.replace(/[^a-zA-Z0-9]/g, '_')}\\.`);
/* One row as AIOMetadata stores an imported catalog (the shape its own import makes), here kept on a short cache time. */
export const catalogOf = (address: string, rowId: string, name: string, on: boolean) => catalogFor(address, servedOf(rowId)!, name, on);
export function catalogFor(address: string, row: Served, name: string, on: boolean) {
  return {id: customId(row), type: row.type, name, enabled: on, showInHome: true, source: 'custom', sourceUrl: `${address}/catalog/${row.type}/${row.id}.json`,
    genres: ['None'], cacheTTL: row.ttl, enableRatingPosters: true, manifestData: {type: row.type, id: row.id, name, extra: [{name: 'skip'}], idPrefixes: ['tt', 'tmdb']}};
}

/* A person's rows address, made once and kept: the same address every time, so a sync with nothing changed sends nothing. */
export async function addressOf(env: Env, hub: string, person: string, origin: string, kept: string | null) {
  if (kept) return {address: `${origin}/api/rows/${kept}`, writes: []};
  const token = newToken('r');
  return {address: `${origin}/api/rows/${token}`, writes: [await putSecret(env, hub, person, ROWS, token), env.DB.prepare('INSERT INTO rows_keys (id, hub, person) VALUES (?, ?, ?)').bind(await sha(token), hub, person)]};
}

/* ---------- reading Trakt ---------- */
// `tmdb` and `at` (when it was watched, for what was watched) are kept for For you (foryou.ts); a row lists only id, type and name.
export interface Item {id: string; type: 'movie' | 'series'; name: string; tmdb?: number; at?: number}
interface Media {title?: string; ids?: {imdb?: string | null; tmdb?: number | null}}
const itemOf = (media: Media | undefined, type: Item['type'], when?: string): Item | null => {
  const ids = media?.ids ?? {}, id = /^tt\d+$/.test(ids.imdb ?? '') ? ids.imdb! : Number(ids.tmdb) > 0 ? `tmdb:${ids.tmdb}` : '', at = Math.floor(Date.parse(when ?? '') / 1000);
  return id ? {id, type, name: String(media?.title ?? '').slice(0, 200), ...(Number(ids.tmdb) > 0 ? {tmdb: Number(ids.tmdb)} : {}), ...(at > 0 ? {at} : {})} : null;
};
const once = (items: (Item | null)[]) => {const seen = new Set<string>(); return items.filter((item): item is Item => !!item && !seen.has(item.id) && !!seen.add(item.id));};
// Long lists are read a hundred at a time, a further page only once someone scrolls that far, up to this many pages.
const PAGES: Partial<Record<Kind, number>> = {watchlist: 10, history: 10, list: 10, mdb_watchlist: 10};
const ASK: Record<Exclude<Kind, 'list' | 'fresh' | 'mdb_watchlist' | 'mdb_history'>, string> = {
  // Newest first, as AIOMetadata's own Trakt watchlist row was set up. An episode or season on the list stands for its show.
  watchlist: '/sync/watchlist/all/added/desc?limit=100',
  // What was watched, newest first: a show once, where its latest episode puts it.
  history: '/sync/history?limit=100',
  // Titles already on the watchlist or in the collection are left out: the watchlist has its own row.
  movies: '/recommendations/movies?limit=50&ignore_collected=true&ignore_watchlisted=true',
  shows: '/recommendations/shows?limit=50&ignore_collected=true&ignore_watchlisted=true',
  // Shows with an episode still to watch, the ones watched most lately first.
  next: '/sync/progress/up_next?page=1&limit=50',
};
// `at`: when it was watched, or for a watchlist when it was added.
type Answer = (Media & {type?: string; movie?: Media; show?: Media; watched_at?: string; listed_at?: string})[];
const titles = (got: Answer) => once(got.map(entry => entry.type === 'movie' ? itemOf(entry.movie, 'movie', entry.watched_at ?? entry.listed_at) : itemOf(entry.show, 'series', entry.watched_at ?? entry.listed_at)));
const ITEMS: Record<Exclude<Kind, 'fresh' | 'mdb_watchlist' | 'mdb_history'>, (got: Answer) => Item[]> = {
  watchlist: titles, history: titles, list: titles,
  movies: got => once(got.map(media => itemOf(media, 'movie'))),
  shows: got => once(got.map(media => itemOf(media, 'series'))),
  next: got => once(got.map(entry => itemOf(entry.show, 'series'))),
};
const RETRY = 60, READS = 4;
interface Held {at: number; items: Item[]}
/* The first `want` titles of a row (the whole of a short one), from what was read lately; Trakt is asked for a page only when it is
   needed and what was kept of it is older than the row's time. Each page is kept on its own: `watchlist`, `watchlist.2`, …
   `told`, when given, hears whether what came back is the whole list (every page of it kept, up to the empty page that ends
   it), and how many pages were asked for just now. */
async function itemsOf(env: Env, hub: string, person: string, row: Served, want: number, key = '', told?: {whole: boolean; reads: number}): Promise<Item[]> {
  const base = row.cache ?? row.kind, most = PAGES[row.kind] ?? 1, kinds = Array.from({length: most}, (_, n) => n ? `${base}.${n + 1}` : base);
  const stored = await env.DB.prepare(`SELECT kind, at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (${kinds.map(() => '?').join(', ')})`).bind(hub, person, ...kinds).all<{kind: string; at: number; items: string}>();
  const held = new Map(stored.results.map(page => [page.kind, {at: page.at, items: JSON.parse(page.items) as Item[]}])), out: Item[] = [], seen = new Set<string>();
  let reads = READS;
  for (let n = 0; n < most && (!n || out.length < want); n++) {
    let page = held.get(kinds[n]), failed = false;
    // An empty page after the first marks the end of the list. It stays until the page before it is read again.
    if (!page || (now() - page.at >= row.ttl && (!n || page.items.length))) {
      if (!reads--) break;
      if (told) told.reads++;
      const got = await readPage(env, hub, person, row, n + 1, kinds, page, key);
      if (!got) break;
      page = got; failed = !got.ok; if (got.end) held.set(kinds[n + 1], {at: got.at, items: []});
    }
    for (const item of page.items) if (!seen.has(item.id)) {seen.add(item.id); out.push(item);}
    // Past an empty page, or one Trakt did not answer for just now, nothing more is asked this time.
    // An empty page after the first is the list's end (an empty first page may be a read that failed: never taken as the whole).
    // A list longer than every page kept is never whole either.
    if (told && !failed && n > 0 && !page.items.length) told.whole = true;
    if (!page.items.length || failed) break;
  }
  return out;
}
/* One page from Trakt or MDBList, kept. When it does not answer: the last it gave, however old, kept to ask again in a minute rather
   than on every scroll; null for a further page never read. */
async function readPage(env: Env, hub: string, person: string, row: Served, page: number, kinds: string[], last?: Held, key = ''): Promise<Held & {ok: boolean; end: boolean} | null> {
  const next = kinds[page], got = await fetchPage(env, hub, person, row, page, key);
  if (!got && page > 1 && !last) return null;
  const ok = !!got, at = ok ? now() : now() - row.ttl + RETRY, items = got ? got.items : last?.items ?? [];
  const keep = (kind: string, list: Item[]) => env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items')
    .bind(hub, person, kind, at, JSON.stringify(list));
  // The last page: an empty one is kept after it. Otherwise any such end after it goes, so the list can grow.
  const end = ok && !!next && !!items.length && got!.end;
  const after = !ok || !next ? [] : end ? [keep(next, [])] : [env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = ? AND items = '[]'").bind(hub, person, next)];
  await env.DB.batch([keep(kinds[page - 1], items), ...after]);
  return {at, items, ok, end};
}
/* A page as its service gives it: the titles, and whether it is the last. null when it did not answer. */
async function fetchPage(env: Env, hub: string, person: string, row: Served, page: number, key: string): Promise<{items: Item[]; end: boolean} | null> {
  if (row.kind === 'mdb_watchlist' || row.kind === 'mdb_history') return key ? fromMdblist(env, key, row.kind, page) : null;
  const paging = {pages: 0}, paged = !!PAGES[row.kind];
  const ask = row.ask ?? ASK[row.kind as keyof typeof ASK], got = await read<Answer>(env, hub, person, paged ? `${ask}&page=${page}` : ask, paging);
  if (!Array.isArray(got)) return null;
  // Trakt says this is its last page.
  return {items: ITEMS[row.kind as keyof typeof ITEMS](got), end: paging.pages > 0 && page >= paging.pages};
}

/* ---------- reading MDBList, with the person's own key ---------- */
// `watchlist_at`: when it was added to the watchlist, where MDBList says (merged, below, does without it).
interface Listed {id?: number; mediatype?: string; imdb_id?: string | null; title?: string; ids?: {imdb?: string | null; tmdb?: number | null}; watchlist_at?: string; added_at?: string}
interface Watched {last_watched_at?: string; movie?: Media; show?: Media; episode?: {show?: Media}}
const MDB_PAGE = 100, MDB_KEPT = 300;
/* Their watchlist, newest added first, a hundred at a time (a page short of that is the last); or what they watched, newest first,
   a show once where its latest episode puts it. MDBList lists what was watched by kind, so it is read in one go and put in order here. */
async function fromMdblist(env: Env, key: string, kind: 'mdb_watchlist' | 'mdb_history', page: number): Promise<{items: Item[]; end: boolean} | null> {
  const ask = mdblist(env, key);
  if (kind === 'mdb_watchlist') {
    const got = await ask(`/watchlist/items?unified=true&sort=added&order=desc&limit=${MDB_PAGE}&offset=${(page - 1) * MDB_PAGE}`), body = got.body as Listed[] | {movies?: Listed[]; shows?: Listed[]} | null;
    if (got.status !== 200 || !body) return null;
    const list = Array.isArray(body) ? body : [...(body.movies ?? []), ...(body.shows ?? [])];
    return {items: once(list.map(item => itemOf({title: item.title, ids: {imdb: item.ids?.imdb ?? item.imdb_id, tmdb: item.ids?.tmdb ?? item.id}}, item.mediatype === 'movie' ? 'movie' : 'series', item.watchlist_at ?? item.added_at))), end: list.length < MDB_PAGE};
  }
  const got = await ask('/sync/watched?limit=1000'), body = got.body as {movies?: Watched[]; shows?: Watched[]; episodes?: Watched[]} | null;
  if (got.status !== 200 || !body || Array.isArray(body)) return null;
  const all = [...(body.movies ?? []).map(entry => ({at: entry.last_watched_at, item: itemOf(entry.movie, 'movie', entry.last_watched_at)})), ...(body.shows ?? []).map(entry => ({at: entry.last_watched_at, item: itemOf(entry.show, 'series', entry.last_watched_at)})),
    ...(body.episodes ?? []).map(entry => ({at: entry.last_watched_at, item: itemOf(entry.episode?.show, 'series', entry.last_watched_at)}))];
  const when = (at?: string) => Date.parse(at ?? '') || 0;
  return {items: once(all.sort((a, b) => when(b.at) - when(a.at)).map(entry => entry.item)).slice(0, MDB_KEPT), end: true};
}

/* ---------- what they played here ---------- */
/* Newest first, a show once. A title is known by what Trakt was told it is, or else by its id on their own server, which carries
   its IMDb or TMDB id (here.ts); a play on any other server that Trakt was never told about is left out. */
export async function played(env: Env, hub: string, person: string, done = false): Promise<Item[]> {
  // `done`: only what was finished (played to 90% or more, as Activity says finished; util.ts, FINISHED, for a file that runs longer than listed) or ticked as watched in an app.
  const got = await env.DB.prepare(`SELECT item, ids, title, updated FROM plays WHERE hub = ?1 AND person = ?2${done ? ` AND (${FINISHED}
    OR EXISTS (SELECT 1 FROM sittings s WHERE s.hub = plays.hub AND s.person = plays.person AND s.item = plays.item AND s.parts LIKE '%marked%'))` : ''} ORDER BY updated DESC LIMIT 300`).bind(hub, person).all<{item: string; ids: string | null; title: string; updated: number}>();
  return once(got.results.map(play => {
    let target: {movie?: Media; show?: Media} | null = null;
    try {target = play.ids ? JSON.parse(play.ids) : null;} catch {target = null;}
    const told = target?.movie || target?.show ? itemOf({...(target.movie ?? target.show), title: play.title}, target.movie ? 'movie' : 'series') : null;
    if (told) return {...told, at: play.updated};
    if (target?.movie || target?.show) return null;
    const known = unpacked(play.item), tmdb = /^tmdb:(\d+)$/.exec(known?.id ?? '');
    return known ? {...known, name: play.title.slice(0, 200), ...(tmdb ? {tmdb: Number(tmdb[1])} : {}), at: play.updated} : null;
  }));
}
/* Recently Watched for someone whose Trakt is connected while their Trakt sync is off: Trakt's history and what they finished or
   ticked here as one list, newest first, each title once (a show once, where its latest episode puts it; a title in both by
   whichever is later). Trakt names a title by its IMDb id and a play here sometimes only by TMDB's, so both count. */
function recent(theirs: Item[], here: Item[]): Item[] {
  const seen = new Set<string>(), out: Item[] = [];
  for (const item of [...theirs, ...here].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) {const keys = keysOf(item); if (keys.some(key => seen.has(key))) continue; for (const key of keys) seen.add(key); out.push(item);}
  return out;
}
/* What a person watched, newest first, from what was read of their accounts and their plays here. `fresh`: Recently Watched is
   read again first, as far as its first `want` titles, where what was kept of it is older than its time (READS calls at most);
   otherwise only what is kept is used. */
export async function watchedOf(env: Env, hub: string, person: string, fresh: boolean, want = PAGE): Promise<Item[]> {
  const kept = await env.DB.prepare("SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'history' OR kind LIKE 'history.%' OR kind = 'mdb_history' OR kind LIKE 'mdb_history.%') ORDER BY kind").bind(hub, person).all<{items: string}>();
  const lists = [...(fresh ? [await fill(env, hub, person, SERVED['recently-watched'], want)] : []), ...kept.results.map(row => JSON.parse(row.items) as Item[]), await played(env, hub, person)];
  return once(lists.flat()).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/* Shows with an episode still to watch, as Trakt has them (Up Next), when their Trakt is connected to the hub. */
export const upNextOf = (env: Env, hub: string, person: string) => fill(env, hub, person, SERVED['up-next'], 50);
/* What is on their watchlist, read again where what was kept is older than its time (recs.ts leaves these out). */
export const listedOf = (env: Env, hub: string, person: string) => fill(env, hub, person, SERVED.watchlist, 100);

/* Their whole Trakt watchlist, newest added first, for Favorites (hearts.ts): the same kept pages the Watchlist row reads, through
   the same reader. A page is read again here only once it is half an hour old (the row itself reads one again after ten minutes,
   and a heart in an app clears them all), so the cron step asks Trakt for a page at most every half hour per person, and a long
   list (four pages a run at most) is whole again within a few runs rather than never. While Trakt does not answer, the last it
   gave stays. `whole` only when every page is kept up to the list's end and no read of it failed just now: anything less is
   never taken as a title having left. `reads`: the pages asked for just now. */
const HEARTS_TTL = 1800;
export async function traktWatchlist(env: Env, hub: string, person: string): Promise<{items: Item[]; whole: boolean; reads: number}> {
  const told = {whole: false, reads: 0}, items = await itemsOf(env, hub, person, {...SERVED.watchlist, ttl: HEARTS_TTL}, Infinity, '', told);
  return {items, whole: told.whole && items.length > 0, reads: told.reads};
}
/* The kept Watchlist goes, so it is read again the next time it is asked for (a heart in an app just changed it). */
export const forgetWatchlist = (env: Env, hub: string, person: string) => env.DB.prepare("DELETE FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'watchlist' OR kind LIKE 'watchlist.%')").bind(hub, person);

/* ---------- one Watchlist from two ---------- */
/* Trakt's and MDBList's as one list, newest added first, a title on both once. Trakt is the one that knows when a title was
   added: MDBList stamps a title with the moment it arrived there, so a watchlist copied over in one go has hundreds of titles
   sharing one moment, later than anything on Trakt. So:
   - a title on both is Trakt's entry, at Trakt's date (MDBList's copy is dropped before anything is ordered);
   - Trakt's titles keep Trakt's own order;
   - a title only MDBList has is placed among them by its own date (MDBList's watchlist_at), unless more than BULK of MDBList's
     titles share that very date (a bulk import, which says nothing of when each was added): those go after everything dated, in
     MDBList's own order.
   Where some title has no date at all, each list keeps its own order and they take turns, which keeps the newest of both near
   the top. */
const BULK = 5;
function merged(mine: Item[], theirs: Item[]): Item[] {
  // Trakt names a title by its IMDb id and MDBList sometimes only by TMDB's, so both count.
  const held = new Set(mine.flatMap(keysOf)), only = theirs.filter(item => !keysOf(item).some(key => held.has(key)));
  if (![...mine, ...only].every(item => item.at)) return Array.from({length: Math.max(mine.length, only.length)}, (_, n) => [mine[n], only[n]]).flat().filter(Boolean);
  const sharing = new Map<number, number>();
  for (const item of theirs) if (item.at) sharing.set(item.at, (sharing.get(item.at) ?? 0) + 1);
  const bulk = (item: Item) => (sharing.get(item.at!) ?? 0) > BULK, dated = only.filter(item => !bulk(item)).sort((a, b) => b.at! - a.at!), out: Item[] = [];
  // Each dated title of MDBList's goes in just ahead of the first of Trakt's that was added before it.
  let next = 0;
  for (const item of mine) {while (next < dated.length && dated[next].at! > item.at!) out.push(dated[next++]); out.push(item);}
  return [...out, ...dated.slice(next), ...only.filter(bulk)];
}
const keysOf = (item: Item) => [item.id, ...(item.tmdb ? [`${item.type}:${item.tmdb}`] : [])];

/* ---------- New for you ---------- */
/* New episodes of the shows they watch and movies on their watchlist that can be watched at home now, newest first: Trakt's own
   calendars of each for this person (my/shows, which leaves out shows they hid from it, and my/dvd). Trakt gives a calendar about
   a month at a time, so what it gave is kept and added to (by hub and person): a title stays, however long ago it came out,
   until they start it or NEW_MOST newer ones push it out. The first time, and after a long gap, as many months back as BACK
   are read (counted from the last time every calendar asked for answered: `full`). A show is listed once, by its newest
   episode out.
   A title leaves once they started it: STARTED seconds or more of it played here (that episode or a later one, for a show), or
   Trakt has it watched (their plays since the earliest day read, the latest hundred, and up to PLAYS hundreds when more than one
   calendar is read). What left is remembered (`gone`) for as long as a
   calendar could bring it back. Shows they dropped or hid from their progress on Trakt never come (read once a day). */
const NEW = 'new', HIDDEN = 'hidden', NEW_MOST = 50, WINDOW = 33, BACK = 3, PLAYS = 3, STARTED = 120, DAY = 86400;
interface Fresh extends Item {at: number; season?: number; episode?: number}
interface Kept {list: Fresh[]; gone: Record<string, number>; full?: number}
interface Aired {first_aired?: string; released?: string; episode?: {season?: number; number?: number}; show?: Media; movie?: Media}
type Raw = {type?: string; movie?: Media; show?: Media; episode?: {season?: number; number?: number}}[];
// An episode as one number, so "that one or a later one" is a comparison.
const nth = (season = 0, episode = 0) => season * 10000 + episode;
const goneKey = (item: Fresh) => item.type === 'movie' ? item.id : `${item.id}@${nth(item.season, item.episode)}`;
/* What they started: movies, and for each show the latest episode. */
interface Started {movies: Set<string>; shows: Map<string, number>}
const startedIn = (found: Started, item: Fresh) => item.type === 'movie' ? keysOf(item).some(key => found.movies.has(key)) : keysOf(item).some(key => (found.shows.get(key) ?? -1) >= nth(item.season, item.episode));
function note(found: Started, type: Item['type'], ids: {imdb?: string | null; tmdb?: number | null} | undefined, season?: number, episode?: number) {
  const keys = [...(/^tt\d+$/.test(ids?.imdb ?? '') ? [ids!.imdb!] : []), ...(Number(ids?.tmdb) > 0 ? [`tmdb:${ids!.tmdb}`, `${type}:${ids!.tmdb}`] : [])];
  for (const key of keys) if (type === 'movie') found.movies.add(key); else found.shows.set(key, Math.max(found.shows.get(key) ?? -1, nth(season, episode)));
}
/* From what they played here: only a title with STARTED seconds or more played (the parts played, front.ts; a spot it was picked
   up from with no parts noted counts as started before), or ticked as watched. */
function startedHere(plays: {item: string; ids: string | null; detail: string; position: number; parts: string | null}[]): Started {
  const found: Started = {movies: new Set(), shows: new Map()};
  for (const play of plays) {
    const parts = (play.parts ?? '').split(' ').filter(Boolean), spans = parts.map(part => part.split('-').map(Number)).filter(([a, b]) => b > a);
    if (!parts.includes('marked') && (spans.length ? spans.reduce((sum, [a, b]) => sum + b - a, 0) : play.position) < STARTED) continue;
    let target: {movie?: Media; show?: Media; episode?: {season?: number; number?: number}} | null = null;
    try {target = play.ids ? JSON.parse(play.ids) : null;} catch {target = null;}
    const said = /Season (\d+) · Episode (\d+)/.exec(play.detail), known = unpacked(play.item), tmdb = /^tmdb:(\d+)$/.exec(known?.id ?? '');
    if (target?.movie) note(found, 'movie', target.movie.ids);
    else if (target?.show) note(found, 'series', target.show.ids, target.episode?.season ?? Number(said?.[1] ?? 0), target.episode?.number ?? Number(said?.[2] ?? 0));
    else if (known) note(found, known.type, tmdb ? {tmdb: Number(tmdb[1])} : {imdb: known.id}, Number(said?.[1] ?? 0), Number(said?.[2] ?? 0));
  }
  return found;
}
async function freshOf(env: Env, hub: string, person: string, row: Served): Promise<Item[]> {
  const [had, hid, plays] = await env.DB.batch([env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, NEW),
    env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, HIDDEN),
    env.DB.prepare('SELECT item, ids, detail, position, parts FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 300').bind(hub, person)]);
  const before = had.results[0] as {at: number; items: string} | undefined, time = now(), here = startedHere(plays.results as Parameters<typeof startedHere>[0]);
  let kept: Kept = {list: [], gone: {}};
  try {kept = before ? JSON.parse(before.items) as Kept : kept;} catch { /* kept as nothing */ }
  if (before && time - before.at < row.ttl) return kept.list.filter(item => !startedIn(here, item));
  // As many calendars back as the time since the last look needs.
  const months = Math.min(BACK, kept.full ? Math.max(1, Math.ceil((time - kept.full) / (WINDOW * DAY))) : BACK), found = new Map(kept.list.map(item => [item.id, item]));
  let answered = 0;
  for (let n = 0; n < months; n++) {
    const from = new Date((time - ((n + 1) * WINDOW - 1) * DAY) * 1000).toISOString().slice(0, 10);
    const shows = await read<Aired[]>(env, hub, person, `/calendars/my/shows/${from}/${WINDOW}`), movies = Array.isArray(shows) ? await read<Aired[]>(env, hub, person, `/calendars/my/dvd/${from}/${WINDOW}`) : null;
    // Trakt not answering: what was kept stays, and it is asked again in a minute rather than on every look.
    if (!Array.isArray(shows)) break;
    answered++;
    const out = [...shows.map(entry => ({entry, item: itemOf(entry.show, 'series', entry.first_aired)})), ...(Array.isArray(movies) ? movies : []).map(entry => ({entry, item: itemOf(entry.movie, 'movie', entry.released)}))];
    for (const {entry, item} of out) {
      // Only what is out already; a special is not a new episode.
      if (!item?.at || item.at > time || (item.type === 'series' && !(Number(entry.episode?.season) > 0))) continue;
      const fresh: Fresh = {...item, at: item.at, ...(item.type === 'series' ? {season: Number(entry.episode!.season), episode: Number(entry.episode!.number) || 0} : {})};
      if (!found.has(item.id) || found.get(item.id)!.at < fresh.at) found.set(item.id, fresh);
    }
  }
  if (!answered) {
    await store(env, hub, person, NEW, time - row.ttl + RETRY, kept).run();
    return kept.list.filter(item => !startedIn(here, item));
  }
  // What Trakt has them as having watched lately, and the shows they dropped or hid there.
  const there: Started = {movies: new Set(), shows: new Map()}, since = new Date((time - months * WINDOW * DAY) * 1000).toISOString(), paging = {pages: 0};
  for (let page = 1; page <= (months > 1 ? PLAYS : 1); page++) {
    const watched = await read<Raw>(env, hub, person, `/sync/history?start_at=${encodeURIComponent(since)}&limit=100&page=${page}`, paging);
    for (const entry of Array.isArray(watched) ? watched : []) if (entry.type === 'movie') note(there, 'movie', entry.movie?.ids); else note(there, 'series', entry.show?.ids, entry.episode?.season, entry.episode?.number);
    if (!Array.isArray(watched) || page >= paging.pages) break;
  }
  const hidden = new Set((await hiddenOf(env, hub, person, hid.results[0] as {at: number; items: string} | undefined, time)).keys);
  const gone = Object.fromEntries(Object.entries(kept.gone ?? {}).filter(([, at]) => at > time - (BACK * WINDOW + 7) * DAY));
  const list = [...found.values()].filter(item => {
    if (keysOf(item).some(key => hidden.has(key)) || gone[goneKey(item)]) return false;
    if (startedIn(there, item) || startedIn(here, item)) {gone[goneKey(item)] = item.at; return false;}
    return true;
  }).sort((a, b) => b.at - a.at).slice(0, NEW_MOST);
  // Every calendar asked for answered: the next look needs only what came out since. Else the same ones are asked for again.
  await store(env, hub, person, NEW, time, {list, gone, full: answered === months ? time : kept.full}).run();
  return list;
}
const store = (env: Env, hub: string, person: string, kind: string, at: number, value: unknown) => env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items')
  .bind(hub, person, kind, at, JSON.stringify(value));
/* The shows they dropped, or hid from their progress, on Trakt (its two lists of them), by every id a title goes by here. Kept a
   day by hub and person; while Trakt does not answer, what was kept, asked again in an hour. `known`: Trakt has answered at
   some time, so an empty list means none are hidden rather than nobody was asked (kept as null until it has). */
async function hiddenOf(env: Env, hub: string, person: string, had: {at: number; items: string} | undefined, time: number): Promise<{keys: string[]; known: boolean}> {
  let before: string[] | null = null;
  try {before = had ? JSON.parse(had.items) as string[] | null : null;} catch {before = null;}
  if (had && time - had.at < DAY) return {keys: before ?? [], known: !!before};
  const lists = [await read<{show?: Media}[]>(env, hub, person, '/users/hidden/progress_watched?type=show&limit=100'), await read<{show?: Media}[]>(env, hub, person, '/users/hidden/dropped?type=show&limit=100')];
  const got = lists.some(Array.isArray), out = got ? [...new Set(lists.flatMap(list => Array.isArray(list) ? list : []).flatMap(entry => {const item = itemOf(entry.show, 'series'); return item ? keysOf(item) : [];}))] : before;
  await store(env, hub, person, HIDDEN, got ? time : time - DAY + 3600, out).run();
  return {keys: out ?? [], known: !!out};
}
/* The same for sync.ts (Next Up leaves these shows alone), from the list New for you keeps: a show goes by its IMDb id, tmdb:<id>
   and series:<id>. null while it is not known which they are (Trakt never answered about them). */
export async function hiddenShows(env: Env, hub: string, person: string): Promise<Set<string> | null> {
  const had = await env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, HIDDEN).first<{at: number; items: string}>();
  const got = await hiddenOf(env, hub, person, had ?? undefined, now());
  return got.known ? new Set(got.keys) : null;
}

/* ---------- the addon ---------- */
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*'}});
/* /api/rows/<token>/manifest.json and /api/rows/<token>/catalog/<type>/<id>[/skip=N].json. Whose rows they are comes only from the token. */
export async function rows(env: Env, path: string[]): Promise<Response> {
  const [token, what, type, id, extra] = path;
  if (!token) return answer(404, {err: 'Not found'});
  const owner = await env.DB.prepare('SELECT hub, person FROM rows_keys WHERE id = ?').bind(await sha(token)).first<{hub: string; person: string}>();
  if (!owner) return answer(404, {err: 'Not found'});
  if (what === 'manifest.json' && !type) return answer(200, {id: MANIFEST, version: '1.0.0', name: 'AIOHub rows', description: 'Your watchlist, what you watched lately, recommendations, what’s next and what’s new, from the hub.',
    resources: ['catalog'], types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'], catalogs: Object.values(SERVED).map(row => ({type: row.type, id: row.id, name: row.name, extra: [{name: 'skip'}]}))});
  const name = (extra ?? id ?? '').replace(/\.json$/, ''), catalog = extra ? id : name;
  const list = /^list_(mine|liked)_(\d{1,12})$/.exec(catalog ?? '');
  const mine = what === 'catalog' && forYouRow(catalog ?? '', type ?? '');
  const row = what !== 'catalog' ? undefined : list ? (type === 'all' ? listServed(list[1], list[2]) : undefined) : mine || Object.values(SERVED).find(item => item.type === type && item.id === catalog) || BEFORE[`${type}/${catalog}`];
  if (!row) return answer(404, {err: 'Not found'});
  const skip = Math.max(0, Number(new URLSearchParams(extra ? name : '').get('skip') ?? 0) || 0);
  const all = mine ? await forYouServed(env, owner.hub, owner.person, row.id, row.type as 'movie' | 'series') : await fill(env, owner.hub, owner.person, row, skip + PAGE);
  // A row of one type lists only that type (the address from before for New for you's shows).
  const items = row.type === 'all' ? all : all.filter(item => item.type === row.type);
  return answer(200, {metas: items.slice(skip, skip + PAGE).map(item => ({id: item.id, type: item.type, name: item.name}))});
}
/* A row's titles, from this person's own accounts only. Trakt disconnected from the hub, or MDBList's key removed: nothing of
   theirs, even if it was read a moment ago. Never an error, which AIOMetadata would keep. */
async function fill(env: Env, hub: string, person: string, row: Served, want: number): Promise<Item[]> {
  const link = env.TRAKT_CLIENT_ID ? await getSecret<{again?: boolean}>(env, hub, person, LINK) : null;
  // Recommended: Trakt's when it is connected, as far as their content limit lets it through; else what was worked out for them (recs.ts).
  if (row.kind === 'movies' || row.kind === 'shows') return recommendedOf(env, hub, person, row.type as 'movie' | 'series', link ? await itemsOf(env, hub, person, row, want) : []);
  if (row.kind === 'fresh') return link ? freshOf(env, hub, person, row) : [];
  if (row.kind === 'next' || row.kind === 'list') return link ? itemsOf(env, hub, person, row, want) : [];
  if (row.kind === 'history' && link && !link.again) {
    // With their Trakt sync off, plays made here never reach Trakt: they join the row here instead (recent, above).
    const theirs = await itemsOf(env, hub, person, row, want);
    return await syncOn(env, hub, person) ? theirs : recent(theirs, await played(env, hub, person, true));
  }
  const key = (await getSecret<{key?: string}>(env, hub, person, 'mdblist'))?.key ?? '';
  if (row.kind === 'mdb_watchlist') return key ? itemsOf(env, hub, person, row, want, key) : [];
  // The Watchlist: Trakt's, MDBList's, or both as one.
  if (row.kind === 'watchlist') {
    const mine = link ? await itemsOf(env, hub, person, row, want) : [], theirs = key ? await itemsOf(env, hub, person, MDB_WATCHLIST, want, key) : [];
    return mine.length && theirs.length ? merged(mine, theirs) : mine.length ? mine : theirs;
  }
  // Recently Watched without Trakt: their MDBList, kept apart from Trakt's pages, else what they played here.
  return key ? itemsOf(env, hub, person, {...row, kind: 'mdb_history'}, want, key) : played(env, hub, person);
}
