/* Keeping a person's Trakt and their progress matching, once they turn it on from their own page (never from anyone else's: it
   writes to their own accounts). Progress has one home, this hub (their own server) or their MDBList; Trakt keeps a copy.
   - Here to Trakt: as it plays (front.ts, through the outbox). What was watched here before connecting goes only if they said so
     (`earlier`): a pass at a time from their open page (`pass`), and once a day here for any play that never reached Trakt.
   - Trakt to the home: a cron step, one person a run, each about every twenty minutes (`match`). First one cheap read of what
     changed (Trakt's /sync/last_activities); only when a stamp moved is anything else read: Trakt's plays since then, and its
     paused spots. What the hub itself sent is left out. The rest is ticked on their own server, or added to their MDBList (a
     server write would be passed on to MDBList and echo; AIOMetadata reads MDBList for them).
   - MDBList and Trakt, for plays made in other apps: the daily look (drift.ts), which copies across by itself.
   Only adds: nothing is ever unwatched or removed, since a play missing on one side cannot be told from one deleted there. Each
   play goes to a place once (the `sent` ledger, carry.ts), so one deleted there stays deleted. A paused spot replaces the one in
   the home only when it is later and not the hub's own (places.ts, lacking). Every Trakt write goes through the outbox.
   Workers Free allows about fifty outside calls per run, so a cron pass writes a few titles and leaves the rest for the next. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK, read, traktWait} from './trakt';
import type {Link, Target} from './trakt';
import {NO_ANSWER, NO_SETUP, carry, history, ledger, mdblist, pointKey, remember, traktPoints} from './carry';
import type {Failed, TraktPoint} from './carry';
import {SAME, mdblistPlays, skippedOf, traktPlays} from './drift';
import {BUDGET, NEAR, SPAN, fromPoint, lacking, listsPause, quiet, sentKey, tickHere, where} from './places';
import type {Incoming} from './places';
import {server} from './here';
import type {Via} from './here';

// EVERY: how often each person is looked at. WAIT: after Trakt did not answer, how long before they are asked again. HOUR: the
// UTC hour the day's pass starts. A cron pass writes to their server until its calls reach WRITES, and asks MDBList about TITLES.
// CHEAP: the calls a look makes when nothing needs doing (the stamps, Trakt's plays since): a run that made no more is not busy,
// so the For you picks after it still run.
const EVERY = 20 * 60, WAIT = 3600, HOUR = 4, WRITES = 8, TITLES = 5, CHEAP = 2;
export const NOT_SIGNED_IN = 'Trakt needs you to sign in again.';
export interface Stamps {w: number; p: number}
type Activity = {movies?: {watched_at?: string; paused_at?: string}; episodes?: {watched_at?: string; paused_at?: string}};
const secs = (text?: string) => Math.floor(Date.parse(text ?? '') / 1000) || 0;
const stampsOf = (got: Activity): Stamps => ({w: Math.max(secs(got.movies?.watched_at), secs(got.episodes?.watched_at)), p: Math.max(secs(got.movies?.paused_at), secs(got.episodes?.paused_at))});

/* What the hub itself sent to Trakt for this person since `from`, by title or episode, with when (front.ts notes each). Trakt
   lists those plays and spots too: they are never copied back. */
async function ownSends(env: Env, hub: string, person: string, from: number) {
  const rows = (await env.DB.prepare("SELECT ids, scrobbled_at FROM plays WHERE hub = ? AND person = ? AND ids IS NOT NULL AND ids != '' AND scrobbled_at >= ?").bind(hub, person, from).all<{ids: string; scrobbled_at: number}>()).results;
  const out = new Map<string, number[]>();
  for (const row of rows) {
    const target = JSON.parse(row.ids) as Target, key = 'movie' in target ? where('movie', target.movie.ids.tmdb) : where('show', target.show.ids.tmdb, target.episode.season, target.episode.number);
    out.set(key, [...(out.get(key) ?? []), row.scrobbled_at]);
  }
  return out;
}

type Into = {added: number; more: boolean; calls: number};
/* Trakt's plays and paused spots since these times (null: that kind did not move) into the person's home, less what the hub sent
   and what was sent there before. `budget`: how many calls their server may take. */
export async function toHome(env: Env, hub: string, person: string, since: {w: number | null; p: number | null}, lists: boolean, budget: number, moved = 0): Promise<Into | (Failed & {calls: number})> {
  let calls = 0, more = false;
  const titles: Parameters<typeof traktPlays>[6] = {}, plays: Omit<Incoming, 'id'>[] = [];
  const own = await ownSends(env, hub, person, Math.min(since.w ?? Infinity, since.p ?? Infinity) - SAME), ours = (key: string, at: number, slack: number) => (own.get(key) ?? []).some(sent => Math.abs(sent - at) <= slack);
  if (since.w != null) {
    for (let page = 1; page <= 2; page++) {
      const got = await traktPlays(env, hub, person, since.w - 60, now(), page, titles); calls++;
      if (!got) return {...NO_ANSWER.trakt, calls};
      for (const play of got.plays) {
        const title = titles[play.t], key = where(title.kind, title.tmdb, play.s, play.e);
        if (ours(key, play.at, SAME) || plays.some(item => item.key === `i:${key}`)) continue;
        plays.push({key: `i:${key}`, kind: title.kind, ids: {tmdb: title.tmdb, ...(title.imdb ? {imdb: title.imdb} : {})}, title: title.name || 'Untitled', ...(play.s != null ? {season: play.s, episode: play.e} : {}), at: new Date(play.at * 1000).toISOString()});
      }
      if (!got.more) break;
      more = page === 2;
    }
  }
  if (since.p != null) {
    const got = await traktPoints(env, hub, person, moved); calls++;
    if (!Array.isArray(got)) return {...NO_ANSWER.trakt, calls};
    for (const point of got) {
      const at = secs(point.paused_at), key = pointKey(point), play = fromPoint(point);
      if (at > since.p && key && play && !ours(key, at, NEAR)) plays.push(play);
    }
  }
  const done = await ledger(env, hub, person, lists ? 'mdblist' : 'here'), todo = plays.filter(play => !done.has(sentKey(play)));
  if (!todo.length) return {added: 0, more, calls};
  if (!lists) {
    const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
    if (!via) return {...NO_SETUP, calls};
    calls++;
    if (!await quiet(env, hub, person)) return {error: 'Your setup is still switching over.', calls};
    const own = await server(via);
    if (!own) return {...NO_ANSWER.server, calls: calls + 1};
    try {
      const found = await lacking(own, todo), got = await tickHere(own, found.out, budget), noted = [...got.done, ...got.missed];
      if (noted.length) await env.DB.batch(remember(env, hub, person, 'here', noted));
      return {added: got.added, more: more || got.left > 0, calls: calls + own.counter.calls + 1};
    } catch {return {...NO_ANSWER.server, calls: calls + own.counter.calls};}
    finally {await own.done();}
  }
  const key = (await getSecret<{key: string}>(env, hub, person, 'mdblist'))?.key;
  if (!key) return {added: 0, more: false, calls};
  const ask = mdblist(env, key), sent: string[] = [], send: Omit<Incoming, 'id'>[] = [];
  let added = 0;
  const finished = todo.filter(play => play.pct == null), points = todo.filter(play => play.pct != null);
  // Finished plays: MDBList is asked about each title (a few a pass), so one it already has within twelve hours is not added twice.
  const names = [...new Set(finished.map(play => `${play.kind}/${play.ids.tmdb}`))];
  more ||= names.length > TITLES;
  for (const t of names.slice(0, TITLES)) {
    const [kind, tmdb] = t.split('/') as ['movie' | 'show', string], has = await mdblistPlays(ask, {kind, tmdb: Number(tmdb), name: ''}, t); calls++;
    if (!has) return {...NO_ANSWER.mdblist, calls};
    // A title MDBList says it listed only part of is left alone rather than guessed at.
    for (const play of finished.filter(item => `${item.kind}/${item.ids.tmdb}` === t)) if (has !== 'long' && !has.some(held => (held.s == null ? held.t : `${held.t}:${held.s}:${held.e}`) === play.key.slice(2) && Math.abs(held.at - secs(play.at)) <= SAME)) send.push(play);
  }
  if (send.length) {
    calls++;
    if ((await ask('/sync/watched', history(send))).status !== 200) return {...NO_ANSWER.mdblist, calls};
    added += send.length; sent.push(...send.map(sentKey));
  }
  // Spots: Trakt's replaces MDBList's only when later (by more than a send takes) and somewhere else.
  if (points.length) {
    const theirs = await ask('/sync/playback'); calls++;
    if (theirs.status !== 200 || !Array.isArray(theirs.body)) return {...NO_ANSWER.mdblist, calls};
    const held = new Map((theirs.body as TraktPoint[]).map(point => [pointKey(point), point]));
    for (const play of points.slice(0, TITLES)) {
      const there = held.get(play.key.slice(3));
      if (there && (secs(play.at) <= secs(there.paused_at) + NEAR || Math.abs(Number(there.progress) - play.pct!) <= 1)) continue;
      const answer = await ask('/scrobble/pause', listsPause(play)); calls++;
      if (answer.status === 200 || answer.status === 201) {added++; sent.push(sentKey(play));}
    }
    more ||= points.length > TITLES;
  }
  if (sent.length) await env.DB.batch(remember(env, hub, person, 'mdblist', sent));
  return {added, more, calls};
}

/* One pass of catching up, from the person's own open page: what they watched here that Trakt lacks (from before connecting only
   if they said so), then what Trakt has from the last two weeks that their progress lacks. `trakt`: how many went to Trakt, and
   about how many are `left` for it. */
export async function pass(env: Env, hub: string, person: string, lists: boolean): Promise<{trakt: number; home: number; left: number; more: boolean} | Failed> {
  const row = await env.DB.prepare('SELECT matching, earlier FROM sync WHERE hub = ? AND person = ?').bind(hub, person).first<{matching: number; earlier: number}>();
  if (!row?.matching) return {error: 'Matching isn’t on. The page has been refreshed.'};
  const link = await getSecret<Link>(env, hub, person, LINK);
  if (!link || link.again) return {error: NOT_SIGNED_IN};
  const out = await carry(env, hub, person, await skippedOf(env, hub, person), {trakt: true, before: !!row.earlier});
  if ('error' in out) return out;
  const since = now() - SPAN, into = await toHome(env, hub, person, {w: since, p: since}, lists, BUDGET);
  if ('error' in into) return into;
  const more = out.more || into.more;
  if (!more) await env.DB.prepare('UPDATE sync SET good = ?, failing = NULL, why = NULL WHERE hub = ? AND person = ?').bind(now(), hub, person).run();
  return {trakt: out.trakt, home: into.added, left: out.left ?? 0, more};
}

/* One step of the cron (index.ts): one person a run. True when it did more than look (see CHEAP). */
export async function match(env: Env, time: number): Promise<boolean> {
  if (!env.TRAKT_CLIENT_ID) return false;
  const who = await env.DB.prepare(`SELECT y.hub, y.person, y.stamps, y.earlier, y.day, coalesce(json_extract(p.data, '$.lists'), 0) AS lists FROM sync y JOIN people p ON p.hub = y.hub AND p.id = y.person
    JOIN secrets s ON s.hub = y.hub AND s.owner = y.person AND s.kind = ?1 WHERE y.matching = 1 AND y.checked <= ?2 ORDER BY y.checked LIMIT 1`)
    .bind(LINK, now() - EVERY).first<{hub: string; person: string; stamps: string | null; earlier: number; day: string; lists: number}>();
  if (!who) return false;
  const {hub, person} = who, at = now(), today = new Date(time).toISOString().slice(0, 10);
  const set = (fields: string, ...values: unknown[]) => env.DB.prepare(`UPDATE sync SET ${fields} WHERE hub = ? AND person = ?`).bind(...values, hub, person).run();
  // Failing since the first time it failed, with why: the page says so only after three days of it.
  const failed = (why: string, next = at) => set('failing = coalesce(failing, ?), why = ?, checked = ?', at, why, next);
  const good = (stamps: Stamps) => set('stamps = ?, good = ?, checked = ?, failing = NULL, why = NULL', JSON.stringify(stamps), at, at);
  // Calls of theirs still waiting for Trakt: Trakt would look behind. Looked at again on their next turn.
  if (await env.DB.prepare('SELECT 1 FROM trakt_outbox WHERE hub = ? AND person = ? LIMIT 1').bind(hub, person).first()) {await set('checked = ?', at); return false;}
  const activity = await read<Activity>(env, hub, person, '/sync/last_activities');
  if (!activity || typeof activity !== 'object') {
    // Trakt turned the hub away, or their login lapsed: asked again in an hour, and nobody else this run.
    const link = await getSecret<Link>(env, hub, person, LINK);
    await failed(!link || link.again ? NOT_SIGNED_IN : NO_ANSWER.trakt.error, (await traktWait(env, hub, person) || at + WAIT) - EVERY);
    return false;
  }
  const current = stampsOf(activity), kept = who.stamps ? JSON.parse(who.stamps) as Stamps : null;
  // Once a day, for someone whose progress is kept here and who played something since the last: plays that never reached Trakt
  // (Trakt refused for a week, or their login lapsed meanwhile), one pass. Their look at Trakt comes next run.
  if (!who.lists && new Date(time).getUTCHours() >= HOUR && who.day < today) {
    const played = await env.DB.prepare('SELECT 1 FROM plays WHERE hub = ? AND person = ? AND updated > ? LIMIT 1').bind(hub, person, (Date.parse(`${who.day}T00:00:00Z`) / 1000 || 0) - 86400).first();
    if (played) {
      const got = await carry(env, hub, person, await skippedOf(env, hub, person), {trakt: true, before: !!who.earlier});
      if ('error' in got) {await failed(got.error); await set('day = ?', today); return true;}
    }
    await set('day = ?, checked = ?', today, at - EVERY);
    return !!played;
  }
  // Nothing moved since the last good look: nothing else is read.
  const span = at - SPAN, since = {w: !kept ? span : current.w > kept.w ? kept.w : null, p: !kept ? span : current.p > kept.p ? kept.p : null};
  if (since.w == null && since.p == null) {await good(current); return false;}
  const got = await toHome(env, hub, person, since, !!who.lists, WRITES, current.p);
  if ('error' in got) {await failed(got.error); return got.calls > CHEAP;}
  // More than a pass holds: they are due again next run, from the same stamps (what was sent is not sent twice).
  if (got.more) await set('good = ?, checked = ?, failing = NULL, why = NULL', at, at - EVERY);
  else await good(current);
  return got.calls > CHEAP;
}
