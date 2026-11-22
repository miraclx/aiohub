/* A person's own rows (their Trakt and MDBList watchlists, what they watched lately, recommendations, what's next), served by the
   hub itself from its own Trakt connection (trakt.ts) and their own MDBList key, as a small Stremio addon that only lists titles. Their AIOMetadata setup reads it as imported catalogs and fills in
   the rest itself (details, art, ratings, the content limit), so AIOMetadata needs no Trakt connection of its own.
   The address carries a random token per person. The token is kept in the vault; only its hash is kept here to find whose it is.
   Answers are kept in the database for a few minutes, and AIOMetadata keeps them as long again, so Trakt is asked rarely. While
   Trakt is not answering (it turns away the shared addresses Workers call from for a while at times), a row shows the last list
   Trakt gave rather than nothing. MDBList is read the same way, on demand only, and kept as long.
   Recently Watched is one row whose source is picked each time it is asked for: their Trakt when it is connected to the hub (the
   fullest record), else their MDBList, else what they played here (the plays table). Its address stays the same either way. */
import type {Env} from './util';
import {getSecret, newToken, now, putSecret, sha} from './util';
import {LINK, read} from './trakt';
import {mdblist} from './carry';
import {unpacked} from './here';
import {FOR_YOU_SERVED, served as forYouServed} from './foryou';

export const ROWS = 'rows';
const MANIFEST = 'aiohub.rows', PAGE = 20;
type Kind = 'watchlist' | 'movies' | 'shows' | 'next' | 'aired' | 'history' | 'list' | 'mdb_watchlist' | 'mdb_history';
// `ask` and `cache`: for one of their own Trakt lists, where Trakt has it and what it is kept as here (by list).
interface Served {id: string; type: 'movie' | 'series' | 'all'; name: string; ttl: number; kind: Kind; ask?: string; cache?: string}
// Each Home row the hub can serve, by the site's row id. Names are only defaults; the person's own row titles are what AIOMetadata shows.
// AIOMetadata leaves watched titles in any row whose id says watchlist, up next or history, as it does with its own Trakt rows.
export const SERVED: Record<string, Served> = {
  'watchlist': {id: 'watchlist', type: 'all', name: 'Watchlist', ttl: 600, kind: 'watchlist'},
  'mdblist-watchlist': {id: 'mdblist_watchlist', type: 'all', name: 'Watchlist', ttl: 600, kind: 'mdb_watchlist'},
  'recently-watched': {id: 'history', type: 'all', name: 'Recently Watched', ttl: 300, kind: 'history'},
  'recommended-movies': {id: 'recommended', type: 'movie', name: 'Recommended Movies', ttl: 900, kind: 'movies'},
  'recommended-series': {id: 'recommended', type: 'series', name: 'Recommended Shows', ttl: 900, kind: 'shows'},
  'up-next': {id: 'up_next', type: 'series', name: 'Up Next', ttl: 300, kind: 'next'},
  'recently-aired': {id: 'recently_aired', type: 'series', name: 'Recently Aired for You', ttl: 300, kind: 'aired'},
};
/* One of the person's own Trakt lists, or one they liked, as a row: `trakt-mine.<Trakt list id>` or `trakt-liked.<id>`. Their own
   are read through their login, so a private list works too; a liked list is someone else's public one. In list order. */
export const LIST_ROW = /^trakt-(mine|liked)\.(\d{1,12})$/;
const listServed = (whose: string, id: string): Served => ({id: `list_${whose}_${id}`, type: 'all', name: 'Trakt list', ttl: 900, kind: 'list', cache: `list_${whose}_${id}`,
  ask: whose === 'mine' ? `/users/me/lists/${id}/items?limit=100` : `/lists/${id}/items?limit=100`});
/* The rows the hub serves without Trakt: everyone has a Recently Watched, and the MDBList watchlist needs only their MDBList key. */
export const NO_TRAKT = new Set(['recently-watched', 'mdblist-watchlist']);
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
const ASK: Record<Exclude<Kind, 'list' | 'mdb_watchlist' | 'mdb_history'>, string> = {
  // Newest first, as AIOMetadata's own Trakt watchlist row was set up. An episode or season on the list stands for its show.
  watchlist: '/sync/watchlist/all/added/desc?limit=100',
  // What was watched, newest first: a show once, where its latest episode puts it.
  history: '/sync/history?limit=100',
  // Titles already on the watchlist or in the collection are left out: the watchlist has its own row.
  movies: '/recommendations/movies?limit=50&ignore_collected=true&ignore_watchlisted=true',
  shows: '/recommendations/shows?limit=50&ignore_collected=true&ignore_watchlisted=true',
  // Shows with an episode still to watch: the ones watched most lately first, or the ones with the newest episode first.
  next: '/sync/progress/up_next?page=1&limit=50',
  aired: '/sync/progress/up_next?page=1&limit=50&sort_by=recently-aired&sort_how=desc',
};
type Answer = (Media & {type?: string; movie?: Media; show?: Media; watched_at?: string})[];
const titles = (got: Answer) => once(got.map(entry => entry.type === 'movie' ? itemOf(entry.movie, 'movie', entry.watched_at) : itemOf(entry.show, 'series', entry.watched_at)));
const ITEMS: Record<Exclude<Kind, 'mdb_watchlist' | 'mdb_history'>, (got: Answer) => Item[]> = {
  watchlist: titles, history: titles, list: titles,
  movies: got => once(got.map(media => itemOf(media, 'movie'))),
  shows: got => once(got.map(media => itemOf(media, 'series'))),
  next: got => once(got.map(entry => itemOf(entry.show, 'series'))),
  aired: got => once(got.map(entry => itemOf(entry.show, 'series'))),
};
const RETRY = 60, READS = 4;
interface Held {at: number; items: Item[]}
/* The first `want` titles of a row (the whole of a short one), from what was read lately; Trakt is asked for a page only when it is
   needed and what was kept of it is older than the row's time. Each page is kept on its own: `watchlist`, `watchlist.2`, … */
async function itemsOf(env: Env, hub: string, person: string, row: Served, want: number, key = ''): Promise<Item[]> {
  const base = row.cache ?? row.kind, most = PAGES[row.kind] ?? 1, kinds = Array.from({length: most}, (_, n) => n ? `${base}.${n + 1}` : base);
  const stored = await env.DB.prepare(`SELECT kind, at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (${kinds.map(() => '?').join(', ')})`).bind(hub, person, ...kinds).all<{kind: string; at: number; items: string}>();
  const held = new Map(stored.results.map(page => [page.kind, {at: page.at, items: JSON.parse(page.items) as Item[]}])), out: Item[] = [], seen = new Set<string>();
  let reads = READS;
  for (let n = 0; n < most && (!n || out.length < want); n++) {
    let page = held.get(kinds[n]), failed = false;
    // An empty page after the first marks the end of the list. It stays until the page before it is read again.
    if (!page || (now() - page.at >= row.ttl && (!n || page.items.length))) {
      if (!reads--) break;
      const got = await readPage(env, hub, person, row, n + 1, kinds, page, key);
      if (!got) break;
      page = got; failed = !got.ok; if (got.end) held.set(kinds[n + 1], {at: got.at, items: []});
    }
    for (const item of page.items) if (!seen.has(item.id)) {seen.add(item.id); out.push(item);}
    // Past an empty page, or one Trakt did not answer for just now, nothing more is asked this time.
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
interface Listed {id?: number; mediatype?: string; imdb_id?: string | null; title?: string; ids?: {imdb?: string | null; tmdb?: number | null}}
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
    return {items: once(list.map(item => itemOf({title: item.title, ids: {imdb: item.ids?.imdb ?? item.imdb_id, tmdb: item.ids?.tmdb ?? item.id}}, item.mediatype === 'movie' ? 'movie' : 'series'))), end: list.length < MDB_PAGE};
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
export async function played(env: Env, hub: string, person: string): Promise<Item[]> {
  const got = await env.DB.prepare('SELECT item, ids, title, updated FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 300').bind(hub, person).all<{item: string; ids: string | null; title: string; updated: number}>();
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
/* What a person watched, newest first, from what was read of their accounts and their plays here. `fresh`: Recently Watched is
   read again first when what was kept of it is older than its time (one call at most); otherwise only what is kept is used. */
export async function watchedOf(env: Env, hub: string, person: string, fresh: boolean): Promise<Item[]> {
  const kept = await env.DB.prepare("SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'history' OR kind LIKE 'history.%' OR kind = 'mdb_history' OR kind LIKE 'mdb_history.%') ORDER BY kind").bind(hub, person).all<{items: string}>();
  const lists = [...(fresh ? [await fill(env, hub, person, SERVED['recently-watched'], PAGE)] : []), ...kept.results.map(row => JSON.parse(row.items) as Item[]), await played(env, hub, person)];
  return once(lists.flat()).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/* Shows with an episode still to watch, as Trakt has them (Up Next), when their Trakt is connected to the hub. */
export const upNextOf = (env: Env, hub: string, person: string) => fill(env, hub, person, SERVED['up-next'], 50);

/* ---------- the addon ---------- */
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*'}});
/* /api/rows/<token>/manifest.json and /api/rows/<token>/catalog/<type>/<id>[/skip=N].json. Whose rows they are comes only from the token. */
export async function rows(env: Env, path: string[]): Promise<Response> {
  const [token, what, type, id, extra] = path;
  if (!token) return answer(404, {err: 'Not found'});
  const owner = await env.DB.prepare('SELECT hub, person FROM rows_keys WHERE id = ?').bind(await sha(token)).first<{hub: string; person: string}>();
  if (!owner) return answer(404, {err: 'Not found'});
  if (what === 'manifest.json' && !type) return answer(200, {id: MANIFEST, version: '1.0.0', name: 'AIOHub rows', description: 'Your watchlists, what you watched lately, recommendations and what’s next, from the hub.',
    resources: ['catalog'], types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'], catalogs: Object.values(SERVED).map(row => ({type: row.type, id: row.id, name: row.name, extra: [{name: 'skip'}]}))});
  const name = (extra ?? id ?? '').replace(/\.json$/, ''), catalog = extra ? id : name;
  const list = /^list_(mine|liked)_(\d{1,12})$/.exec(catalog ?? '');
  const mine = what === 'catalog' && forYouRow(catalog ?? '', type ?? '');
  const row = what !== 'catalog' ? undefined : list ? (type === 'all' ? listServed(list[1], list[2]) : undefined) : mine || Object.values(SERVED).find(item => item.type === type && item.id === catalog);
  if (!row) return answer(404, {err: 'Not found'});
  const skip = Math.max(0, Number(new URLSearchParams(extra ? name : '').get('skip') ?? 0) || 0);
  const items = mine ? await forYouServed(env, owner.hub, owner.person, row.id, row.type as 'movie' | 'series') : await fill(env, owner.hub, owner.person, row, skip + PAGE);
  return answer(200, {metas: items.slice(skip, skip + PAGE).map(item => ({id: item.id, type: item.type, name: item.name}))});
}
/* A row's titles, from this person's own accounts only. Trakt disconnected from the hub, or MDBList's key removed: nothing, even if it
   was read a moment ago. Never an error, which AIOMetadata would keep. */
async function fill(env: Env, hub: string, person: string, row: Served, want: number): Promise<Item[]> {
  const link = env.TRAKT_CLIENT_ID ? await getSecret<{again?: boolean}>(env, hub, person, LINK) : null;
  if (row.kind !== 'history' && row.kind !== 'mdb_watchlist') return link ? itemsOf(env, hub, person, row, want) : [];
  if (row.kind === 'history' && link && !link.again) return itemsOf(env, hub, person, row, want);
  const key = (await getSecret<{key?: string}>(env, hub, person, 'mdblist'))?.key ?? '';
  if (row.kind === 'mdb_watchlist') return key ? itemsOf(env, hub, person, row, want, key) : [];
  // Recently Watched without Trakt: their MDBList, kept apart from Trakt's pages, else what they played here.
  return key ? itemsOf(env, hub, person, {...row, kind: 'mdb_history'}, want, key) : played(env, hub, person);
}
