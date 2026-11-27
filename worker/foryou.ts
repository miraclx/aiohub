/* "For you": the places on each person's Home that the hub fills every day with something picked for them (data.ts, withForYou).
   Once a day per person (a cron step after HOUR UTC, one person a run), and again within minutes of a change to their places, kinds
   of pick or content limit, the kinds of pick are worked out from what they watched, and their places that are on fill from the top
   of their order of kinds (fillOrder in data.ts). Within minutes of a finished watch one of those places is picked again. The picks are kept here (the foryou table) and become catalogs in their own AIOMetadata setup at the next sync
   (native.ts), which this cron starts for their hub once its people are picked.
   A pick names its row and says what fills it in the same catalog: a TMDB search AIOMetadata runs (seasonal, a director, a genre,
   something different, the no-history fallbacks), a FlixPatrol Top 10 chart AIOMetadata reads, or a row the hub serves itself
   (rows.ts) whose catalog id carries what fills it (because you watched, the other films of a series, shows to pick back up). Nothing looks up "today's pick"
   when a row is read, so a setup that failed to save never shows a new name over an old list.
   TMDB is asked with the hub's own key, and its answers are kept a day per hub (rows_cache, person '#tmdb'): they are not personal.
   Workers Free allows about fifty outside calls and database queries per run, so a person's picking makes at most CALLS of them. */
import {FOR_YOU_KINDS, FOR_YOU_ORDER, fillOrder, isPlace, orderOf, rowsOf} from '../src/data';
import type {ForYouDetail, Limit, Row, Settings, Shown, Why} from '../src/data';
import type {Env} from './util';
import {getSecret, now} from './util';
import {upNextOf, watchedOf} from './rows';
import type {Item} from './rows';
import {syncInTurn} from './native';
import {changed as homeChanged} from './notice';
import {refreshShelf} from './shelf';
import type {Synced} from './native';

export const TMDB_OWNER = '#tmdb';
const DAY = 86400, HOUR = 5, CALLS = 22, DEEP = 60, HUB = '#hub', SYNC_TRIES = 12, SYNC_BUDGET = 16;
const TODAY = '__tmdb_date__:today:to';
export interface Pick {
  kind: string; key: string; name: string; type: 'movie' | 'series';
  // What fills it: a TMDB search (AIOMetadata), a FlixPatrol chart (AIOMetadata), or a catalog id the hub serves (rows.ts).
  params?: Record<string, string>; chart?: {service: string; cc: string; slug: string}; serve?: string; score?: number;
  // What it came from, for the site to word (data.ts), and the title it was worked out from ('m27205', 's1396'), which the person
  // can leave out for good. `keep`: asked from a Home to stay in its place at the daily pick, until let go.
  why?: Why; seed?: string; keep?: boolean;
}
/* The day's other options, in the order the places filled in (the places' own picks are not among them), and the kinds with
   nothing today and why: 'off', 'limit' (not filled under a content limit), 'watching' (nothing watched to go on yet), 'none'
   (nothing left today). */
interface Pool {options?: Pick[]; none?: Record<string, string>}
const read = <T>(text: string | null | undefined, or: T): T => {try {return (JSON.parse(text ?? '') as T) ?? or;} catch {return or;}};
/* The catalogs the hub serves for For you: foryou_because_m<TMDB film> or _s<show>, foryou_series_<TMDB collection>, and
   foryou_upnext_<show>-<show>-… (AIOMetadata never hides watched titles from a row whose id says upnext,
   so a show part watched stays in it). */
export const FOR_YOU_SERVED = /^foryou_(?:because_[ms]\d{1,9}|series_\d{1,9}|upnext_\d{1,9}(?:-\d{1,9}){0,19})$/;
/* The UTC hour the day's picking starts (FORYOU_HOUR, else HOUR). */
export const pickHour = (env: Env) => Number(env.FORYOU_HOUR ?? HOUR);
export const namesOf = (text: string): Record<string, string> => {
  try {return Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, Pick>).map(([place, pick]) => [place, pick.name]));} catch {return {};}
};
/* What the site is told of a person's For you today (data.ts, ForYouDetail): never the searches or ids that fill a row. */
const shown = (pick: Pick): Shown => ({key: pick.key, kind: pick.kind, name: pick.name, ...(pick.why ? {why: pick.why} : {}), ...(pick.seed ? {seed: pick.seed} : {}), ...(pick.keep ? {keep: true} : {})});
export function detailOf(picks: string, pool: string, never: string): ForYouDetail {
  const placed = read<Record<string, Pick>>(picks, {}), {options = [], none = {}} = read<Pool>(pool, {}), on = new Set(Object.values(placed).map(pick => pick.key));
  return {places: Object.fromEntries(Object.entries(placed).map(([place, pick]) => [place, shown(pick)])), options: options.filter(pick => !on.has(pick.key)).map(shown), none, never: read(never, [])};
}
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
export interface Ask {env: Env; hub: string; key: string; held: Held; calls: {left: number}; writes: D1PreparedStatement[]}
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
export const tmdb = <T>(ask: Ask, path: string, trim: (body: unknown) => T) => cached(ask, `tmdb:${path}`, () => `${tmdbBase(ask.env)}/${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(ask.key)}`, trim);
export interface Title {id: number; t: string; v: number; d: string}
const listed = (body: unknown): Title[] => ((body as {results?: {id?: number; adult?: boolean; title?: string; name?: string; vote_average?: number; release_date?: string; first_air_date?: string}[]}).results ?? [])
  .filter(item => Number(item.id) > 0 && !item.adult).slice(0, 20).map(item => ({id: Number(item.id), t: String(item.title ?? item.name ?? '').slice(0, 120), v: Number(item.vote_average) || 0, d: String(item.release_date ?? item.first_air_date ?? '')}));
export const recommended = (ask: Ask, type: 'movie' | 'series', id: number) => tmdb(ask, `${type === 'movie' ? 'movie' : 'tv'}/${id}/recommendations?page=1`, listed);
// A film's series, genres and directors, in one call (its credits come with it).
interface Film {c: [number, string] | null; g: number[]; d: [number, string][]}
const film = (ask: Ask, id: number) => tmdb<Film>(ask, `movie/${id}?append_to_response=credits`, body => {
  const b = body as {belongs_to_collection?: {id?: number; name?: string} | null; genres?: {id: number}[]; credits?: {crew?: {id?: number; name?: string; job?: string}[]}};
  return {c: b.belongs_to_collection?.id ? [b.belongs_to_collection.id, String(b.belongs_to_collection.name ?? '').slice(0, 120)] : null, g: (b.genres ?? []).map(g => g.id),
    d: (b.credits?.crew ?? []).filter(item => item.job === 'Director' && Number(item.id) > 0).slice(0, 2).map(item => [Number(item.id), String(item.name ?? '').slice(0, 80)])};
});
interface Series {n: string; parts: Title[]}
const series = (ask: Ask, id: number) => tmdb<Series>(ask, `collection/${id}`, body => {const b = body as {name?: string; parts?: unknown[]}; return {n: String(b.name ?? '').slice(0, 120), parts: listed({results: b.parts ?? []}).sort((a, b) => a.d.localeCompare(b.d))};});
// `a`: the day its newest episode came out; `n`: the next one to come, with its day (ahead.ts reads both). An answer kept from
// before they were has neither, for the day it is kept.
export interface Show {t: string; g: number[]; last: [number, number] | null; a?: string; n?: [number, number, string] | null}
type Episode = {season_number?: number; episode_number?: number; air_date?: string | null} | null;
export const show = (ask: Ask, id: number) => tmdb<Show>(ask, `tv/${id}`, body => {
  const b = body as {name?: string; genres?: {id: number}[]; last_episode_to_air?: Episode; next_episode_to_air?: Episode}, day = (episode: Episode | undefined) => /^\d{4}-\d\d-\d\d$/.test(episode?.air_date ?? '') ? episode!.air_date! : '';
  return {t: String(b.name ?? '').slice(0, 120), g: (b.genres ?? []).map(g => g.id), last: b.last_episode_to_air ? [Number(b.last_episode_to_air.season_number), Number(b.last_episode_to_air.episode_number)] : null,
    a: day(b.last_episode_to_air), n: b.next_episode_to_air && day(b.next_episode_to_air) ? [Number(b.next_episode_to_air.season_number), Number(b.next_episode_to_air.episode_number), day(b.next_episode_to_air)] : null};
});
/* A TMDB search as AIOMetadata will run it, with today's date where it reads one, to see what it holds. */
const concrete = (params: Record<string, string>, day: string) => Object.fromEntries(Object.entries(params).filter(([, value]) => !value.startsWith('__tmdb_date__:') || value === TODAY).map(([key, value]) => [key, value === TODAY ? day : value]));
const discover = (ask: Ask, type: 'movie' | 'series', params: Record<string, string>, day: string) => tmdb(ask, `discover/${type === 'movie' ? 'movie' : 'tv'}?${new URLSearchParams(concrete(params, day)).toString()}`, listed);

/* ---------- serving a pick the hub fills (rows.ts) ---------- */
/* A person's content limit as it stands now: their own, else their group's, else the hub's. null when they are gone. */
export async function limitOf(env: Env, hub: string, person: string): Promise<Limit | null> {
  const who = await env.DB.prepare('SELECT p.data AS mine, g.data AS theirs, h.data AS top FROM people p JOIN groups g ON g.hub = p.hub AND g.id = p.grp JOIN hubs h ON h.id = p.hub WHERE p.hub = ? AND p.id = ?').bind(hub, person).first<{mine: string; theirs: string; top: string}>();
  if (!who) return null;
  const settings = (text: string, at: string) => (JSON.parse(text) as Record<string, {limit?: Limit}>)[at] ?? {};
  return settings(who.mine, 'settings').limit ?? settings(who.theirs, 'settings').limit ?? settings(who.top, 'defaults').limit ?? 'all';
}
type Watched = Set<string>;
export const seenSet = (items: Item[]): Watched => new Set(items.flatMap(item => [item.id, ...(item.tmdb ? [`${item.type}:${item.tmdb}`] : [])]));
export const unseen = (titles: Title[], type: 'movie' | 'series', seen: Watched) => titles.filter(title => !seen.has(`${type}:${title.id}`));
const asItems = (titles: Title[], type: 'movie' | 'series'): Item[] => titles.map(title => ({id: `tmdb:${title.id}`, type, name: title.t}));
/* The titles of a For you row the hub serves, from its catalog id alone, less what the person watched. Under a content limit
   nothing: these are not rated, and the sync never sends one there (allowed). */
export async function served(env: Env, hub: string, person: string, id: string, type: 'movie' | 'series'): Promise<Item[]> {
  if (await limitOf(env, hub, person) !== 'all') return [];
  const key = await getSecret<string>(env, hub, HUB, 'key:tmdb');
  if (!key) return [];
  const [, kind, rest] = /^foryou_([a-z]+)_(.+)$/.exec(id)!;
  // Only the answers this row reads, from what was kept today.
  const kinds = kind === 'because' ? [`tmdb:${rest[0] === 'm' ? 'movie' : 'tv'}/${rest.slice(1)}/recommendations?page=1`] : kind === 'series' ? [`tmdb:collection/${rest}`] : rest.split('-').map(show => `tmdb:tv/${show}`);
  const kept = await env.DB.prepare(`SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (${kinds.map(() => '?').join(', ')})`).bind(hub, TMDB_OWNER, ...kinds).all<{kind: string; at: number; body: string}>();
  const ask: Ask = {env, hub, key, held: new Map(kept.results.map(row => [row.kind, row])), calls: {left: 3}, writes: []};
  // An account of theirs that has never answered (rows.ts, watchedOf): what they watched is not known, so nothing is listed
  // rather than titles they may have watched.
  const watched = await watchedOf(env, hub, person);
  if (!watched.known) return [];
  const seen = seenSet(watched.items);
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
// A row needs at least this many titles not yet watched to be picked (a series or shows to pick back up need just one).
const ENOUGH = 4, ROTATE = 1, LEFT = 21 * DAY;
// Watching older than this is "older" for because-you-watched, and counts this much for how recent it is (fresh watching counts up to 1).
const OLD = 60 * DAY, OLD_CREDIT = 0.5;
// How many of the latest days' picks count for less (by key, newest first): enough for three days of most Homes. How many other
// options a day's pick keeps, and how many titles someone can leave out for good (the oldest goes first).
const REMEMBER = 12, POOL = 10, NEVER = 20;
interface Candidate {pick: Pick; seed?: number; old?: boolean; titles: number; quality: number}
const mean = (titles: Title[]) => titles.length ? titles.slice(0, 10).reduce((sum, title) => sum + title.v, 0) / Math.min(10, titles.length) / 10 : 0;
// How good a pick is against others of its kind: how lately its title was watched, how much it holds, and how well rated.
const scoreOf = (item: Candidate, at: number) => (item.old ? OLD_CREDIT : item.seed ? Math.exp(-Math.max(0, at - item.seed) / DAY / 14) : 0) + Math.min(1, item.titles / 20) + item.quality;
export const tagOf = (item: {type: 'movie' | 'series'; tmdb?: number}) => `${item.type === 'movie' ? 'm' : 's'}${item.tmdb}`;
/* Everything that could fill this person's places today, in the order they are worked out (the most personal first, so a run
   short of calls still has those), and why each kind with nothing has nothing (Pool). `never`: titles they left out for good,
   which seed nothing. `any`: because-you-watched from any time, two newest titles and four older instead of four and two. */
async function candidates(ask: Ask, watched: Item[], plays: {item: string; detail: string; at: number}[], next: Set<number>, country: string, limit: Limit, off: string[], time: number, never: string[] = [], any = false): Promise<{found: Candidate[]; none: Record<string, string>}> {
  const out: Candidate[] = [], seen = seenSet(watched), day = new Date(time).toISOString().slice(0, 10), mmdd = day.slice(5), at = Math.floor(time / 1000), nth = Math.floor(at / DAY);
  const open = (kind: string) => !off.includes(kind) && (limit === 'all' || !!FOR_YOU_KINDS.find(item => item.id === kind)?.discover);
  const seeds = watched.filter(item => item.tmdb && item.at && !never.includes(tagOf(item))), films = seeds.filter(item => item.type === 'movie');
  const rated = (params: Record<string, string>) => limit === 'all' ? params : {...params, certification_country: 'US', certification: limit === 'kids' ? 'G|PG' : 'G|PG|PG-13'};
  const search = async (kind: string, key: string, name: string, type: 'movie' | 'series', params: Record<string, string>, extra: Partial<Candidate> = {}, about: Partial<Pick> = {}) => {
    // Asked as AIOMetadata will ask it (rated, under a limit): a search that leaves too little to show is not a pick.
    const left = unseen(await discover(ask, type, rated(params), day) ?? [], type, seen);
    if (left.length >= ENOUGH) out.push({pick: {kind, key, name, type, params, ...about}, titles: left.length, quality: mean(left), ...extra});
  };
  // The four newest titles and two older ones (watched over OLD ago), a different two each day, so older watching has its turn
  // too; the next newest stand in when there are not two older. From any time: the two newest and four older.
  const [newest, oldest] = any ? [2, 4] : [4, 2];
  const older = seeds.slice(newest).filter(item => at - item.at! > OLD), turn = older.length ? [...new Set(Array.from({length: oldest}, (_, n) => older[(oldest * nth + n) % older.length]))] : [];
  const because = [...seeds.slice(0, newest), ...turn, ...seeds.slice(newest).filter(item => !turn.includes(item))].slice(0, 6);
  if (open('because')) for (const item of because) {
    const titles = await recommended(ask, item.type, item.tmdb!), left = unseen(titles ?? [], item.type, seen), tag = tagOf(item);
    if (left.length >= ENOUGH) out.push({pick: {kind: 'because', key: `because:${tag}`, name: `Because you watched ${item.name}`, type: item.type, serve: `foryou_because_${tag}`, why: {title: item.name, seen: item.at}, seed: tag}, seed: item.at, old: turn.includes(item), titles: left.length, quality: mean(left)});
  }
  const genres = new Map<number, number>(), collections = new Set<number>();
  for (const item of films.slice(0, 4)) {
    const about = await film(ask, item.tmdb!);
    for (const genre of about?.g ?? []) genres.set(genre, (genres.get(genre) ?? 0) + 1);
    // At most two series a day, the newest first: a third rarely gets a place, and the calls are worth more elsewhere.
    if (!open('series') || !about?.c || collections.has(about.c[0]) || collections.size >= 2) continue;
    collections.add(about.c[0]);
    const parts = (await series(ask, about.c[0]))?.parts.filter(part => part.d && part.d <= day) ?? [], left = unseen(parts, 'movie', seen);
    if (left.length && left.length < parts.length) out.push({pick: {kind: 'series', key: `series:${about.c[0]}`, name: `More from ${about.c[1].replace(/ Collection$/, '')}`, type: 'movie', serve: `foryou_series_${about.c[0]}`, why: {title: item.name, seen: item.at, more: left.length}, seed: tagOf(item)}, seed: item.at, titles: left.length, quality: mean(left)});
  }
  if (open('pickup')) {
    // Shows last watched more than three weeks ago (within the year) with an episode still to watch: Trakt says so (Up Next), or the
    // last episode played here comes before the newest one aired. Every such show is looked at, most recently watched first: one
    // Trakt lists needs no call at all, and only the others are asked of TMDB, four of them a day at most (the cap is for the
    // calls, never for how many shows can be in the row). Only a show that was looked up counts towards her genres.
    const left: Item[] = []; let looked = 0;
    for (const item of seeds.filter(item => item.type === 'series' && at - item.at! > LEFT && at - item.at! < 365 * DAY)) {
      if (next.has(item.tmdb!)) {left.push(item); continue;}
      if (looked >= 4) continue;
      looked++;
      const about = await show(ask, item.tmdb!), last = plays.find(play => play.item === `tmdb:${item.tmdb}` || play.item === item.id), had = /Season (\d+) · Episode (\d+)/.exec(last?.detail ?? '');
      for (const genre of about?.g ?? []) genres.set(genre, (genres.get(genre) ?? 0) + 0.5);
      if (had && about?.last && Number(had[1]) * 10000 + Number(had[2]) < about.last[0] * 10000 + about.last[1]) left.push(item);
    }
    if (left.length) out.push({pick: {kind: 'pickup', key: 'pickup', name: 'Pick back up', type: 'series', serve: `foryou_upnext_${left.slice(0, 20).map(item => item.tmdb).join('-')}`, why: {title: left[0].name, more: left.length - 1}}, titles: left.length * 4, quality: 0.6});
  }
  if (open('crew')) for (const item of films.slice(0, 2)) {
    const [who] = (await film(ask, item.tmdb!))?.d ?? [];
    if (who) await search('crew', `crew:${who[0]}`, `More from ${who[1]}`, 'movie', {with_crew: String(who[0]), sort_by: 'popularity.desc', 'vote_count.gte': '50', 'primary_release_date.lte': TODAY}, {seed: item.at}, {why: {title: item.name, seen: item.at, who: who[1]}, seed: tagOf(item)});
  }
  const [favourite] = [...genres].sort((a, b) => b[1] - a[1]);
  if (open('genres') && favourite && GENRES[favourite[0]] && favourite[1] >= 2) await search('genres', `genres:${favourite[0]}`, `${GENRES[favourite[0]]} movies for you`, 'movie', {with_genres: String(favourite[0]), sort_by: 'vote_average.desc', 'vote_count.gte': '500', 'primary_release_date.lte': TODAY}, {}, {why: {title: GENRES[favourite[0]]}});
  // Something different: a well-liked movie genre none of their latest watching is in, a different one each day. Only once there is
  // watching to tell it from; worked out before the season and Top 10, so a run short of calls still has it.
  const other = (GENRES_FOR[limit] ?? FILM_GENRES).filter(genre => !genres.has(genre)), fresh = other[nth % Math.max(1, other.length)];
  if (open('different') && genres.size && fresh) await search('different', `different:${fresh}`, `Something different: ${GENRES[fresh]} movies`, 'movie', {with_genres: String(fresh), sort_by: 'vote_average.desc', 'vote_count.gte': '1000', 'primary_release_date.lte': TODAY}, {}, {why: {title: GENRES[fresh]}});
  const season = SEASONS.find(item => mmdd >= item.from && mmdd <= item.to);
  if (open('seasonal') && season) await search('seasonal', `seasonal:${season.id}`, season.name, 'movie', {with_keywords: season.keyword, sort_by: 'popularity.desc', 'vote_count.gte': '50', 'primary_release_date.lte': TODAY});
  if (open('top10')) {
    const [slug, place] = COUNTRIES[country] ?? ['world', 'the world'], cc = COUNTRIES[country] ? country.toLowerCase() : 'world';
    const charts = await cached(ask, `flix:${slug}`, () => `${FLIX(ask.env)}/${slug === 'world' ? 'global' : slug}.json`, body => {
      const all = (body as {charts?: {catalog_id?: string; entries?: {tmdb?: {id?: number; media_type?: string} | null; title?: string}[]}[]}).charts ?? [];
      const of = (id: string) => (all.find(chart => chart.catalog_id === id)?.entries ?? []).filter(entry => Number(entry.tmdb?.id) > 0).map(entry => ({id: Number(entry.tmdb!.id), t: String(entry.title ?? '').slice(0, 120), v: 0, d: ''}));
      return {movie: of('netflix.movies'), series: of('netflix.series')};
    });
    for (const type of ['movie', 'series'] as const) {
      const left = unseen(charts?.[type] ?? [], type, seen);
      if (left.length >= ENOUGH) out.push({pick: {kind: 'top10', key: `top10:${type}`, name: `Top 10 ${type === 'movie' ? 'movies' : 'shows'} on Netflix in ${place}`, type, chart: {service: 'netflix', cc, slug}, why: {title: place}}, titles: left.length * 2, quality: 0.5});
    }
  }
  // Each kind with nothing today, and why: switched off, not filled under the limit, nothing watched to go on, or nothing left today.
  const none = Object.fromEntries(FOR_YOU_KINDS.filter(kind => !out.some(item => item.pick.kind === kind.id)).map(kind =>
    [kind.id, off.includes(kind.id) ? 'off' : !open(kind.id) ? 'limit' : !seeds.length && kind.id !== 'seasonal' && kind.id !== 'top10' ? 'watching' : 'none']));
  return {found: out, none};
}
/* The picks for the places, in place order, by the order of the kinds (fillOrder in data.ts): within each kind the best first, and
   what filled a place in the last few days counts for less, the more so the more lately (by its place in `before`, newest first),
   so a kind moves on through its titles rather than show the same one each day. The stand-ins fill what is left. `kept`: picks
   staying where they are (kept from a Home), each its kind's pick in its round. `pool`: what comes next, as the day's other options. */
export function choose(found: Candidate[], places: string[], before: string[], time: number, kept: Pick[] = [], order = FOR_YOU_ORDER): {picks: Record<string, Pick>; pool: Pick[]} {
  const at = Math.floor(time / 1000), ranked = found.map(item => ({...item.pick, score: Math.round((scoreOf(item, at) - (before.includes(item.pick.key) ? ROTATE * (1 - before.indexOf(item.pick.key) / REMEMBER) : 0)) * 100) / 100}));
  const all = fillOrder(ranked.sort((a, b) => b.score - a.score), orderOf(order), kept, FALLBACKS);
  return {picks: Object.fromEntries(places.flatMap((place, n) => all[n] ? [[place, all[n]]] : [])), pool: all.slice(places.length, places.length + POOL)};
}

/* ---------- the daily step ---------- */
interface PersonData {rows: Row[] | null; picks?: Record<string, boolean>; settings: Partial<Settings>}
/* A person's For you places that are on, in Home order, and what their picks depend on. The order of the kinds and where
   because-you-watched looks count only once changed, so a sig kept from before they could be still matches. */
export function placesOf(own: PersonData, shared: Row[], settings: Settings) {
  const places = rowsOf(own.rows, shared, {trakt: false, lists: false, watched: false, kids: settings.limit === 'kids', front: true}, own.picks).filter(row => row.on && isPlace(row.id)).map(row => row.id);
  const order = orderOf(settings.forYouOrder), changed = order.join() !== FOR_YOU_ORDER.join() || settings.forYouBecause === 'any';
  return {places, sig: JSON.stringify([settings.limit, [...(settings.forYouOff ?? [])].sort(), places, ...(changed ? [order, settings.forYouBecause ?? 'lately'] : [])])};
}
// Only what fills the places counts: a score, a reason or a place kept changes nothing in the apps.
const bare = (picks: Record<string, Pick>) => JSON.stringify(Object.entries(picks).map(([place, {score: _, why: _w, seed: _s, keep: _k, ...pick}]) => [place, pick]));
const same = (a: Record<string, Pick>, b: Record<string, Pick>) => bare(a) === bare(b);
interface Kept {day: string; sig: string; picks: string; before: string; never: string; fresh: string}
interface Due {hub: string; person: string; places: string[]; sig: string; settings: Settings; before?: Kept; day: string; due: boolean}
/* One step, from the cron. `time` is when the run was due. True when it did something (it then had the run to itself). */
export async function forYou(env: Env, time: number): Promise<boolean> {
  const date = new Date(time), day = date.toISOString().slice(0, 10);
  if (env.FRONT !== 'aiometadata') return false;
  // Picking starts at HOUR (UTC); someone never picked for (just added), someone whose places, kinds of pick or limit changed, and a
  // hub's setups still waiting to be brought in step are seen to at any hour. A change before HOUR is picked for as of the day it
  // was last picked, so the day's own picking still comes at HOUR.
  const picking = date.getUTCHours() >= pickHour(env), started = now();
  const [hubs, groups, people, kept] = await env.DB.batch([env.DB.prepare('SELECT id, data FROM hubs ORDER BY id'), env.DB.prepare('SELECT hub, id, data FROM groups'), env.DB.prepare('SELECT hub, id, grp, data FROM people ORDER BY hub, created, id'),
    env.DB.prepare('SELECT hub, person, day, sig, picks, before, never, fresh FROM foryou')]);
  const hubData = new Map((hubs.results as {id: string; data: string}[]).map(row => [row.id, row])), had = new Map((kept.results as (Kept & {hub: string; person: string})[]).map(row => [`${row.hub}/${row.person}`, row]));
  const everyone: Due[] = (people.results as {hub: string; id: string; grp: string; data: string}[]).flatMap(row => {
    const hub = hubData.get(row.hub), group = (groups.results as {hub: string; id: string; data: string}[]).find(item => item.hub === row.hub && item.id === row.grp);
    if (!hub || !group) return [];
    const top = JSON.parse(hub.data) as {rows: Row[]; defaults: Settings}, theirs = JSON.parse(group.data) as {rows: Row[] | null; settings: Partial<Settings>}, own = JSON.parse(row.data) as PersonData;
    const settings = {...top.defaults, ...theirs.settings, ...own.settings} as Settings, {places, sig} = placesOf(own, theirs.rows ?? top.rows, settings), before = had.get(`${row.hub}/${row.id}`);
    const on = picking || !before ? day : before.day;
    return [{hub: row.hub, person: row.id, places, sig, settings, before, day: on, due: !(before?.day === on && before.sig === sig)}];
  }), due = everyone.filter(item => item.due);
  // A hub whose setups are still to be saved again after a try that failed (resend, below; a first try has had its run already,
  // ahead of everything, unless it waits for someone due here, whom this run then picks for).
  if (await resend(env, time, false)) return true;
  // Someone's My lists row, worked out again (shelf.ts): one person a run, before the picks.
  if (await refreshShelf(env, people.results as {hub: string; id: string; data: string}[], hub => flag(env, hub))) return true;
  // Whoever has no place on is done at once; then one person a run is picked for; then, with nobody due, one person who just
  // finished something (finished, below).
  const idle = due.filter(item => !item.places.length), next = due.find(item => item.places.length);
  const fresh = next ? undefined : everyone.find(item => item.places.length && read<Fresh>(item.before?.fresh, {}).due);
  // The titles they left out for good are theirs to change, from their Home: never written here.
  const keep = (item: Due, picks: Record<string, Pick>, pool: Pool = {}, recent = lately(item.before, item.day)) => env.DB.prepare(`INSERT INTO foryou (hub, person, day, sig, picks, before, pool, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person) DO UPDATE SET
    day = excluded.day, sig = excluded.sig, picks = excluded.picks, before = excluded.before, pool = excluded.pool, at = excluded.at`).bind(item.hub, item.person, item.day, item.sig, JSON.stringify(picks), JSON.stringify(recent), JSON.stringify(pool), now());
  const changed = (item: Due, picks: Record<string, Pick>) => !same(JSON.parse(item.before?.picks ?? '{}'), picks);
  const writes = idle.flatMap(item => [keep(item, {}), ...(changed(item, {}) ? [flag(env, item.hub)] : [])]);
  if (fresh) return again(env, fresh, time, writes, keep, changed);
  if (!next) {if (writes.length) await env.DB.batch(writes); return writes.length > 0;}
  const {limit, forYouOff: off = [], forYouOrder: order} = next.settings, {ask, found, none, never} = await gather(env, next, time);
  // Places kept from a Home stay as they are, whatever the day, while their pick may still be used there (a kind switched off, a
  // content limit or a title left out lets it go, and the place is picked for as any other).
  const held = read<Record<string, Pick>>(next.before?.picks, {});
  const stay = Object.fromEntries(next.places.flatMap(place => {const pick = held[place]; return pick?.keep && allowed(pick, limit, off) && !(pick.seed && never.includes(pick.seed)) ? [[place, pick]] : [];}));
  const chosen = choose(found, next.places.filter(place => !stay[place]), lately(next.before, next.day), time, Object.values(stay), order);
  const picks: Record<string, Pick> = Object.fromEntries(next.places.flatMap(place => {const pick = stay[place] ?? chosen.picks[place]; return pick ? [[place, pick]] : [];}));
  await env.DB.batch([...writes, ...ask.writes, keep(next, picks, {options: chosen.pool, none}), ...(changed(next, picks) ? [flag(env, next.hub)] : []),
    // A finished watch noted before their watching was read is in these picks already.
    env.DB.prepare("UPDATE foryou SET fresh = json_set(fresh, '$.due', 0) WHERE hub = ? AND person = ? AND json_extract(fresh, '$.due') BETWEEN 1 AND ?").bind(next.hub, next.person, started),
    // Answers nobody has asked for in three days are let go.
    env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND at < ?').bind(next.hub, TMDB_OWNER, now() - 3 * DAY)]);
  return true;
}
/* A hub whose setups are to be saved again (flag, below: its picks changed, a Watchlist switch was turned, an account was
   connected or removed with no page left open to send it): they are brought in step, in a run of its own. One hub a run, the one
   waiting longest.
   - Its first try comes ahead of every cron step that works a person or a hub at a time (index.ts, `early`), so none of them can
     hold it up. A try that failed is tried again from the day's For you step instead (forYou, below), behind those steps, so
     AIOMetadata not answering never holds them up in turn.
   - It never waits on picking for longer than WAITS (a little over one run): a hub flagged within that time, with someone still
     to pick for, is left for the run after their pick (the day's picking, a person a run, flags it again as each is picked), so
     a day's picks reach the apps in one go; any other is seen to now. So a flagged hub is in step by the next run or the one
     after, whoever is still to be picked for.
   True when it did (it then had the run to itself). */
const WAITS = 420;
export async function resend(env: Env, time: number, early: boolean): Promise<boolean> {
  if (env.FRONT !== 'aiometadata') return false;
  const waiting = (await env.DB.prepare(`SELECT s.hub, s.tries, s.at, h.data FROM foryou_sync s LEFT JOIN hubs h ON h.id = s.hub${early ? ' WHERE s.tries = 0' : ''} ORDER BY s.at`).all<{hub: string; tries: number; at: number; data: string | null}>()).results;
  if (!waiting.length) return false;
  const lately = waiting.filter(row => now() - row.at < WAITS), picking = lately.length ? await dueHubs(env, time) : new Set<string>();
  const pending = waiting.find(row => !(now() - row.at < WAITS && picking.has(row.hub)));
  if (!pending) return false;
  // (Other work on its setups under way, a page's or the hub's own: left for the next run.)
  const got: Synced | null = pending.data ? await syncInTurn(env, {id: pending.hub, data: pending.data}, '', SYNC_BUDGET).catch(error => ({state: 'error', message: (error as Error).message})) : {state: 'ok'};
  if (!got) return true;
  // A change that reached the apps is told to the address the hub's manager set, if any (notice.ts).
  if (pending.data) await homeChanged(env, pending.hub, got);
  if (got.state !== 'ok') console.error('foryou sync', got.state, got.more ? 'more' : '');
  // Still more to do (a few setups a run) is not a failed try; anything else short of done is, and is let go after a few. A flag
  // made again meanwhile (`at` moved on) stays for the next run.
  if (got.state === 'ok' || (!got.more && pending.tries + 1 >= SYNC_TRIES)) await env.DB.prepare('DELETE FROM foryou_sync WHERE hub = ? AND at = ?').bind(pending.hub, pending.at).run();
  else await env.DB.prepare('UPDATE foryou_sync SET tries = tries + ? WHERE hub = ? AND at = ?').bind(got.more ? 0 : 1, pending.hub, pending.at).run();
  return true;
}
/* The hubs with someone the day's step (forYou) has yet to pick for, as it sees them. */
async function dueHubs(env: Env, time: number): Promise<Set<string>> {
  const date = new Date(time), day = date.toISOString().slice(0, 10), picking = date.getUTCHours() >= pickHour(env);
  const [hubs, groups, people, kept] = await env.DB.batch([env.DB.prepare('SELECT id, data FROM hubs'), env.DB.prepare('SELECT hub, id, data FROM groups'), env.DB.prepare('SELECT hub, id, grp, data FROM people'), env.DB.prepare('SELECT hub, person, day, sig FROM foryou')]);
  const had = new Map((kept.results as {hub: string; person: string; day: string; sig: string}[]).map(row => [`${row.hub}/${row.person}`, row])), out = new Set<string>();
  for (const row of people.results as {hub: string; id: string; grp: string; data: string}[]) {
    const hub = (hubs.results as {id: string; data: string}[]).find(item => item.id === row.hub), group = (groups.results as {hub: string; id: string; data: string}[]).find(item => item.hub === row.hub && item.id === row.grp);
    if (!hub || !group) continue;
    const top = JSON.parse(hub.data) as {rows: Row[]; defaults: Settings}, theirs = JSON.parse(group.data) as {rows: Row[] | null; settings: Partial<Settings>}, own = JSON.parse(row.data) as PersonData;
    const {places, sig} = placesOf(own, theirs.rows ?? top.rows, {...top.defaults, ...theirs.settings, ...own.settings} as Settings), before = had.get(`${row.hub}/${row.id}`);
    // Only someone with a place to pick for: anyone else is done in passing, and changes nothing in the apps.
    if (places.length && !(before?.day === (picking || !before ? day : before.day) && before.sig === sig)) out.add(row.hub);
  }
  return out;
}
/* What could fill someone's places now, worked out within the run's calls, and the titles they left out for good. */
async function gather(env: Env, item: Due, time: number) {
  const key = await getSecret<string>(env, item.hub, HUB, 'key:tmdb');
  const [cache, plays] = await env.DB.batch([env.DB.prepare('SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND at > ?').bind(item.hub, TMDB_OWNER, now() - 3 * DAY),
    env.DB.prepare('SELECT item, ids, detail, place, updated FROM plays WHERE hub = ? AND person = ? AND unwatched = 0 ORDER BY updated DESC LIMIT 300').bind(item.hub, item.person)]);
  const ask: Ask = {env, hub: item.hub, key: key ?? '', held: new Map((cache.results as {kind: string; at: number; body: string}[]).map(row => [row.kind, row])), calls: {left: key ? CALLS : 0}, writes: []};
  const played = (plays.results as {item: string; ids: string | null; detail: string; place: string | null; updated: number}[]).map(play => {
    let ids: {show?: {ids?: {tmdb?: number}}} | null = null; try {ids = play.ids ? JSON.parse(play.ids) : null;} catch {ids = null;}
    return {item: ids?.show?.ids?.tmdb ? `tmdb:${ids.show.ids.tmdb}` : play.item, detail: play.detail, at: play.updated, place: play.place ?? ''};
  });
  const country = /, ([A-Z]{2})$/.exec(played.find(play => play.place)?.place ?? '')?.[1] ?? '';
  const {limit, forYouOff: off = [], forYouBecause} = item.settings, never = read<{seed: string}[]>(item.before?.never, []).map(left => left.seed);
  const following = new Set((limit === 'all' && !off.includes('pickup') ? await upNextOf(env, item.hub, item.person).catch(() => [] as Item[]) : []).map(show => show.tmdb ?? 0));
  // Read as far back as DEEP titles, so older watching can seed a row too (a few pages of Trakt history; MDBList comes whole).
  const watched: Item[] = (await watchedOf(env, item.hub, item.person, DEEP).catch(() => null))?.items ?? [];
  const {found, none} = await candidates(ask, watched, played, following, country, limit, off, time, never, forYouBecause === 'any').catch(error => {console.error('foryou', (error as Error).message); return {found: [] as Candidate[], none: {}};});
  return {ask, found, none, never};
}

/* ---------- after a finished watch ---------- */
/* `seen`: the titles finished lately (newest first), each of which counts once; `due`: when one was finished and not yet picked
   from; `at`: when a row was picked again for one, so it happens at most FRESH times a day. */
interface Fresh {seen?: string[]; due?: number; at?: number[]}
const FRESH = 3, SEEN = 30;
/* A title someone played to the end (front.ts): the next run picks one of their For you rows again, so what they just watched can
   come up within minutes. Only for someone picked for already; a title finished again counts no more. Over what was read only, so
   a run or another report meanwhile is never undone. */
export async function finished(env: Env, hub: string, person: string, title: string) {
  if (env.FRONT !== 'aiometadata') return;
  const row = await env.DB.prepare('SELECT fresh FROM foryou WHERE hub = ? AND person = ?').bind(hub, person).first<{fresh: string}>();
  const was = read<Fresh>(row?.fresh, {});
  if (!row || was.seen?.includes(title)) return;
  await env.DB.prepare('UPDATE foryou SET fresh = ? WHERE hub = ? AND person = ? AND fresh = ?').bind(JSON.stringify({...was, seen: [title, ...was.seen ?? []].slice(0, SEEN), due: now()}), hub, person, row.fresh).run();
}
/* A title marked unwatched in an app (front.ts, unmarked): it no longer counts as finished lately, so finishing it again counts
   again; and when it was the latest finish, the pick it had coming is let go. Over what was read only, as above. */
export async function unfinished(env: Env, hub: string, person: string, title: string) {
  if (env.FRONT !== 'aiometadata') return;
  const row = await env.DB.prepare('SELECT fresh FROM foryou WHERE hub = ? AND person = ?').bind(hub, person).first<{fresh: string}>();
  const was = read<Fresh>(row?.fresh, {});
  if (!row || !was.seen?.includes(title)) return;
  await env.DB.prepare('UPDATE foryou SET fresh = ? WHERE hub = ? AND person = ? AND fresh = ?').bind(JSON.stringify({...was, seen: was.seen.filter(seen => seen !== title), ...(was.seen[0] === title ? {due: 0} : {})}), hub, person, row.fresh).run();
}
/* The run's step for someone who finished something: the lowest of their places not kept is picked again by the same rule (the
   others stay and count as their kinds' picks), with what they just watched among the seeds. What it held counts as lately picked.
   At most FRESH a day; past that, or with every place kept, the finish is let go. */
async function again(env: Env, item: Due, time: number, writes: D1PreparedStatement[], keep: (item: Due, picks: Record<string, Pick>, pool?: Pool, recent?: string[]) => D1PreparedStatement, changed: (item: Due, picks: Record<string, Pick>) => boolean): Promise<boolean> {
  const was = read<Fresh>(item.before!.fresh, {}), today = (was.at ?? []).filter(at => at > now() - DAY), held = read<Record<string, Pick>>(item.before!.picks, {});
  const {limit, forYouOff: off = [], forYouOrder: order} = item.settings;
  const place = [...item.places].reverse().find(place => held[place] && !(held[place].keep && allowed(held[place], limit, off))), go = !!place && today.length < FRESH;
  const done = env.DB.prepare('UPDATE foryou SET fresh = ? WHERE hub = ? AND person = ? AND fresh = ?').bind(JSON.stringify({...was, due: 0, at: go ? [now(), ...today] : today}), item.hub, item.person, item.before!.fresh);
  if (!go) {await env.DB.batch([...writes, done]); return true;}
  const {ask, found, none} = await gather(env, item, time), recent = lately(item.before, item.day);
  const chosen = choose(found, [place!], recent, time, item.places.filter(other => other !== place && held[other]).map(other => held[other]), order);
  const pick = chosen.picks[place!], picks = pick ? {...held, [place!]: pick} : held, moved = !!pick && pick.key !== held[place!].key;
  await env.DB.batch([...writes, ...ask.writes, keep(item, picks, {options: chosen.pool, none}, moved ? [held[place!].key, ...recent.filter(key => key !== held[place!].key)].slice(0, REMEMBER) : recent), done, ...(changed(item, picks) ? [flag(env, item.hub)] : [])]);
  return true;
}
const keysOf = (picks: string) => Object.values(read<Record<string, Pick>>(picks, {})).map(pick => pick.key);
/* The keys of the latest days' picks, newest first, for rotation (choose): a new day puts the last day's in front of what was kept;
   picking again on the same day keeps what was kept. */
function lately(before: {day: string; picks: string; before: string} | undefined, day: string): string[] {
  if (!before) return [];
  const kept = read<string[]>(before.before || '[]', []);
  return before.day === day ? kept : [...new Set([...keysOf(before.picks), ...kept])].slice(0, REMEMBER);
}
/* A hub's setups are to be saved again by the cron (forYou, above), in the first run with nothing else to do. Also asked by
   api.ts when someone's Watchlist switch is turned, so their setup follows even if the page was closed before it synced. */
export const flag = (env: Env, hub: string) => env.DB.prepare('INSERT INTO foryou_sync (hub, at, tries) VALUES (?, ?, 0) ON CONFLICT (hub) DO UPDATE SET at = excluded.at, tries = 0').bind(hub, now());

/* ---------- from a Home ---------- */
/* Asked from a For you row's Edit sheet (api.ts), by the person or their manager. `use`: one of the day's other options goes in this
   place at once (nothing is asked of TMDB; what it held goes back among the options and counts as lately picked). `keep`: the place
   keeps its pick at the daily pick, or lets it change again. `never`: the title this pick came from is never picked from again,
   and the place takes the best option not from it. A change to what fills a place brings the hub's setups in step, as a day's
   picking does. Only over the picks and options it read, so a run that picked meanwhile is not undone. An error to show, or ''. */
export async function placeAsked(env: Env, hub: string, person: string, place: string, asked: {use?: string; keep?: boolean; never?: boolean}): Promise<string> {
  const row = await env.DB.prepare('SELECT picks, before, pool, never FROM foryou WHERE hub = ? AND person = ?').bind(hub, person).first<{picks: string; before: string; pool: string; never: string}>();
  const picks = read<Record<string, Pick>>(row?.picks, {}), pick = picks[place], pool = read<Pool>(row?.pool, {}), options = pool.options ?? [];
  if (!row || !pick) return 'Nothing is picked here yet.';
  const elsewhere = (key: string) => Object.entries(picks).some(([other, item]) => other !== place && item.key === key);
  let never = read<{seed: string; title: string}[]>(row.never, []), next: Pick | undefined = pick, rest = options;
  if (asked.keep !== undefined) {const {keep: _, ...bare} = pick; next = asked.keep ? {...bare, keep: true} : bare;}
  else if (asked.use !== undefined) {
    const option = options.find(item => item.key === asked.use);
    if (!option) return 'That option is gone. The page has been refreshed.';
    if (elsewhere(option.key)) return 'That one is on another For you row already.';
    // A place kept stays kept with what it holds now.
    next = {...option, ...(pick.keep ? {keep: true} : {})}; rest = options.filter(item => item.key !== option.key);
  } else if (asked.never) {
    if (!pick.seed) return 'This row isn’t worked out from a title.';
    never = [{seed: pick.seed, title: pick.why?.title ?? pick.name}, ...never.filter(item => item.seed !== pick.seed)].slice(0, NEVER);
    rest = options.filter(item => item.seed !== pick.seed);
    // The best option left; with none, the place holds its stand-in (placePick) until the next pick.
    next = rest.find(item => !elsewhere(item.key)); rest = rest.filter(item => item !== next);
  }
  // What a place held goes back among the options, first (it came before them in the day's order), unless it is not to be picked
  // from again.
  const back = next?.key !== pick.key && !(asked.never && pick.seed) ? [(({keep: _, ...item}) => item)(pick)] : [];
  const out = {...picks}; if (next) out[place] = next; else delete out[place];
  const recent = next?.key !== pick.key ? [pick.key, ...read<string[]>(row.before, []).filter(key => key !== pick.key)].slice(0, REMEMBER) : read<string[]>(row.before, []);
  const done = await env.DB.prepare('UPDATE foryou SET picks = ?, pool = ?, never = ?, before = ? WHERE hub = ? AND person = ? AND picks = ? AND pool = ?')
    .bind(JSON.stringify(out), JSON.stringify({...pool, options: [...back, ...rest]}), JSON.stringify(never), JSON.stringify(recent), hub, person, row.picks, row.pool).run();
  if (!done.meta.changes) return 'This changed meanwhile. Try again.';
  if (!same(picks, out)) await flag(env, hub).run();
  return '';
}
/* A title left out for good counts again, from the next daily pick. */
export async function pickFromAgain(env: Env, hub: string, person: string, seed: string) {
  const row = await env.DB.prepare('SELECT never FROM foryou WHERE hub = ? AND person = ?').bind(hub, person).first<{never: string}>();
  if (row) await env.DB.prepare('UPDATE foryou SET never = ? WHERE hub = ? AND person = ? AND never = ?').bind(JSON.stringify(read<{seed: string}[]>(row.never, []).filter(item => item.seed !== seed)), hub, person, row.never).run();
}
