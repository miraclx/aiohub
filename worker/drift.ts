/* Whether a person's Trakt and their own MDBList agree on what they watched in the last two weeks. Looked at once a day for
   everyone with both connected (Trakt to the hub, MDBList with their own key). A play one has and the other lacks is shown on
   their own page, under Accounts, and copied across only when they ask (`fix`). Looking never changes either side.
   The two note a finish at slightly different moments, so plays of the same title within twelve hours are the same viewing.
   Workers Free allows about fifty outside calls and database queries per run, so the reading is spread over a few cron runs and
   kept here in between (the drift table). */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK, read, send, taken} from './trakt';
import {mdblist} from './carry';

const DAY = 86400, SPAN = 14 * DAY, SAME = 12 * 3600;
// The last hour is left out: a play may still be on its way to one of them. The day's look starts with the first cron run after
// HOUR (UTC); each run makes up to STEP outside calls, and a look that keeps failing is let go after TRIES runs.
const FRESH = 3600, HOUR = 4, STEP = 6, TRIES = 12, PAGES = 10, KEPT = 200, CHECK = 15;

type Kind = 'movie' | 'show';
interface Title {kind: Kind; tmdb: number; imdb?: string; name: string}
interface Play {t: string; s?: number; e?: number; at: number}
interface Work {since: number; until: number; page: number; listed: boolean; tries: number; titles: Record<string, Title>; todo: string[]; skipped: string[]; trakt: Play[]; mdblist: Play[]}
export interface Miss {kind: Kind; tmdb: number; imdb?: string; name: string; season?: number; episode?: number; at: number}
export interface Found {since: number; trakt: number; mdblist: number; toMdblist: Miss[]; toTrakt: Miss[]}
interface Media {title?: string; ids?: {tmdb?: number | null; imdb?: string | null}}
interface Entry {watched_at?: string; type?: string; movie?: Media; show?: Media; episode?: {season?: number; number?: number}}

const iso = (at: number) => new Date(at * 1000).toISOString();
const keyOf = (play: {t: string; s?: number; e?: number}) => play.s == null ? play.t : `${play.t}:${play.s}:${play.e}`;
const missKey = (miss: Miss) => keyOf({t: `${miss.kind}/${miss.tmdb}`, s: miss.season, e: miss.episode});
const seconds = (text?: string) => Math.floor(Date.parse(text ?? '') / 1000) || 0;
function titleOf(titles: Record<string, Title>, kind: Kind, media?: Media) {
  const tmdb = Number(media?.ids?.tmdb), imdb = media?.ids?.imdb;
  if (!(tmdb > 0)) return '';
  const t = `${kind}/${tmdb}`;
  titles[t] ??= {kind, tmdb, ...(imdb && /^tt\d+$/.test(imdb) ? {imdb} : {}), name: String(media?.title ?? '').slice(0, 200)};
  return t;
}
/* A Trakt history entry as a play, or null for one without a TMDB id (it cannot be looked up on MDBList). */
function fromTrakt(entry: Entry, titles: Record<string, Title>): Play | null {
  const movie = entry.type === 'movie', t = titleOf(titles, movie ? 'movie' : 'show', movie ? entry.movie : entry.show), at = seconds(entry.watched_at);
  if (!t || !at) return null;
  if (movie) return {t, at};
  const {season, number} = entry.episode ?? {};
  return season == null || number == null ? null : {t, s: season, e: number, at};
}
/* Trakt's history between two moments, page by page. null when Trakt did not answer. */
async function traktPlays(env: Env, hub: string, person: string, from: number, to: number, page: number, titles: Record<string, Title>) {
  const paging = {pages: 0}, got = await read<Entry[]>(env, hub, person, `/sync/history?start_at=${iso(from)}&end_at=${iso(to)}&page=${page}&limit=100`, paging);
  if (!Array.isArray(got)) return null;
  return {plays: got.map(entry => fromTrakt(entry, titles)).filter((play): play is Play => !!play), more: got.length > 0 && (!paging.pages || page < paging.pages)};
}
/* One title's plays on MDBList. null when MDBList did not answer; 'long' when it says it left some out. */
async function mdblistPlays(ask: ReturnType<typeof mdblist>, title: Title, t: string) {
  const got = await ask(`/sync/history/${title.kind}/tmdb/${title.tmdb}`);
  if (got.status === 404) return [];
  const body = got.body as {plays?: {watched_at?: string; season_num?: number | null; episode_num?: number | null}[]; truncated?: boolean} | null;
  if (got.status !== 200 || !body || Array.isArray(body)) return null;
  if (body.truncated) return 'long' as const;
  return (body.plays ?? []).map(play => ({t, ...(title.kind === 'show' ? {s: play.season_num ?? undefined, e: play.episode_num ?? undefined} : {}), at: seconds(play.watched_at)}))
    .filter(play => play.at && (title.kind === 'movie' || (play.s != null && play.e != null)));
}
/* Plays of each title paired up across the two within twelve hours; what is left over on either side, in the window. */
function compare(work: Work): Found {
  // Every play read is paired, but only those inside the window are reported: one just before or after it can still be a pair.
  const skip = new Set(work.skipped), inside = (at: number) => at >= work.since && at <= work.until;
  const group = (plays: Play[]) => {const out = new Map<string, number[]>(); for (const play of plays.filter(item => !skip.has(item.t))) out.set(keyOf(play), [...(out.get(keyOf(play)) ?? []), play.at]); return out;};
  const trakt = group(work.trakt), lists = group(work.mdblist), toMdblist: Miss[] = [], toTrakt: Miss[] = [];
  const miss = (key: string, at: number): Miss => {
    const [t, s, e] = key.split(':'), title = work.titles[t];
    return {kind: title.kind, tmdb: title.tmdb, ...(title.imdb ? {imdb: title.imdb} : {}), name: title.name, ...(s ? {season: Number(s), episode: Number(e)} : {}), at};
  };
  for (const key of new Set([...trakt.keys(), ...lists.keys()])) {
    const one = (trakt.get(key) ?? []).sort((a, b) => a - b), other = (lists.get(key) ?? []).sort((a, b) => a - b), used = new Set<number>();
    for (const at of one) {
      const match = other.findIndex((them, n) => !used.has(n) && Math.abs(them - at) <= SAME);
      if (match >= 0) used.add(match); else if (inside(at)) toMdblist.push(miss(key, at));
    }
    other.forEach((at, n) => {if (!used.has(n) && inside(at)) toTrakt.push(miss(key, at));});
  }
  const count = (plays: Play[]) => plays.filter(play => !skip.has(play.t) && inside(play.at)).length, newest = (a: Miss, b: Miss) => b.at - a.at;
  return {since: work.since, trakt: count(work.trakt), mdblist: count(work.mdblist), toMdblist: toMdblist.sort(newest).slice(0, KEPT), toTrakt: toTrakt.sort(newest).slice(0, KEPT)};
}

/* One step of the day's look, from the cron. `time` is when the cron run was due. */
export async function drift(env: Env, time: number) {
  const date = new Date(time), day = date.toISOString().slice(0, 10);
  if (!env.TRAKT_CLIENT_ID || date.getUTCHours() < HOUR) return;
  // One person a run: whoever is part way through, else whoever has not had today's look.
  const who = await env.DB.prepare(`SELECT s.hub, s.owner AS person, d.day, d.work FROM secrets s JOIN secrets m ON m.hub = s.hub AND m.owner = s.owner AND m.kind = 'mdblist'
    LEFT JOIN drift d ON d.hub = s.hub AND d.person = s.owner WHERE s.kind = ?1 AND (d.day IS NULL OR d.day < ?2 OR d.work IS NOT NULL) ORDER BY d.work IS NULL LIMIT 1`)
    .bind(LINK, day).first<{hub: string; person: string; day: string | null; work: string | null}>();
  if (!who) return;
  const {hub, person} = who;
  // A play still waiting to reach Trakt would look missing there: the look waits for the outbox.
  if (await env.DB.prepare('SELECT 1 FROM trakt_outbox WHERE hub = ? AND person = ? LIMIT 1').bind(hub, person).first()) return;
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist');
  if (!lists?.key) return;
  const start = now(), ask = mdblist(env, lists.key);
  const work: Work = who.work && who.day === day ? JSON.parse(who.work) as Work
    : {since: start - SPAN, until: start - FRESH, page: 1, listed: false, tries: 0, titles: {}, todo: [], skipped: [], trakt: [], mdblist: []};
  const keep = (next: Work | null, found: Found | null) => env.DB.prepare(`INSERT INTO drift (hub, person, day, work, result, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (hub, person) DO UPDATE SET
    day = excluded.day, work = excluded.work, result = coalesce(excluded.result, drift.result), at = CASE WHEN excluded.result IS NULL THEN drift.at ELSE excluded.at END`)
    .bind(hub, person, day, next ? JSON.stringify(next) : null, found ? JSON.stringify(found) : null, now()).run();
  let calls = STEP, failed = false;
  while (calls-- > 0 && !failed) {
    if (work.page) {
      // Trakt from twelve hours either side of the window, so a play just inside it can still find its pair.
      const got = await traktPlays(env, hub, person, work.since - SAME, work.until + SAME, work.page, work.titles);
      if (!got) {failed = true; break;}
      work.trakt.push(...got.plays); work.page = got.more && work.page < PAGES ? work.page + 1 : 0;
    } else if (!work.listed) {
      // What MDBList has had watched lately, so titles only it knows about are looked at too.
      const got = await ask(`/sync/watched?since=${encodeURIComponent(iso(work.since - SAME))}&limit=1000`), body = got.body as Record<string, {last_watched_at?: string; movie?: Media; show?: Media; episode?: {show?: Media}}[]> | null;
      if (got.status !== 200 || !body || Array.isArray(body)) {failed = true; break;}
      // MDBList's `since` is when an entry last changed; only what was watched in the window is looked at.
      const lately = (item: {last_watched_at?: string}) => !item.last_watched_at || seconds(item.last_watched_at) >= work.since - SAME;
      for (const item of (body.movies ?? []).filter(lately)) titleOf(work.titles, 'movie', item.movie);
      for (const item of (body.episodes ?? []).filter(lately)) titleOf(work.titles, 'show', item.episode?.show);
      work.listed = true; work.todo = Object.keys(work.titles);
    } else if (work.todo.length) {
      const t = work.todo[0], plays = await mdblistPlays(ask, work.titles[t], t);
      if (!plays) {failed = true; break;}
      // MDBList left some of this title's plays out: it is not compared, rather than shown as missing.
      if (plays === 'long') work.skipped.push(t); else work.mdblist.push(...plays.filter(play => play.at >= work.since - SAME));
      work.todo.shift();
    } else break;
  }
  if (failed) return void await keep(++work.tries >= TRIES ? null : work, null);
  if (work.page || !work.listed || work.todo.length) return void await keep(work, null);
  await keep(null, compare(work));
}

/* A play by title, episode and time: what a person skips is kept by this, so it stays skipped through later looks. */
const playKey = (miss: Miss) => `${missKey(miss)}@${miss.at}`;
/* What the page shows: the differences found, less what the person skipped, if any are left. Each comes with its key. */
export function differing(result: string | null, skipped: string | null = null) {
  const found = result ? JSON.parse(result) as Found : null, skip = new Set<string>(skipped ? JSON.parse(skipped) as string[] : []);
  if (!found) return null;
  const keep = (list: Miss[]) => list.filter(miss => !skip.has(playKey(miss))).map(miss => ({...miss, key: playKey(miss)}));
  const left = {...found, toMdblist: keep(found.toMdblist), toTrakt: keep(found.toTrakt)};
  return left.toMdblist.length || left.toTrakt.length ? left : null;
}
/* Plays the person left out: never shown or copied again. Kept for someone with only MDBList too (their row starts empty). */
export async function skip(env: Env, hub: string, person: string, keys: string[]) {
  if (!keys.length) return;
  await env.DB.prepare("INSERT INTO drift (hub, person, day) VALUES (?, ?, '') ON CONFLICT (hub, person) DO NOTHING").bind(hub, person).run();
  const row = await env.DB.prepare('SELECT skipped FROM drift WHERE hub = ? AND person = ?').bind(hub, person).first<{skipped: string | null}>();
  const kept = row?.skipped ? JSON.parse(row.skipped) as string[] : [];
  await env.DB.prepare('UPDATE drift SET skipped = ? WHERE hub = ? AND person = ?').bind(JSON.stringify([...new Set([...keys, ...kept])].slice(0, 1000)), hub, person).run();
}
export const skippedOf = async (env: Env, hub: string, person: string) => new Set(JSON.parse((await env.DB.prepare('SELECT skipped FROM drift WHERE hub = ? AND person = ?').bind(hub, person).first<{skipped: string | null}>())?.skipped ?? '[]') as string[]);
/* The day's look as the person's page shows it, missing or not: when it was checked, and what one side lacks (less what they left out). */
export function looked(row: {result: string | null; skipped: string | null; at: number} | undefined) {
  if (!row?.result) return null;
  const found = differing(row.result, row.skipped), base = JSON.parse(row.result) as Found;
  return {checked: row.at, since: base.since, toMdblist: found?.toMdblist ?? [], toTrakt: found?.toTrakt ?? []};
}

const ids = (miss: Miss) => ({tmdb: miss.tmdb, ...(miss.imdb ? {imdb: miss.imdb} : {})});
/* Plays as Trakt and MDBList both take them: films on their own, episodes under their show and season, each with its date. */
function body(list: Miss[]) {
  const movies = list.filter(miss => miss.kind === 'movie').map(miss => ({ids: ids(miss), watched_at: iso(miss.at)})), shows = new Map<number, {ids: ReturnType<typeof ids>; seasons: Map<number, {number: number; watched_at: string}[]>}>();
  for (const miss of list.filter(item => item.kind === 'show')) {
    const show = shows.get(miss.tmdb) ?? {ids: ids(miss), seasons: new Map()}; shows.set(miss.tmdb, show);
    show.seasons.set(miss.season!, [...(show.seasons.get(miss.season!) ?? []), {number: miss.episode!, watched_at: iso(miss.at)}]);
  }
  return {...(movies.length ? {movies} : {}), ...(shows.size ? {shows: [...shows.values()].map(show => ({ids: show.ids, seasons: [...show.seasons].map(([number, episodes]) => ({number, episodes}))}))} : {})};
}
/* MDBList is sent each episode once per call, oldest plays first. */
function rounds(list: Miss[]) {
  const out: Miss[][] = [];
  for (const miss of [...list].sort((a, b) => a.at - b.at)) {
    const free = out.find(round => !round.some(item => missKey(item) === missKey(miss)));
    if (free) free.push(miss); else out.push([miss]);
  }
  return out;
}
const near = (plays: Play[], miss: Miss) => plays.some(play => keyOf(play) === missKey(miss) && Math.abs(play.at - miss.at) <= SAME);

/* Copies across the plays the day's look found missing, when the person asks. First each side is asked again for those titles, so
   nothing that arrived since is sent twice; then the plays are taken off the list, and only then sent. Only adds: nothing on
   either side is changed or removed. (A play MDBList gets that is older than the newest it has for an episode is kept as history
   only, which is what it is.) */
export async function fix(env: Env, hub: string, person: string): Promise<{trakt: number; mdblist: number} | {error: string}> {
  const row = await env.DB.prepare('SELECT result, skipped FROM drift WHERE hub = ? AND person = ?').bind(hub, person).first<{result: string | null; skipped: string | null}>(), found = differing(row?.result ?? null, row?.skipped ?? null);
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist');
  if (!found || !lists?.key || !await getSecret(env, hub, person, LINK)) return {trakt: 0, mdblist: 0};
  const titles: Record<string, Title> = {}, ask = mdblist(env, lists.key);
  let toTrakt = found.toTrakt;
  if (toTrakt.length) {
    const from = Math.min(...toTrakt.map(miss => miss.at)) - SAME, to = Math.max(...toTrakt.map(miss => miss.at)) + SAME, have: Play[] = [];
    for (let page = 1; page <= 3; page++) {
      const got = await traktPlays(env, hub, person, from, to, page, titles);
      if (!got) return {error: 'Trakt isn’t answering just now. Try again in a few minutes.'};
      have.push(...got.plays); if (!got.more) break;
    }
    toTrakt = toTrakt.filter(miss => !near(have, miss));
  }
  // MDBList is asked title by title, so a long list goes over a few clicks; the rest stays listed.
  const checked = [...new Set(found.toMdblist.map(miss => `${miss.kind}/${miss.tmdb}`))].slice(0, CHECK), have: Play[] = [];
  for (const t of checked) {
    const miss = found.toMdblist.find(item => `${item.kind}/${item.tmdb}` === t)!, plays = await mdblistPlays(ask, {kind: miss.kind, tmdb: miss.tmdb, name: miss.name}, t);
    if (!plays) return {error: 'MDBList isn’t answering just now. Try again in a few minutes.'};
    if (plays !== 'long') have.push(...plays);
  }
  const toMdblist = found.toMdblist.filter(miss => checked.includes(`${miss.kind}/${miss.tmdb}`) && !near(have, miss));
  const later = found.toMdblist.filter(miss => !checked.includes(`${miss.kind}/${miss.tmdb}`));
  // Taken off the list first, against exactly what was read, so a second click at the same moment sends nothing.
  const put = (next: Found) => env.DB.prepare('UPDATE drift SET result = ? WHERE hub = ? AND person = ? AND result = ?').bind(JSON.stringify(next), hub, person, row!.result);
  const left: Found = {...found, toTrakt: [], toMdblist: later};
  if (!(await put(left).run()).meta.changes) return {trakt: 0, mdblist: 0};
  const back: Miss[][] = [[], []];
  if (toTrakt.length && !taken(await send(env, hub, person, '/sync/history', body(toTrakt)))) back[0] = toTrakt;
  let sent = 0;
  for (const round of rounds(toMdblist)) {
    if ((await ask('/sync/watched', body(round))).status === 200) sent += round.length; else back[1].push(...round);
  }
  // What did not go through goes back on the list, for another try.
  if (back[0].length || back[1].length) await env.DB.prepare('UPDATE drift SET result = ? WHERE hub = ? AND person = ?').bind(JSON.stringify({...left, toTrakt: back[0], toMdblist: [...back[1], ...later]}), hub, person).run();
  if (back[0].length || back[1].length) return {error: `${[back[0].length && 'Trakt', back[1].length && 'MDBList'].filter(Boolean).join(' and ')} didn’t take them just now. They’re still listed; try again in a few minutes.`};
  return {trakt: toTrakt.length, mdblist: sent};
}
