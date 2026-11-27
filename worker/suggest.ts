/* "Because you watched": which suggested rows (SUGGESTED in data.ts) a person's own watching points to. Only ever for that one
   person, on their own page, from one query over their own plays here and their own Trakt watchlist and history as the hub last
   read them (rows_cache). Never pooled across people. A franchise is known by a few of its best-known titles: IMDb ids, and TMDB
   ids as m:<movie> or s:<show> (TMDB numbers movies and shows separately). */
import type {Env} from './util';

const FRANCHISES: Record<string, string[]> = {
  'sg.star-wars': ['tt0076759', 'tt0080684', 'tt0086190', 'tt0120915', 'tt0121765', 'tt0121766', 'tt2488496', 'tt2527336', 'tt2527338', 'tt3748528', 'tt3778644', 'tt8111088', 'tt9253284',
    'm:11', 'm:1891', 'm:1892', 'm:1893', 'm:1894', 'm:1895', 'm:140607', 'm:181808', 'm:181812', 'm:330459', 'm:348350', 's:82856', 's:83867'],
  'sg.mcu': ['tt0371746', 'tt0848228', 'tt4154796', 'tt4154756', 'tt1825683', 'tt2015381', 'tt2250912', 'tt10872600', 'tt9140554', 'tt9140560', 'tt6263850',
    'm:1726', 'm:24428', 'm:299534', 'm:299536', 'm:284054', 'm:118340', 'm:315635', 'm:634649', 'm:533535', 's:84958', 's:85271'],
  'sg.wizarding-world': ['tt0241527', 'tt0295297', 'tt0304141', 'tt0330373', 'tt0373889', 'tt0417741', 'tt0926084', 'tt1201607', 'tt3183660',
    'm:671', 'm:672', 'm:673', 'm:674', 'm:675', 'm:767', 'm:12444', 'm:12445', 'm:259316'],
  'sg.middle-earth': ['tt0120737', 'tt0167261', 'tt0167260', 'tt0903624', 'tt1170358', 'tt2310332', 'tt7631058', 'm:120', 'm:121', 'm:122', 'm:49051', 'm:57158', 'm:122917', 's:84773'],
  'sg.bond': ['tt0381061', 'tt1074638', 'tt2379713', 'tt2382320', 'tt0830515', 'tt0113189', 'tt0055928', 'm:36557', 'm:37724', 'm:206647', 'm:370172', 'm:10764', 'm:710', 'm:646'],
  'sg.pixar': ['tt0114709', 'tt1049413', 'tt2096673', 'tt2380307', 'tt0266543', 'tt0910970', 'tt0382932', 'tt0317705', 'tt22022452',
    'm:862', 'm:14160', 'm:150540', 'm:354912', 'm:12', 'm:10681', 'm:2062', 'm:9806', 'm:1022789'],
  'sg.ghibli': ['tt0245429', 'tt0096283', 'tt0347149', 'tt0119698', 'tt0097814', 'tt6587046', 'tt0876563', 'm:129', 'm:8392', 'm:4935', 'm:128', 'm:16859', 'm:508883', 'm:12429'],
};
const KNOWN = new Map(Object.entries(FRANCHISES).flatMap(([row, keys]) => keys.map(key => [key, row] as const)));

/* Suggestion id -> the title that points to it, newest first. One query: their plays here (what Trakt knows each by), then their
   Trakt history and watchlist pages kept by the hub. */
export async function because(env: Env, hub: string, person: string): Promise<Record<string, string>> {
  const rows = (await env.DB.prepare(`SELECT ids AS what, title FROM (SELECT ids, title FROM plays WHERE hub = ?1 AND person = ?2 AND ids IS NOT NULL AND ids != '' AND unwatched = 0 ORDER BY updated DESC LIMIT 300)
    UNION ALL SELECT items AS what, '' AS title FROM (SELECT items FROM rows_cache WHERE hub = ?1 AND person = ?2 AND (kind = 'history' OR kind LIKE 'history.%' OR kind = 'watchlist' OR kind LIKE 'watchlist.%') ORDER BY kind)`)
    .bind(hub, person).all<{what: string; title: string}>()).results;
  const out: Record<string, string> = {};
  const note = (key: string, title: string) => {const row = KNOWN.get(key); if (row && !out[row] && title) out[row] = title.slice(0, 120);};
  for (const row of rows) {
    let parsed: unknown; try {parsed = JSON.parse(row.what);} catch {continue;}
    if (Array.isArray(parsed)) {
      // A kept Trakt page: {id: 'tt…' | 'tmdb:N', type, name}.
      for (const item of parsed as {id?: string; type?: string; name?: string}[]) {
        const id = String(item.id ?? ''), tmdb = /^tmdb:(\d+)$/.exec(id);
        note(tmdb ? `${item.type === 'series' ? 's' : 'm'}:${tmdb[1]}` : id, String(item.name ?? ''));
      }
    } else if (parsed && typeof parsed === 'object') {
      // A play here, as Trakt knows it: {movie: {ids}} or {show: {ids}, episode}.
      const target = parsed as {movie?: {ids?: {tmdb?: number; imdb?: string}}; show?: {ids?: {tmdb?: number; imdb?: string}}}, ids = (target.movie ?? target.show)?.ids, title = row.title.split(' · ')[0];
      if (ids?.imdb) note(ids.imdb, title);
      if (ids?.tmdb) note(`${target.movie ? 'm' : 's'}:${ids.tmdb}`, title);
    }
  }
  return out;
}
