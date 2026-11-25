/* "For you": the places on each person's Home that the hub fills every day with something picked for them (data.ts, withForYou).
   Once a day per person (a cron step after HOUR UTC, one person a run), and again within minutes of a change to their places, kinds
   of pick or content limit, the kinds of pick are worked out from what they watched, scored, and the best go into their places
   that are on. The picks are kept here (the foryou table) and become catalogs in their own AIOMetadata setup at the next sync
   (native.ts), which this cron starts for their hub once its people are picked.
   A pick names its row and says what fills it in the same catalog: a TMDB search AIOMetadata runs (seasonal, a director, a genre,
   something different, the no-history fallbacks), a FlixPatrol Top 10 chart AIOMetadata reads, or a row the hub serves itself
   (rows.ts) whose catalog id carries what fills it (because you watched, the next films in a series, shows to pick back up). Nothing looks up "today's pick"
   when a row is read, so a setup that failed to save never shows a new name over an old list.
   TMDB is asked with the hub's own key, and its answers are kept a day per hub (rows_cache, person '#tmdb'): they are not personal.
   Workers Free allows about fifty outside calls and database queries per run, so a person's picking makes at most CALLS of them. */
import {FOR_YOU_KINDS, isPlace, rowsOf} from '../src/data';
import type {Limit, Row, Settings} from '../src/data';
import type {Env} from './util';
import {getSecret, now} from './util';
import {upNextOf, watchedOf} from './rows';
import type {Item} from './rows';
import {syncPlayers} from './native';
import {refreshShelf} from './shelf';
import type {Synced} from './native';

const DAY = 86400, HOUR = 5, CALLS = 22, DEEP = 60, TMDB_OWNER = '#tmdb', HUB = '#hub', SYNC_TRIES = 12, SYNC_BUDGET = 16;
const TODAY = '__tmdb_date__:today:to';
export interface Pick {
  kind: string; key: string; name: string; type: 'movie' | 'series';
  // What fills it: a TMDB search (AIOMetadata), a FlixPatrol chart (AIOMetadata), or a catalog id the hub serves (rows.ts).
  params?: Record<string, string>; chart?: {service: string; cc: string; slug: string}; serve?: string; score?: number;
  // "Pick something else", asked for this place from a Home: the picking day it was asked on (once a place a day), and, until the
  // next run has picked again for that place alone, again.
  redo?: string; again?: boolean;
}
/* The catalogs the hub serves for For you: foryou_because_m<TMDB film> or _s<show>, foryou_series_<TMDB collection>, and
   foryou_upnext_<show>-<show>-… (AIOMetadata never hides watched titles from a row whose id says upnext,
   so a show part watched stays in it). */
export const FOR_YOU_SERVED = /^foryou_(?:because_[ms]\d{1,9}|series_\d{1,9}|upnext_\d{1,9}(?:-\d{1,9}){0,19})$/;
/* The UTC hour the day's picking starts (FORYOU_HOUR, else HOUR). */
export const pickHour = (env: Env) => Number(env.FORYOU_HOUR ?? HOUR);
export const namesOf = (text: string): Record<string, string> => {
  try {return Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, Pick>).map(([place, pick]) => [place, pick.name]));} catch {return {};}
};
/* The places whose pick was asked to be picked again on this picking day: each may be asked once a day. */
export const redoneOf = (text: string, day: string): string[] => {
  try {return Object.entries(JSON.parse(text) as Record<string, Pick>).filter(([, pick]) => pick.redo === day).map(([place]) => place);} catch {return [];}
};
/* Which kind each place's pick is (FOR_YOU_KINDS, or 'popular' for a stand-in), so the site can say where it came from. */
export const kindsOf = (text: string): Record<string, string> => {
  try {return Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, Pick>).map(([place, pick]) => [place, pick.kind]));} catch {return {};}
};
/* What every place without a pick of its own holds: something popular, the same whoever looks and whatever the day, so a sync
   started by anyone writes the same thing. By place number; a fourth place onwards waits for its pick. */
export const FALLBACKS: Pick[] = [
  {kind: 'popular', key: 'popular:movie', name: 'Popular movies lately', type: 'movie', params: {sort_by: 'popularity.desc', 'vote_count.gte': '200', 'primary_release_date.gte': '__tmdb_date__:last_year:from', 'primary_release_date.lte': TODAY}},
  {kind: 'popular', key: 'popular:series', name: 'Popular shows lately', type: 'series', params: {sort_by: 'popularity.desc', 'vote_count.gte': '100', 'air_date.gte': '__tmdb_date__:last_month:from', without_genres: '10767,10763,10766,10764'}},
  {kind: 'popular', key: 'acclaimed:movie', name: 'Well-liked movies of recent years', type: 'movie', params: {sort_by: 'vote_average.desc', 'vote_count.gte': '1500', 'primary_release_date.gte': '__tmdb_date__:last_5_years:from', 'primary_release_date.lte': TODAY}},
];
/* The stand-in names by place, for someone not picked for yet. */
export const STAND_INS: Record<string, string> = Object.fromEntries(FALLBACKS.map((pick, n) => [`for-you-${n + 1}`, pick.name]));
/* Whether a pick may fill a place now: not of a kind muted for this person, and under a content limit only a TMDB search, which
   asks TMDB for rated titles. Checked again at every sync, so a pick made before the limit changed is never used under it. */
export function allowed(pick: Pick, limit: Limit, off: string[] = []): boolean {
  if (pick.kind === 'popular') return true;
  if (off.includes(pick.kind)) return false;
  return limit === 'all' || (!!pick.params && pick.type === 'movie' && !!FOR_YOU_KINDS.find(kind => kind.id === pick.kind)?.discover);
}
/* What a place holds at a sync: its pick if it may be used, else its fallback. */
export function placePick(place: string, picks: Record<string, Pick> | undefined, limit: Limit, off: string[] = []): Pick | null {
  const pick = picks?.[place];
  if (pick && allowed(pick, limit, off)) return pick;
  const n = Number(/(\d+)$/.exec(place)?.[1] ?? 0);
  return FALLBACKS[n - 1] ?? null;
}

/* ---------- TMDB, kept a day per hub ---------- */
type Held = Map<string, {at: number; body: string}>;
interface Ask {env: Env; hub: string; key: string; held: Held; calls: {left: number}; writes: D1PreparedStatement[]}
const tmdbBase = (env: Env) => env.TMDB_API ?? 'https://api.themoviedb.org/3';
const FLIX = (env: Env) => env.FLIXPATROL_API ?? 'https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs';
/* An answer, from what was kept today, else asked for (when the run has calls left) and kept trimmed by `trim`. A kept answer
   older than a day is still used when asking fails. null when there is nothing. */
async function cached<T>(ask: Ask, kind: string, url: () => string, trim: (body: unknown) => T): Promise<T | null> {
  const had = ask.held.get(kind);
  if (had && now() - had.at < DAY) return JSON.parse(had.body) as T;
  if (ask.calls.left-- <= 0) return had ? JSON.parse(had.body) as T : null;
  const got = await fetch(url(), {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
  const body = got?.status === 200 ? await got.json().catch(() => null) : null;
  if (!body) return had ? JSON.parse(had.body) as T : null;
  const kept = JSON.stringify(trim(body)), at = now();
  ask.held.set(kind, {at, body: kept});
  ask.writes.push(ask.env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items').bind(ask.hub, TMDB_OWNER, kind, at, kept));
  return JSON.parse(kept) as T;
}
const tmdb = <T>(ask: Ask, path: string, trim: (body: unknown) => T) => cached(ask, `tmdb:${path}`, () => `${tmdbBase(ask.env)}/${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(ask.key)}`, trim);
interface Title {id: number; t: string; v: number; d: string}
const listed = (body: unknown): Title[] => ((body as {results?: {id?: number; title?: string; name?: string; vote_average?: number; release_date?: string; first_air_date?: string}[]}).results ?? [])
  .filter(item => Number(item.id) > 0).slice(0, 20).map(item => ({id: Number(item.id), t: String(item.title ?? item.name ?? '').slice(0, 120), v: Number(item.vote_average) || 0, d: String(item.release_date ?? item.first_air_date ?? '')}));
const recommended = (ask: Ask, type: 'movie' | 'series', id: number) => tmdb(ask, `${type === 'movie' ? 'movie' : 'tv'}/${id}/recommendations?page=1`, listed);
// A film's series, genres and directors, in one call (its credits come with it).
interface Film {c: [number, string] | null; g: number[]; d: [number, string][]}
const film = (ask: Ask, id: number) => tmdb<Film>(ask, `movie/${id}?append_to_response=credits`, body => {
  const b = body as {belongs_to_collection?: {id?: number; name?: string} | null; genres?: {id: number}[]; credits?: {crew?: {id?: number; name?: string; job?: string}[]}};
  return {c: b.belongs_to_collection?.id ? [b.belongs_to_collection.id, String(b.belongs_to_collection.name ?? '').slice(0, 120)] : null, g: (b.genres ?? []).map(g => g.id),
    d: (b.credits?.crew ?? []).filter(item => item.job === 'Director' && Number(item.id) > 0).slice(0, 2).map(item => [Number(item.id), String(item.name ?? '').slice(0, 80)])};
});
interface Series {n: string; parts: Title[]}
const series = (ask: Ask, id: number) => tmdb<Series>(ask, `collection/${id}`, body => {const b = body as {name?: string; parts?: unknown[]}; return {n: String(b.name ?? '').slice(0, 120), parts: listed({results: b.parts ?? []}).sort((a, b) => a.d.localeCompare(b.d))};});
interface Show {t: string; g: number[]; last: [number, number] | null}
const show = (ask: Ask, id: number) => tmdb<Show>(ask, `tv/${id}`, body => {const b = body as {name?: string; genres?: {id: number}[]; last_episode_to_air?: {season_number?: number; episode_number?: number} | null}; return {t: String(b.name ?? '').slice(0, 120), g: (b.genres ?? []).map(g => g.id), last: b.last_episode_to_air ? [Number(b.last_episode_to_air.season_number), Number(b.last_episode_to_air.episode_number)] : null};});
/* A TMDB search as AIOMetadata will run it, with today's date where it reads one, to see what it holds. */
const concrete = (params: Record<string, string>, day: string) => Object.fromEntries(Object.entries(params).filter(([, value]) => !value.startsWith('__tmdb_date__:') || value === TODAY).map(([key, value]) => [key, value === TODAY ? day : value]));
const discover = (ask: Ask, type: 'movie' | 'series', params: Record<string, string>, day: string) => tmdb(ask, `discover/${type === 'movie' ? 'movie' : 'tv'}?${new URLSearchParams(concrete(params, day)).toString()}`, listed);

/* ---------- serving a pick the hub fills (rows.ts) ---------- */
type Watched = Set<string>;
const seenSet = (items: Item[]): Watched => new Set(items.flatMap(item => [item.id, ...(item.tmdb ? [`${item.type}:${item.tmdb}`] : [])]));
const unseen = (titles: Title[], type: 'movie' | 'series', seen: Watched) => titles.filter(title => !seen.has(`${type}:${title.id}`));
const asItems = (titles: Title[], type: 'movie' | 'series'): Item[] => titles.map(title => ({id: `tmdb:${title.id}`, type, name: title.t}));
/* The titles of a For you row the hub serves, from its catalog id alone, less what the person watched. Under a content limit
   nothing: these are not rated, and the sync never sends one there (allowed). */
export async function served(env: Env, hub: string, person: string, id: string, type: 'movie' | 'series'): Promise<Item[]> {
  const who = await env.DB.prepare('SELECT p.data AS mine, g.data AS theirs, h.data AS top FROM people p JOIN groups g ON g.hub = p.hub AND g.id = p.grp JOIN hubs h ON h.id = p.hub WHERE p.hub = ? AND p.id = ?').bind(hub, person).first<{mine: string; theirs: string; top: string}>();
  if (!who) return [];
  const settings = (text: string, at: string) => (JSON.parse(text) as Record<string, {limit?: Limit}>)[at] ?? {};
  if ((settings(who.mine, 'settings').limit ?? settings(who.theirs, 'settings').limit ?? settings(who.top, 'defaults').limit ?? 'all') !== 'all') return [];
  const key = await getSecret<string>(env, hub, HUB, 'key:tmdb');
  if (!key) return [];
  const [, kind, rest] = /^foryou_([a-z]+)_(.+)$/.exec(id)!;
  // Only the answers this row reads, from what was kept today.
  const kinds = kind === 'because' ? [`tmdb:${rest[0] === 'm' ? 'movie' : 'tv'}/${rest.slice(1)}/recommendations?page=1`] : kind === 'series' ? [`tmdb:collection/${rest}`] : rest.split('-').map(show => `tmdb:tv/${show}`);
  const kept = await env.DB.prepare(`SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (${kinds.map(() => '?').join(', ')})`).bind(hub, TMDB_OWNER, ...kinds).all<{kind: string; at: number; body: string}>();
  const ask: Ask = {env, hub, key, held: new Map(kept.results.map(row => [row.kind, row])), calls: {left: 3}, writes: []};
  const seen = seenSet(await watchedOf(env, hub, person, false));
  let out: Item[] = [];
  if (kind === 'because') out = asItems(unseen(await recommended(ask, rest[0] === 'm' ? 'movie' : 'series', Number(rest.slice(1))) ?? [], type, seen), type);
  else if (kind === 'series') out = asItems(unseen((await series(ask, Number(rest)))?.parts.filter(part => part.d && part.d <= new Date().toISOString().slice(0, 10)) ?? [], 'movie', seen), 'movie');
  else if (kind === 'upnext') out = rest.split('-').map(Number).map(show => ({id: `tmdb:${show}`, type: 'series' as const, name: (JSON.parse(ask.held.get(`tmdb:tv/${show}`)?.body ?? '{}') as {t?: string}).t ?? ''}));
  if (ask.writes.length) await env.DB.batch(ask.writes);
  return out;
}

/* ---------- picking ---------- */
// Seasons (MM-DD, inclusive) and the TMDB keyword behind each, checked on themoviedb.org on 2026-11-22.
const SEASONS = [{id: 'christmas', name: 'Christmas movies', from: '11-15', to: '12-31', keyword: '207317'}, {id: 'halloween', name: 'Halloween movies', from: '10-01', to: '11-01', keyword: '3335'}];
const GENRES: Record<number, string> = {28: 'Action', 12: 'Adventure', 16: 'Animated', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery',
  10749: 'Romance', 878: 'Sci-fi', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action', 10762: 'Kids', 10765: 'Sci-fi and fantasy', 10768: 'War and politics'};
// The movie genres of those (the rest are TV's own), for something different.
const FILM_GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37];
// Under a content limit the genre itself is kept to suit it, not only the titles in it: for children animated, adventure, comedy,
// family, fantasy and music; for teens anything but horror.
const GENRES_FOR: Partial<Record<Limit, number[]>> = {kids: [16, 12, 35, 10751, 14, 10402], teen: FILM_GENRES.filter(genre => genre !== 27)};
// The country a person's Top 10 is for: where they last played something here. FlixPatrol names its files by country.
const COUNTRIES: Record<string, [string, string]> = {NG: ['nigeria', 'Nigeria'], GB: ['united-kingdom', 'the UK'], US: ['united-states', 'the US'], GH: ['ghana', 'Ghana'], ZA: ['south-africa', 'South Africa'], KE: ['kenya', 'Kenya'],
  CA: ['canada', 'Canada'], IE: ['ireland', 'Ireland'], AU: ['australia', 'Australia'], IN: ['india', 'India'], FR: ['france', 'France'], DE: ['germany', 'Germany'], ES: ['spain', 'Spain'], NL: ['netherlands', 'the Netherlands']};
// How much each kind counts for before anything else: following a series and the person's own seeds first.
const BASE: Record<string, number> = {series: 1.2, pickup: 1.1, because: 1, crew: 0.8, genres: 0.7, seasonal: 0.6, top10: 0.6, different: 0.5, popular: 0};
// A row needs at least this many titles not yet watched to be picked (a series or shows to pick back up need just one).
const ENOUGH = 4, ROTATE = 1, REPEAT: Record<string, number> = {because: 0.35}, REPEAT_ANY = 0.7, LEFT = 21 * DAY;
// Watching older than this is "older" for because-you-watched, and counts this much for how recent it is (fresh watching counts up to 1).
const OLD = 60 * DAY, OLD_CREDIT = 0.5;
// How many of the latest days' picks count for less (by key, newest first): enough for three days of most Homes.
const REMEMBER = 12;
interface Candidate {pick: Pick; seed?: number; old?: boolean; titles: number; quality: number; season?: boolean}
const mean = (titles: Title[]) => titles.length ? titles.slice(0, 10).reduce((sum, title) => sum + title.v, 0) / Math.min(10, titles.length) / 10 : 0;
const scoreOf = (item: Candidate, at: number) => (BASE[item.pick.kind] ?? 0) + (item.old ? OLD_CREDIT : item.seed ? Math.exp(-Math.max(0, at - item.seed) / DAY / 14) : 0) + Math.min(1, item.titles / 20) + item.quality + (item.season ? 1 : 0);
/* Everything that could fill this person's places today, in the order they are worked out (the most personal first, so a run
   short of calls still has those). */
async function candidates(ask: Ask, watched: Item[], plays: {item: string; detail: string; at: number}[], next: Set<number>, country: string, limit: Limit, off: string[], time: number): Promise<Candidate[]> {
  const out: Candidate[] = [], seen = seenSet(watched), day = new Date(time).toISOString().slice(0, 10), mmdd = day.slice(5), at = Math.floor(time / 1000), nth = Math.floor(at / DAY);
  const open = (kind: string) => !off.includes(kind) && (limit === 'all' || !!FOR_YOU_KINDS.find(item => item.id === kind)?.discover);
  const seeds = watched.filter(item => item.tmdb && item.at), films = seeds.filter(item => item.type === 'movie');
  const rated = (params: Record<string, string>) => limit === 'all' ? params : {...params, certification_country: 'US', certification: limit === 'kids' ? 'G|PG' : 'G|PG|PG-13'};
  const search = async (kind: string, key: string, name: string, type: 'movie' | 'series', params: Record<string, string>, extra: Partial<Candidate> = {}) => {
    // Asked as AIOMetadata will ask it (rated, under a limit): a search that leaves too little to show is not a pick.
    const left = unseen(await discover(ask, type, rated(params), day) ?? [], type, seen);
    if (left.length >= ENOUGH) out.push({pick: {kind, key, name, type, params}, titles: left.length, quality: mean(left), ...extra});
  };
  // The four newest titles and two older ones (watched over OLD ago), a different two each day, so older watching has its turn
  // too; the next newest stand in when there are not two older.
  const older = seeds.slice(4).filter(item => at - item.at! > OLD), turn = older.length ? [...new Set([older[2 * nth % older.length], older[(2 * nth + 1) % older.length]])] : [];
  const because = [...seeds.slice(0, 4), ...turn, ...seeds.slice(4).filter(item => !turn.includes(item))].slice(0, 6);
  if (open('because')) for (const item of because) {
    const titles = await recommended(ask, item.type, item.tmdb!), left = unseen(titles ?? [], item.type, seen), tag = `${item.type === 'movie' ? 'm' : 's'}${item.tmdb}`;
    if (left.length >= ENOUGH) out.push({pick: {kind: 'because', key: `because:${tag}`, name: `Because you watched ${item.name}`, type: item.type, serve: `foryou_because_${tag}`}, seed: item.at, old: turn.includes(item), titles: left.length, quality: mean(left)});
  }
  const genres = new Map<number, number>(), collections = new Set<number>();
  for (const item of films.slice(0, 4)) {
    const about = await film(ask, item.tmdb!);
    for (const genre of about?.g ?? []) genres.set(genre, (genres.get(genre) ?? 0) + 1);
    // At most two series a day, the newest first: a third rarely gets a place, and the calls are worth more elsewhere.
    if (!open('series') || !about?.c || collections.has(about.c[0]) || collections.size >= 2) continue;
    collections.add(about.c[0]);
    const parts = (await series(ask, about.c[0]))?.parts.filter(part => part.d && part.d <= day) ?? [], left = unseen(parts, 'movie', seen);
    if (left.length && left.length < parts.length) out.push({pick: {kind: 'series', key: `series:${about.c[0]}`, name: `Next in ${about.c[1].replace(/ Collection$/, '')}`, type: 'movie', serve: `foryou_series_${about.c[0]}`}, seed: item.at, titles: left.length, quality: mean(left)});
  }
  if (open('pickup')) {
    // Shows last watched more than three weeks ago (within the year) with an episode still to watch: Trakt says so (Up Next), or the
    // last episode played here comes before the newest one aired.
    const left: number[] = [];
    for (const item of seeds.filter(item => item.type === 'series' && at - item.at! > LEFT && at - item.at! < 365 * DAY).slice(0, 4)) {
      const about = await show(ask, item.tmdb!), last = plays.find(play => play.item === `tmdb:${item.tmdb}` || play.item === item.id), had = /Season (\d+) · Episode (\d+)/.exec(last?.detail ?? '');
      for (const genre of about?.g ?? []) genres.set(genre, (genres.get(genre) ?? 0) + 0.5);
      const behind = had && about?.last ? Number(had[1]) * 10000 + Number(had[2]) < about.last[0] * 10000 + about.last[1] : false;
      if (next.has(item.tmdb!) || behind) left.push(item.tmdb!);
    }
    if (left.length) out.push({pick: {kind: 'pickup', key: 'pickup', name: 'Pick back up', type: 'series', serve: `foryou_upnext_${left.slice(0, 20).join('-')}`}, titles: left.length * 4, quality: 0.6});
  }
  if (open('crew')) for (const item of films.slice(0, 2)) {
    const [who] = (await film(ask, item.tmdb!))?.d ?? [];
    if (who) await search('crew', `crew:${who[0]}`, `More from ${who[1]}`, 'movie', {with_crew: String(who[0]), sort_by: 'popularity.desc', 'vote_count.gte': '50', 'primary_release_date.lte': TODAY}, {seed: item.at});
  }
  const [favourite] = [...genres].sort((a, b) => b[1] - a[1]);
  if (open('genres') && favourite && GENRES[favourite[0]] && favourite[1] >= 2) await search('genres', `genres:${favourite[0]}`, `${GENRES[favourite[0]]} movies for you`, 'movie', {with_genres: String(favourite[0]), sort_by: 'vote_average.desc', 'vote_count.gte': '500', 'primary_release_date.lte': TODAY});
  // Something different: a well-liked movie genre none of their latest watching is in, a different one each day. Only once there is
  // watching to tell it from; worked out before the season and Top 10, so a run short of calls still has it.
  const other = (GENRES_FOR[limit] ?? FILM_GENRES).filter(genre => !genres.has(genre)), fresh = other[nth % Math.max(1, other.length)];
  if (open('different') && genres.size && fresh) await search('different', `different:${fresh}`, `Something different: ${GENRES[fresh]} movies`, 'movie', {with_genres: String(fresh), sort_by: 'vote_average.desc', 'vote_count.gte': '1000', 'primary_release_date.lte': TODAY});
  const season = SEASONS.find(item => mmdd >= item.from && mmdd <= item.to);
  if (open('seasonal') && season) await search('seasonal', `seasonal:${season.id}`, season.name, 'movie', {with_keywords: season.keyword, sort_by: 'popularity.desc', 'vote_count.gte': '50', 'primary_release_date.lte': TODAY}, {season: true});
  if (open('top10')) {
    const [slug, place] = COUNTRIES[country] ?? ['world', 'the world'], cc = COUNTRIES[country] ? country.toLowerCase() : 'world';
    const charts = await cached(ask, `flix:${slug}`, () => `${FLIX(ask.env)}/${slug === 'world' ? 'global' : slug}.json`, body => {
      const all = (body as {charts?: {catalog_id?: string; entries?: {tmdb?: {id?: number; media_type?: string} | null; title?: string}[]}[]}).charts ?? [];
      const of = (id: string) => (all.find(chart => chart.catalog_id === id)?.entries ?? []).filter(entry => Number(entry.tmdb?.id) > 0).map(entry => ({id: Number(entry.tmdb!.id), t: String(entry.title ?? '').slice(0, 120), v: 0, d: ''}));
      return {movie: of('netflix.movies'), series: of('netflix.series')};
    });
    for (const type of ['movie', 'series'] as const) {
      const left = unseen(charts?.[type] ?? [], type, seen);
      if (left.length >= ENOUGH) out.push({pick: {kind: 'top10', key: `top10:${type}`, name: `Top 10 ${type === 'movie' ? 'movies' : 'shows'} on Netflix in ${place}`, type, chart: {service: 'netflix', cc, slug}}, titles: left.length * 2, quality: 0.5});
    }
  }
  return out;
}
/* The best for each place, in place order: each kind counts for less once it has a place already (because-you-watched less so,
   with another title behind it), and what filled a place in the last few days counts for less today, the more so the more lately
   (by its place in `before`, newest first), so the places move on through what there is rather than swap back and forth. The
   fallbacks fill what is left. `kept`: picks staying where they are (picking one place again), never picked twice and counted
   as kinds already placed. */
export function choose(found: Candidate[], places: string[], before: string[], time: number, kept: Pick[] = []): Record<string, Pick> {
  const at = Math.floor(time / 1000), out: Record<string, Pick> = {}, used = new Map<string, number>(), taken = new Set(kept.map(pick => pick.key));
  for (const pick of kept) used.set(pick.kind, (used.get(pick.kind) ?? 0) + 1);
  const pool = [...found, ...FALLBACKS.map(pick => ({pick, titles: 0, quality: 0}))].map(item => ({...item, base: scoreOf(item, at) - (before.includes(item.pick.key) ? ROTATE * (1 - before.indexOf(item.pick.key) / REMEMBER) : 0)}));
  for (const place of places) {
    const ranked = pool.filter(item => !taken.has(item.pick.key)).map(item => ({item, score: item.base - (used.get(item.pick.kind) ?? 0) * (REPEAT[item.pick.kind] ?? REPEAT_ANY)})).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best) break;
    taken.add(best.item.pick.key); used.set(best.item.pick.kind, (used.get(best.item.pick.kind) ?? 0) + 1);
    out[place] = {...best.item.pick, score: Math.round(best.score * 100) / 100};
  }
  return out;
}

/* ---------- the daily step ---------- */
interface PersonData {rows: Row[] | null; picks?: Record<string, boolean>; settings: Partial<Settings>}
/* A person's For you places that are on, in Home order, and what their picks depend on. */
export function placesOf(own: PersonData, shared: Row[], settings: Settings) {
  const places = rowsOf(own.rows, shared, {trakt: false, lists: false, watched: false, kids: settings.limit === 'kids', front: true}, own.picks).filter(row => row.on && isPlace(row.id)).map(row => row.id);
  return {places, sig: JSON.stringify([settings.limit, [...(settings.forYouOff ?? [])].sort(), places])};
}
// Only what fills the places counts: a score, or a place marked as picked again, changes nothing in the apps.
const bare = (picks: Record<string, Pick>) => JSON.stringify(Object.entries(picks).map(([place, {score: _, redo: _r, again: _a, ...pick}]) => [place, pick]));
const same = (a: Record<string, Pick>, b: Record<string, Pick>) => bare(a) === bare(b);
/* One step, from the cron. `time` is when the run was due. True when it did something (it then had the run to itself). */
export async function forYou(env: Env, time: number): Promise<boolean> {
  const date = new Date(time), day = date.toISOString().slice(0, 10);
  if (env.FRONT !== 'aiometadata') return false;
  // Picking starts at HOUR (UTC); someone never picked for (just added), someone whose places, kinds of pick or limit changed, and a
  // hub's setups still waiting to be brought in step are seen to at any hour. A change before HOUR is picked for as of the day it
  // was last picked, so the day's own picking still comes at HOUR.
  const picking = date.getUTCHours() >= pickHour(env);
  const [hubs, groups, people, kept, syncs] = await env.DB.batch([env.DB.prepare('SELECT id, data FROM hubs ORDER BY id'), env.DB.prepare('SELECT hub, id, data FROM groups'), env.DB.prepare('SELECT hub, id, grp, data FROM people ORDER BY hub, created, id'),
    env.DB.prepare('SELECT hub, person, day, sig, picks, before FROM foryou'), env.DB.prepare('SELECT hub, tries FROM foryou_sync')]);
  const hubData = new Map((hubs.results as {id: string; data: string}[]).map(row => [row.id, row])), had = new Map((kept.results as {hub: string; person: string; day: string; sig: string; picks: string; before: string}[]).map(row => [`${row.hub}/${row.person}`, row]));
  const due = (people.results as {hub: string; id: string; grp: string; data: string}[]).flatMap(row => {
    const hub = hubData.get(row.hub), group = (groups.results as {hub: string; id: string; data: string}[]).find(item => item.hub === row.hub && item.id === row.grp);
    if (!hub || !group) return [];
    const top = JSON.parse(hub.data) as {rows: Row[]; defaults: Settings}, theirs = JSON.parse(group.data) as {rows: Row[] | null; settings: Partial<Settings>}, own = JSON.parse(row.data) as PersonData;
    const settings = {...top.defaults, ...theirs.settings, ...own.settings} as Settings, {places, sig} = placesOf(own, theirs.rows ?? top.rows, settings), before = had.get(`${row.hub}/${row.id}`);
    const on = picking || !before ? day : before.day, done = before?.day === on && before.sig === sig;
    // Places someone asked to have something else in, from their Home: only those are picked again, as of the same day.
    const again = done ? Object.entries(JSON.parse(before!.picks || '{}') as Record<string, Pick>).filter(([place, pick]) => pick.again && places.includes(place)).map(([place]) => place) : [];
    return done && !again.length ? [] : [{hub: row.hub, person: row.id, places, sig, settings, before, day: on, again}];
  });
  // A hub whose people are all picked for today, and whose picks changed: its setups are brought in step, in a run of its own.
  for (const pending of syncs.results as {hub: string; tries: number}[]) {
    if (due.some(item => item.hub === pending.hub)) continue;
    const hub = hubData.get(pending.hub);
    const got: Synced = hub ? await syncPlayers(env, hub, '', SYNC_BUDGET).catch(error => ({state: 'error', message: (error as Error).message})) : {state: 'ok'};
    if (got.state !== 'ok') console.error('foryou sync', got.state, got.more ? 'more' : '');
    // Still more to do (a few setups a run) is not a failed try; anything else short of done is, and is let go after a few.
    if (got.state === 'ok' || (!got.more && pending.tries + 1 >= SYNC_TRIES)) await env.DB.prepare('DELETE FROM foryou_sync WHERE hub = ?').bind(pending.hub).run();
    else await env.DB.prepare('UPDATE foryou_sync SET tries = tries + ?, at = ? WHERE hub = ?').bind(got.more ? 0 : 1, now(), pending.hub).run();
    return true;
  }
  // Someone's My Trakt lists row, worked out again (shelf.ts): one person a run, before the picks.
  if (await refreshShelf(env, people.results as {hub: string; id: string; data: string}[], hub => flag(env, hub))) return true;
  // Whoever has no place on is done at once; then one person a run is picked for.
  const idle = due.filter(item => !item.places.length), next = due.find(item => item.places.length);
  // `gone`: picks just replaced, remembered as lately picked so they count for less in the next days too.
  const keep = (item: typeof due[number], picks: Record<string, Pick>, gone: string[] = []) => env.DB.prepare(`INSERT INTO foryou (hub, person, day, sig, picks, before, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person) DO UPDATE SET
    day = excluded.day, sig = excluded.sig, picks = excluded.picks, before = excluded.before, at = excluded.at`).bind(item.hub, item.person, item.day, item.sig, JSON.stringify(picks), JSON.stringify([...new Set([...gone, ...lately(item.before, item.day)])].slice(0, REMEMBER)), now());
  const changed = (item: typeof due[number], picks: Record<string, Pick>) => !same(JSON.parse(item.before?.picks ?? '{}'), picks);
  const writes = idle.flatMap(item => [keep(item, {}), ...(changed(item, {}) ? [flag(env, item.hub)] : [])]);
  if (!next) {if (writes.length) await env.DB.batch(writes); return writes.length > 0;}
  const key = await getSecret<string>(env, next.hub, HUB, 'key:tmdb');
  const [cache, plays] = await env.DB.batch([env.DB.prepare('SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND at > ?').bind(next.hub, TMDB_OWNER, now() - 3 * DAY),
    env.DB.prepare('SELECT item, ids, detail, place, updated FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 300').bind(next.hub, next.person)]);
  const ask: Ask = {env, hub: next.hub, key: key ?? '', held: new Map((cache.results as {kind: string; at: number; body: string}[]).map(row => [row.kind, row])), calls: {left: key ? CALLS : 0}, writes: []};
  const played = (plays.results as {item: string; ids: string | null; detail: string; place: string | null; updated: number}[]).map(play => {
    let ids: {show?: {ids?: {tmdb?: number}}} | null = null; try {ids = play.ids ? JSON.parse(play.ids) : null;} catch {ids = null;}
    return {item: ids?.show?.ids?.tmdb ? `tmdb:${ids.show.ids.tmdb}` : play.item, detail: play.detail, at: play.updated, place: play.place ?? ''};
  });
  const country = /, ([A-Z]{2})$/.exec(played.find(play => play.place)?.place ?? '')?.[1] ?? '';
  const following = new Set((next.settings.limit === 'all' && !(next.settings.forYouOff ?? []).includes('pickup') ? await upNextOf(env, next.hub, next.person).catch(() => [] as Item[]) : []).map(item => item.tmdb ?? 0));
  // Read as far back as DEEP titles, so older watching can seed a row too (a few pages of Trakt history; MDBList comes whole).
  const watched = await watchedOf(env, next.hub, next.person, true, DEEP).catch(() => [] as Item[]);
  const found = await candidates(ask, watched, played, following, country, next.settings.limit, next.settings.forYouOff ?? [], time).catch(error => {console.error('foryou', (error as Error).message); return [] as Candidate[];});
  // Picking again for the places asked for alone: the rest stay as they are, and nothing already on Home is picked for them.
  const today: Record<string, Pick> = next.before && next.before.day === next.day ? JSON.parse(next.before.picks || '{}') : {}, stay = next.again.length ? today : {};
  const picks: Record<string, Pick> = {...stay, ...choose(found, next.again.length ? next.again : next.places, lately(next.before, next.day), time, Object.values(stay))};
  // A place picked again keeps the mark for the rest of the day, through any picking again that day, so it is asked once a day.
  for (const [place, pick] of Object.entries(picks)) {const {again: _, ...rest} = pick; picks[place] = today[place]?.redo === next.day ? {...rest, redo: next.day} : rest;}
  const gone = next.again.flatMap(place => today[place] && today[place].key !== picks[place]?.key ? [today[place].key] : []);
  await env.DB.batch([...writes, ...ask.writes, keep(next, picks, gone), ...(changed(next, picks) ? [flag(env, next.hub)] : []),
    // Answers nobody has asked for in three days are let go.
    env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND at < ?').bind(next.hub, TMDB_OWNER, now() - 3 * DAY)]);
  return true;
}
const keysOf = (picks: string) => {try {return Object.values(JSON.parse(picks) as Record<string, Pick>).map(pick => pick.key);} catch {return [];}};
/* The keys of the latest days' picks, newest first, for rotation (choose): a new day puts the last day's in front of what was kept;
   picking again on the same day keeps what was kept. */
function lately(before: {day: string; picks: string; before: string} | undefined, day: string): string[] {
  if (!before) return [];
  let kept: string[] = [];
  try {kept = JSON.parse(before.before || '[]') as string[];} catch {kept = [];}
  return before.day === day ? kept : [...new Set([...keysOf(before.picks), ...kept])].slice(0, REMEMBER);
}
const flag = (env: Env, hub: string) => env.DB.prepare('INSERT INTO foryou_sync (hub, at, tries) VALUES (?, ?, 0) ON CONFLICT (hub) DO UPDATE SET at = excluded.at, tries = 0').bind(hub, now());
