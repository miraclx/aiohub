/* Recommended Movies and Recommended Shows without Trakt, and under a content limit.
   With Trakt connected and answering, and no content limit, the two rows are Trakt's own recommendations (rows.ts). Otherwise they
   are worked out here the way For you's "because you watched" is: TMDB's recommendations for the last SEEDS titles the person
   watched (their Trakt, their MDBList and what they played here, as one list: watchedOf in rows.ts), a title from each in turn,
   less anything they watched or have on a watchlist. It blends them and names none. Nothing watched: nothing listed.
   Under a content limit a title is listed only once TMDB says it carries a US rating the limit lets through (CERTS in data.ts);
   one with no rating, or one not looked up yet, is left out, and so is anything TMDB marks adult, whatever the limit. That goes
   for Trakt's own recommendations too: under a limit they are listed only as far as they pass, ahead of what was worked out.
   This is the hub's own check. AIOMetadata has the person's limit as well, but nothing here shows that it applies it to a row
   the hub serves.
   All of it takes more calls than a row may make when it is asked for, so a cron step (the last of a run, index.ts) works it out
   ahead, one person a run and once a day each, from HOUR (UTC) like the day's other work, and keeps it by hub and person (rows_cache, RECS): the two lists, the limit they
   were made under, and each rating looked up, so a rating is asked for once. TMDB is asked with that hub's own key only, and its
   answers are kept a day per hub with For you's (they are not personal). A run makes at most CALLS calls; under a limit what is
   left to look up is done on the next runs. */
import {CERTS, rowsOf} from '../src/data';
import type {Limit, Row, Settings} from '../src/data';
import type {Env} from './util';
import {getSecret, now} from './util';
import {listedOf, watchedOf} from './rows';
import type {Item} from './rows';
import {TMDB_OWNER, limitOf, recommended, seenSet, tagOf, tmdb, unseen} from './foryou';
import {LINK} from './trakt';
import type {Ask} from './foryou';

export const RECS = 'recs', AHEAD = 'ahead';
// Tried again this long after a run with nothing watched to go on (or no TMDB key yet), and after one with ratings still to look up.
// A run reads their watching and watchlist first (a page of each), so it asks TMDB less than a For you run does.
const CALLS = 16, DAY = 86400, HOUR = 4, SEEDS = 10, MOST = 60, CERTS_KEPT = 800, RETRY = 6 * 3600, SOON = 600, HUB = '#hub';
// `ran`: when it was last worked out (its row's own time says when it is due again).
interface Built {limit: Limit; movie: Item[]; series: Item[]; certs: Record<string, string>; ran?: number}
const read = (text: string | null | undefined): Built => {
  try {const kept = JSON.parse(text ?? '') as Partial<Built>; return {limit: kept.limit ?? 'all', movie: kept.movie ?? [], series: kept.series ?? [], certs: kept.certs ?? {}};} catch {return {limit: 'all', movie: [], series: [], certs: {}};}
};
/* Whether a title's US rating passes a limit: every rating it carries is one the limit lets through. None known: no. */
const passes = (type: 'movie' | 'series', cert: string | undefined, limit: Limit) => {
  const let_ = CERTS[limit]?.[type].split('|') ?? [], had = (cert ?? '').split('|').filter(Boolean);
  return had.length > 0 && had.every(rating => let_.includes(rating));
};

/* ---------- serving the two rows (rows.ts) ---------- */
/* `theirs`: Trakt's own recommendations of this type, when it is connected and has given any. */
export async function recommendedOf(env: Env, hub: string, person: string, type: 'movie' | 'series', theirs: Item[]): Promise<Item[]> {
  const limit = await limitOf(env, hub, person);
  if (!limit) return [];
  if (limit === 'all' && theirs.length) return theirs;
  const kept = read((await env.DB.prepare('SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, RECS).first<{items: string}>())?.items);
  if (limit === 'all') return kept[type];
  const fits = (item: Item) => !!item.tmdb && passes(type, kept.certs[tagOf({type, tmdb: item.tmdb})], limit), seen = new Set<string>();
  return [...theirs.filter(fits), ...kept[type].filter(fits)].filter(item => !seen.has(`${item.tmdb}`) && !!seen.add(`${item.tmdb}`));
}

/* ---------- the cron step ---------- */
/* A title's US ratings on TMDB, as "PG" or "PG|PG-13" (a film can carry one for each cut), '' when it has none. null when TMDB
   did not answer. */
const certOf = (ask: Ask, type: 'movie' | 'series', id: number) => type === 'movie'
  ? tmdb(ask, `movie/${id}/release_dates`, body => [...new Set(((body as {results?: {iso_3166_1?: string; release_dates?: {certification?: string}[]}[]}).results ?? []).filter(item => item.iso_3166_1 === 'US').flatMap(item => item.release_dates ?? []).map(item => String(item.certification ?? '').trim()).filter(Boolean))].join('|'))
  : tmdb(ask, `tv/${id}/content_ratings`, body => String(((body as {results?: {iso_3166_1?: string; rating?: string}[]}).results ?? []).find(item => item.iso_3166_1 === 'US')?.rating ?? '').trim());
/* Everyone, with their hub's and group's Home and settings, and what the day's two steps kept for each (this one, and ahead.ts):
   read once a run for both. `kept` goes by hub, person and kind; `linked`, whose Trakt is connected to the hub, by hub and person. */
export interface Scan {
  tops: Map<string, {rows: Row[]; defaults: Settings}>; groups: {hub: string; id: string; data: string}[]; people: {hub: string; id: string; grp: string; data: string}[];
  kept: Map<string, {hub: string; person: string; kind: string; at: number; made: string | null}>; linked: Set<string>;
}
export async function scan(env: Env): Promise<Scan> {
  const [hubs, groups, people, had, links] = await env.DB.batch([env.DB.prepare('SELECT id, data FROM hubs'), env.DB.prepare('SELECT hub, id, data FROM groups'), env.DB.prepare('SELECT hub, id, grp, data FROM people ORDER BY hub, created, id'),
    env.DB.prepare("SELECT hub, person, kind, at, json_extract(items, '$.limit') AS made FROM rows_cache WHERE kind IN (?, ?)").bind(RECS, AHEAD), env.DB.prepare('SELECT hub, owner FROM secrets WHERE kind = ?').bind(LINK)]);
  return {tops: new Map((hubs.results as {id: string; data: string}[]).map(row => [row.id, JSON.parse(row.data) as {rows: Row[]; defaults: Settings}])), groups: groups.results as Scan['groups'], people: people.results as Scan['people'],
    kept: new Map((had.results as {hub: string; person: string; kind: string; at: number; made: string | null}[]).map(row => [`${row.hub}/${row.person}/${row.kind}`, row])),
    linked: new Set(env.TRAKT_CLIENT_ID ? (links.results as {hub: string; owner: string}[]).map(row => `${row.hub}/${row.owner}`) : [])};
}
/* The UTC hour from which the day's two steps run (RECS_HOUR, else 4). */
export const dayHour = (env: Env) => Number(env.RECS_HOUR ?? HOUR);
/* One step, from HOUR (RECS_HOUR, else 4): the next person whose Recommended rows are on a Home of theirs and were not worked out
   in the last day (or under the limit they have now) has them worked out and kept. `when` is when the run was due. True when
   there was one, or when rows kept for Homes that no longer have them were let go (so the run does nothing more). */
export async function recommend(env: Env, when: number, all?: Scan): Promise<boolean> {
  if (new Date(when).getUTCHours() < dayHour(env)) return false;
  const {tops, groups, people, kept} = all ?? await scan(env), time = now();
  let next: {hub: string; person: string; limit: Limit} | undefined;
  const off: D1PreparedStatement[] = [];
  for (const row of people) {
    const top = tops.get(row.hub), group = groups.find(item => item.hub === row.hub && item.id === row.grp);
    if (!top || !group) continue;
    const theirs = JSON.parse(group.data) as {rows: Row[] | null; settings: Partial<Settings>}, own = JSON.parse(row.data) as {rows: Row[] | null; picks?: Record<string, boolean>; settings: Partial<Settings>};
    const limit = {...top.defaults, ...theirs.settings, ...own.settings}.limit ?? 'all', before = kept.get(`${row.hub}/${row.id}/${RECS}`);
    // Whether either row is on their Home, whatever accounts they have: without anything watched there is simply nothing to keep.
    const on = rowsOf(own.rows, theirs.rows ?? top.rows, {trakt: true, lists: true, watched: true}, own.picks).some(item => item.on && (item.id === 'recommended-movies' || item.id === 'recommended-series'));
    if (on && (!before || time - before.at >= DAY || (before.made ?? 'all') !== limit)) {next = {hub: row.hub, person: row.id, limit}; break;}
    // Both rows taken off their Home: what was kept for them goes, and is not worked out again.
    if (!on && before) off.push(env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(row.hub, row.id, RECS));
  }
  if (off.length) await env.DB.batch(off.slice(0, 20));
  if (!next) return off.length > 0;
  const {hub, person, limit} = next, key = await getSecret<string>(env, hub, HUB, 'key:tmdb');
  const [cache, mine] = await env.DB.batch([env.DB.prepare('SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND at > ?').bind(hub, TMDB_OWNER, time - 3 * DAY),
    // What was kept for them before (its ratings stay), and Trakt's own recommendations as last read, to rate under a limit.
    env.DB.prepare("SELECT kind, items FROM rows_cache WHERE hub = ? AND person = ? AND kind IN (?, 'movies', 'shows')").bind(hub, person, RECS)]);
  const of = (kind: string) => (mine.results as {kind: string; items: string}[]).find(row => row.kind === kind)?.items, before = read(of(RECS));
  const ask: Ask = {env, hub, key: key ?? '', held: new Map((cache.results as {kind: string; at: number; body: string}[]).map(row => [row.kind, row])), calls: {left: key ? CALLS : 0}, writes: []};
  const watched = await watchedOf(env, hub, person, true).catch(() => [] as Item[]), seeds = watched.filter(item => item.tmdb).slice(0, SEEDS);
  // Left out: what they watched, and what is on their watchlist already.
  const seen = seenSet([...watched, ...(seeds.length ? await listedOf(env, hub, person).catch(() => [] as Item[]) : [])]);
  const lists: Record<'movie' | 'series', Item[][]> = {movie: [], series: []};
  for (const seed of seeds) lists[seed.type].push(unseen(await recommended(ask, seed.type, seed.tmdb!) ?? [], seed.type, seen).map(title => ({id: `tmdb:${title.id}`, type: seed.type, name: title.t, tmdb: title.id})));
  // A title from each in turn (the newest watched first), each once.
  const blend = (from: Item[][]) => {
    const out: Item[] = [], had = new Set<string>();
    for (let n = 0; n < 20 && out.length < MOST; n++) for (const list of from) if (list[n] && !had.has(list[n].id) && out.length < MOST) {had.add(list[n].id); out.push(list[n]);}
    return out;
  };
  const built: Built = {limit, movie: blend(lists.movie), series: blend(lists.series), certs: before.certs, ran: time};
  let more = false;
  if (limit !== 'all') {
    // Ratings, for Trakt's own first and then these, a movie and a show in turn so neither row waits for the other.
    const trakt = (kind: string, type: 'movie' | 'series') => {try {return (JSON.parse(of(kind) ?? '[]') as Item[]).filter(item => item.tmdb).map(item => ({...item, type}));} catch {return [] as Item[];}};
    const films = [...trakt('movies', 'movie'), ...built.movie], shows = [...trakt('shows', 'series'), ...built.series];
    for (let n = 0; n < Math.max(films.length, shows.length) && !more; n++) for (const item of [films[n], shows[n]]) {
      const tag = item ? tagOf({type: item.type, tmdb: item.tmdb}) : '';
      if (!item || built.certs[tag] !== undefined) continue;
      // Out of calls: the rest on the next runs. One TMDB did not answer for is left for tomorrow, and left out until then.
      if (ask.calls.left <= 0) {more = true; break;}
      const cert = await certOf(ask, item.type, item.tmdb!);
      if (cert !== null) built.certs = {...built.certs, [tag]: cert};
    }
    // The newest looked up are kept when there are too many.
    built.certs = Object.fromEntries(Object.entries(built.certs).slice(-CERTS_KEPT));
  }
  // Nothing to go on yet is looked at again sooner than a day; ratings left to look up, on the next runs.
  const at = more ? time - DAY + SOON : seeds.length && key ? time : time - DAY + RETRY;
  await env.DB.batch([...ask.writes, env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND at < ?').bind(hub, TMDB_OWNER, time - 3 * DAY), env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items').bind(hub, person, RECS, at, JSON.stringify(built))]);
  return true;
}
