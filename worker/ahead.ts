/* Up Next and New for you for someone without Trakt.
   With Trakt connected to the hub both rows are Trakt's own (rows.ts). Without it they come from what the hub itself knows:
   - Up Next: each show they finished an episode of here (played to the end or ticked, as Recently Watched counts it, never one
     marked unwatched since), when TMDB says an episode after the one they finished most lately has come out. The show they
     watched most lately first.
   - New for you: the shows they played here and the titles on their watchlist (as the Watchlist row has it: their MDBList's,
     without Trakt), where TMDB says an episode, or the film to watch at home (a digital, disc or TV release, the US one where
     there is one), came out in the last RECENT days. Newest first, a show once by its newest episode out. A title leaves once
     they started it here, or their MDBList has the film as watched.
   What has come out takes more calls than a row may make when it is asked for, so a cron step (the last of a run, after the
   Recommended rows: index.ts) looks it up ahead, one person a run and once a day each, from the same hour, and keeps it by hub
   and person (rows_cache, AHEAD): each show's newest and next episode with their days, each film's day, and the New for you
   list. Reading a row asks nobody: Up Next sets what they finished (the plays table, read then) against what was kept, so an
   episode finished a moment ago counts at once. A title played to the end has the step look again on its next run
   (watchedMore), so a show just begun is in Up Next within minutes rather than tomorrow. Two limits: the step only runs from
   its hour (a show begun between midnight UTC and then waits for it), and a tick as watched does not ask for a look (a show
   only ever ticked is looked up at the day's look).
   TMDB is asked with that hub's own key only, and its answers are kept a day per hub with For you's (they are not personal).
   A run makes at most CALLS calls and looks at the SHOWS shows played most lately and the first LISTED titles of the
   watchlist; what is left is looked up on the next runs. A film's day, once it is out, is kept and not asked for again.
   Only for someone with either row on a Home of theirs; taken off, what was kept goes. */
import {rowsOf} from '../src/data';
import type {Row, Settings} from '../src/data';
import type {Env} from './util';
import {getSecret, now} from './util';
import {goneKey, keysOf, listedOf, nth, showsHere, startedIn} from './rows';
import type {Fresh, Item} from './rows';
import {TMDB_OWNER, show, tmdb} from './foryou';
import type {Ask} from './foryou';
import {AHEAD, dayHour, recommend, scan} from './recs';
import type {Scan} from './recs';

const CALLS = 16, DAY = 86400, SHOWS = 40, LISTED = 60, RECENT = 99 * DAY, NEW_MOST = 50, SOON = 600, RETRY = 6 * 3600, IDS = 400, SETTLED = 365 * DAY, FORGET = 30 * DAY, HUB = '#hub';
/* A show as TMDB last had it: its newest episode out and the next to come, each as one number (rows.ts, nth; -1 for none) with
   its day (unix seconds, 0 when TMDB gives none), and when it was looked up. */
interface Look {t: string; last: number; aired: number; next: number; nextAt: number; at: number}
/* A film: the day it came out to watch at home (0 while TMDB gives none), and when it was looked up. `done`: nothing more to
   ask, as it is out, or is over a year old with no such day. */
interface Film {out: number; at: number; done?: 1}
/* `ids`: the TMDB id of a title known here only by its IMDb id (0: TMDB has none), found once. `shows` and `films` go by TMDB id. */
interface Built {ran?: number; ids: Record<string, number>; shows: Record<string, Look>; films: Record<string, Film>; fresh: Fresh[]; gone: Record<string, number>}
const read = (text: string | null | undefined): Built => {
  try {const kept = JSON.parse(text ?? '') as Partial<Built>; return {ids: kept.ids ?? {}, shows: kept.shows ?? {}, films: kept.films ?? {}, fresh: kept.fresh ?? [], gone: kept.gone ?? {}};} catch {return {ids: {}, shows: {}, films: {}, fresh: [], gone: {}};}
};
const keptOf = async (env: Env, hub: string, person: string) => read((await env.DB.prepare('SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, AHEAD).first<{items: string}>())?.items);
const idOf = (kept: Built, item: Item) => item.tmdb ?? kept.ids[item.id] ?? 0;
const dayAt = (day: string | undefined) => Math.floor(Date.parse(`${day ?? ''}T00:00:00Z`) / 1000) || 0;

/* ---------- serving the two rows (rows.ts) ---------- */
/* Up Next: the shows with an episode out after the one they finished most lately, the show watched most lately first. */
export async function nextHere(env: Env, hub: string, person: string): Promise<Item[]> {
  const kept = await keptOf(env, hub, person), time = now();
  if (!Object.keys(kept.shows).length) return [];
  const {shows} = await showsHere(env, hub, person);
  return shows.filter(item => item.done >= 0).sort((a, b) => b.doneAt - a.doneAt).filter(item => {
    const look = kept.shows[idOf(kept, item)];
    return !!look && (look.last > item.done || (look.next > item.done && look.nextAt > 0 && look.nextAt <= time));
  });
}
/* New for you: what was kept, less what they started here since. */
export async function freshHere(env: Env, hub: string, person: string): Promise<Item[]> {
  const kept = await keptOf(env, hub, person);
  if (!kept.fresh.length) return [];
  const {here} = await showsHere(env, hub, person);
  return kept.fresh.filter(item => !startedIn(here, item));
}
/* A finished watch (front.ts): the step looks again on its next run, so a show just begun is looked up. Only what is kept
   already is marked; someone with neither row on has nothing kept. */
export const watchedMore = (env: Env, hub: string, person: string) => env.DB.prepare('UPDATE rows_cache SET at = 0 WHERE hub = ? AND person = ? AND kind = ? AND at > 0').bind(hub, person, AHEAD).run();

/* ---------- the cron step ---------- */
/* The day's two steps that work rows out ahead, from RECS_HOUR (else 4) UTC: one person's Recommended rows (recs.ts), or in a
   run with none of those to do one person's Up Next and New for you. Everyone is read once for both. */
export async function nightly(env: Env, when: number): Promise<boolean> {
  if (new Date(when).getUTCHours() < dayHour(env)) return false;
  const all = await scan(env);
  return await recommend(env, when, all) || ahead(env, all);
}
/* The film or show TMDB has under an IMDb id. */
const found = (ask: Ask, imdb: string) => tmdb(ask, `find/${imdb}?external_source=imdb_id`, body => {
  const b = body as {movie_results?: {id?: number}[]; tv_results?: {id?: number}[]};
  return {m: Number(b.movie_results?.[0]?.id) || 0, s: Number(b.tv_results?.[0]?.id) || 0};
});
/* A film's first day out, and the day it came out to watch at home: its earliest digital, disc or TV release (TMDB's release
   types 4, 5 and 6) in the US, else anywhere. '' when TMDB lists none. Asked for with the film's details, so what is kept is
   never mistaken for the ratings recs.ts keeps from the release dates alone. */
const HOME = new Set([4, 5, 6]);
const film = (ask: Ask, id: number) => tmdb(ask, `movie/${id}?append_to_response=release_dates`, body => {
  const b = body as {adult?: boolean; release_date?: string; release_dates?: {results?: {iso_3166_1?: string; release_dates?: {type?: number; release_date?: string}[]}[]}};
  const all = (b.release_dates?.results ?? []).flatMap(place => (place.release_dates ?? []).filter(item => HOME.has(Number(item.type)) && /^\d{4}-\d\d-\d\d/.test(item.release_date ?? '')).map(item => ({us: place.iso_3166_1 === 'US', day: item.release_date!.slice(0, 10)})));
  const days = (all.some(item => item.us) ? all.filter(item => item.us) : all).map(item => item.day).sort();
  return {d: String(b.release_date ?? ''), out: days[0] ?? '', x: b.adult ? 1 : 0};
});
/* One step: the next person without Trakt who has Up Next or New for you on a Home of theirs, and for whom it was not looked up
   in the last day (or who finished something since), has it looked up and kept. True when there was one, or when what was kept
   for someone who no longer needs it was let go. */
export async function ahead(env: Env, all: Scan): Promise<boolean> {
  const time = now(), off: D1PreparedStatement[] = [];
  let next: {hub: string; person: string} | undefined;
  for (const row of all.people) {
    const top = all.tops.get(row.hub), group = all.groups.find(item => item.hub === row.hub && item.id === row.grp), before = all.kept.get(`${row.hub}/${row.id}/${AHEAD}`);
    if (!top || !group) continue;
    const theirs = JSON.parse(group.data) as {rows: Row[] | null; settings: Partial<Settings>}, own = JSON.parse(row.data) as {rows: Row[] | null; picks?: Record<string, boolean>};
    // With Trakt connected to the hub both rows are Trakt's. Otherwise: is either on their Home, whatever they have watched so far.
    const on = !all.linked.has(`${row.hub}/${row.id}`) && rowsOf(own.rows, theirs.rows ?? top.rows, {trakt: false, lists: true, watched: true}, own.picks).some(item => item.on && (item.id === 'up-next' || item.id === 'new-for-you'));
    if (on && (!before || time - before.at >= DAY)) {next = {hub: row.hub, person: row.id}; break;}
    if (!on && before) off.push(env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(row.hub, row.id, AHEAD));
  }
  if (off.length) await env.DB.batch(off.slice(0, 20));
  if (!next) return off.length > 0;
  const {hub, person} = next, key = await getSecret<string>(env, hub, HUB, 'key:tmdb');
  const [cache, mine, theirs] = await env.DB.batch([env.DB.prepare('SELECT kind, at, items AS body FROM rows_cache WHERE hub = ? AND person = ? AND at > ?').bind(hub, TMDB_OWNER, time - 3 * DAY),
    env.DB.prepare('SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND kind = ?').bind(hub, person, AHEAD),
    // What their MDBList has as watched, as Recently Watched last read it: a film in it has left New for you.
    env.DB.prepare("SELECT items FROM rows_cache WHERE hub = ? AND person = ? AND (kind = 'mdb_history' OR kind LIKE 'mdb_history.%')").bind(hub, person)]);
  const ask: Ask = {env, hub, key: key ?? '', held: new Map((cache.results as {kind: string; at: number; body: string}[]).map(row => [row.kind, row])), calls: {left: key ? CALLS : 0}, writes: []};
  const built = read((mine.results[0] as {items: string} | undefined)?.items), seen = new Set<string>();
  for (const row of theirs.results as {items: string}[]) try {for (const item of JSON.parse(row.items) as Item[]) for (const each of keysOf(item)) seen.add(each);} catch { /* nothing kept */ }
  const {shows, here} = await showsHere(env, hub, person), mineKeys = new Set(shows.slice(0, SHOWS).flatMap(keysOf));
  const listed = (await listedOf(env, hub, person).catch(() => [] as Item[])).slice(0, LISTED).filter(item => !keysOf(item).some(each => mineKeys.has(each)));
  const want: Item[] = [...shows.slice(0, SHOWS), ...listed];
  // Whether an answer can be had now: kept today, or the run has a call left. What cannot is looked up on the next runs.
  const can = (path: string) => {const had = ask.held.get(`tmdb:${path}`); return (!!had && time - had.at < DAY) || ask.calls.left > 0;};
  let more = false;
  for (const item of want) {
    let id = item.tmdb ?? built.ids[item.id];
    if (id === undefined) {
      if (!/^tt\d+$/.test(item.id)) continue;
      if (!can(`find/${item.id}?external_source=imdb_id`)) {more = true; continue;}
      const got = await found(ask, item.id);
      // One TMDB did not answer for is left for tomorrow.
      if (!got) continue;
      id = item.type === 'movie' ? got.m : got.s; built.ids[item.id] = id;
    }
    if (!id) continue;
    if (item.type === 'series') {
      const had = built.shows[id];
      if (had && time - had.at < DAY) continue;
      if (!can(`tv/${id}`)) {more = true; continue;}
      const got = await show(ask, id);
      if (got) built.shows[id] = {t: got.t, last: got.last ? nth(got.last[0], got.last[1]) : -1, aired: dayAt(got.a), next: got.n ? nth(got.n[0], got.n[1]) : -1, nextAt: got.n ? dayAt(got.n[2]) : 0, at: time};
    } else {
      const had = built.films[id];
      if (had && (had.done || time - had.at < DAY)) continue;
      if (!can(`movie/${id}?append_to_response=release_dates`)) {more = true; continue;}
      const got = await film(ask, id);
      if (got) {const out = got.x ? 0 : dayAt(got.out), first = dayAt(got.d); built.films[id] = {out, at: time, ...(got.x || (out && out <= time) || (first && first < time - SETTLED) ? {done: 1 as const} : {})};}
    }
  }
  // New for you, made again from what is known now: what came out in the last RECENT days, newest first.
  const fresh = new Map<string, Fresh>();
  for (const item of want) {
    const id = idOf(built, item), look = built.shows[id], out = built.films[id]?.out ?? 0;
    if (!id) continue;
    if (item.type === 'movie') {if (out && out <= time && out > time - RECENT) fresh.set(item.id, {id: item.id, type: 'movie', name: item.name, tmdb: id, at: out});}
    else if (look) {
      // Its newest episode out: the next one once its day has come, else the last. A special is not a new episode.
      const [episode, at] = look.nextAt && look.nextAt <= time ? [look.next, look.nextAt] : [look.last, look.aired];
      if (episode >= nth(1, 0) && at && at <= time && at > time - RECENT) fresh.set(item.id, {id: item.id, type: 'series', name: item.name || look.t, tmdb: id, at, season: Math.floor(episode / 10000), episode: episode % 10000});
    }
  }
  // What they started is remembered for as long as it could be listed again.
  const gone = Object.fromEntries(Object.entries(built.gone).filter(([, at]) => at > time - RECENT - 7 * DAY));
  const list = [...fresh.values()].filter(item => {
    if (gone[goneKey(item)]) return false;
    if (startedIn(here, item) || (item.type === 'movie' && keysOf(item).some(each => seen.has(each)))) {gone[goneKey(item)] = item.at; return false;}
    return true;
  }).sort((a, b) => b.at - a.at).slice(0, NEW_MOST);
  // A lookup nobody has needed for a month is let go, and the oldest ids when there are too many.
  const lately = <T extends {at: number; done?: 1}>(from: Record<string, T>) => Object.fromEntries(Object.entries(from).filter(([, item]) => item.at > time - FORGET));
  const kept: Built = {ran: time, ids: Object.fromEntries(Object.entries(built.ids).slice(-IDS)), shows: lately(built.shows), films: lately(built.films), fresh: list, gone};
  // Lookups left over are done on the next runs; with no TMDB key yet it is tried again sooner than a day.
  const at = more ? time - DAY + SOON : key ? time : time - DAY + RETRY;
  await env.DB.batch([...ask.writes, env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND at < ?').bind(hub, TMDB_OWNER, time - 3 * DAY),
    env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items').bind(hub, person, AHEAD, at, JSON.stringify(kept))]);
  return true;
}
