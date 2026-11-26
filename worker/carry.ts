/* Copying what someone watched here to their own trackers (their MDBList, their Trakt, or both), once they connect one, when they ask
   and after they have seen the plan.
   AIOMetadata keeps what is played on a person's own server whether or not a tracker is connected, and once one is connected it
   shows both; nothing is lost by leaving it there. This is for having it in MDBList too (other apps read it there).
   Only titles played through the hub are looked at: on this path every play passes through it, so that is everything the
   server learned here, and it keeps the work small however long someone's MDBList history is. AIOMetadata is asked what it
   holds for those titles, MDBList and Trakt what they already have, and only the difference is offered.
   Trakt: only plays that never reached it as they happened are looked at (nothing was sent for them: Trakt was not connected
   yet, or the title could not be matched then), and a play Trakt already has within twelve hours counts as the same viewing.
   Trakt's history takes finished watches only: a part-watched title goes to Trakt as a paused point (/scrobble/pause, under 80%,
   dated when it is sent), unless Trakt already holds a point for it. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK, deliver, read} from './trakt';
import type {Link} from './trakt';
import {SAME, traktPlays} from './drift';

import {server} from './here';
import type {Ids, Via} from './here';
export type Cell = 'has' | 'add' | 'none';
// item: its id on their own server, which is also the play's id here.
export interface Entry {item?: string; key: string; title: string; detail: string; at: string; pct?: number; kind: 'movie' | 'show'; ids: Ids; season?: number; episode?: number; trakt: Cell; lists: Cell}
// waiting: how many are left for a later pass (more than one pass checks). had: plays MDBList was asked about and already holds.
export interface Plan {watched: Entry[]; partway: Entry[]; already: number; unknown: number; more: boolean; waiting?: number; trakt: boolean; lists: boolean; had: string[]}
/* Why a look or a copy could not be done, in words the page shows as they are: never a key or what the other side sent back.
   `status` 503: that side did not answer, so asking again later may work; otherwise (409) something here has to change first. */
export type Failed = {error: string; status?: number};
export const NO_SETUP: Failed = {error: 'Your player setup isn’t made yet.'};
export const NO_ANSWER = {
  trakt: {error: 'Trakt didn’t answer just now.', status: 503},
  mdblist: {error: 'MDBList isn’t taking requests from your key right now. If this lasts a day, paste a new key.', status: 503},
  server: {error: 'Your player setup didn’t answer. Try again in a minute, or ask your manager.', status: 503},
} satisfies Record<string, Failed>;

// A Worker may make about 50 calls per request, so each pass checks this many titles with MDBList, reads this many pages of Trakt
// history, and sends this many paused points. FEW: how many titles (and points) a cron pass takes instead.
const TITLES = 20, PAUSES = 10, TRAKT_PAGES = 3, FEW = 8;
const where = (entry: Entry) => `${entry.kind}/${entry.ids.tmdb}${entry.season != null ? `:${entry.season}:${entry.episode}` : ''}`;
/* A paused point as Trakt and MDBList list them (/sync/playback). */
export interface TraktPoint {type?: string; progress?: number; paused_at?: string; movie?: {title?: string; ids?: {tmdb?: number | null; imdb?: string | null}}; show?: {title?: string; ids?: {tmdb?: number | null; imdb?: string | null}}; episode?: {season?: number; number?: number}}
export const pointKey = (point: TraktPoint) => point.type === 'movie' && point.movie?.ids?.tmdb ? `movie/${point.movie.ids.tmdb}` : point.type === 'episode' && point.show?.ids?.tmdb ? `show/${point.show.ids.tmdb}:${point.episode?.season}:${point.episode?.number}` : '';
/* A person's paused points on Trakt: read at most every ten minutes and kept by hub and person (Trakt often turns away the shared
   addresses Workers call from, and this list is asked for by every look). When Trakt does not answer, the last one read, if any.
   `after`: when Trakt says the points last changed; a list read before then is not used. */
export async function traktPoints(env: Env, hub: string, person: string, after = 0): Promise<TraktPoint[] | null> {
  const kept = await env.DB.prepare("SELECT at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind = 'playback'").bind(hub, person).first<{at: number; items: string}>();
  if (kept && now() - kept.at < 600 && kept.at > after) return JSON.parse(kept.items) as TraktPoint[];
  const got = await read<TraktPoint[]>(env, hub, person, '/sync/playback');
  if (!Array.isArray(got)) return kept && kept.at > after ? JSON.parse(kept.items) as TraktPoint[] : null;
  const slim = got.map(({type, progress, paused_at, movie, show, episode}) => ({type, progress, paused_at, ...(movie ? {movie: {title: movie.title, ids: {tmdb: movie.ids?.tmdb, imdb: movie.ids?.imdb}}} : {}), ...(show ? {show: {title: show.title, ids: {tmdb: show.ids?.tmdb, imdb: show.ids?.imdb}}} : {}), ...(episode ? {episode: {season: episode.season, number: episode.number}} : {})}));
  await env.DB.prepare("INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, 'playback', ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items").bind(hub, person, now(), JSON.stringify(slim)).run();
  return slim;
}
/* A paused point to send: the title (an episode under its show), and how far, kept under 80%, where it would count as watched. */
export const pauseOf = (entry: {kind: 'movie' | 'show'; ids: Ids; season?: number; episode?: number; pct?: number}) => {
  const progress = Math.min(79.99, Math.max(1, entry.pct!));
  return entry.kind === 'movie' ? {movie: {ids: entry.ids}, progress} : {show: {ids: entry.ids}, episode: {season: entry.season, number: entry.episode}, progress};
};

/* What the hub copied to each of a person's places (the `sent` table): each play once, never again, so one they deleted there
   stays deleted. Copies made before the table, kept in their vault as `carried` (MDBList's by the play's key, Trakt's as t:<key>),
   still count. Read once per pass; written in one batch. */
export type Place = 'trakt' | 'here' | 'mdblist';
export async function ledger(env: Env, hub: string, person: string, place: Place): Promise<Set<string>> {
  // A spot that took the place of one held there is kept as ir: (places.ts, sentKey), and counts as that spot sent (ip:) too.
  const rows = (await env.DB.prepare('SELECT play FROM sent WHERE hub = ? AND person = ? AND place = ?').bind(hub, person, place).all<{play: string}>()).results.flatMap(row => row.play.startsWith('ir:') ? [row.play, `ip:${row.play.slice(3)}`] : [row.play]);
  if (place === 'here') return new Set(rows);
  const old = await getSecret<string[]>(env, hub, person, 'carried') ?? [];
  return new Set([...rows, ...old.filter(key => key.startsWith('t:') === (place === 'trakt')).map(key => place === 'trakt' ? key.slice(2) : key)]);
}
/* A play to note as sent: its key alone (only never to be sent again: the other side had it already, or could not take it), or
   with what it is called, when the hub really copied it, so their own page can list it under What was synced. */
export type Noted = string | {key: string; title: string; detail: string; item?: string};
export const noted = (play: {key: string; title: string; detail: string; item?: string}): Noted => ({key: play.key, title: play.title, detail: play.detail, ...(play.item ? {item: play.item} : {})});
export const remember = (env: Env, hub: string, person: string, place: Place, plays: Noted[]) => plays.slice(0, 200).map(play => {
  const key = typeof play === 'string' ? play : play.key, title = typeof play === 'string' ? null : play.title.slice(0, 200), detail = typeof play === 'string' ? null : play.detail.slice(0, 120);
  return env.DB.prepare('INSERT INTO sent (hub, person, place, play, at, title, detail, item) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(hub, person, place, key.slice(0, 200), now(), title, detail, typeof play === 'string' ? null : play.item?.slice(0, 200) ?? null);
});
/* What the hub synced for a person lately, newest first, as their own page lists it: what it is called, where it went, and when.
   `spot`: a paused spot rather than a finished watch (by how its key starts). `updated`: a spot that took the place of an
   earlier one held there, rather than one added where there was none. */
export async function synced(env: Env, hub: string, person: string) {
  const rows = (await env.DB.prepare('SELECT place, play, at, title, detail FROM sent WHERE hub = ? AND person = ? AND title IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT 30').bind(hub, person).all<{place: Place; play: string; at: number; title: string; detail: string | null}>()).results;
  return rows.map(row => ({title: row.title, detail: row.detail ?? '', to: row.place, spot: /^(p|ip|ir|pm|pt):/.test(row.play), ...(row.play.startsWith('ir:') ? {updated: true} : {}), at: row.at}));
}
/* What they watched here before connecting Trakt, newest first, as the consent box lists it: from the plays kept here (title and
   date), with no call to their server or to Trakt. The same plays a pass looks at (the newest 500, `plan`), less what was played
   under 1%, what was sent to Trakt before (by the play's id here, kept with what was sent), and what is known to have been left
   out. What is really sent can still be fewer: Trakt may already have a play, their server may no longer hold a title as watched,
   and one left out before Trakt's ids for it were looked up is not known here. */
export async function earlierPlays(env: Env, hub: string, person: string, since: number, skip: Set<string>) {
  const rows = (await env.DB.prepare('SELECT item, title, detail, position, duration, updated, ids FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 500').bind(hub, person).all<{item: string; title: string; detail: string; position: number; duration: number; updated: number; ids: string | null}>()).results;
  const early = rows.filter(row => row.updated < since && row.duration > 0 && row.position * 100 >= row.duration);
  if (!early.length) return [];
  const sent = await ledger(env, hub, person, 'trakt'), gone = new Set((await env.DB.prepare("SELECT item FROM sent WHERE hub = ? AND person = ? AND place = 'trakt' AND item IS NOT NULL").bind(hub, person).all<{item: string}>()).results.map(row => row.item));
  return early.filter(row => {
    if (gone.has(row.item)) return false;
    let target: {movie?: {ids: Ids}; show?: {ids: Ids}; episode?: {season: number; number: number}} | null = null;
    try {target = row.ids ? JSON.parse(row.ids) : null;} catch {target = null;}
    const tmdb = target?.movie?.ids.tmdb ?? target?.show?.ids.tmdb;
    if (!tmdb) return true;
    // Sent or left out before, as watched or as a spot (their server says which; here either counts).
    const at = target!.movie ? `movie/${tmdb}` : `show/${tmdb}:${target!.episode?.season}:${target!.episode?.number}`;
    return !['w', 'p'].some(as => sent.has(`${as}:${at}`) || skip.has(`${as}:${at}`));
  }).map(row => ({title: row.title, detail: row.detail, at: row.updated}));
}

export const mdblist = (env: Env, key: string) => async (path: string, body?: unknown) => {
  const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`,
    {method: body === undefined ? 'GET' : 'POST', headers: {accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'AIOHub/1.0'}, body: body === undefined ? undefined : JSON.stringify(body)}).catch(() => null);
  return {status: answer?.status ?? 0, body: answer ? await answer.json().catch(() => null) as Record<string, unknown> | unknown[] | null : null};
};

/* `skip`: what the person left out, never offered again. */
/* `want`: which of the two to look at (both, unless said). MDBList's key is used even while the person is still moving to it.
   `before` false: what was watched here before Trakt was connected stays off Trakt (they have not agreed to send it; sync.ts).
   `since`: only what was played here from then on. `few`: a cron pass, which checks and sends fewer (it shares its run). */
export interface Want {trakt?: boolean; lists?: boolean; before?: boolean; since?: number; few?: boolean}
export async function plan(env: Env, hub: string, person: string, skip: Set<string> = new Set(), want: Want = {trakt: true, lists: true}): Promise<Plan | Failed> {
  const lists = want.lists ? await getSecret<{key: string}>(env, hub, person, 'mdblist') : null, held = env.TRAKT_CLIENT_ID && want.trakt ? await getSecret<Link>(env, hub, person, LINK) : null, link = held && !held.again ? held : null;
  if (!lists?.key && !link) return {error: 'Connect Trakt or MDBList first.'};
  // Copied before: a tracker may still answer from a few minutes ago, and one the person deleted there stays deleted, so these are
  // never sent twice.
  const toLists = lists?.key ? await ledger(env, hub, person, 'mdblist') : new Set<string>(), toTrakt = link ? await ledger(env, hub, person, 'trakt') : new Set<string>();
  const rows = (await env.DB.prepare('SELECT item, updated, scrobbled FROM plays WHERE hub = ? AND person = ? AND updated >= ? ORDER BY updated DESC LIMIT 500').bind(hub, person, want.since ?? 0).all<{item: string; updated: number; scrobbled: string | null}>()).results;
  const none: Plan = {watched: [], partway: [], already: 0, unknown: 0, more: false, trakt: !!link, lists: !!lists?.key, had: []};
  // Nothing played here: nothing to copy, with or without a player setup.
  if (!rows.length) return none;
  const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
  if (!via) return NO_SETUP;
  const own = await server(via);
  if (!own) return NO_ANSWER.server;
  try {
    const found = await own.items(rows.map(row => row.item)), play = new Map(rows.map(row => [row.item, row]));
    const shows = new Map((await own.items([...new Set(found.filter(item => item.Type === 'Episode' && item.SeriesId).map(item => item.SeriesId!))])).map(item => [item.Id, item]));
    const all: Entry[] = []; let unknown = 0;
    for (const item of found) {
      const episode = item.Type === 'Episode', show = episode ? shows.get(item.SeriesId ?? '') : undefined, provider = (episode ? show : item)?.ProviderIds;
      const data = item.UserData ?? {}, pct = Number(data.PlayedPercentage ?? 0), watched = !!data.Played, partway = !watched && pct >= 1 && pct < 80;
      if (!watched && !partway) continue;
      const tmdb = Number(provider?.Tmdb);
      if (!(tmdb > 0) || (episode && (item.ParentIndexNumber == null || item.IndexNumber == null))) {unknown++; continue;}
      const here = play.get(item.Id);
      const entry: Entry = {item: item.Id, key: '', kind: episode ? 'show' : 'movie', ids: {tmdb, ...(/^tt\d+$/.test(provider?.Imdb ?? '') ? {imdb: provider!.Imdb} : {})},
        title: String((episode ? show?.Name ?? item.SeriesName : item.Name) ?? 'Untitled').slice(0, 200), detail: episode ? `Season ${item.ParentIndexNumber} · Episode ${item.IndexNumber}` : 'Movie',
        at: data.LastPlayedDate ?? new Date((here?.updated ?? now()) * 1000).toISOString(), ...(partway ? {pct: Math.round(pct)} : {}), ...(episode ? {season: item.ParentIndexNumber, episode: item.IndexNumber} : {}), trakt: 'none', lists: 'none'};
      entry.key = `${watched ? 'w' : 'p'}:${where(entry)}`;
      if (skip.has(entry.key)) continue;
      if (lists?.key) entry.lists = toLists.has(entry.key) ? 'has' : 'add';
      // Trakt: a finished watch it was never sent as it happened (sent: scrobbled is set, after the link was made; 'held' is a start
      // still held back, front.ts, so nothing was sent). One from before
      // the link only when the person said so.
      const early = !!link?.since && (here?.updated ?? 0) < link.since;
      if (link) entry.trakt = toTrakt.has(entry.key) || (!partway && here?.scrobbled && here.scrobbled !== 'held' && !early) ? 'has' : early && want.before === false ? 'none' : 'add';
      if (entry.lists === 'add' || entry.trakt === 'add') all.push(entry);
    }
    let more = false;
    const decided = new Set<Entry>(all), had: string[] = [];
    // What MDBList already has for each title. Newest first, so a long list is copied the most recent first.
    if (lists?.key) {
      const asking = all.filter(entry => entry.lists === 'add'), titles = [...new Set(asking.map(entry => `${entry.kind}/${entry.ids.tmdb}`))], checked = new Set(titles.slice(0, want.few ? FEW : TITLES)), has = new Set<string>(), ask = mdblist(env, lists.key);
      for (const title of checked) {
        const answer = await ask(`/sync/history/${title.replace('/', '/tmdb/')}`);
        if (answer.status !== 200) return NO_ANSWER.mdblist;
        for (const play of ((answer.body as {plays?: {season_num?: number; episode_num?: number}[]})?.plays ?? [])) has.add(title.startsWith('show') ? `${title}:${play.season_num}:${play.episode_num}` : title);
      }
      if (asking.some(entry => entry.pct != null && checked.has(`${entry.kind}/${entry.ids.tmdb}`))) {
        const answer = await ask('/sync/playback');
        if (answer.status !== 200) return NO_ANSWER.mdblist;
        for (const point of (Array.isArray(answer.body) ? answer.body : []) as {type?: string; movie?: {ids?: {tmdb?: number}}; show?: {ids?: {tmdb?: number}}; episode?: {season?: number; number?: number}}[]) {
          if (point.type === 'movie' && point.movie?.ids?.tmdb) has.add(`movie/${point.movie.ids.tmdb}`);
          if (point.type === 'episode' && point.show?.ids?.tmdb) has.add(`show/${point.show.ids.tmdb}:${point.episode?.season}:${point.episode?.number}`);
        }
      }
      for (const entry of asking) {
        if (!checked.has(`${entry.kind}/${entry.ids.tmdb}`)) {decided.delete(entry); more = true;}
        else if (has.has(where(entry))) {entry.lists = 'has'; had.push(entry.key);}
      }
    }
    // Part-watched: Trakt's paused points, read once. Any point for the title or episode means Trakt has where it was left.
    if (link && all.some(entry => entry.pct != null && entry.trakt === 'add')) {
      // Not known just now: those spots wait for a later look rather than being sent blind.
      const points = await traktPoints(env, hub, person), held = new Set((points ?? []).map(pointKey).filter(Boolean));
      for (const entry of all) if (entry.pct != null && entry.trakt === 'add' && (!points || held.has(where(entry)))) entry.trakt = points ? 'has' : 'none';
    }
    // What Trakt's history has around those times, newest first: a play of the same title or episode within twelve hours is this one.
    const asking = all.filter(entry => entry.pct == null && entry.trakt === 'add' && decided.has(entry));
    if (link && asking.length) {
      const times = asking.map(entry => Math.floor(Date.parse(entry.at) / 1000)), from = Math.min(...times) - SAME, to = Math.max(...times) + SAME, titles = {}, have: {t: string; s?: number; e?: number; at: number}[] = [];
      let oldest = from, page = 1;
      for (; page <= TRAKT_PAGES; page++) {
        const got = await traktPlays(env, hub, person, from, to, page, titles);
        if (!got) return NO_ANSWER.trakt;
        have.push(...got.plays);
        if (!got.more) {oldest = from; break;}
        oldest = Math.min(...got.plays.map(item => item.at), to);
      }
      for (const entry of asking) {
        const at = Math.floor(Date.parse(entry.at) / 1000);
        // Further back than the pages read reach: looked at on the next pass.
        if (at - SAME < oldest) {decided.delete(entry); more = true; continue;}
        if (have.some(item => `${item.t}${item.s == null ? '' : `:${item.s}:${item.e}`}` === where(entry) && Math.abs(item.at - at) <= SAME)) entry.trakt = 'has';
      }
    }
    const kept = all.filter(entry => decided.has(entry) && (entry.lists === 'add' || entry.trakt === 'add'));
    return {...none, watched: kept.filter(entry => entry.pct == null), partway: kept.filter(entry => entry.pct != null), already: decided.size - kept.length, unknown, more, waiting: all.length - decided.size, had};
  } catch {
    return NO_ANSWER.server;
  } finally {
    await own.done();
  }
}

/* Plays as Trakt and MDBList both take them: films on their own, episodes under their show and season, each with its own date. */
export function history(entries: Pick<Entry, 'kind' | 'ids' | 'season' | 'episode' | 'at'>[]) {
  const movies = entries.filter(entry => entry.kind === 'movie').map(entry => ({ids: entry.ids, watched_at: entry.at})), shows = new Map<number, {ids: Ids; seasons: Map<number, {number: number; watched_at: string}[]>}>();
  for (const entry of entries.filter(item => item.kind === 'show')) {
    const show = shows.get(entry.ids.tmdb!) ?? {ids: entry.ids, seasons: new Map<number, {number: number; watched_at: string}[]>()}; shows.set(entry.ids.tmdb!, show);
    const season = show.seasons.get(entry.season!) ?? []; show.seasons.set(entry.season!, season);
    if (!season.some((item: {number: number}) => item.number === entry.episode)) season.push({number: entry.episode!, watched_at: entry.at});
  }
  return {...(movies.length ? {movies} : {}), ...(shows.size ? {shows: [...shows.values()].map(show => ({ids: show.ids, seasons: [...show.seasons].map(([number, episodes]) => ({number, episodes}))}))} : {})};
}
/* Copies one pass of the plan, worked out again here rather than taken from the page. Says whether there is more to do. Trakt gets
   its plays through the outbox, so a moment when Trakt turns calls away only delays them. */
// left: about how many are still to copy after this pass.
// busy: another pass for them was under way, so this one did nothing.
type Carried = {watched: number; partway: number; trakt: number; missed: number; more: boolean; left?: number; busy?: boolean};
export async function carry(env: Env, hub: string, person: string, skip: Set<string> = new Set(), want: Want = {trakt: true, lists: true}): Promise<Carried | Failed> {
  // One pass at a time per person (two clicks at once would both send): claimed here, let go at the end. A claim left by a pass
  // that never finished is taken over after two minutes.
  const claim = await env.DB.prepare("INSERT INTO ops (hub, kind, target, state, created, updated) VALUES (?1, 'carry', ?2, 'requested', ?3, ?3) ON CONFLICT (hub, kind, target) DO UPDATE SET created = excluded.created, updated = excluded.updated WHERE ops.created < ?4")
    .bind(hub, person, now(), now() - 120).run();
  if (!claim.meta.changes) return {watched: 0, partway: 0, trakt: 0, missed: 0, more: false, busy: true};
  try {return await carryPass(env, hub, person, skip, want);}
  finally {await env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'carry' AND target = ?").bind(hub, person).run();}
}
async function carryPass(env: Env, hub: string, person: string, skip: Set<string>, want: Want): Promise<Carried | Failed> {
  const got = await plan(env, hub, person, skip, want);
  if ('error' in got) return got;
  const done: Noted[] = [], toTraktDone: Noted[] = [], pauses = want.few ? FEW : PAUSES, toLists = got.watched.filter(entry => entry.lists === 'add'), pausing = got.partway.filter(entry => entry.lists === 'add'), toTrakt = got.watched.filter(entry => entry.trakt === 'add');
  const traktPausing = got.partway.filter(entry => entry.trakt === 'add');
  let missed = 0, sent = 0, refused = false;
  if (toTrakt.length) {
    const how = await deliver(env, hub, person, 'carry', {kind: 'mark', path: '/sync/history', body: history(toTrakt)});
    if (how === 'off') return {error: 'Trakt needs connecting again. Nothing was copied.'};
    toTraktDone.push(...toTrakt.map(noted)); sent = toTrakt.length;
  }
  // Paused points one at a time, through the outbox (Trakt takes one write a second per person).
  for (const entry of traktPausing.slice(0, pauses)) {
    const how = await deliver(env, hub, person, `carry:${where(entry)}`, {kind: 'pause', path: '/scrobble/pause', body: pauseOf(entry)});
    if (how === 'off') return {error: 'Trakt needs connecting again.'};
    toTraktDone.push(noted(entry)); sent++;
  }
  const lists = want.lists ? await getSecret<{key: string}>(env, hub, person, 'mdblist') : null, ask = lists?.key ? mdblist(env, lists.key) : null;
  if (ask && toLists.length) {
    const answer = await ask('/sync/watched', history(toLists));
    if (answer.status !== 200) refused = true;
    else {
      const lost = (answer.body as {not_found?: Record<string, unknown[]>} | null)?.not_found ?? {};
      missed += Object.values(lost).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
      done.push(...toLists.map(noted));
    }
  }
  // A paused point is kept under 80%, where MDBList would count it as watched.
  for (const entry of ask ? pausing.slice(0, pauses) : []) {
    const progress = Math.min(79.99, Math.max(1, entry.pct!));
    // MDBList's own shape for an episode: under its show, by season.
    const answer = await ask!('/scrobble/pause', entry.kind === 'movie' ? {movie: {ids: entry.ids}, progress} : {show: {ids: entry.ids, season: {number: entry.season, episode: {number: entry.episode}}}, progress});
    if (answer.status === 200 || answer.status === 201) done.push(noted(entry)); else missed++;
  }
  // Noted as sent once it is sent or waiting in the outbox, so neither a second pass nor a later look sends it again.
  // What MDBList was asked about and already holds is noted too (by its key alone), so a long history is not asked about again
  // pass after pass, and one deleted there later stays deleted.
  if (done.length || toTraktDone.length || got.had.length) await env.DB.batch([...remember(env, hub, person, 'mdblist', [...done, ...got.had]), ...remember(env, hub, person, 'trakt', toTraktDone)]);
  if (refused) return {error: sent ? 'Trakt has them; MDBList didn’t take its share just now. Try again in a moment.' : 'MDBList did not take it. Nothing was copied; try again in a moment.'};
  const left = Math.max(0, pausing.length - pauses) + Math.max(0, traktPausing.length - pauses) + (got.waiting ?? 0);
  return {watched: toLists.length, partway: Math.min(pausing.length, pauses), trakt: sent, missed, more: got.more || pausing.length > pauses || traktPausing.length > pauses, left};
}
