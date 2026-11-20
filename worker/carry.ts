/* Copying what someone watched here to their own trackers (their MDBList, their Trakt, or both), once they connect one, when they ask
   and after they have seen the plan.
   AIOMetadata keeps what is played on a person's own server whether or not a tracker is connected, and once one is connected it
   shows both; nothing is lost by leaving it there. This is for having it in MDBList too (other apps read it there).
   Only titles played through the hub are looked at: on this path every play passes through it, so that is everything the
   server learned here, and it keeps the work small however long someone's MDBList history is. AIOMetadata is asked what it
   holds for those titles, MDBList and Trakt what they already have, and only the difference is offered.
   Trakt: only plays that never reached it as they happened are looked at (nothing was sent for them: Trakt was not connected
   yet, or the title could not be matched then), and a play Trakt already has within twelve hours counts as the same viewing.
   Trakt's history takes finished watches only, so a part-watched title is offered to MDBList alone. */
import type {Env} from './util';
import {getSecret, now, putSecret} from './util';
import {LINK, deliver} from './trakt';
import type {Link} from './trakt';
import {SAME, traktPlays} from './drift';

interface Via {user: string; pass: string; base: string}
interface Ids {tmdb: number; imdb?: string}
interface Item {Id: string; Type?: string; Name?: string; SeriesId?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number; ProviderIds?: Record<string, string>; UserData?: {Played?: boolean; PlayedPercentage?: number; LastPlayedDate?: string}}
// Per tracker: it has this play already, it would be added there, or that tracker is not connected (or does not take it).
export type Cell = 'has' | 'add' | 'none';
export interface Entry {key: string; title: string; detail: string; at: string; pct?: number; kind: 'movie' | 'show'; ids: Ids; season?: number; episode?: number; trakt: Cell; lists: Cell}
export interface Plan {watched: Entry[]; partway: Entry[]; already: number; unknown: number; more: boolean; trakt: boolean; lists: boolean}
type Failed = {error: string};

// A Worker may make about 50 calls per request, so each pass checks this many titles with MDBList, reads this many pages of Trakt
// history, and sends this many paused points.
const TITLES = 20, PAUSES = 10, TRAKT_PAGES = 3;
const head = (token = '') => ({accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'AIOHub/1.0', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="aiohub-carry", Version="1"${token ? `, Token="${token}"` : ''}`});
const where = (entry: Entry) => `${entry.kind}/${entry.ids.tmdb}${entry.season != null ? `:${entry.season}:${entry.episode}` : ''}`;

/* The person's own server, signed in to the way an app would, for as long as the plan takes. */
async function server(via: Via) {
  const signed = await fetch(`${via.base}/Users/AuthenticateByName`, {method: 'POST', headers: head(), body: JSON.stringify({Username: via.user, Pw: via.pass})})
    .then(answer => answer.ok ? answer.json() : null).catch(() => null) as {AccessToken?: string; User?: {Id?: string}} | null;
  if (!signed?.AccessToken || !signed.User?.Id) return null;
  const token = signed.AccessToken, user = signed.User.Id;
  return {
    items: async (ids: string[]) => {
      const out: Item[] = [];
      for (let at = 0; at < ids.length; at += 100) {
        const page = await fetch(`${via.base}/Users/${user}/Items?Ids=${ids.slice(at, at + 100).map(encodeURIComponent).join(',')}&Fields=ProviderIds`, {headers: head(token)})
          .then(answer => answer.ok ? answer.json() : null).catch(() => null) as {Items?: Item[]} | null;
        if (!page) throw new Error('server');
        out.push(...(page.Items ?? []));
      }
      return out;
    },
    done: () => fetch(`${via.base}/Sessions/Logout`, {method: 'POST', headers: head(token)}).catch(() => null),
  };
}
export const mdblist = (env: Env, key: string) => async (path: string, body?: unknown) => {
  const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`,
    {method: body === undefined ? 'GET' : 'POST', headers: {accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'AIOHub/1.0'}, body: body === undefined ? undefined : JSON.stringify(body)}).catch(() => null);
  return {status: answer?.status ?? 0, body: answer ? await answer.json().catch(() => null) as Record<string, unknown> | unknown[] | null : null};
};

/* `skip`: what the person left out, never offered again. */
export async function plan(env: Env, hub: string, person: string, skip: Set<string> = new Set()): Promise<Plan | Failed> {
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist'), held = env.TRAKT_CLIENT_ID ? await getSecret<Link>(env, hub, person, LINK) : null, link = held && !held.again ? held : null;
  if (!lists?.key && !link) return {error: 'Connect Trakt or MDBList first.'};
  const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
  if (!via) return {error: 'Nothing has been watched here yet.'};
  // Copied before: a tracker may still answer from a few minutes ago, so these are never sent twice. MDBList's by the play's key,
  // Trakt's as t:<key>.
  const carried = new Set(await getSecret<string[]>(env, hub, person, 'carried') ?? []);
  const rows = (await env.DB.prepare('SELECT item, updated, scrobbled FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 500').bind(hub, person).all<{item: string; updated: number; scrobbled: string | null}>()).results;
  const none: Plan = {watched: [], partway: [], already: 0, unknown: 0, more: false, trakt: !!link, lists: !!lists?.key};
  if (!rows.length) return none;
  const own = await server(via);
  if (!own) return {error: 'Your server did not answer. Try again in a moment.'};
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
      const entry: Entry = {key: '', kind: episode ? 'show' : 'movie', ids: {tmdb, ...(/^tt\d+$/.test(provider?.Imdb ?? '') ? {imdb: provider!.Imdb} : {})},
        title: String((episode ? show?.Name ?? item.SeriesName : item.Name) ?? 'Untitled').slice(0, 200), detail: episode ? `Season ${item.ParentIndexNumber} · Episode ${item.IndexNumber}` : 'Movie',
        at: data.LastPlayedDate ?? new Date((here?.updated ?? now()) * 1000).toISOString(), ...(partway ? {pct: Math.round(pct)} : {}), ...(episode ? {season: item.ParentIndexNumber, episode: item.IndexNumber} : {}), trakt: 'none', lists: 'none'};
      entry.key = `${watched ? 'w' : 'p'}:${where(entry)}`;
      if (skip.has(entry.key)) continue;
      if (lists?.key) entry.lists = carried.has(entry.key) ? 'has' : 'add';
      // Trakt: a finished watch it was never sent as it happened (sent: scrobbled is set, after the link was made).
      if (link && !partway) entry.trakt = carried.has(`t:${entry.key}`) || (here?.scrobbled && (!link.since || (here.updated ?? 0) >= link.since)) ? 'has' : 'add';
      if (entry.lists === 'add' || entry.trakt === 'add') all.push(entry);
    }
    let more = false;
    const decided = new Set<Entry>(all);
    // What MDBList already has for each title. Newest first, so a long list is copied the most recent first.
    if (lists?.key) {
      const asking = all.filter(entry => entry.lists === 'add'), titles = [...new Set(asking.map(entry => `${entry.kind}/${entry.ids.tmdb}`))], checked = new Set(titles.slice(0, TITLES)), has = new Set<string>(), ask = mdblist(env, lists.key);
      for (const title of checked) {
        const answer = await ask(`/sync/history/${title.replace('/', '/tmdb/')}`);
        if (answer.status !== 200) return {error: 'MDBList did not answer. Try again in a moment.'};
        for (const play of ((answer.body as {plays?: {season_num?: number; episode_num?: number}[]})?.plays ?? [])) has.add(title.startsWith('show') ? `${title}:${play.season_num}:${play.episode_num}` : title);
      }
      if (asking.some(entry => entry.pct != null && checked.has(`${entry.kind}/${entry.ids.tmdb}`))) {
        const answer = await ask('/sync/playback');
        if (answer.status !== 200) return {error: 'MDBList did not answer. Try again in a moment.'};
        for (const point of (Array.isArray(answer.body) ? answer.body : []) as {type?: string; movie?: {ids?: {tmdb?: number}}; show?: {ids?: {tmdb?: number}}; episode?: {season?: number; number?: number}}[]) {
          if (point.type === 'movie' && point.movie?.ids?.tmdb) has.add(`movie/${point.movie.ids.tmdb}`);
          if (point.type === 'episode' && point.show?.ids?.tmdb) has.add(`show/${point.show.ids.tmdb}:${point.episode?.season}:${point.episode?.number}`);
        }
      }
      for (const entry of asking) {
        if (!checked.has(`${entry.kind}/${entry.ids.tmdb}`)) {decided.delete(entry); more = true;}
        else if (has.has(where(entry))) entry.lists = 'has';
      }
    }
    // What Trakt's history has around those times, newest first: a play of the same title or episode within twelve hours is this one.
    const asking = all.filter(entry => entry.trakt === 'add' && decided.has(entry));
    if (link && asking.length) {
      const times = asking.map(entry => Math.floor(Date.parse(entry.at) / 1000)), from = Math.min(...times) - SAME, to = Math.max(...times) + SAME, titles = {}, have: {t: string; s?: number; e?: number; at: number}[] = [];
      let oldest = from, page = 1;
      for (; page <= TRAKT_PAGES; page++) {
        const got = await traktPlays(env, hub, person, from, to, page, titles);
        if (!got) return {error: 'Trakt isn’t answering just now. Try again in a few minutes.'};
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
    return {...none, watched: kept.filter(entry => entry.pct == null), partway: kept.filter(entry => entry.pct != null), already: decided.size - kept.length, unknown, more};
  } catch {
    return {error: 'Your server did not answer. Try again in a moment.'};
  } finally {
    await own.done();
  }
}

/* Plays as Trakt and MDBList both take them: films on their own, episodes under their show and season, each with its own date. */
function history(entries: Entry[]) {
  const movies = entries.filter(entry => entry.kind === 'movie').map(entry => ({ids: entry.ids, watched_at: entry.at})), shows = new Map<number, {ids: Ids; seasons: Map<number, {number: number; watched_at: string}[]>}>();
  for (const entry of entries.filter(item => item.kind === 'show')) {
    const show = shows.get(entry.ids.tmdb) ?? {ids: entry.ids, seasons: new Map<number, {number: number; watched_at: string}[]>()}; shows.set(entry.ids.tmdb, show);
    const season = show.seasons.get(entry.season!) ?? []; show.seasons.set(entry.season!, season);
    if (!season.some((item: {number: number}) => item.number === entry.episode)) season.push({number: entry.episode!, watched_at: entry.at});
  }
  return {...(movies.length ? {movies} : {}), ...(shows.size ? {shows: [...shows.values()].map(show => ({ids: show.ids, seasons: [...show.seasons].map(([number, episodes]) => ({number, episodes}))}))} : {})};
}
/* Copies one pass of the plan, worked out again here rather than taken from the page. Says whether there is more to do. Trakt gets
   its plays through the outbox, so a moment when Trakt turns calls away only delays them. */
type Carried = {watched: number; partway: number; trakt: number; missed: number; more: boolean};
export async function carry(env: Env, hub: string, person: string, skip: Set<string> = new Set()): Promise<Carried | Failed> {
  // One pass at a time per person (two clicks at once would both send): claimed here, let go at the end. A claim left by a pass
  // that never finished is taken over after two minutes.
  const claim = await env.DB.prepare("INSERT INTO ops (hub, kind, target, state, created, updated) VALUES (?1, 'carry', ?2, 'requested', ?3, ?3) ON CONFLICT (hub, kind, target) DO UPDATE SET created = excluded.created, updated = excluded.updated WHERE ops.created < ?4")
    .bind(hub, person, now(), now() - 120).run();
  if (!claim.meta.changes) return {watched: 0, partway: 0, trakt: 0, missed: 0, more: false};
  try {return await carryPass(env, hub, person, skip);}
  finally {await env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'carry' AND target = ?").bind(hub, person).run();}
}
async function carryPass(env: Env, hub: string, person: string, skip: Set<string>): Promise<Carried | Failed> {
  const got = await plan(env, hub, person, skip);
  if ('error' in got) return got;
  const done: string[] = [], toLists = got.watched.filter(entry => entry.lists === 'add'), pausing = got.partway.filter(entry => entry.lists === 'add'), toTrakt = got.watched.filter(entry => entry.trakt === 'add');
  let missed = 0, sent = 0, refused = false;
  if (toTrakt.length) {
    const how = await deliver(env, hub, person, 'carry', {kind: 'mark', path: '/sync/history', body: history(toTrakt)});
    if (how === 'off') return {error: 'Trakt needs connecting again. Nothing was copied.'};
    done.push(...toTrakt.map(entry => `t:${entry.key}`)); sent = toTrakt.length;
  }
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist'), ask = lists?.key ? mdblist(env, lists.key) : null;
  if (ask && toLists.length) {
    const answer = await ask('/sync/watched', history(toLists));
    if (answer.status !== 200) refused = true;
    else {
      const lost = (answer.body as {not_found?: Record<string, unknown[]>} | null)?.not_found ?? {};
      missed += Object.values(lost).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
      done.push(...toLists.map(entry => entry.key));
    }
  }
  // A paused point is kept under 80%, where MDBList would count it as watched.
  for (const entry of ask ? pausing.slice(0, PAUSES) : []) {
    const progress = Math.min(79.99, Math.max(1, entry.pct!));
    const answer = await ask!('/scrobble/pause', entry.kind === 'movie' ? {movie: {ids: entry.ids}, progress} : {show: {ids: entry.ids, season: {number: entry.season, episode: {number: entry.episode}}}, progress});
    if (answer.status === 200 || answer.status === 201) done.push(entry.key); else missed++;
  }
  if (done.length) {
    const before = await getSecret<string[]>(env, hub, person, 'carried') ?? [];
    await (await putSecret(env, hub, person, 'carried', [...done, ...before].slice(0, 3000))).run();
  }
  if (refused) return {error: sent ? 'Trakt has them; MDBList didn’t take its share just now. Try again in a moment.' : 'MDBList did not take it. Nothing was copied; try again in a moment.'};
  return {watched: toLists.length, partway: Math.min(pausing.length, PAUSES), trakt: sent, missed, more: got.more || pausing.length > PAUSES};
}
