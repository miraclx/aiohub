/* Copying what someone watched here to their own MDBList, once they connect it, when they ask and after they have seen the plan.
   AIOMetadata keeps what is played on a person's own server whether or not a tracker is connected, and once one is connected it
   shows both; nothing is lost by leaving it there. This is for having it in MDBList too (other apps read it there).
   Only titles played through the hub are looked at: on this path every play passes through it, so that is everything the
   server learned here, and it keeps the work small however long someone's MDBList history is. AIOMetadata is asked what it
   holds for those titles, MDBList what it already has, and only the difference is offered. */
import type {Env} from './util';
import {getSecret, now, putSecret} from './util';

interface Via {user: string; pass: string; base: string}
interface Ids {tmdb: number; imdb?: string}
interface Item {Id: string; Type?: string; Name?: string; SeriesId?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number; ProviderIds?: Record<string, string>; UserData?: {Played?: boolean; PlayedPercentage?: number; LastPlayedDate?: string}}
export interface Entry {key: string; title: string; detail: string; at: string; pct?: number; kind: 'movie' | 'show'; ids: Ids; season?: number; episode?: number}
export interface Plan {watched: Entry[]; partway: Entry[]; already: number; unknown: number; more: boolean}
type Failed = {error: string};

// A Worker may make about 50 calls per request, so each pass checks this many titles with MDBList and sends this many paused points.
const TITLES = 20, PAUSES = 10;
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
  const lists = await getSecret<{key: string}>(env, hub, person, 'mdblist');
  if (!lists?.key) return {error: 'Connect MDBList first.'};
  const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
  if (!via) return {error: 'Nothing has been watched here yet.'};
  // Copied before: MDBList may still answer from a few minutes ago, so these are never sent twice.
  const carried = new Set(await getSecret<string[]>(env, hub, person, 'carried') ?? []);
  const rows = (await env.DB.prepare('SELECT item, updated FROM plays WHERE hub = ? AND person = ? ORDER BY updated DESC LIMIT 500').bind(hub, person).all<{item: string; updated: number}>()).results;
  if (!rows.length) return {watched: [], partway: [], already: 0, unknown: 0, more: false};
  const own = await server(via);
  if (!own) return {error: 'Your server did not answer. Try again in a moment.'};
  try {
    const found = await own.items(rows.map(row => row.item)), when = new Map(rows.map(row => [row.item, row.updated]));
    const shows = new Map((await own.items([...new Set(found.filter(item => item.Type === 'Episode' && item.SeriesId).map(item => item.SeriesId!))])).map(item => [item.Id, item]));
    const all: Entry[] = []; let unknown = 0;
    for (const item of found) {
      const episode = item.Type === 'Episode', show = episode ? shows.get(item.SeriesId ?? '') : undefined, provider = (episode ? show : item)?.ProviderIds;
      const data = item.UserData ?? {}, pct = Number(data.PlayedPercentage ?? 0), watched = !!data.Played, partway = !watched && pct >= 1 && pct < 80;
      if (!watched && !partway) continue;
      const tmdb = Number(provider?.Tmdb);
      if (!(tmdb > 0) || (episode && (item.ParentIndexNumber == null || item.IndexNumber == null))) {unknown++; continue;}
      const entry: Entry = {key: '', kind: episode ? 'show' : 'movie', ids: {tmdb, ...(/^tt\d+$/.test(provider?.Imdb ?? '') ? {imdb: provider!.Imdb} : {})},
        title: String((episode ? show?.Name ?? item.SeriesName : item.Name) ?? 'Untitled').slice(0, 200), detail: episode ? `Season ${item.ParentIndexNumber} · Episode ${item.IndexNumber}` : 'Movie',
        at: data.LastPlayedDate ?? new Date((when.get(item.Id) ?? now()) * 1000).toISOString(), ...(partway ? {pct: Math.round(pct)} : {}), ...(episode ? {season: item.ParentIndexNumber, episode: item.IndexNumber} : {})};
      entry.key = `${watched ? 'w' : 'p'}:${where(entry)}`;
      if (!carried.has(entry.key) && !skip.has(entry.key)) all.push(entry);
    }
    // What MDBList already has for each title. Newest first, so a long list is copied the most recent first.
    const titles = [...new Set(all.map(entry => `${entry.kind}/${entry.ids.tmdb}`))], checked = new Set(titles.slice(0, TITLES)), held = new Set<string>(), ask = mdblist(env, lists.key);
    for (const title of checked) {
      const answer = await ask(`/sync/history/${title.replace('/', '/tmdb/')}`);
      if (answer.status !== 200) return {error: 'MDBList did not answer. Try again in a moment.'};
      for (const play of ((answer.body as {plays?: {season_num?: number; episode_num?: number}[]})?.plays ?? [])) held.add(title.startsWith('show') ? `${title}:${play.season_num}:${play.episode_num}` : title);
    }
    const looked = all.filter(entry => checked.has(`${entry.kind}/${entry.ids.tmdb}`));
    if (looked.some(entry => entry.pct != null)) {
      const answer = await ask('/sync/playback');
      if (answer.status !== 200) return {error: 'MDBList did not answer. Try again in a moment.'};
      for (const point of (Array.isArray(answer.body) ? answer.body : []) as {type?: string; movie?: {ids?: {tmdb?: number}}; show?: {ids?: {tmdb?: number}}; episode?: {season?: number; number?: number}}[]) {
        if (point.type === 'movie' && point.movie?.ids?.tmdb) held.add(`movie/${point.movie.ids.tmdb}`);
        if (point.type === 'episode' && point.show?.ids?.tmdb) held.add(`show/${point.show.ids.tmdb}:${point.episode?.season}:${point.episode?.number}`);
      }
    }
    const watched = looked.filter(entry => entry.pct == null && !held.has(where(entry))), partway = looked.filter(entry => entry.pct != null && !held.has(where(entry)));
    return {watched, partway, already: looked.length - watched.length - partway.length, unknown, more: titles.length > checked.size};
  } catch {
    return {error: 'Your server did not answer. Try again in a moment.'};
  } finally {
    await own.done();
  }
}

/* Copies one pass of the plan, worked out again here rather than taken from the page. Says whether there is more to do. */
export async function carry(env: Env, hub: string, person: string, skip: Set<string> = new Set()): Promise<{watched: number; partway: number; missed: number; more: boolean} | Failed> {
  const got = await plan(env, hub, person, skip);
  if ('error' in got) return got;
  const lists = (await getSecret<{key: string}>(env, hub, person, 'mdblist'))!, ask = mdblist(env, lists.key), done: string[] = [];
  let missed = 0;
  if (got.watched.length) {
    // Each title's own date, as MDBList takes them: films on their own, episodes under their show and season.
    const movies = got.watched.filter(entry => entry.kind === 'movie').map(entry => ({ids: entry.ids, watched_at: entry.at})), shows = new Map<number, {ids: Ids; seasons: Map<number, {number: number; watched_at: string}[]>}>();
    for (const entry of got.watched.filter(item => item.kind === 'show')) {
      const show = shows.get(entry.ids.tmdb) ?? {ids: entry.ids, seasons: new Map<number, {number: number; watched_at: string}[]>()}; shows.set(entry.ids.tmdb, show);
      const season = show.seasons.get(entry.season!) ?? []; show.seasons.set(entry.season!, season);
      if (!season.some((item: {number: number}) => item.number === entry.episode)) season.push({number: entry.episode!, watched_at: entry.at});
    }
    const body = {...(movies.length ? {movies} : {}), ...(shows.size ? {shows: [...shows.values()].map(show => ({ids: show.ids, seasons: [...show.seasons].map(([number, episodes]) => ({number, episodes}))}))} : {})};
    const answer = await ask('/sync/watched', body);
    if (answer.status !== 200) return {error: 'MDBList did not take it. Nothing was copied; try again in a moment.'};
    const lost = (answer.body as {not_found?: Record<string, unknown[]>} | null)?.not_found ?? {};
    missed += Object.values(lost).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    done.push(...got.watched.map(entry => entry.key));
  }
  // A paused point is kept under 80%, where MDBList would count it as watched.
  for (const entry of got.partway.slice(0, PAUSES)) {
    const progress = Math.min(79.99, Math.max(1, entry.pct!));
    const answer = await ask('/scrobble/pause', entry.kind === 'movie' ? {movie: {ids: entry.ids}, progress} : {show: {ids: entry.ids, season: {number: entry.season, episode: {number: entry.episode}}}, progress});
    if (answer.status === 200 || answer.status === 201) done.push(entry.key); else missed++;
  }
  if (done.length) {
    const before = await getSecret<string[]>(env, hub, person, 'carried') ?? [];
    await (await putSecret(env, hub, person, 'carried', [...done, ...before].slice(0, 3000))).run();
  }
  return {watched: got.watched.length, partway: Math.min(got.partway.length, PAUSES), missed, more: got.more || got.partway.length > PAUSES};
}
