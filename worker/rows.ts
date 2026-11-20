/* A person's Trakt rows (watchlist, recommendations, what's next), served by the hub itself from its own Trakt connection
   (trakt.ts), as a small Stremio addon that only lists titles. Their AIOMetadata setup reads it as imported catalogs and fills in
   the rest itself (details, art, ratings, the content limit), so AIOMetadata needs no Trakt connection of its own.
   The address carries a random token per person. The token is kept in the vault; only its hash is kept here to find whose it is.
   Answers are kept in the database for a few minutes, and AIOMetadata keeps them as long again, so Trakt is asked rarely. While
   Trakt is not answering (it turns away the shared addresses Workers call from for a while at times), a row shows the last list
   Trakt gave rather than nothing. */
import type {Env} from './util';
import {newToken, now, putSecret, sha} from './util';
import {LINK, read} from './trakt';

export const ROWS = 'rows';
const MANIFEST = 'aiohub.rows', PAGE = 20;
type Kind = 'watchlist' | 'movies' | 'shows' | 'next' | 'aired';
interface Served {id: string; type: 'movie' | 'series' | 'all'; name: string; ttl: number; kind: Kind}
// Each Home row the hub can serve, by the site's row id. Names are only defaults; the person's own row titles are what AIOMetadata shows.
// AIOMetadata leaves watched titles in any row whose id says watchlist or up next, as it does with its own Trakt rows.
export const SERVED: Record<string, Served> = {
  'watchlist': {id: 'watchlist', type: 'all', name: 'Watchlist', ttl: 600, kind: 'watchlist'},
  'recommended-movies': {id: 'recommended', type: 'movie', name: 'Recommended Movies', ttl: 900, kind: 'movies'},
  'recommended-series': {id: 'recommended', type: 'series', name: 'Recommended Shows', ttl: 900, kind: 'shows'},
  'up-next': {id: 'up_next', type: 'series', name: 'Up Next', ttl: 300, kind: 'next'},
  'recently-aired': {id: 'recently_aired', type: 'series', name: 'Recently Aired for You', ttl: 300, kind: 'aired'},
};
/* The id AIOMetadata gives a catalog imported from another addon: custom.<addon id>.<type>.<catalog id>, anything else as _. */
export const customId = (row: Served) => `custom.${MANIFEST.replace(/[^a-zA-Z0-9]/g, '_')}.${row.type}.${row.id}`;
export const CUSTOM = new RegExp(`^custom\\.${MANIFEST.replace(/[^a-zA-Z0-9]/g, '_')}\\.`);
/* One row as AIOMetadata stores an imported catalog (the shape its own import makes), here kept on a short cache time. */
export function catalogOf(address: string, rowId: string, name: string, on: boolean) {
  const row = SERVED[rowId];
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
interface Item {id: string; type: 'movie' | 'series'; name: string}
interface Media {title?: string; ids?: {imdb?: string | null; tmdb?: number | null}}
const itemOf = (media: Media | undefined, type: Item['type']): Item | null => {
  const ids = media?.ids ?? {}, id = /^tt\d+$/.test(ids.imdb ?? '') ? ids.imdb! : Number(ids.tmdb) > 0 ? `tmdb:${ids.tmdb}` : '';
  return id ? {id, type, name: String(media?.title ?? '').slice(0, 200)} : null;
};
const once = (items: (Item | null)[]) => {const seen = new Set<string>(); return items.filter((item): item is Item => !!item && !seen.has(item.id) && !!seen.add(item.id));};
const ASK: Record<Kind, string> = {
  // Newest first, as AIOMetadata's own Trakt watchlist row was set up. An episode or season on the list stands for its show.
  watchlist: '/sync/watchlist/all/added/desc?page=1&limit=100',
  // Titles already on the watchlist or in the collection are left out: the watchlist has its own row.
  movies: '/recommendations/movies?limit=50&ignore_collected=true&ignore_watchlisted=true',
  shows: '/recommendations/shows?limit=50&ignore_collected=true&ignore_watchlisted=true',
  // Shows with an episode still to watch: the ones watched most lately first, or the ones with the newest episode first.
  next: '/sync/progress/up_next?page=1&limit=50',
  aired: '/sync/progress/up_next?page=1&limit=50&sort_by=recently-aired&sort_how=desc',
};
type Answer = (Media & {type?: string; movie?: Media; show?: Media})[];
const ITEMS: Record<Kind, (got: Answer) => Item[]> = {
  watchlist: got => once(got.map(entry => entry.type === 'movie' ? itemOf(entry.movie, 'movie') : itemOf(entry.show, 'series'))),
  movies: got => once(got.map(media => itemOf(media, 'movie'))),
  shows: got => once(got.map(media => itemOf(media, 'series'))),
  next: got => once(got.map(entry => itemOf(entry.show, 'series'))),
  aired: got => once(got.map(entry => itemOf(entry.show, 'series'))),
};
const RETRY = 60;
async function itemsOf(env: Env, hub: string, person: string, row: Served): Promise<Item[]> {
  const stored = await env.DB.prepare('SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, row.kind).first<{at: number; items: string}>();
  const last = stored ? JSON.parse(stored.items) as Item[] : [];
  if (stored && now() - stored.at < row.ttl) return last;
  const got = await read<Answer>(env, hub, person, ASK[row.kind]);
  const items = Array.isArray(got) ? ITEMS[row.kind](got) : last;
  // Trakt did not answer: the last list it gave, however old, and Trakt is asked again in a minute rather than on every page.
  await env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items')
    .bind(hub, person, row.kind, Array.isArray(got) ? now() : now() - row.ttl + RETRY, JSON.stringify(items)).run();
  return items;
}

/* ---------- the addon ---------- */
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*'}});
/* /api/rows/<token>/manifest.json and /api/rows/<token>/catalog/<type>/<id>[/skip=N].json. Whose rows they are comes only from the token. */
export async function rows(env: Env, path: string[]): Promise<Response> {
  const [token, what, type, id, extra] = path;
  if (!token || !env.TRAKT_CLIENT_ID) return answer(404, {err: 'Not found'});
  const owner = await env.DB.prepare('SELECT k.hub, k.person, EXISTS (SELECT 1 FROM secrets s WHERE s.hub = k.hub AND s.owner = k.person AND s.kind = ?) AS linked FROM rows_keys k WHERE k.id = ?')
    .bind(LINK, await sha(token)).first<{hub: string; person: string; linked: number}>();
  if (!owner) return answer(404, {err: 'Not found'});
  if (what === 'manifest.json' && !type) return answer(200, {id: MANIFEST, version: '1.0.0', name: 'AIOHub Trakt rows', description: 'Your Trakt watchlist, recommendations and what’s next, from the hub.',
    resources: ['catalog'], types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'], catalogs: Object.values(SERVED).map(row => ({type: row.type, id: row.id, name: row.name, extra: [{name: 'skip'}]}))});
  const name = (extra ?? id ?? '').replace(/\.json$/, ''), catalog = extra ? id : name;
  const row = what === 'catalog' ? Object.values(SERVED).find(item => item.type === type && item.id === catalog) : undefined;
  if (!row) return answer(404, {err: 'Not found'});
  const skip = Math.max(0, Number(new URLSearchParams(extra ? name : '').get('skip') ?? 0) || 0);
  // Trakt disconnected from the hub: nothing, even if it was read a moment ago. Never an error, which AIOMetadata would keep.
  const items = owner.linked ? await itemsOf(env, owner.hub, owner.person, row) : [];
  return answer(200, {metas: items.slice(skip, skip + PAGE)});
}
