/* Syncing a person's Trakt with their progress, once they turn it on from their own page (never from anyone else's: it
   writes to their own accounts). Progress has one home, this hub (their own server) or their MDBList; Trakt keeps a copy.
   - Here to Trakt: as it plays (front.ts, through the outbox). What was watched here before connecting goes only if they said so
     (`earlier`): a pass at a time from their open page (`pass`), and once a day here for any play that never reached Trakt.
   - Trakt to the home: a cron step, one person a run, each about every twenty minutes (`match`). First one cheap read of what
     changed (Trakt's /sync/last_activities); only when a stamp moved is anything else read: Trakt's plays since then, and its
     paused spots. What the hub itself sent is left out. The rest is ticked on their own server, or added to their MDBList (a
     server write would be passed on to MDBList and echo; AIOMetadata reads MDBList for them).
   - MDBList and Trakt, for plays made in other apps: the daily look (drift.ts), which copies across by itself.
   - Here to MDBList, for someone whose progress is kept in MDBList (with or without Trakt): once a day, what was watched here
     and their MDBList lacks (`leftovers`). Their setup tells MDBList of each play itself; this is for any that never got there.
   Only adds: nothing is ever unwatched or removed, since a play missing on one side cannot be told from one deleted there. Each
   play goes to a place once (the `sent` ledger, carry.ts), so one deleted there stays deleted. A paused spot replaces the one in
   the home only when it is later and not the hub's own (places.ts, lacking). Every Trakt write goes through the outbox.
   Workers Free allows about fifty outside calls per run, so a cron pass writes a few titles and leaves the rest for the next. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK, read, traktWait} from './trakt';
import type {Link, Target} from './trakt';
import {NO_ANSWER, NO_SETUP, carry, history, ledger, mdblist, pointKey, remember, traktPoints} from './carry';
import type {Failed, Noted, TraktPoint} from './carry';
import {SAME, mdblistPlays, skippedOf, traktPlays} from './drift';
import {BUDGET, NEAR, SPAN, detail, fromPoint, lacking, listsPause, quiet, sentKey, tickHere, where} from './places';
import type {Incoming} from './places';
import {server} from './here';
import type {Via} from './here';

// EVERY: how often each person is looked at at most (one person a run, so with more than four syncing it is longer: SLOT each). WAIT: after Trakt did not answer, how long before they are asked again. HOUR: the
// UTC hour the day's pass starts. A cron pass writes to their server until its calls reach WRITES, and asks MDBList about TITLES.
// CHEAP: the calls a look makes when nothing needs doing (the stamps, Trakt's plays since): a run that made no more is not busy,
// so the For you picks after it still run.
const EVERY = 20 * 60, WAIT = 3600, HOUR = 4, WRITES = 8, TITLES = 5, CHEAP = 2, SLOT = 5;
/* About how often, in minutes, each person's turn comes: one person each five-minute run, whichever hub they are in, and never
   sooner than EVERY. Only the minutes leave here, for the Background work row. */
export const turnEvery = (syncing: number) => Math.max(EVERY / 60, syncing * SLOT);
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
   and what was sent there before. `budget`: how many calls their server may take. `skip`: plays they left out on their own
   page (drift.ts, skip), which stay out here too. */
export async function toHome(env: Env, hub: string, person: string, since: {w: number | null; p: number | null}, lists: boolean, budget: number, skip: Set<string>, moved = 0): Promise<Into | (Failed & {calls: number})> {
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
  // Left out on their page, under any of the keys a page gives a play: a look at here and Trakt (i:, ip:), the daily look at
  // MDBList and Trakt (the title or episode with its time), or its paused spots (pt:).
  const leftOut = (play: Omit<Incoming, 'id'>) => skip.has(play.key) || (play.pct != null ? skip.has(`pt:${play.key.slice(3)}`) : skip.has(`${play.key.slice(2)}@${secs(play.at)}`));
  const done = await ledger(env, hub, person, lists ? 'mdblist' : 'here'), todo = plays.filter(play => !leftOut(play) && !done.has(sentKey(play)));
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
  const ask = mdblist(env, key), sent: Noted[] = [], send: Omit<Incoming, 'id'>[] = [], said = (play: Omit<Incoming, 'id'>): Noted => ({key: sentKey(play), title: play.title, detail: detail(play.season, play.episode)});
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
    added += send.length; sent.push(...send.map(said));
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
      if (answer.status === 200 || answer.status === 201) {added++; sent.push(said(play));}
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
  if (!row?.matching) return {error: 'Sync isn’t on. The page has been refreshed.'};
  const link = await getSecret<Link>(env, hub, person, LINK);
  if (!link || link.again) return {error: NOT_SIGNED_IN};
  const skip = await skippedOf(env, hub, person), out = await carry(env, hub, person, skip, {trakt: true, before: !!row.earlier});
  if ('error' in out) return out;
  const since = now() - SPAN, into = await toHome(env, hub, person, {w: since, p: since}, lists, BUDGET, skip);
  if ('error' in into) return into;
  const more = out.more || into.more;
  if (!more) await env.DB.prepare('UPDATE sync SET good = ?, failing = NULL, why = NULL WHERE hub = ? AND person = ?').bind(now(), hub, person).run();
  return {trakt: out.trakt, home: into.added, left: out.left ?? 0, more};
}

/* One step of the cron (index.ts): one person a run, across every hub. True when it did more than look (see CHEAP). */
export async function match(env: Env, time: number): Promise<boolean> {
  if (!env.TRAKT_CLIENT_ID) return false;
  const who = await env.DB.prepare(`SELECT y.hub, y.person, y.stamps, y.earlier, y.day, coalesce(json_extract(p.data, '$.lists'), 0) AS lists FROM sync y JOIN people p ON p.hub = y.hub AND p.id = y.person
    JOIN secrets s ON s.hub = y.hub AND s.owner = y.person AND s.kind = ?1 WHERE y.matching = 1 AND y.checked <= ?2 ORDER BY y.checked LIMIT 1`)
    .bind(LINK, now() - EVERY).first<{hub: string; person: string; stamps: string | null; earlier: number; day: string; lists: number}>();
  if (!who) return false;
  const {hub, person} = who, at = now(), today = new Date(time).toISOString().slice(0, 10);
  const set = (fields: string, ...values: unknown[]) => env.DB.prepare(`UPDATE sync SET ${fields} WHERE hub = ? AND person = ?`).bind(...values, hub, person).run();
  // Failing since the first time it failed, with why: their page says so at once (never "syncing" as if all were well), and
  // after three days that it is stuck.
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
  const got = await toHome(env, hub, person, since, !!who.lists, WRITES, await skippedOf(env, hub, person), current.p);
  if ('error' in got) {await failed(got.error); return got.calls > CHEAP;}
  // More than a pass holds: they are due again next run, from the same stamps (what was sent is not sent twice).
  if (got.more) await set('good = ?, checked = ?, failing = NULL, why = NULL', at, at - EVERY);
  else await good(current);
  return got.calls > CHEAP;
}

/* The daily step for what was watched here and their MDBList lacks, for someone whose progress is kept in MDBList (Trakt or not,
   sync on or not: keeping progress there is their say-so, and the switch copied the rest the same way). One person a run, from
   HOUR (UTC), and only when they played something since the last look; a run of its own (the last step, after For you had
   nothing to do: index.ts), since a look asks MDBList about each
   title (a few, `few` in carry.ts). The first look takes everything played here; later ones what was played since. What they
   left out stays out, and each play goes once (the `sent` ledger). True when it asked anything of their server or MDBList. */
export async function leftovers(env: Env, time: number): Promise<boolean> {
  const date = new Date(time), day = date.toISOString().slice(0, 10);
  if (date.getUTCHours() < HOUR) return false;
  const who = await env.DB.prepare(`SELECT m.hub, m.owner AS person, d.lists_at AS at FROM secrets m JOIN people p ON p.hub = m.hub AND p.id = m.owner AND json_extract(p.data, '$.lists') = 1
    LEFT JOIN drift d ON d.hub = m.hub AND d.person = m.owner WHERE m.kind = 'mdblist' AND (d.lists_day IS NULL OR d.lists_day < ?1) LIMIT 1`).bind(day).first<{hub: string; person: string; at: number | null}>();
  if (!who) return false;
  const {hub, person} = who, since = who.at ? who.at - 2 * 86400 : 0;
  // The day counts as looked at (`finished`: a whole look, so the next takes only what was played since).
  const looked = (finished: boolean) => env.DB.prepare(`INSERT INTO drift (hub, person, day, lists_day, lists_at) VALUES (?1, ?2, '', ?3, ?4) ON CONFLICT (hub, person) DO UPDATE SET lists_day = excluded.lists_day, lists_at = coalesce(excluded.lists_at, drift.lists_at)`)
    .bind(hub, person, day, finished ? now() : null).run();
  // Still switching where progress is kept: their open page copies (places.ts).
  if ((await getSecret<{moving?: string}>(env, hub, person, 'mdblist'))?.moving) {await looked(false); return false;}
  if (!await env.DB.prepare('SELECT 1 FROM plays WHERE hub = ? AND person = ? AND updated >= ? LIMIT 1').bind(hub, person, since).first()) {await looked(!!who.at); return false;}
  const got = await carry(env, hub, person, await skippedOf(env, hub, person), {lists: true, since, few: true});
  // Not answered: tried again tomorrow. Only that it failed is noted, never whose or what.
  if ('error' in got) {console.error('leftovers', got.status ?? 409); await looked(false); return true;}
  // Another pass of theirs was under way (their open page): nothing was looked at, so the day is not counted yet.
  if (got.busy) return true;
  // More than a pass holds: they are due again next run (what was sent, or MDBList already had, is not asked about twice).
  if (!got.more) await looked(true);
  return true;
}
