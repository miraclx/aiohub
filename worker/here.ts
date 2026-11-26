/* "Here": what a person's own server (their AIOMetadata setup, as a Jellyfin server) holds of their watching. The hub reads it and,
   when the person asks, writes to it, signed in as them the way an app would, straight to AIOMetadata (never through the hub's own
   address, which would pass a tick on to Trakt).
   AIOMetadata 4.1.0 names a title by a packed id that can be worked out from its IMDb or TMDB id (lib/jellyfin/idsCodec.ts): 16 bytes,
   0xA1, kind<<4 | id type, media type, the id (6 bytes), season and episode (2 bytes each, 0xFFFF for none), version 1, two zeros.
   An episode is packed under its show's id. A tick is taken with the date it happened (PlayedItems?DatePlayed=), and always answered
   as taken, so each one is read back before it counts. */
export interface Via {user: string; pass: string; base: string}
export interface Item {Id: string; Type?: string; Name?: string; SeriesId?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number; RunTimeTicks?: number; ProviderIds?: Record<string, string>; UserData?: {Played?: boolean; PlayedPercentage?: number; LastPlayedDate?: string; PlaybackPositionTicks?: number}}
export interface Ids {tmdb?: number; imdb?: string}

const KIND = {movie: 1, series: 2, episode: 4} as const;
/* The id AIOMetadata gives a film, a show or an episode (of the show with these ids), as the hub's own address shows them. */
export function packed(kind: keyof typeof KIND, ids: Ids, season?: number, episode?: number): string | null {
  const imdb = /^tt(\d{1,14})$/.exec(ids.imdb ?? ''), numeric = imdb ? Number(imdb[1]) : Number(ids.tmdb);
  if (!(numeric > 0) || numeric > 2 ** 48 - 1 || (kind === 'episode' && !(Number.isInteger(season) && Number.isInteger(episode) && season! >= 0 && episode! >= 0 && season! < 0xffff && episode! < 0xffff))) return null;
  const bytes = new Uint8Array(16);
  bytes[0] = 0xa1; bytes[1] = (KIND[kind] << 4) | (imdb ? 1 : 2); bytes[2] = kind === 'movie' ? 1 : 2;
  for (let at = 8, rest = numeric; at >= 3; at--, rest = Math.floor(rest / 256)) bytes[at] = rest % 256;
  const s = kind === 'episode' ? season! : 0xffff, e = kind === 'episode' ? episode! : 0xffff;
  bytes[9] = s >> 8; bytes[10] = s & 255; bytes[11] = e >> 8; bytes[12] = e & 255; bytes[13] = 1;
  const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* The other way: the film or show an id on their own server stands for (an episode, its show), as a row lists it. null for any other id. */
export function unpacked(id: string): {id: string; type: 'movie' | 'series'} | null {
  // With dashes or without: Strand sends ids without them.
  const hex = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/.exec(id.toLowerCase());
  if (!hex) return null;
  const bytes = hex.slice(1).join('').match(/../g)!.map(pair => parseInt(pair, 16)), kind = bytes[1] >> 4, from = bytes[1] & 15;
  if (bytes[0] !== 0xa1 || (kind !== 1 && kind !== 2 && kind !== 4) || (from !== 1 && from !== 2)) return null;
  const numeric = bytes.slice(3, 9).reduce((total, byte) => total * 256 + byte, 0);
  if (!(numeric > 0)) return null;
  return {id: from === 1 ? `tt${String(numeric).padStart(7, '0')}` : `tmdb:${numeric}`, type: kind === 1 ? 'movie' : 'series'};
}

const head = (token = '') => ({accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'AIOHub/1.0', authorization: `MediaBrowser Client="AIOHub", Device="AIOHub", DeviceId="aiohub-carry", Version="1"${token ? `, Token="${token}"` : ''}`});
/* The person's own server, signed in to the way an app would, for as long as the work takes. `calls` counts what was asked of it. */
export async function server(via: Via) {
  const signed = await fetch(`${via.base}/Users/AuthenticateByName`, {method: 'POST', headers: head(), body: JSON.stringify({Username: via.user, Pw: via.pass})})
    .then(answer => answer.ok ? answer.json() : null).catch(() => null) as {AccessToken?: string; User?: {Id?: string}} | null;
  if (!signed?.AccessToken || !signed.User?.Id) return null;
  const token = signed.AccessToken, user = signed.User.Id, counter = {calls: 1};
  const ask = async <T>(path: string, init: RequestInit = {}): Promise<T | null> => {counter.calls++; return fetch(`${via.base}${path}`, {...init, headers: head(token)}).then(answer => answer.ok ? answer.json().catch(() => ({})) : null).catch(() => null) as Promise<T | null>;};
  return {
    counter,
    /* Titles by id, a hundred at a time. Throws when the server does not answer, so nothing is taken as missing by mistake. */
    items: async (ids: string[]) => {
      const out: Item[] = [];
      for (let at = 0; at < ids.length; at += 100) {
        const page = await ask<{Items?: Item[]}>(`/Users/${user}/Items?Ids=${ids.slice(at, at + 100).map(encodeURIComponent).join(',')}&Fields=ProviderIds`);
        if (!page) throw new Error('server');
        out.push(...(page.Items ?? []));
      }
      return out;
    },
    /* A show's episodes as this server numbers them: "season:episode" -> id. null when it did not answer. */
    episodes: async (series: string) => {
      const got = await ask<{Items?: Item[]}>(`/Shows/${encodeURIComponent(series)}/Episodes?UserId=${user}`);
      return got ? new Map((got.Items ?? []).filter(item => item.ParentIndexNumber != null && item.IndexNumber != null).map(item => [`${item.ParentIndexNumber}:${item.IndexNumber}`, item.Id])) : null;
    },
    /* Ticks a title as watched at that moment, then reads it back: true only when the server says it now holds it. */
    mark: async (id: string, at: string) => {
      if (!await ask(`/Users/${user}/PlayedItems/${encodeURIComponent(id)}?DatePlayed=${encodeURIComponent(at)}`, {method: 'POST'})) return false;
      return !!(await ask<Item['UserData']>(`/Users/${user}/Items/${encodeURIComponent(id)}/UserData`))?.Played;
    },
    /* Keeps the spot in a title watched partway (ticks of 100 ns), in place of any it held, then reads it back: it counts only
       when the server now holds this spot (within a minute), since one it held before would read back as well. `at`: when it
       was left there, sent as the date last played (the server would say now), so Continue Watching, newest first, puts it
       where it belongs. Only the spot and that date change: watched and the play count stay as they were. */
    position: async (id: string, ticks: number, at?: string) => {
      if (!await ask(`/Users/${user}/Items/${encodeURIComponent(id)}/UserData`, {method: 'POST', body: JSON.stringify({PlaybackPositionTicks: Math.round(ticks), ...(Date.parse(at ?? '') ? {LastPlayedDate: new Date(at!).toISOString()} : {})})})) return false;
      return Math.abs(Number((await ask<Item['UserData']>(`/Users/${user}/Items/${encodeURIComponent(id)}/UserData`))?.PlaybackPositionTicks) - ticks) < 60e7;
    },
    done: () => fetch(`${via.base}/Sessions/Logout`, {method: 'POST', headers: head(token)}).catch(() => null),
  };
}
export type Server = NonNullable<Awaited<ReturnType<typeof server>>>;
