/* The content limit on every list the hub hands to a person's apps: one rule, in one place.
   AIOMetadata applies a person's limit to the rows it builds itself. A row the hub makes (rows.ts: the Watchlist, Recently
   Watched, Recommended, Up Next, New for you, one of their Trakt lists, a For you row the hub fills) is handed over as a
   finished list, so the hub checks it: every such list leaves through `fitting`, below, as it is asked for (rows.ts, rows).
   A row added later is filtered too, because there is no other way out.
   - The limit is the person's as it stands at that moment (foryou.ts, limitOf: their own, else their group's, else the hub's),
     so a change by the manager counts the next time a row is read. Nothing kept is filtered: the lists stay whole.
   - What a limit lets through is CERTS in data.ts, the same US ratings AIOMetadata is asked for: every rating a title carries
     must be one of them (`passes`). A title with no US rating is left out under either limit, and so is one whose rating has
     not been looked up yet.
   - Ratings are kept by hub and person (rows_cache, RATINGS): each title's US rating as TMDB gave it ('' for none), by TMDB id,
     and the TMDB id of a title known only by its IMDb id. The ratings the Recommended rows looked up (recs.ts) count as well.
   - Reading a row looks nothing up. A title it has no rating for is noted as wanted (one write, and only when there is a new
     one), and a cron step (`rate`, the last of a run: index.ts) looks up the wanted titles of one person a run, CALLS calls at
     most, with that hub's own TMDB key, through the answers kept a day per hub (foryou.ts, tmdb). So a row is short, or empty,
     until its titles are rated, and fills in over the next runs.
   Nothing here changes what anyone watched or has on a list: only what a row lists. */
import {CERTS} from '../src/data';
import type {Limit} from '../src/data';
import type {Env} from './util';
import {getSecret, now} from './util';
import {TMDB_OWNER, limitOf, tagOf, tmdb} from './foryou';
import type {Ask} from './foryou';

// RECS: what the Recommended rows keep (recs.ts), whose ratings count here too.
export const RATINGS = 'certs', RECS = 'recs';
// CALLS: the TMDB calls one run makes at most (a title known by its TMDB id takes one, one known only by its IMDb id two).
// WANT: the titles that may wait for one person. KEPT: the ratings kept for one person, the newest. A title TMDB did not
// answer for is not asked about again for a day.
const CALLS = 20, WANT = 300, KEPT = 3000, DAY = 86400, RETRY = 6 * 3600, HUB = '#hub';
export interface Rated {id: string; type: 'movie' | 'series'; tmdb?: number}
/* `certs`: US ratings by tag (foryou.ts, tagOf). `ids`: the TMDB id of a title known only by its IMDb id (0: TMDB has none).
   `want`: the titles to look up, the latest asked for first. `miss`: when TMDB last did not answer for one. `ran`: the last look. */
interface Kept {certs: Record<string, string>; ids: Record<string, number>; want: Rated[]; miss: Record<string, number>; ran?: number}
const read = (text: string | null | undefined): Kept => {
  try {const kept = JSON.parse(text ?? '') as Partial<Kept>; return {certs: kept.certs ?? {}, ids: kept.ids ?? {}, want: Array.isArray(kept.want) ? kept.want : [], miss: kept.miss ?? {}};} catch {return {certs: {}, ids: {}, want: [], miss: {}};}
};
const keyOf = (item: Rated) => `${item.type}:${item.id}`;
/* A title's TMDB id: its own, or the one found for its IMDb id. 0 when TMDB has none; undefined while that is not known. */
const idOf = (kept: Kept, item: Rated): number | undefined => item.tmdb || Number(/^tmdb:(\d+)$/.exec(item.id)?.[1]) || kept.ids[keyOf(item)];

/* Whether a title's US rating passes a limit: every rating it carries is one the limit lets through. None known: no. */
export const passes = (type: 'movie' | 'series', cert: string | undefined, limit: Limit) => {
  const let_ = CERTS[limit]?.[type].split('|') ?? [], had = (cert ?? '').split('|').filter(Boolean);
  return had.length > 0 && had.every(rating => let_.includes(rating));
};
/* A title's US ratings on TMDB, as "PG" or "PG|PG-13" (a film can carry one for each cut), '' when it has none. null when TMDB
   did not answer. */
export const certOf = (ask: Ask, type: 'movie' | 'series', id: number) => type === 'movie'
  ? tmdb(ask, `movie/${id}/release_dates`, body => [...new Set(((body as {results?: {iso_3166_1?: string; release_dates?: {certification?: string}[]}[]}).results ?? []).filter(item => item.iso_3166_1 === 'US').flatMap(item => item.release_dates ?? []).map(item => String(item.certification ?? '').trim()).filter(Boolean))].join('|'))
  : tmdb(ask, `tv/${id}/content_ratings`, body => String(((body as {results?: {iso_3166_1?: string; rating?: string}[]}).results ?? []).find(item => item.iso_3166_1 === 'US')?.rating ?? '').trim());
/* The film or show TMDB has under an IMDb id. */
export const found = (ask: Ask, imdb: string) => tmdb(ask, `find/${imdb}?external_source=imdb_id`, body => {
  const b = body as {movie_results?: {id?: number}[]; tv_results?: {id?: number}[]};
  return {m: Number(b.movie_results?.[0]?.id) || 0, s: Number(b.tv_results?.[0]?.id) || 0};
});
const keptOf = async (env: Env, hub: string, person: string) => {
  const rows = (await env.DB.prepare('SELECT kind, items FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (?, ?)').bind(hub, person, RATINGS, RECS).all<{kind: string; items: string}>()).results;
  const kept = read(rows.find(row => row.kind === RATINGS)?.items);
  // What the Recommended rows looked up counts too; a rating kept here wins.
  return {kept, certs: {...read(rows.find(row => row.kind === RECS)?.items).certs, ...kept.certs}};
};

/* ---------- the one filter ---------- */
/* The titles of a list that a person's limit lets through, in the list's own order. No limit: the list as it is, and nothing is
   read. A title with no rating kept is left out and noted as wanted, for the cron step to look up. `told`, when given, hears
   how many were left out only because their rating is not known yet. */
export async function fitting<T extends Rated>(env: Env, hub: string, person: string, limit: Limit, items: T[], told?: {unknown: number}): Promise<T[]> {
  if (!CERTS[limit] || !items.length) return items;
  const {kept, certs} = await keptOf(env, hub, person), time = now(), waiting = new Set(kept.want.map(keyOf)), want: Rated[] = [];
  const out = items.filter(item => {
    const id = idOf(kept, item), cert = id ? certs[tagOf({type: item.type, tmdb: id})] : id === 0 ? '' : undefined;
    if (cert !== undefined) return passes(item.type, cert, limit);
    const key = keyOf(item);
    if (told) told.unknown++;
    if (!waiting.has(key) && !((kept.miss[key] ?? 0) > time - DAY)) {waiting.add(key); want.push({id: item.id, type: item.type, ...(id ? {tmdb: id} : {})});}
    return false;
  });
  // Added to what waits in one statement, so rows read at the same moment (a Home opening) never lose each other's, and a
  // title two of them list waits once.
  if (want.length) await env.DB.prepare(`INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?1, ?2, ?3, 0, json_object('certs', json('{}'), 'ids', json('{}'), 'miss', json('{}'), 'want', json(?4)))
    ON CONFLICT (hub, person, kind) DO UPDATE SET items = json_set(rows_cache.items, '$.want', (SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(?4) UNION ALL SELECT value FROM json_each(rows_cache.items, '$.want') WHERE value NOT IN (SELECT value FROM json_each(?4)) LIMIT ?5)))`)
    .bind(hub, person, RATINGS, JSON.stringify(want.slice(0, WANT)), WANT).run();
  return out;
}

/* ---------- the cron step ---------- */
/* One step: the person whose wanted titles have waited longest has some looked up and kept. True when there was one. */
export async function rate(env: Env): Promise<boolean> {
  const time = now(), next = await env.DB.prepare("SELECT hub, person FROM rows_cache WHERE kind = ? AND at <= ? AND json_array_length(items, '$.want') > 0 ORDER BY at LIMIT 1").bind(RATINGS, time).first<{hub: string; person: string}>();
  if (!next) return false;
  const {hub, person} = next, limit = await limitOf(env, hub, person);
  const set = (fields: string, ...values: unknown[]) => env.DB.prepare(`UPDATE rows_cache SET ${fields} WHERE hub = ? AND person = ? AND kind = ?`).bind(...values, hub, person, RATINGS);
  // No limit now (or gone): nothing of theirs waits. The ratings kept stay, for the day a limit is set again.
  if (!limit || !CERTS[limit]) {await set("at = ?, items = json_set(items, '$.want', json('[]'))", time).run(); return true;}
  const key = await getSecret<string>(env, hub, HUB, 'key:tmdb');
  // No TMDB key yet: looked at again later.
  if (!key) {await set('at = ?', time + RETRY).run(); return true;}
  const {kept, certs} = await keptOf(env, hub, person), had = new Set<string>(), want = kept.want.filter(item => item && typeof item.id === 'string' && (item.type === 'movie' || item.type === 'series') && !had.has(keyOf(item)) && !!had.add(keyOf(item)));
  // Only the answers this run may read, of what is kept for the hub today.
  const paths = (item: Rated) => {const id = idOf(kept, item); return id ? [`tmdb:${item.type === 'movie' ? `movie/${id}/release_dates` : `tv/${id}/content_ratings`}`] : id === undefined && /^tt\d+$/.test(item.id) ? [`tmdb:find/${item.id}?external_source=imdb_id`] : [];};
  const kinds = [...new Set(want.slice(0, CALLS * 2).flatMap(paths))].slice(0, 80);
  const cache = kinds.length ? (await env.DB.prepare(`SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (${kinds.map(() => '?').join(', ')})`).bind(hub, TMDB_OWNER, ...kinds).all<{kind: string; at: number; body: string}>()).results : [];
  const ask: Ask = {env, hub, key, held: new Map(cache.map(row => [row.kind, row])), calls: {left: CALLS}, writes: []}, done: string[] = [];
  for (const item of want) {
    const name = keyOf(item);
    let id = idOf(kept, item);
    if (id === undefined) {
      // Known by neither id: never rated, so never listed under a limit. Not asked about again today.
      if (!/^tt\d+$/.test(item.id)) {kept.miss[name] = time; done.push(name); continue;}
      if (ask.calls.left < 2) break;
      const got = await found(ask, item.id);
      if (!got) {kept.miss[name] = time; done.push(name); continue;}
      id = kept.ids[name] = item.type === 'movie' ? got.m : got.s;
    }
    const tag = tagOf({type: item.type, tmdb: id});
    if (id && certs[tag] === undefined) {
      if (ask.calls.left < 1) break;
      const cert = await certOf(ask, item.type, id);
      // One TMDB did not answer for is left out, and asked about again tomorrow if a row still lists it.
      if (cert === null) kept.miss[name] = time; else kept.certs[tag] = certs[tag] = cert;
    }
    done.push(name);
  }
  const lately = Object.fromEntries(Object.entries(kept.miss).filter(([, at]) => at > time - DAY));
  // What was looked up is kept, and what was dealt with leaves what waits, as it is in the database now: a row read meanwhile
  // may have added to it.
  await env.DB.batch([...ask.writes, env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND at < ?').bind(hub, TMDB_OWNER, time - 3 * DAY),
    set(`at = ?, items = json_object('ran', ?, 'certs', json(?), 'ids', json(?), 'miss', json(?), 'want', (SELECT json_group_array(json(w.value)) FROM json_each(rows_cache.items, '$.want') w
      WHERE (json_extract(w.value, '$.type') || ':' || json_extract(w.value, '$.id')) NOT IN (SELECT value FROM json_each(?))))`, time, time, JSON.stringify(Object.fromEntries(Object.entries(kept.certs).slice(-KEPT))), JSON.stringify(Object.fromEntries(Object.entries(kept.ids).slice(-KEPT))), JSON.stringify(lately), JSON.stringify(done))]);
  return true;
}
