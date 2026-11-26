/* The Trakt and MDBList card on a person's own Accounts page always compares two places: where their progress is kept (Here, their
   own server; or their MDBList) and Trakt, or, while they move where progress is kept, the old place and the new one. Each line is a
   play one of the two lacks; Add (or Move) copies it across. Nothing is ever removed anywhere.
   Pairs, by what is looked at:
   - here-trakt: plays here that never reached Trakt go to Trakt (carry.ts); plays on Trakt in the last two weeks that Here lacks
     ("watched elsewhere") are ticked Here.
   - here-mdblist: what Here has that MDBList lacks (carry.ts): the move to MDBList, or what is left of it.
   - mdblist-here: what MDBList has that Here lacks, ticked Here: the move back.
   - mdblist-trakt: paused points (part-watched titles) one of MDBList and Trakt has and the other lacks. Their finished plays are
     compared by the daily look (drift.ts).
   Part-watched titles travel as paused points under 80%: Trakt and MDBList date one when it is sent; Here keeps the position.
   Ticking Here never reaches a tracker: it goes straight to the person's own server, and only while that server passes nothing on
   (playbackReporting off: someone on Here, or someone moving back from MDBList, whose setup is switched first). */
import type {Env} from './util';
import {getSecret, now, putSecret} from './util';
import {LINK} from './trakt';
import type {Link} from './trakt';
import {traktPlays} from './drift';
import {NO_ANSWER, NO_SETUP, carry, ledger, mdblist, pauseOf, plan, pointKey, remember, traktPoints} from './carry';
import type {Failed, TraktPoint} from './carry';
import {deliver} from './trakt';
import type {Cell} from './carry';
import {packed, server} from './here';
import type {Ids, Item, Server, Via} from './here';

export type Pair = 'here-trakt' | 'here-mdblist' | 'mdblist-here' | 'mdblist-trakt';
export const PAIRS: Pair[] = ['here-trakt', 'here-mdblist', 'mdblist-here', 'mdblist-trakt'];
export interface Line {key: string; title: string; detail: string; at: string; pct?: number; here: Cell; trakt: Cell; lists: Cell; elsewhere?: boolean}
export interface Look {lines: Line[]; more: boolean; unmatched: number; already: number; checked?: number}
/* A play another place has that Here lacks, with the id Here knows it by. */
export interface Incoming {key: string; kind: 'movie' | 'show'; ids: Ids; title: string; season?: number; episode?: number; at: string; pct?: number; id: string; runtime?: number}

// Trakt plays from this far back are offered to Here; MDBList is read whole when moving back, the newest this many at a time.
// A pass ticks Here until its own calls reach BUDGET, leaving room in the Worker's ~50 for the rest of the pass.
// NEAR: a spot here stays when the other side's is from no more than this much later (a send can take that long to land).
export const SPAN = 14 * 86400, CHECK = 300, BUDGET = 22, NEAR = 600;
const detail = (season?: number, episode?: number) => season != null ? `Season ${season} · Episode ${episode}` : 'Movie';
const same = (a: string, b: string) => a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
export const where = (kind: string, tmdb: number | undefined, season?: number, episode?: number) => `${kind}/${tmdb}${season != null ? `:${season}:${episode}` : ''}`;

/* How a play brought here is noted as sent (carry.ts, ledger): a finished one by title or episode; a spot with when it was left
   there too, so a later spot from the same place can still come. */
export const sentKey = (play: {key: string; at: string; pct?: number}) => play.pct != null ? `${play.key}@${play.at}` : play.key;
/* What Here holds of these plays: each one Here lacks (with its id there), how many it has, how many it does not know.
   Watched beats part-watched. A spot here gives way to another place's only when that one is later by more than a send can take
   (Trakt and MDBList date a spot when it reaches them, so the hub's own would otherwise look newer) and not where Here already is. */
export async function lacking(own: Server, plays: Omit<Incoming, 'id'>[]) {
  const withId = plays.map(play => ({...play, id: packed(play.kind === 'movie' ? 'movie' : 'episode', play.ids, play.season, play.episode) ?? ''})).filter(play => play.id);
  const found = await own.items(withId.map(play => play.id)), out: Incoming[] = [];
  let has = 0, unknown = plays.length - withId.length;
  for (const play of withId) {
    const item = found.find(held => same(held.Id, play.id));
    if (!item) {unknown++; continue;}
    if (item.UserData?.Played) {has++; continue;}
    const ticks = Number(item.UserData?.PlaybackPositionTicks) || 0, last = Date.parse(item.UserData?.LastPlayedDate ?? '') || 0;
    // With no date for Here's spot there is no telling which is later: Here's stays.
    if (play.pct != null && ticks > 0 && (!last || Date.parse(play.at) <= last + NEAR * 1000 || (item.RunTimeTicks && Math.abs(ticks / item.RunTimeTicks * 100 - play.pct) <= 1))) {has++; continue;}
    out.push({...play, runtime: item.RunTimeTicks});
  }
  return {out, has, unknown};
}
/* Plays on Trakt in the last two weeks (or since `from`), newest first, one per title or episode. null when Trakt did not answer. */
async function fromTrakt(env: Env, hub: string, person: string, from = now() - SPAN) {
  const titles: Record<string, {kind: 'movie' | 'show'; tmdb: number; imdb?: string; name: string}> = {}, plays: Omit<Incoming, 'id'>[] = [], seen = new Set<string>();
  let more = false;
  // Where Trakt holds a part-watched title: brought Here as a position, where Here has none.
  // Not known just now: only the finished plays are looked at this time.
  const points = await traktPoints(env, hub, person) ?? [];
  for (const point of points) {const play = fromPoint(point); if (play && !seen.has(play.key)) {seen.add(play.key); plays.push(play);}}
  for (let page = 1; page <= 3; page++) {
    const got = await traktPlays(env, hub, person, from, now(), page, titles);
    if (!got) return null;
    for (const play of got.plays) {
      const title = titles[play.t], key = `i:${where(title.kind, title.tmdb, play.s, play.e)}`;
      if (seen.has(key)) continue; seen.add(key);
      plays.push({key, kind: title.kind, ids: {tmdb: title.tmdb, ...(title.imdb ? {imdb: title.imdb} : {})}, title: title.name || 'Untitled', ...(play.s != null ? {season: play.s, episode: play.e} : {}), at: new Date(play.at * 1000).toISOString()});
    }
    if (!got.more) break;
    more = page === 3;
  }
  return {plays, more};
}
interface Media {title?: string; ids?: {tmdb?: number | null; imdb?: string | null}}
const idsOf = (media?: Media): Ids => ({tmdb: Number(media?.ids?.tmdb) || undefined, ...(/^tt\d+$/.test(media?.ids?.imdb ?? '') ? {imdb: media!.ids!.imdb!} : {})});
/* A paused point (Trakt's or MDBList's) as a part-watched play, or null for one that is finished or has nothing to go by. */
export function fromPoint(point: TraktPoint): Omit<Incoming, 'id'> | null {
  const pct = Math.round(Number(point.progress)), movie = point.type === 'movie', media = movie ? point.movie : point.show, key = pointKey(point);
  if (!key || !(pct >= 1 && pct < 80) || (!movie && (point.episode?.season == null || point.episode.number == null))) return null;
  return {key: `ip:${key}`, kind: movie ? 'movie' : 'show', ids: idsOf(media), title: String(media?.title ?? 'Untitled').slice(0, 200), ...(movie ? {} : {season: point.episode!.season, episode: point.episode!.number}), at: point.paused_at ?? new Date().toISOString(), pct};
}
/* Everything MDBList has as watched, and what it holds partway, newest first. null when MDBList did not answer. */
async function fromMdblist(env: Env, key: string) {
  const ask = mdblist(env, key), watched = await ask('/sync/watched?limit=1000'), paused = await ask('/sync/playback');
  const body = watched.body as {movies?: {last_watched_at?: string; movie?: Media}[]; episodes?: {last_watched_at?: string; episode?: {season?: number; number?: number; show?: Media}}[]} | null;
  if (watched.status !== 200 || !body || Array.isArray(body) || paused.status !== 200) return null;
  const plays: Omit<Incoming, 'id'>[] = [], ids = idsOf;
  for (const item of body.movies ?? []) if (item.movie) plays.push({key: `i:${where('movie', ids(item.movie).tmdb)}`, kind: 'movie', ids: ids(item.movie), title: String(item.movie.title ?? 'Untitled').slice(0, 200), at: item.last_watched_at ?? new Date().toISOString()});
  for (const item of body.episodes ?? []) if (item.episode?.show && item.episode.season != null && item.episode.number != null) plays.push({key: `i:${where('show', ids(item.episode.show).tmdb, item.episode.season, item.episode.number)}`, kind: 'show', ids: ids(item.episode.show), title: String(item.episode.show.title ?? 'Untitled').slice(0, 200), season: item.episode.season, episode: item.episode.number, at: item.last_watched_at ?? new Date().toISOString()});
  for (const point of (Array.isArray(paused.body) ? paused.body : []) as TraktPoint[]) {const play = fromPoint(point); if (play) plays.push(play);}
  return plays.filter(play => play.ids.tmdb || play.ids.imdb).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
const incomingLine = (play: Incoming, from: 'trakt' | 'lists'): Line => ({key: play.key, title: play.title, detail: detail(play.season, play.episode), at: play.at, ...(play.pct != null ? {pct: play.pct} : {}), here: 'add', trakt: from === 'trakt' ? 'has' : 'none', lists: from === 'lists' ? 'has' : 'none', ...(from === 'trakt' ? {elsewhere: true} : {})});

/* Paused points MDBList has and Trakt lacks, and the other way: one read of each. */
async function pointsBoth(env: Env, hub: string, person: string): Promise<{lines: Line[]; points: (Omit<Incoming, 'id'> & {to: 'trakt' | 'lists'})[]; same: number} | Failed> {
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist');
  if (!lists?.key) return {error: 'Connect MDBList first.'};
  const theirs = await mdblist(env, lists.key)('/sync/playback'), trakt = await traktPoints(env, hub, person);
  if (theirs.status !== 200 || !Array.isArray(theirs.body)) return NO_ANSWER.mdblist;
  if (!Array.isArray(trakt)) return NO_ANSWER.trakt;
  const onLists = new Map((theirs.body as TraktPoint[]).map(point => [pointKey(point), point])), onTrakt = new Map(trakt.map(point => [pointKey(point), point]));
  const points: (Omit<Incoming, 'id'> & {to: 'trakt' | 'lists'})[] = [];
  // A spot already sent to Trakt is not offered again: Trakt's list is kept a few minutes, and its copy goes through the outbox.
  const sentTrakt = await ledger(env, hub, person, 'trakt');
  let same = 0;
  for (const [key, point] of onLists) {if (!key) continue; if (onTrakt.has(key)) {same++; continue;} const play = fromPoint(point); if (play && sentTrakt.has(`pm:${key}@${play.at}`)) same++; else if (play) points.push({...play, key: `pm:${key}`, to: 'trakt'});}
  for (const [key, point] of onTrakt) {if (!key || onLists.has(key)) continue; const play = fromPoint(point); if (play) points.push({...play, key: `pt:${key}`, to: 'lists'});}
  return {points, same, lines: points.map(point => ({key: point.key, title: point.title, detail: detail(point.season, point.episode), at: point.at, pct: point.pct, here: 'none', trakt: point.to === 'trakt' ? 'add' : 'has', lists: point.to === 'lists' ? 'add' : 'has'}))};
}
/* What a pair has to copy, as the card shows it. */
export async function look(env: Env, hub: string, person: string, pair: Pair, skip: Set<string>, outgoing = true): Promise<Look & {incoming: Incoming[]} | Failed> {
  const lines: Line[] = [];
  let more = false, unmatched = 0, already = 0, incoming: Incoming[] = [];
  if (pair === 'mdblist-trakt') {
    const got = await pointsBoth(env, hub, person);
    if ('error' in got) return got;
    return {lines: got.lines.filter(line => !skip.has(line.key)), more: false, unmatched: 0, already: got.same, incoming: []};
  }
  if (outgoing && (pair === 'here-trakt' || pair === 'here-mdblist')) {
    const out = await plan(env, hub, person, skip, pair === 'here-trakt' ? {trakt: true} : {lists: true});
    if ('error' in out) return out;
    for (const entry of [...out.watched, ...out.partway]) lines.push({key: entry.key, title: entry.title, detail: entry.detail, at: entry.at, ...(entry.pct != null ? {pct: entry.pct} : {}), here: 'has', trakt: entry.trakt, lists: entry.lists});
    more = out.more; unmatched = out.unknown; already = out.already;
  }
  if (pair === 'here-trakt' || pair === 'mdblist-here') {
    let plays: Omit<Incoming, 'id'>[];
    if (pair === 'here-trakt') {
      const got = await fromTrakt(env, hub, person);
      if (!got) return NO_ANSWER.trakt;
      plays = got.plays; more ||= got.more;
    } else {
      const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist');
      if (!lists?.key) return {error: 'Connect MDBList first.'};
      const got = await fromMdblist(env, lists.key);
      if (!got) return NO_ANSWER.mdblist;
      plays = got;
    }
    // What the hub ticked here before is never ticked again, so one unticked since stays that way.
    const done = await ledger(env, hub, person, 'here');
    plays = plays.filter(play => !skip.has(play.key) && !done.has(sentKey(play)));
    if (plays.length > CHECK) {more = true; plays = plays.slice(0, CHECK);}
    // Nothing the other side has to bring here: no need of their server.
    if (!plays.length) return {lines: lines.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), more, unmatched, already, incoming};
    const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
    if (!via) return NO_SETUP;
    const own = await server(via);
    if (!own) return NO_ANSWER.server;
    try {
      const got = await lacking(own, plays);
      incoming = got.out; already += got.has; unmatched += got.unknown;
      lines.push(...incoming.map(play => incomingLine(play, pair === 'here-trakt' ? 'trakt' : 'lists')));
    } catch {return NO_ANSWER.server;}
    finally {await own.done();}
  }
  return {lines: lines.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), more, unmatched, already, incoming};
}

/* The person's own server passes nothing on to a tracker right now: ticking Here cannot echo anywhere. */
export async function quiet(env: Env, hub: string, person: string) {
  const made = await getSecret<{uuid: string; password: string; at?: string}>(env, hub, person, 'aiom');
  if (!made) return false;
  const read = await fetch(`${made.at ?? env.AIOM_ORIGIN}/api/config/load/${made.uuid}`, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, body: JSON.stringify({password: made.password})}).catch(() => null);
  const config = read?.status === 200 ? ((await read.json().catch(() => null)) as {config?: Record<string, unknown>} | null)?.config : null;
  return !!config && config.playbackReporting !== true && config.mdblistWatchTracking !== true;
}
/* Ticks plays Here, as many as fit in one pass. Episodes go by the show's own numbering on this server: one it does not have under
   that season and number is left out (counted as not matched), never guessed. */
export async function tickHere(own: Server, plays: Incoming[], budget = BUDGET) {
  let added = 0, unmatched = 0, left = 0;
  // Which were ticked, and which this server numbers differently (never guessed again): by each play's key. One the server did not
  // answer about is neither, and is tried again later.
  const done: string[] = [], missed: string[] = [];
  const shows = new Map<string, Map<string, string> | null>();
  for (const play of plays) {
    if (own.counter.calls > budget) {left++; continue;}
    let id = play.id;
    if (play.kind === 'show') {
      const series = packed('series', play.ids) ?? '';
      if (!shows.has(series)) shows.set(series, series ? await own.episodes(series) : null);
      const numbered = shows.get(series);
      id = numbered?.get(`${play.season}:${play.episode}`) ?? '';
      if (!id) {unmatched++; if (numbered) missed.push(sentKey(play)); continue;}
    }
    const taken = play.pct != null ? (play.runtime ? await own.position(id, play.runtime * play.pct / 100) : false) : await own.mark(id, play.at);
    if (taken) {added++; done.push(sentKey(play));} else unmatched++;
  }
  return {added, unmatched, left, done, missed};
}

/* One pass of Add (or Move) for a pair. `leave`: what the person tapped out, kept out for good. */
export async function copy(env: Env, hub: string, person: string, pair: Pair, skip: Set<string>, want: {before?: boolean} = {}): Promise<{added: number; unmatched: number; more: boolean; left: number} | Failed> {
  let added = 0, unmatched = 0, more = false, left = 0;
  if (pair === 'mdblist-trakt') {
    const got = await pointsBoth(env, hub, person);
    if ('error' in got) return got;
    const lists = (await getSecret<{key: string}>(env, hub, person, 'mdblist'))!, ask = mdblist(env, lists.key), todo = got.points.filter(point => !skip.has(point.key));
    // A spot is sent once (by where it is and when it was left there): a later one is a new spot.
    const toTrakt: string[] = [], toLists: string[] = [];
    for (const point of todo.slice(0, 10)) {
      if (point.to === 'trakt') {if (await deliver(env, hub, person, `carry:${point.key.slice(3)}`, {kind: 'pause', path: '/scrobble/pause', body: pauseOf(point)}) === 'off') return {error: 'Trakt needs connecting again.'}; added++; toTrakt.push(`${point.key}@${point.at}`);}
      else {const answer = await ask('/scrobble/pause', listsPause(point)); if (answer.status === 200 || answer.status === 201) {added++; toLists.push(`${point.key}@${point.at}`);} else unmatched++;}
    }
    if (toTrakt.length || toLists.length) await env.DB.batch([...remember(env, hub, person, 'trakt', toTrakt), ...remember(env, hub, person, 'mdblist', toLists)]);
    return {added, unmatched, more: todo.length > 10, left: Math.max(0, todo.length - 10)};
  }
  // Out of Here first (to Trakt or MDBList), through carry.ts, which keeps one pass per person at a time.
  if (pair !== 'mdblist-here') {
    const got = await carry(env, hub, person, skip, pair === 'here-trakt' ? {trakt: true, before: want.before} : {lists: true});
    if ('error' in got) return got;
    added += got.watched + got.partway + got.trakt; more ||= got.more; unmatched += got.missed; left += got.left ?? 0;
    if (pair === 'here-mdblist') return {added, unmatched, more, left};
  }
  const found = await look(env, hub, person, pair, skip, false);
  if ('error' in found) return found;
  if (!found.incoming.length) return {added, unmatched, more: more || found.more, left};
  // Ticking here only while their server passes nothing on to a tracker, or it would echo there.
  if (!await quiet(env, hub, person)) return {error: 'Your setup is still switching over. Try again in a moment.'};
  const via = (await getSecret<Via>(env, hub, person, 'upstream-aiom'))!, own = await server(via);
  if (!own) return NO_ANSWER.server;
  try {
    const got = await tickHere(own, found.incoming);
    // Each ticked once: one the person unticks later stays unticked. One this server could not take is not tried again either.
    const noted = [...got.done, ...got.missed];
    if (noted.length) await env.DB.batch(remember(env, hub, person, 'here', noted));
    return {added: added + got.added, unmatched: unmatched + got.unmatched, more: more || found.more || got.left > 0, left: left + got.left};
  } finally {await own.done();}
}

/* A paused spot as MDBList takes it: an episode under its show, by season; kept under 80%, where it would count as watched. */
export const listsPause = (point: {kind: 'movie' | 'show'; ids: Ids; season?: number; episode?: number; pct?: number}) => {
  const progress = Math.min(79.99, Math.max(1, point.pct!));
  return point.kind === 'movie' ? {movie: {ids: point.ids}, progress} : {show: {ids: point.ids, season: {number: point.season, episode: {number: point.episode}}}, progress};
};
/* What the card shows, worked out when it opens and kept for six hours per person and pair: MDBList allows a person 1,000 calls a
   day, and Trakt turns away busy callers. Checking again (`fresh`) looks anew unless the last look is under two minutes old. */
const KEPT = 6 * 3600, AGAIN = 120;
export async function shown(env: Env, hub: string, person: string, pair: Pair, skip: Set<string>, fresh = false): Promise<Look | Failed> {
  const row = await env.DB.prepare('SELECT here FROM drift WHERE hub = ? AND person = ?').bind(hub, person).first<{here: string | null}>();
  let kept: Record<string, {at: number; look: Look}> = {};
  try {kept = row?.here ? JSON.parse(row.here) : {};} catch {kept = {};}
  if (kept[pair] && now() - kept[pair].at < (fresh ? AGAIN : KEPT)) return {...kept[pair].look, checked: kept[pair].at};
  const got = await look(env, hub, person, pair, skip);
  if ('error' in got) return got;
  const {incoming: _, ...look_} = got;
  await env.DB.batch([env.DB.prepare("INSERT INTO drift (hub, person, day) VALUES (?, ?, '') ON CONFLICT (hub, person) DO NOTHING").bind(hub, person), env.DB.prepare('UPDATE drift SET here = ?, here_at = ? WHERE hub = ? AND person = ?').bind(JSON.stringify({...kept, [pair]: {at: now(), look: look_}}), now(), hub, person)]);
  return {...look_, checked: now()};
}
export const forgetShown = (env: Env, hub: string, person: string) => env.DB.prepare('UPDATE drift SET here = NULL, here_at = NULL WHERE hub = ? AND person = ?').bind(hub, person);

/* Whether a person's Trakt is connected to the hub and usable. */
export const traktOn = async (env: Env, hub: string, person: string) => !!env.TRAKT_CLIENT_ID && !((await getSecret<Link>(env, hub, person, LINK)) ?? {again: true}).again;
/* Marks the MDBList key as being moved to or from. */
export async function moving(env: Env, hub: string, person: string, to: 'mdblist' | 'here' | null) {
  const kept = await getSecret<{key: string; username?: string; moving?: string}>(env, hub, person, 'mdblist');
  if (!kept) return false;
  const {moving: _, ...rest} = kept;
  await (await putSecret(env, hub, person, 'mdblist', to ? {...rest, moving: to} : rest)).run();
  return true;
}
export type {Item};
