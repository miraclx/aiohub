// Runs against `wrangler dev --var FRONT:aiometadata` with a throwaway local database. No real accounts or upstream calls.
// Each person is served by their own AIOMetadata setup, which the hub makes, keeps in step and removes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8799', UP = 'http://127.0.0.1:8798';
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const answer = await fetch(BASE + path, {method, headers: {origin: BASE, 'content-type': 'application/json', ...(cookie ? {cookie} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    const set = answer.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return {status: answer.status, body: await answer.json().catch(() => null)};
  };
}
// Stand-ins: AIOStreams (setups, its server id) and AIOMetadata (setups by uuid, each also a Jellyfin server once it has an app password).
// `slow`: how long AIOMetadata takes over reading or writing a setup; `most`: the most it was asked to at once; `catalogs`: rows asked for.
// `favs`: the titles hearted on each setup's server (favourites), by setup; `hearts`: every heart made or taken away there, in order.
// TMDB as For you reads it: recommendations, a film's series and director, a show's newest episode, and searches.
const films = (from, count, vote = 7.5) => Array.from({length: count}, (_, n) => ({id: from + n, title: `Title ${from + n}`, vote_average: vote, release_date: '2020-01-01'}));
const NOLAN = [{id: 27205, title: 'Inception', vote_average: 8.4}, {id: 155, title: 'The Dark Knight', vote_average: 8.5}, {id: 157336, title: 'Interstellar', vote_average: 8.4}, {id: 1124, title: 'The Prestige', vote_average: 8.2}, {id: 77, title: 'Memento', vote_average: 8.2}, {id: 49026, title: 'The Dark Knight Rises', vote_average: 7.8}];
const XMAS = films(8800, 12, 6.8);
const TMDB = {
  'movie/27205/recommendations': {results: [{id: 550, title: 'Fight Club', vote_average: 8.4}, ...NOLAN.slice(1), ...films(7000, 6)]},
  'movie/155/recommendations': {results: [{id: 272, title: 'Batman Begins', vote_average: 7.7}, {id: 27205, title: 'Inception', vote_average: 8.4}, ...films(7100, 8)]},
  'movie/550/recommendations': {results: films(7200, 10)},
  'tv/1396/recommendations': {results: films(7300, 10).map(({title, ...item}) => ({...item, name: title}))},
  // Older titles she watched months ago (the For you tests on older watching).
  'movie/680/recommendations': {results: films(7400, 10)}, 'movie/13/recommendations': {results: films(7500, 10)}, 'movie/949/recommendations': {results: films(7600, 10)},
  // A film's details, with its credits (asked for with them).
  'movie/27205': {belongs_to_collection: null, genres: [{id: 878}, {id: 28}], credits: {crew: [{id: 525, name: 'Christopher Nolan', job: 'Director'}, {id: 1, name: 'Someone', job: 'Writer'}]}},
  'movie/155': {belongs_to_collection: {id: 263, name: 'The Dark Knight Collection'}, genres: [{id: 28}, {id: 80}, {id: 18}], credits: {crew: [{id: 525, name: 'Christopher Nolan', job: 'Director'}]}},
  'movie/550': {belongs_to_collection: null, genres: [{id: 18}], credits: {crew: [{id: 7467, name: 'David Fincher', job: 'Director'}]}},
  'collection/263': {name: 'The Dark Knight Collection', parts: [{id: 49026, title: 'The Dark Knight Rises', release_date: '2012-07-16', vote_average: 7.8}, {id: 272, title: 'Batman Begins', release_date: '2005-06-10', vote_average: 7.7},
    {id: 155, title: 'The Dark Knight', release_date: '2008-07-14', vote_average: 8.5}, {id: 999001, title: 'Not Out Yet', release_date: '2099-01-01', vote_average: 0}]},
  'tv/60622': {name: 'Fargo', genres: [{id: 80}, {id: 18}], last_episode_to_air: {season_number: 5, episode_number: 10}},
  'tv/1396': {name: 'Breaking Bad', genres: [{id: 18}], last_episode_to_air: {season_number: 5, episode_number: 16}, backdrop_path: '/bb-backdrop.jpg'},
  // The Matrix, finished here late on (the For you test on a finished watch).
  'movie/603/recommendations': {results: [{id: 604, title: 'The Matrix Reloaded', vote_average: 8.9}, ...films(7900, 9, 8.9)]},
  'movie/603': {belongs_to_collection: {id: 2344, name: 'The Matrix Collection'}, genres: [{id: 878}, {id: 28}], credits: {crew: [{id: 9339, name: 'Lana Wachowski', job: 'Director'}]}},
  // US ratings, as the Recommended rows look them up under a content limit: by film (one for each release) and by show.
  'movie/550/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'R'}]}]}, 'movie/157336/release_dates': {results: [{iso_3166_1: 'GB', release_dates: [{certification: '12A'}]}, {iso_3166_1: 'US', release_dates: [{certification: ''}, {certification: 'PG-13'}]}]},
  'movie/7100/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'PG'}]}]}, 'movie/1124/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'G'}, {certification: 'PG'}]}]},
  'movie/7101/release_dates': {results: [{iso_3166_1: 'GB', release_dates: [{certification: 'U'}]}]}, 'movie/77/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'PG'}, {certification: 'R'}]}]},
  'tv/7300/content_ratings': {results: [{iso_3166_1: 'US', rating: 'TV-PG'}]}, 'tv/7301/content_ratings': {results: [{iso_3166_1: 'US', rating: 'TV-MA'}]}, 'tv/7302/content_ratings': {results: [{iso_3166_1: 'US', rating: 'TV-14'}]},
  'movie/9001/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'G'}]}]}, 'movie/9002/release_dates': {results: [{iso_3166_1: 'US', release_dates: [{certification: 'R'}]}]},
  'collection/2344': {name: 'The Matrix Collection', parts: [{id: 603, title: 'The Matrix', release_date: '1999-03-30', vote_average: 8.2}, {id: 604, title: 'The Matrix Reloaded', release_date: '2003-05-15', vote_average: 7.0}]},
};
const fake = {favs: new Map(), hearts: [], favReads: 0, unfiltered: false, tmdb: [], flix: [], configs: new Map(), homes: new Map(), made: 0, signIns: 0, watched: [], pauses: [], ticks: [], positions: [], slow: 0, busy: 0, most: 0, catalogs: []};
const uuidOf = n => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000aa`, ITEM = 'a1110100-0000-eaf7-78ff-ffffff010000';
// What Ada's own server holds: a film she watched, an episode she is partway through, one MDBList already has, and their show.
const FILM = 'a1110100-0000-eaf7-78ff-ffffff050000', LEFT = 'a1110100-0000-eaf7-78ff-ffffff060000', EP3 = 'a1110100-0000-eaf7-78ff-ffffff070000';
const MATRIX = 'a1120100-0000-0002-5bff-ffffff010000', OTHER = 'a1110100-0000-eaf7-78ff-ffffff080000';
const VIEW = 'b220f707-f7e5-0b8e-9314-1314e52c6304', EP = 'a1110100-0000-eaf7-78ff-ffffff020000', EP_HELD = 'a1110100-0000-eaf7-78ff-ffffff030000', SHOW = 'a1210200-0000-eaf7-78ff-ffffff040000';
const HELD = {
  [ITEM]: {Id: ITEM, Type: 'Movie', Name: 'Meta Movie', ProviderIds: {Tmdb: '603', Imdb: 'tt0133093'}, UserData: {Played: true, LastPlayedDate: '2026-11-01T20:00:00.000Z'}},
  [EP]: {Id: EP, Type: 'Episode', Name: 'Two', SeriesId: SHOW, SeriesName: 'Meta Show', ParentIndexNumber: 1, IndexNumber: 2, ProviderIds: {}, UserData: {PlayedPercentage: 40}},
  [EP_HELD]: {Id: EP_HELD, Type: 'Episode', Name: 'One', SeriesId: SHOW, SeriesName: 'Meta Show', ParentIndexNumber: 1, IndexNumber: 1, ProviderIds: {}, UserData: {Played: true}},
  [SHOW]: {Id: SHOW, Type: 'Series', Name: 'Meta Show', ProviderIds: {Tmdb: '1399'}},
  // Played only once Trakt history is connected.
  [FILM]: {Id: FILM, Type: 'Movie', Name: 'Scrobbled Movie', ProviderIds: {Tmdb: '27205', Imdb: 'tt1375666'}},
  [LEFT]: {Id: LEFT, Type: 'Movie', Name: 'Left Running', ProviderIds: {Tmdb: '550', Imdb: 'tt0137523'}},
  [EP3]: {Id: EP3, Type: 'Episode', Name: 'Three', SeriesId: SHOW, SeriesName: 'Meta Show', ParentIndexNumber: 1, IndexNumber: 3, ProviderIds: {}},
  // A film whose id on her server says TMDB 603 (see unpacked in here.ts), and another she finishes after it.
  [MATRIX]: {Id: MATRIX, Type: 'Movie', Name: 'The Matrix', ProviderIds: {Tmdb: '603'}}, [OTHER]: {Id: OTHER, Type: 'Movie', Name: 'Another Film', ProviderIds: {}},
};
// Trakt: single-use refresh tokens, and every call as Ada logged. Each title above runs 6000 seconds. `refuse` turns that many
// writes away with a 429, as Trakt's Cloudflare does to the shared addresses Workers call from; `refuseReads` does it to reads.
// `retryAfter`: the seconds a refused write is told to wait (Trakt's own limit says so; Cloudflare's refusal does not).
// `pace`: as Trakt's own limit of one write a second per person: a write within that many milliseconds of the last one taken is
// turned away (429), so a burst only gets through one at a time.
// `activity`: what Trakt's /sync/last_activities says changed last (sync.ts reads it first).
// `watched`: every show she watched, each with its seasons, and each episode with when it was last watched. Read two ways (sync.ts,
// nextUp): /sync/watched/shows?extended=noseasons lists the shows without their seasons, and /shows/<Trakt id>/progress/watched
// gives one show's `last_episode`. `big`: the list comes back over a megabyte long.
const trakt = {calendar: {shows: [], dvd: []}, hidden: {progress_watched: [], dropped: []}, activity: {movies: {watched_at: '2020-01-01T00:00:00.000Z', paused_at: '2020-01-01T00:00:00.000Z'}, episodes: {watched_at: '2020-01-01T00:00:00.000Z', paused_at: '2020-01-01T00:00:00.000Z'}}, history: [], watched: [], playback: null, watchlist: null, calls: [], reads: [], issued: 0, valid: new Set(), refresh: '', expiresIn: 7 * 86400, refreshed: [], revoked: [], stop: 201, refuse: 0, refused: [], refuseReads: false, retryAfter: 0, pace: 0, lastWrite: 0};
// The hub keeps Trakt's paused list a few minutes: a test that changes the list has the kept one forgotten, as if time had passed.
let paused = null;
Object.defineProperty(trakt, 'playback', {get: () => paused, set: value => {paused = value; try {sql("DELETE FROM rows_cache WHERE kind = 'playback'");} catch { /* before the database is there */ }}});
// What Ada's Trakt holds, for the rows the hub serves: a watchlist with a film, a show (twice: once by an episode) and a film known
// only by its TMDB id; 45 recommended films; one show with an episode to watch.
const film = n => ({title: `Film ${n}`, year: 2000, ids: {trakt: n, imdb: `tt${String(9000000 + n)}`, tmdb: 9000 + n}});
const WATCHLIST = [{type: 'movie', movie: {title: 'Meta Movie', ids: {imdb: 'tt0133093', tmdb: 603}}}, {type: 'show', show: {title: 'Meta Show', ids: {imdb: 'tt0944947', tmdb: 1399}}},
    {type: 'episode', episode: {season: 1, number: 1}, show: {title: 'Meta Show', ids: {imdb: 'tt0944947', tmdb: 1399}}}, {type: 'movie', movie: {title: 'Fight Club', ids: {imdb: null, tmdb: 550}}}, {type: 'movie', movie: {title: 'No ids', ids: {}}}];
// Her Trakt history, newest first (set by the tests below), and her MDBList: plays per title, and what it lists as watched lately.
const DAY = 86400, ago = days => new Date((Math.floor(Date.now() / 1000) - Math.round(days * DAY)) * 1000).toISOString();
const MOVIE = {inception: {title: 'Inception', ids: {imdb: 'tt1375666', tmdb: 27205}}, fight: {title: 'Fight Club', ids: {imdb: 'tt0137523', tmdb: 550}}, pulp: {title: 'Pulp Fiction', ids: {imdb: 'tt0110912', tmdb: 680}},
  gump: {title: 'Forrest Gump', ids: {imdb: 'tt0109830', tmdb: 13}}, knight: {title: 'The Dark Knight', ids: {imdb: 'tt0468569', tmdb: 155}}, heat: {title: 'Heat', ids: {imdb: 'tt0113277', tmdb: 949}}};
const BB = {title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}};
// `all`: every call made to MDBList, as its method and address without the key.
const lists = {plays: {}, recent: {movies: [], shows: [], episodes: []}, refuse: false, playback: null, watchlist: [], reads: [], all: []};
const READS = {
  '/sync/watchlist/all/added/desc': () => trakt.watchlist ?? WATCHLIST,
  '/sync/history': () => trakt.history,
  '/sync/watched/shows': () => trakt.watched.map(({seasons: _, none: __, ...entry}) => entry),
  '/sync/playback': () => trakt.playback ?? [],
  '/recommendations/movies': Array.from({length: 45}, (_, n) => film(n + 1)),
  '/recommendations/shows': [{title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}}],
  '/sync/progress/up_next': [{show: {title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}}, progress: {aired: 62, completed: 10}}],
  // The shows she hid from her progress on Trakt, and the ones she dropped (New for you leaves both out).
  '/users/hidden/progress_watched': () => trakt.hidden.progress_watched, '/users/hidden/dropped': () => trakt.hidden.dropped,
  // Her own lists (one private), one she liked, and what her private list holds, in its own order.
  '/users/me/lists': [{name: 'Heist nights', privacy: 'private', item_count: 2, ids: {trakt: 501, slug: 'heist-nights'}}],
  '/users/likes/lists': [{type: 'list', list: {name: 'Liked one', privacy: 'public', item_count: 1, ids: {trakt: 777}}}],
  '/users/me/lists/501/items': [{type: 'movie', movie: MOVIE.pulp}, {type: 'show', show: BB}],
  '/lists/777/items': [{type: 'person', person: {name: 'Someone'}}, {type: 'movie', movie: {...MOVIE.gump, votes: 40}}, {type: 'show', show: {...BB, votes: 900}}],
};
// Lists anyone may look up on Trakt with the site's app alone: one public, one private.
const PUBLIC = {'/users/someone/lists/heist': {name: 'Heist classics', privacy: 'public', item_count: 9, ids: {trakt: 9001}}, '/users/someone/lists/secret': {name: 'Secret', privacy: 'private', item_count: 3, ids: {trakt: 9002}}};
const issue = () => {const n = ++trakt.issued; trakt.valid.add(`trakt-access-${n}`); trakt.refresh = `trakt-refresh-${n}`; return {access_token: `trakt-access-${n}`, refresh_token: trakt.refresh, expires_in: trakt.expiresIn, created_at: Math.floor(Date.now() / 1000), token_type: 'bearer', scope: 'public'};};
function traktAnswer(request, path, body, send, answer) {
  // Renewing and revoking, on Trakt's sign-in host: plain JSON. Renewing takes a moment, so reports that arrive together find it under way.
  if (path.startsWith('/oauth/')) {
    if (request.headers['content-type'] !== 'application/json' || !request.headers['user-agent'] || body.client_id !== 'local-trakt-client' || body.client_secret !== undefined) return send(403, {});
    if (path === '/oauth/token') {trakt.refreshed.push(body); if (body.refresh_token !== trakt.refresh) return send(400, {error: 'invalid_grant'}); trakt.expiresIn = 7 * 86400; return new Promise(done => setTimeout(done, 300)).then(() => send(200, issue()));}
    if (path === '/oauth/revoke') {trakt.revoked.push(body); trakt.valid.delete(body.token); return send(200, {});}
    return send(404, {});
  }
  if (request.headers['trakt-api-key'] !== 'local-trakt-client' || request.headers['trakt-api-version'] !== '2' || !request.headers['user-agent'] || request.headers['content-type'] !== 'application/json') return send(403, {});
  const auth = (request.headers.authorization ?? '').replace('Bearer ', '');
  if (!auth && PUBLIC[path]) {trakt.reads.push({where: path}); return send(200, PUBLIC[path]);}
  if (!auth && path.startsWith('/users/')) return send(404, {});
  if (!trakt.valid.has(auth)) return send(401, {});
  if (path === '/users/settings') return send(200, {user: {username: 'adatrakt'}});
  // Reads for the rows the hub serves. Kept apart from the calls that write, which the tests below count exactly.
  const [where, query] = path.split('?');
  if (request.method === 'GET' && where === '/sync/last_activities') {trakt.reads.push({where, auth}); return trakt.refuseReads ? send(429, {}) : send(200, trakt.activity);}
  // Her calendars (New for you): new episodes of her shows, and films on her watchlist as they come out to watch at home, for the
  // days asked for, 33 at most as Trakt allows.
  const calendar = request.method === 'GET' && /^\/calendars\/my\/(shows|dvd)\/(\d{4}-\d\d-\d\d)\/(\d+)$/.exec(where);
  if (calendar) {
    trakt.reads.push({where: `/calendars/my/${calendar[1]}`, query: `${calendar[2]}/${calendar[3]}`, auth}); if (trakt.refuseReads) return send(429, {});
    const from = Date.parse(calendar[2]), to = from + Number(calendar[3]) * 86400e3;
    return Number(calendar[3]) > 33 ? send(400, {}) : send(200, trakt.calendar[calendar[1]].filter(item => {const at = Date.parse(item.first_aired ?? item.released); return at >= from && at < to;}));
  }
  // One show's progress, as Trakt works it out: specials left out unless asked for, and `last_episode` the latest aired episode
  // she watched, or with last_activity=watched the one she watched most lately (the highest of those watched at the same moment).
  // null for a show Trakt has no such episode for (`none`).
  const progress = request.method === 'GET' && /^\/shows\/(\d+)\/progress\/watched$/.exec(where);
  if (progress) {
    trakt.reads.push({where: '/shows/progress/watched', query, auth}); if (trakt.refuseReads) return send(429, {});
    const entry = trakt.watched.find(item => item.show.ids.trakt === Number(progress[1])), ask = new URLSearchParams(query ?? ''); if (!entry) return send(404, {});
    const seasons = entry.seasons.filter(season => season.number > 0 || ask.get('specials') === 'true'), all = seasons.flatMap(season => season.episodes.map(episode => ({season: season.number, number: episode.number, at: Date.parse(episode.last_watched_at)})));
    const nth = episode => episode.season * 10000 + episode.number, last = all.sort((a, b) => (ask.get('last_activity') === 'watched' ? b.at - a.at : 0) || nth(b) - nth(a))[0];
    return send(200, {aired: all.length, completed: all.length, last_watched_at: all.length ? new Date(Math.max(...all.map(episode => episode.at))).toISOString() : null, reset_at: null, next_episode: null,
      seasons: seasons.map(season => ({number: season.number, aired: season.episodes.length, completed: season.episodes.length, episodes: season.episodes.map(episode => ({number: episode.number, completed: true, last_watched_at: episode.last_watched_at}))})),
      last_episode: last && !entry.none ? {season: last.season, number: last.number, title: 'An episode', ids: {trakt: 1}} : null});
  }
  if (request.method === 'GET' && where === '/sync/watched/shows' && trakt.big) {trakt.reads.push({where, query, auth}); answer.writeHead(200, {'content-type': 'application/json'}); return answer.end(`[${' '.repeat(1_100_000)}]`);}
  if (request.method === 'GET' && READS[where]) {
    trakt.reads.push({where, query, auth}); if (trakt.refuseReads) return send(429, {});
    // Paged as Trakt pages, by `page` and `limit` with its page count; history between `start_at` and `end_at`.
    const ask = new URLSearchParams(query ?? ''), from = Date.parse(ask.get('start_at') ?? '') || 0, to = Date.parse(ask.get('end_at') ?? '') || Infinity;
    const all = (typeof READS[where] === 'function' ? READS[where]() : READS[where]).filter(item => !item.watched_at || (Date.parse(item.watched_at) >= from && Date.parse(item.watched_at) <= to));
    const limit = Number(ask.get('limit')) || 100, page = Number(ask.get('page')) || 1;
    answer.writeHead(200, {'content-type': 'application/json', 'x-pagination-page': String(page), 'x-pagination-page-count': String(Math.max(1, Math.ceil(all.length / limit)))});
    return answer.end(JSON.stringify(ask.has('page') ? all.slice((page - 1) * limit, page * limit) : all));
  }
  if (trakt.refuse > 0) {trakt.refuse--; trakt.refused.push({path, body}); if (!trakt.retryAfter) return send(429, {}); answer.writeHead(429, {'content-type': 'application/json', 'retry-after': String(trakt.retryAfter)}); return answer.end('{}');}
  if (trakt.pace && Date.now() - trakt.lastWrite < trakt.pace) {trakt.refused.push({path, body}); return send(429, {});}
  trakt.lastWrite = Date.now(); trakt.calls.push({path, body, auth});
  // Her watchlist, added to and removed from as Trakt's docs give the two calls: movies and shows by their ids; 201 with what was
  // added (listed now) or was there already, 200 with what was deleted. Only once a test has given her a watchlist of its own.
  if (path === '/sync/watchlist' || path === '/sync/watchlist/remove') {
    const sent = [...(body.movies ?? []).map(movie => ['movie', movie]), ...(body.shows ?? []).map(show => ['show', show])], list = trakt.watchlist ?? [];
    const same = ([type, media]) => entry => entry.type === type && ((media.ids?.imdb && entry[type].ids.imdb === media.ids.imdb) || (media.ids?.tmdb && entry[type].ids.tmdb === media.ids.tmdb));
    const there = sent.filter(item => list.some(same(item))), count = items => ({movies: items.filter(([type]) => type === 'movie').length, shows: items.filter(([type]) => type === 'show').length});
    if (path === '/sync/watchlist') {
      if (trakt.watchlist) for (const [type, media] of sent.filter(item => !there.includes(item))) trakt.watchlist.unshift({type, [type]: {title: 'Hearted', ids: media.ids}, listed_at: new Date().toISOString()});
      return send(201, {added: count(sent.filter(item => !there.includes(item))), existing: count(there), not_found: {movies: [], shows: []}});
    }
    if (trakt.watchlist) trakt.watchlist = list.filter(entry => !sent.some(item => same(item)(entry)));
    return send(200, {deleted: count(there), not_found: {movies: [], shows: []}});
  }
  return send(path === '/scrobble/stop' ? trakt.stop : 201, {});
}
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk; const body = raw ? JSON.parse(raw) : {};
  const [id, pass] = request.headers.authorization?.startsWith('Basic ') ? atob(request.headers.authorization.slice(6)).split(':') : [];
  const mine = () => fake.configs.get(id)?.password === pass ? fake.configs.get(id) : null;
  if (request.url.startsWith('/trakt/')) return traktAnswer(request, request.url.slice(6), body, send, answer);
  if (request.url.startsWith('/mdblist/')) lists.all.push(`${request.method} ${request.url.split('?')[0]}`);
  // TMDB's public lists, by number: one with titles, one empty.
  if (request.url.startsWith('/tmdb3/list/')) {const id = request.url.split('/')[3].split('?')[0]; return !request.url.includes('api_key=good-tmdb-key') ? send(401, {}) : id === '8300' ? send(200, {name: 'Festival picks', item_count: 14}) : id === '8301' ? send(200, {name: 'Empty', item_count: 0}) : send(404, {});}
  // TMDB for For you, and FlixPatrol's public charts. Every ask is noted (`fake.tmdb`).
  if (request.url.startsWith('/tmdb3/')) {
    const [where, query] = request.url.slice(7).split('?'), ask = new URLSearchParams(query ?? ''); fake.tmdb.push(where);
    if (ask.get('api_key') !== 'good-tmdb-key') return send(401, {});
    // Under a limit no director here has a rated film.
    const answer = TMDB[where] ?? (where === 'discover/movie' ? {results: ask.get('with_crew') && ask.get('certification') ? [] : ask.get('with_crew') === '525' ? NOLAN : ask.get('with_keywords') === '207317' ? XMAS : films(8000, 20)} : where === 'discover/tv' ? {results: films(8500, 20)} : null);
    return answer ? send(200, answer) : send(404, {});
  }
  const chart = /^\/flix\/([a-z-]+)\.json$/.exec(request.url);
  if (chart) {fake.flix.push(chart[1]); return send(200, {region: chart[1], charts: [{catalog_id: 'netflix.movies', entries: films(7700, 10).map((item, n) => ({rank: n + 1, title: item.title, tmdb: {id: item.id, media_type: 'movie'}}))}, {catalog_id: 'netflix.series', entries: films(7800, 10).map((item, n) => ({rank: n + 1, title: item.title, tmdb: {id: item.id, media_type: 'tv'}}))}]});}
  if (request.url.startsWith('/tmdb')) return send(request.url.includes('api_key=good-tmdb-key') ? 200 : 401, {});
  // AIOMetadata's own Letterboxd lookup: the list's Letterboxd identifier, then the list through StremThru.
  if (request.url === '/api/letterboxd/extract-identifier') return /letterboxd\.com\/someone\/list\/noir\/$/.test(body.url) ? send(200, {identifier: 'aBc12', isWatchlist: false}) : send(404, {error: 'not found'});
  if (request.url === '/api/letterboxd/list') return body.identifier === 'aBc12' ? send(200, {data: {title: 'Noir essentials', items: [{id: 1}, {id: 2}]}}) : send(404, {});
  // AIOMetadata's own Trakt connection, as it describes a Token ID.
  if (request.url === '/api/oauth/token/info') return body.tokenId === 'aiom-trakt-token-id-1' ? send(200, {provider: 'trakt', username: 'adatrakt'}) : send(404, {});
  if (request.url.startsWith('/mdblist/user')) return send(request.url.includes('apikey=ada-mdblist-key') ? 200 : 403, {username: 'adalists'});
  if (request.url.startsWith('/mdblist/') && !request.url.includes('apikey=ada-mdblist-key')) return send(403, {});
  // Her own MDBList lists, and a public one looked up by its link.
  if (request.url.startsWith('/mdblist/lists/user?')) return send(200, [{id: 4242, name: 'Award winners', slug: 'award-winners', items: 60, mediatype: 'movie'}]);
  if (request.url.startsWith('/mdblist/lists/someone/a-list?')) return send(200, [{id: 5151, name: 'A list', mediatype: 'show'}]);
  if (request.url.startsWith('/mdblist/sync/history/movie/tmdb/603')) return send(200, {plays: fake.watched.some(body => body.movies?.length) ? [{season_num: null}] : []});
  if (request.url.startsWith('/mdblist/sync/history/show/tmdb/1399')) return send(200, {plays: [{season_num: 1, episode_num: 1}]});
  if (request.url.startsWith('/mdblist/sync/playback')) return send(200, lists.playback ?? []);
  if (request.url.startsWith('/mdblist/') && lists.refuse) return send(503, {});
  const history = /^\/mdblist\/sync\/history\/(movie|show)\/tmdb\/(\d+)/.exec(request.url);
  if (history && lists.plays[`${history[1]}/${history[2]}`]) return send(200, {type: history[1], play_count: lists.plays[`${history[1]}/${history[2]}`].length, truncated: false, plays: lists.plays[`${history[1]}/${history[2]}`]});
  if (history) return send(200, {type: history[1], play_count: 0, truncated: false, plays: []});
  if (request.url.startsWith('/mdblist/sync/watched?') && request.method === 'GET') {lists.reads.push(request.url.split('?')[0]); return send(200, lists.recent);}
  // Her MDBList watchlist, newest added first, as one list of films and shows (unified), by offset and limit.
  if (request.url.startsWith('/mdblist/watchlist/items?')) {
    const ask = new URL(request.url, UP).searchParams, offset = Number(ask.get('offset')) || 0, limit = Number(ask.get('limit')) || 100; lists.reads.push(`/watchlist/items@${offset}`);
    return ask.get('unified') === 'true' && ask.get('sort') === 'added' && ask.get('order') === 'desc' ? send(200, lists.watchlist.slice(offset, offset + limit)) : send(400, {});
  }
  if (request.url.startsWith('/mdblist/sync/watched')) {fake.watched.push(body); return send(200, {added: {movies: 1}, not_found: {movies: [], shows: [], episodes: []}});}
  if (request.url.startsWith('/mdblist/scrobble/pause')) {fake.pauses.push(body); return send(201, {action: 'pause'});}
  if (request.url === '/api/config/save') {if (!body.config?.apiKeys?.tmdb) return send(400, {}); const uuid = uuidOf(++fake.made); fake.homes.set(uuid, {password: body.password, config: {...body.config, configVersion: 1}}); return send(200, {success: true, userUUID: uuid});}
  if (/^\/api\/config\/(load|update)\//.test(request.url)) {fake.most = Math.max(fake.most, ++fake.busy); await new Promise(done => setTimeout(done, fake.slow)); fake.busy--;}
  if (request.url.startsWith('/api/config/')) {
    const home = fake.homes.get(request.url.split('/').pop()); if (!home || home.password !== body.password) return send(401, {});
    if (request.url.includes('/load/')) return send(200, {success: true, config: {...home.config, keptByTheServer: true}});
    if (request.url.includes('/update/')) {if (body.baseVersion !== home.config.configVersion) return send(409, {}); home.config = {...body.config, configVersion: home.config.configVersion + 1}; return send(200, {success: true});}
    if (request.url.includes('/delete-user/')) {fake.homes.delete(request.url.split('/').pop()); return send(200, {success: true});}
  }
  // A row's titles, told apart by setup, so whose answer came back shows.
  const row = /^\/stremio\/([^/]+)\/catalog\/([^/]+)\/([^/]+)\.json$/.exec(request.url);
  if (row) {fake.catalogs.push(`${row[1]}/${row[2]}/${row[3]}`); return send(200, {metas: [1, 2].map(n => ({poster: `https://img.test/${row[1]}/${row[3]}/${n}.jpg`}))});}
  if (request.url.startsWith('/stremio/')) return send(200, {metas: []});
  if (request.url.startsWith('/api/v1/user')) {
    if (request.method === 'POST') {const uuid = `cfg-${fake.configs.size + 1}`; fake.configs.set(uuid, {password: body.password, config: body.config}); return send(201, {success: true, data: {uuid}});}
    if (!mine()) return send(401, {});
    if (request.method === 'GET') return send(200, {success: true, data: {userData: {...mine().config}, encryptedPassword: 'enc+pw/1'}});
    if (request.method === 'PUT') {mine().config = body.config; return send(200, {success: true});}
    if (request.method === 'DELETE') {fake.configs.delete(id); return send(200, {success: true});}
  }
  if (request.url === '/jellyfin/System/Info/Public') return send(200, {Id: 'aiosserverid', ServerName: 'AIOStreams'});
  const jf = /^\/jellyfin\/([0-9a-f-]{36})(\/.*)$/.exec(request.url);
  if (jf) {
    const [, uuid, rest] = jf, home = fake.homes.get(uuid); if (!home) return send(404, {});
    if (/^\/Items\/[^/]+\/Images\//.test(rest)) {answer.writeHead(200, {'content-type': 'image/jpeg'}); return answer.end('jpeg');}
    if (rest === '/Users/AuthenticateByName') {
      if (!home.config.jellyfinAppPassword || body.Pw !== home.config.jellyfinAppPassword) return send(401, {});
      fake.signIns++; return send(200, {AccessToken: `aiom-token-${uuid}`, ServerId: uuid, User: {Id: uuid, Name: home.config.jellyfinUserName, ServerId: uuid}, SessionInfo: {UserId: uuid, Id: uuid.replace(/-/g, '')}});
    }
    if (!(request.headers.authorization ?? '').includes(`Token="aiom-token-${uuid}"`)) return send(401, {});
    if (rest === '/System/Info') return send(200, {Id: uuid, ServerName: 'AIOMetadata', LocalAddress: `${UP}/jellyfin/${uuid}`});
    if (rest === '/Users') return send(200, [{Id: uuid, Name: home.config.jellyfinUserName}]);
    if (rest.startsWith('/Sessions/Playing')) return send(204, {});
    if (rest.startsWith('/UserViews')) return send(200, {Items: [{Id: VIEW, Name: 'Trending Movies', CollectionType: 'movies'}]});
    // A heart made or taken away (a favourite), by either address apps use, as the live probes of AIOMetadata 4.1.0 found them:
    // only for a title the server has; kept by setup, and read back as UserData.IsFavorite on the title (below).
    const fav = /^\/(?:Users\/[^/]+\/FavoriteItems|UserFavoriteItems)\/([^/?]+)/.exec(rest), favs = fake.favs.get(uuid) ?? fake.favs.set(uuid, new Set()).get(uuid);
    if (fav && (request.method === 'POST' || request.method === 'DELETE')) {
      const id = decodeURIComponent(fav[1]); if (!HELD[id]) return send(404, {});
      if (request.method === 'POST') favs.add(id); else favs.delete(id);
      fake.hearts.push({uuid, id, on: request.method === 'POST'}); return send(200, {IsFavorite: favs.has(id)});
    }
    // Ticking and keeping a spot, as AIOMetadata takes them, each read back after (the card's writes into Here).
    const own = /^\/Users\/[^/]+\/(PlayedItems|Items)\/([^/?]+)(\/UserData)?/.exec(rest), held = own && HELD[decodeURIComponent(own[2])];
    // A tick keeps the date it came with (DatePlayed) exactly, as AIOMetadata does; now when none came.
    if (own && own[1] === 'PlayedItems' && request.method === 'POST') {if (held) {const at = new URLSearchParams(rest.split('?')[1]).get('DatePlayed'); held.UserData = {...held.UserData, Played: true, LastPlayedDate: at ?? new Date().toISOString()}; fake.ticks.push({id: held.Id, at});} return send(200, {Played: true});}
    // A spot replaces the one held, with the date last played it came with (never later than now; now when none came), and
    // leaves watched alone.
    if (own && own[3] && request.method === 'POST') {if (held) {held.UserData = {...held.UserData, PlaybackPositionTicks: body.PlaybackPositionTicks, LastPlayedDate: new Date(Math.min(Date.parse(body.LastPlayedDate ?? '') || Date.now(), Date.now())).toISOString()}; fake.positions.push({id: held.Id, ticks: body.PlaybackPositionTicks, at: body.LastPlayedDate});} return held ? send(200, {}) : send(400, {});}
    if (own && own[3]) return held ? send(200, held.UserData ?? {}) : send(404, {});
    if (rest.startsWith('/Shows/')) {const series = decodeURIComponent(rest.split('/')[2]); return send(200, {Items: Object.values(HELD).filter(item => item.SeriesId === series && item.Listed !== false)});}
    // Her Favorites, asked for the way an app's Favorites screen does (unobserved on AIOMetadata 4.1.0: assumed): the films and
    // shows she hearted, up to Limit, each saying it is hearted. `unfiltered`: a server that ignores the filter and lists them all.
    if (rest.startsWith(`/Users/${uuid}/Items?`) && /[?&]IsFavorite=true(&|$)/.test(rest) && /[?&]Filters=IsFavorite(&|$)/.test(rest)) {
      fake.favReads++; const limit = Number(new URLSearchParams(rest.split('?')[1]).get('Limit')) || 100;
      return send(200, {Items: Object.values(HELD).filter(item => (item.Type === 'Movie' || item.Type === 'Series') && (fake.unfiltered || favs.has(item.Id))).slice(0, limit).map(item => favs.has(item.Id) ? {...item, UserData: {...item.UserData, IsFavorite: true}} : item)});
    }
    if (rest.startsWith(`/Users/${uuid}/Items?Ids=`)) return send(200, {Items: decodeURIComponent(rest.split('Ids=')[1].split('&')[0]).split(',').map(id => HELD[id]).filter(Boolean).map(item => favs.has(item.Id) ? {...item, UserData: {...item.UserData, IsFavorite: true}} : item)});
    if (rest.startsWith(`/Users/${uuid}/Items/`)) {const id = rest.split('/').pop().split('?')[0], {UserData, ...held} = HELD[id] ?? {}; return send(200, {Id: ITEM, Name: 'Meta Movie', ...held, RunTimeTicks: 6000e7, ServerId: uuid, UserData: {Key: uuid}, Poster: `${UP}/jellyfin/${uuid}/Items/${ITEM}/Images/Primary`});}
    return send(200, {Seen: rest});
  }
  send(404, {});
}).listen(8798, '127.0.0.1').unref();

const owner = client(), at = () => `/h/${hub.code}`;
let adaSite;
let hub;
const app = (token, device = 'phone-1') => ({authorization: `MediaBrowser Client="Test", Device="Phone", DeviceId="${device}"${token ? `, Token="${token}"` : ''}`});
const raw = async (path, token, init = {}) => {const answer = await fetch(BASE + at() + path, {...init, headers: {'content-type': 'application/json', ...app(token), ...init.headers}, redirect: 'manual'}); return {status: answer.status, text: await answer.text(), location: answer.headers.get('location')};};
const players = () => [...fake.configs.values()][0].config;
const playerOf = name => [...fake.homes.entries()].find(([, home]) => home.config.jellyfinUserName === name);
const syncAll = async () => {for (let i = 0; i < 4; i++) {const got = (await owner('POST', '/api/sync', {})).body; if (!got.more) return got;} return null;};

test('a hub with two people, a debrid key and a TMDB key', async () => {
  const offer = (await client()('GET', '/api/open')).body;
  assert.equal((await owner('POST', '/api/signup', {password: 'correct horse', code: 'local-claim', hub: offer.hub, proof: offer.proof})).status, 200);
  hub = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/groups/mein', {name: 'Mein', rows: null, settings: {}})).status, 200);
  assert.equal((await owner('PUT', '/api/groups/friends', {name: 'Friends', rows: null, settings: {quality: 'saver'}})).status, 200);
  const person = {rows: null, settings: {}, can: {arrange: false, add: false, playback: false}, trakt: false, lists: false};
  assert.equal((await owner('PUT', '/api/people/ada', {...person, name: 'Ada', groupId: 'mein'})).status, 200);
  assert.equal((await owner('PUT', '/api/people/ben', {...person, name: 'Ben', groupId: 'friends', settings: {spoilers: true, limit: 'kids', skip: false}})).status, 200);
  assert.equal((await owner('PUT', '/api/services/TorBox', {key: 'tb-key'})).status, 200);
  assert.equal((await owner('PUT', '/api/keys/tmdb', {key: 'good-tmdb-key'})).status, 200);
});
test('each person gets their own AIOMetadata setup, pointed at their own streams', async () => {
  assert.deepEqual(await syncAll(), {state: 'ok'});
  // The hub's own Home setup, and one player setup per person; no separate Home setups for groups or people.
  assert.equal(fake.homes.size, 3);
  const [, ada] = playerOf('Ada'), [, ben] = playerOf('Ben');
  assert.equal(ada.config.jellyfinResumeSource, 'auto'); assert.deepEqual(ada.config.jellyfinUsers, []); assert.ok(ada.config.jellyfinAppPassword.length > 20);
  assert.equal(ada.config.apiKeys.tmdb, 'good-tmdb-key'); assert.equal(ada.config.blurThumbs, false); assert.equal(ben.config.blurThumbs, true);
  // Ada changes nothing, so she gets the plain stream address; Ben's group and his own changes travel as one variant.
  assert.equal(ada.config.jellyfinStreamUrl, `${UP}/stremio/cfg-1/${encodeURIComponent('enc+pw/1')}/manifest.json`);
  assert.equal(ben.config.jellyfinStreamUrl, `${UP}/stremio/cfg-1/${encodeURIComponent('enc+pw/1')}/v/hub-c-ben/manifest.json`);
  const combined = players().variants.find(item => item.id === 'hub-c-ben');
  assert.ok(combined.script.includes('set preferredEncodes = ["HEVC","AV1"]')); assert.ok(!combined.script.includes('manifestUrl'));
  // AIOStreams only finds streams here: one variant per person who differs and nothing else of ours, no users, no Home.
  assert.deepEqual(players().variants.map(item => item.id), ['hub-c-ben']);
  assert.ok(!(players().presets ?? []).some(item => item.instanceId === 'h01' && item.enabled));
  assert.ok(!(players().catalogModifications ?? []).length);
  // What production carries on AIOStreams (the content limit, skipping intros) is set on each person's own server.
  assert.equal(ada.config.ageRating, 'None'); assert.equal(ben.config.ageRating, 'PG');
  // Kids also leaves out titles without a rating; nobody else's setup carries the setting at all.
  assert.equal(ben.config.allowUnratedContent, false); assert.equal('allowUnratedContent' in ada.config, false);
  // Moving off Kids lets them back in; moving back leaves them out again.
  const putBen = async limit => {const me = (await owner('GET', '/api/state')).body.hub.people.find(item => item.id === 'ben');
    return owner('PUT', '/api/people/ben', {name: me.name, groupId: me.groupId, rows: me.rows, settings: {...me.settings, limit}, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v});};
  assert.equal((await putBen('teen')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal('allowUnratedContent' in playerOf('Ben')[1].config, false);
  assert.equal((await putBen('kids')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Ben')[1].config.allowUnratedContent, false);
  assert.equal(ada.config.jellyfinSkipSource, 'auto'); assert.equal(ben.config.jellyfinSkipSource, 'off');
  // Both are ready to sign in, as far as the site can tell.
  const shown = (await owner('GET', '/api/state')).body.hub.people;
  assert.ok(shown.every(person => person.ready !== false), JSON.stringify(shown.map(person => [person.id, person.ready])));
  // Nothing changed, so a second sync writes nothing.
  const versions = [...fake.homes.values()].map(home => home.config.configVersion);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual([...fake.homes.values()].map(home => home.config.configVersion), versions);
  // People move over one by one: once their own setup's sign-in is kept, AIOStreams keeps no user for them.
  assert.deepEqual(players().jellyfin?.personas ?? [], []);
});
test('a change at the hub reaches everyone who has not changed it for themselves', async () => {
  const state = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...state, defaults: {...state.defaults, spoilers: true, unreleased: false}})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(playerOf('Ada')[1].config.blurThumbs, true); assert.equal(playerOf('Ada')[1].config.hideUnreleasedDigital, false);
  assert.equal(playerOf('Ben')[1].config.hideUnreleasedDigital, false);
  // A person's own MDBList key goes into their setup alone, with play reporting on.
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'});
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const [, ada] = playerOf('Ada'), [, ben] = playerOf('Ben');
  assert.equal(ada.config.apiKeys.mdblist, 'ada-mdblist-key'); assert.equal(ada.config.mdblistWatchTracking, true); assert.equal(ada.config.playbackReporting, true);
  assert.equal(ben.config.apiKeys.mdblist, undefined); assert.equal(ben.config.mdblistWatchTracking, false);
  // Hearts in an app go to a person's own MDBList, never to a key that is not theirs.
  assert.deepEqual([ada.config.jellyfinWatchlistServices, ben.config.jellyfinWatchlistServices], [['mdblist'], ['server']]);
});
let token, jf, uuid;
test('an app signs in through the hub and never sees the setup, its address or its private routes', async () => {
  const details = (await owner('GET', '/api/people/ada/signin')).body; jf = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  [uuid] = playerOf('Ada');
  const signed = await raw('/Users/AuthenticateByName', '', {method: 'POST', body: JSON.stringify({Username: 'Ada', Pw: details.password})});
  assert.equal(signed.status, 200, signed.text);
  const answer = JSON.parse(signed.text); token = answer.AccessToken; jf = answer.User.Id;
  assert.equal(answer.ServerId, 'aiosserverid'); assert.equal(answer.User.Name, 'Ada');
  assert.ok(!signed.text.includes(uuid) && !signed.text.includes(uuid.replace(/-/g, '')) && !signed.text.includes('aiom-token') && !signed.text.includes('/jellyfin/'));
  const info = await raw('/System/Info', token), item = await raw(`/Users/${jf}/Items/${ITEM}`, token), pub = await raw('/System/Info/Public');
  assert.equal(JSON.parse(info.text).ServerName, 'AIOHub'); assert.equal(JSON.parse(pub.text).ServerName, 'AIOHub'); assert.equal(JSON.parse(info.text).Id, 'aiosserverid');
  assert.ok(!info.text.includes(uuid) && !info.text.includes(UP));
  const shown = JSON.parse(item.text); assert.equal(shown.UserData.Key, jf); assert.equal(shown.Poster, `${BASE}${at()}/Items/${ITEM}/Images/Primary`);
  assert.deepEqual(JSON.parse((await raw('/Users', token)).text).map(user => user.Id), [jf]);
  for (const path of ['/AIOStreams/Users', '/AIOStreams/Activity', '/AIOStreams/History/Export', '/AIOStreams/Token']) assert.equal((await raw(path, token)).status, 403, path);
  assert.equal((await raw('/Sessions/Playing', token, {method: 'POST', body: JSON.stringify({ItemId: ITEM, PositionTicks: 0})})).status, 204);
});
test('an app signed in before its person’s sign-in changed carries on without signing in again', async () => {
  const rename = async name => {const ada = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada'); assert.equal((await owner('PUT', '/api/people/ada', {name, groupId: ada.groupId, rows: ada.rows, settings: ada.settings, can: ada.can, trakt: ada.trakt, lists: ada.lists, v: ada.v})).status, 200); await syncAll();};
  // A new name means a new sign-in on her own server, kept without a session: the app's next request makes one.
  await rename('Ada Lovelace'); assert.equal((await raw('/System/Info', token)).status, 200);
  await rename('Ada'); assert.equal((await raw('/System/Info', token)).status, 200);
});
test('a person copies what they watched here to their MDBList, after seeing the plan', async () => {
  // A film played, an episode stopped partway, another ticked as watched: all through the hub, which keeps a note of each.
  const say = (path, body) => raw(path, token, {method: 'POST', body: JSON.stringify(body)});
  assert.equal((await say('/Sessions/Playing/Stopped', {ItemId: EP, PositionTicks: 600e7})).status, 204);
  assert.equal((await say(`/Users/${jf}/PlayedItems/${EP_HELD}`, {})).status, 200);
  await new Promise(resolve => setTimeout(resolve, 500));
  // On Activity, the tick is a line of its own.
  const ticked = (await owner('GET', '/api/activity')).body.sittings.filter(row => row.person === 'ada' && row.item === EP_HELD);
  assert.deepEqual(ticked.map(row => [row.item, row.parts, row.playing]), [[EP_HELD, 'marked', 0]]);
  // Only Ada, from her own page.
  assert.equal((await owner('GET', '/api/people/ada/carry')).status, 403);
  const ada = client(), link = (await owner('GET', '/api/people/ada/signin')).body.link.split('/join/')[1];
  assert.equal((await ada('POST', '/api/join', {token: link, password: 'ada own password'})).status, 200); adaSite = ada;
  const shown = await ada('GET', '/api/people/ada/carry');
  assert.equal(shown.status, 200, JSON.stringify(shown.body));
  assert.deepEqual(shown.body.watched.map(entry => [entry.title, entry.detail, entry.at]), [['Meta Movie', 'Movie', '2026-11-01T20:00:00.000Z']]);
  assert.deepEqual(shown.body.partway.map(entry => [entry.title, entry.detail, entry.pct]), [['Meta Show', 'Season 1 · Episode 2', 40]]);
  assert.equal(shown.body.already, 1); assert.equal(fake.watched.length, 0, 'looking writes nothing');
  const done = await ada('POST', '/api/people/ada/carry', {});
  assert.deepEqual(done.body, {watched: 1, partway: 1, trakt: 0, missed: 0, more: false, left: 0});
  assert.deepEqual(fake.watched, [{movies: [{ids: {tmdb: 603, imdb: 'tt0133093'}, watched_at: '2026-11-01T20:00:00.000Z'}]}]);
  assert.deepEqual(fake.pauses, [{show: {ids: {tmdb: 1399}, season: {number: 1, episode: {number: 2}}}, progress: 40}]);
  // Done once: a second look offers nothing, and nothing is sent twice.
  const again = await ada('GET', '/api/people/ada/carry');
  assert.equal(again.body.watched.length + again.body.partway.length, 0);
  await ada('POST', '/api/people/ada/carry', {}); assert.equal(fake.watched.length, 1); assert.equal(fake.pauses.length, 1);
});
test('watched titles asked for library by library come from everything watched, as in a real Jellyfin library', async () => {
  // Trakt's own Jellyfin sync asks this way. A library here is a catalog row, which only holds what it shows today.
  const asked = async query => JSON.parse((await raw(`/Items?${query}`, token)).text).Seen;
  const byLibrary = await asked(`userId=${jf}&parentId=${VIEW}&isPlayed=true&recursive=true&includeItemTypes=Movie`);
  assert.ok(!byLibrary.toLowerCase().includes('parentid') && byLibrary.includes('isPlayed=true'), byLibrary);
  // Under a show, or when not asking for what was watched, the question goes on exactly as asked.
  assert.ok((await asked(`userId=${jf}&parentId=${SHOW}&isPlayed=true&recursive=true`)).includes(`parentId=${SHOW}`));
  assert.ok((await asked(`userId=${jf}&parentId=${VIEW}&recursive=true`)).includes(`parentId=${VIEW}`));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// `ago`: how many seconds ago the report was made (a test header, front.ts), to play for a while in no time.
const say = (path, body, ago = 0) => raw(path, token, {method: 'POST', body: JSON.stringify(body), headers: ago ? {'x-test-ago': String(ago)} : {}});
// Reports are passed on in the background, after the app has its answer: wait for Trakt to have heard, then a moment more.
const heard = async count => {for (let i = 0; i < 50 && trakt.calls.length < count; i++) await pause(100); await pause(300); return trakt.calls.map(({path, body}) => ({path, body}));};
// What the page does once Trakt's sign-in has come back to it: the login it got from Trakt is handed to the hub.
const connect = async () => {
  const got = issue(), linked = await owner('POST', '/api/people/ada/scrobble/link', {access: got.access_token, refresh: got.refresh_token, lasts: got.expires_in, created: got.created_at, username: 'adatrakt', redirect: `${BASE}/api/trakt/callback`});
  assert.equal(linked.status, 200, JSON.stringify(linked.body)); assert.deepEqual(linked.body, {state: 'connected'});
};
// Trakt's asking the hub to wait (kept by hub and person after a refused read) is over.
const waited = () => sql("DELETE FROM rows_cache WHERE kind = 'trakt-wait'");
// The same for writes (kept apart: Trakt limits them apart). What was kept meanwhile is due, as if the time had passed.
const resumed = () => sql("DELETE FROM rows_cache WHERE kind = 'trakt-wait-send'; UPDATE trakt_outbox SET next = 0");
const sql = command => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', command], {cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: ['ignore', 'pipe', 'ignore']}))[0].results;
const waiting = () => sql('SELECT kind, path FROM trakt_outbox ORDER BY id');
// At 03:00 UTC unless told otherwise: before the day's Trakt and MDBList look, which the drift tests run on purpose.
const cron = (time = Date.UTC(2026, 0, 1, 3)) => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}&time=${time}`).then(answer => answer.text());
// A person's own rows (Trakt's public Trending charts are shared rows, not anyone's own).
const rowsOf = config => config.catalogs.filter(item => /^(trakt|custom)\./.test(item.id) && !/^trakt\.(trending|popular)\./.test(item.id)).map(item => [item.id, item.type, item.name, item.enabled]);
test('Trakt connected on AIOMetadata, as before: its own Trakt rows and Token ID in her setup', async () => {
  // Ada and Ben were picked for long ago (with nothing picked) for the places and limit they have, so a run before five leaves them
  // be until the For you tests; someone never picked for, or whose places, kinds of pick or limit changed, would be picked at any hour.
  sql(`INSERT INTO foryou (hub, person, day, sig) SELECT hub, id, '2000-01-01', json_array(CASE id WHEN 'ben' THEN 'kids' ELSE 'all' END, json_array(), json_array('for-you-1', 'for-you-2', 'for-you-3')) FROM people`);
  assert.deepEqual((await owner('POST', '/api/people/ada/trakt', {tokenId: 'aiom-trakt-token-id-1'})).body, {username: 'adatrakt'});
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const [, ada] = playerOf('Ada');
  assert.equal(ada.config.apiKeys.traktTokenId, 'aiom-trakt-token-id-1');
  // AIOMetadata's own Trakt rows, as before (the one Watchlist is its Trakt one; New for you is its recently aired); Recently
  // Watched comes from the hub, which cannot read a Trakt connected only on AIOMetadata.
  assert.deepEqual(rowsOf(ada.config).map(([id]) => id), ['trakt.watchlist', 'trakt.recommendations.movies', 'trakt.recommendations.shows', 'trakt.upnext', 'trakt.unwatched', 'custom.aiohub_rows.all.history']);
  assert.deepEqual(rowsOf(ada.config).map(row => row[2]), ['Watchlist', 'Recommended Movies', 'Recommended Shows', 'Up Next', 'New for you', 'Recently Watched']);
  // Up Next shows each show's poster, not a still of the episode. No other catalog carries the setting.
  assert.deepEqual(ada.config.catalogs.filter(item => item.metadata && 'useShowPosterForUpNext' in item.metadata).map(item => [item.id, item.type, item.source, item.cacheTTL, item.metadata]), [['trakt.upnext', 'series', 'trakt', 300, {useShowPosterForUpNext: true}]]);
  const shown = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal(shown.trakt, true); assert.equal(shown.aiomTrakt, true);
});
test('back from Trakt’s sign-in the browser goes straight on to the page; the login the page then hands over is kept, never shown', async () => {
  const back = await fetch(`${BASE}/api/trakt/callback?code=a1b2c3&state=s-t_9`, {redirect: 'manual'});
  assert.equal(back.status, 302); assert.equal(back.headers.get('location'), '/#/trakt?code=a1b2c3&state=s-t_9');
  const before = (await owner('GET', '/api/state')).body.hub;
  assert.equal(before.scrobble, true); assert.equal(before.traktClient, 'local-trakt-client'); assert.equal(before.people.find(person => person.id === 'ada').history, null);
  // No login, a sign-in that came back somewhere else, or nobody signed in here: nothing is kept.
  assert.equal((await owner('POST', '/api/people/ada/scrobble/link', {access: '', refresh: 'r'})).status, 400);
  assert.equal((await owner('POST', '/api/people/ada/scrobble/link', {access: 'a', refresh: 'r', redirect: 'https://elsewhere.example/steal'})).status, 400);
  assert.equal((await client()('POST', '/api/people/ada/scrobble/link', {access: 'a', refresh: 'r'})).status, 401);
  // The device code way is gone.
  assert.equal((await owner('POST', '/api/people/ada/scrobble', {})).status, 404);
  await connect();
  const after = await owner('GET', '/api/state'), text = JSON.stringify(after.body);
  assert.deepEqual(after.body.hub.people.find(person => person.id === 'ada').history, {username: 'adatrakt', again: false});
  assert.ok(!text.includes('trakt-access') && !text.includes('trakt-refresh'));
});
let served;
test('with Trakt connected to the hub, her setup reads her Trakt rows from the hub, and AIOMetadata’s own Trakt is no longer used', async () => {
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const [, ada] = playerOf('Ada'), [, ben] = playerOf('Ben');
  // The same rows, in the same order and under the same names, now imported from the hub's own addon; Up Next and New for you stay off.
  // With Trakt and MDBList both connected there is one Watchlist all the same.
  assert.deepEqual(rowsOf(ada.config), [['custom.aiohub_rows.all.watchlist', 'all', 'Watchlist', true], ['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true],
    ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.series.up_next', 'series', 'Up Next', false], ['custom.aiohub_rows.all.upnext_new', 'all', 'New for you', false],
    ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', true]]);
  // The hub's own Up Next lists shows, so it needs no setting for their posters.
  assert.ok(!ada.config.catalogs.some(item => item.metadata && 'useShowPosterForUpNext' in item.metadata));
  served = ada.config.catalogs.filter(item => item.id.startsWith('custom.'));
  for (const item of served) {
    assert.equal(item.source, 'custom'); assert.ok(item.cacheTTL > 0 && item.cacheTTL <= 900); assert.equal(item.showInHome, true);
    assert.match(item.sourceUrl, new RegExp(`^${BASE}/api/rows/r[\\w-]{20,}/catalog/${item.type}/[a-z_]+\\.json$`));
  }
  // Ahead of the shared rows, as before, and nothing of AIOMetadata's own Trakt left: no Token ID, no hiding by it.
  assert.equal(ada.config.catalogs.findIndex(item => item.id.startsWith('custom.')), 0);
  assert.equal(ada.config.apiKeys.traktTokenId, undefined); assert.equal(ada.config.hideWatchedTrakt, false);
  // Ben has no Trakt, no MDBList and has played nothing here yet: nothing of his own, not even an empty Recently Watched.
  assert.deepEqual(rowsOf(ben.config), []);
  // The address is made once: a second sync sends nothing.
  const version = ada.config.configVersion; assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Ada')[1].config.configVersion, version);
  // Switching Recently Watched off keeps her following her group's Home: only that row changes, and a later save leaves it off.
  const before = rowsOf(ada.config), put = async extra => {const me = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
    return owner('PUT', '/api/people/ada', {name: me.name, groupId: me.groupId, rows: me.rows, settings: me.settings, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v, ...extra});};
  assert.equal((await put({picks: {'recently-watched': false, 'not-a-row': true}})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config), before.map(row => row[0] === 'custom.aiohub_rows.all.history' ? [...row.slice(0, 3), false] : row));
  assert.equal((await put({})).status, 200);
  const me = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal(me.rows, null); assert.deepEqual(me.picks, {'recently-watched': false});
  // What she switched on or off before the two watchlists became one, and Recently Aired became New for you, still counts:
  // MDBList's watchlist on keeps the Watchlist on even with Trakt's off, and Recently Aired on is New for you on.
  const rowNow = id => rowsOf(playerOf('Ada')[1].config).find(row => row[0] === id).slice(2);
  assert.equal((await put({picks: {'recently-watched': false, watchlist: false}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowNow('custom.aiohub_rows.all.watchlist'), ['Watchlist', false]);
  assert.equal((await put({picks: {'recently-watched': false, watchlist: false, 'mdblist-watchlist': true, 'recently-aired': true}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowNow('custom.aiohub_rows.all.watchlist'), ['Watchlist', true]); assert.deepEqual(rowNow('custom.aiohub_rows.all.upnext_new'), ['New for you', true]);
  assert.ok(!rowsOf(playerOf('Ada')[1].config).some(([id]) => /mdblist_watchlist|recently_aired/.test(id)), 'nothing is under an address from before');
  assert.equal((await put({picks: {'recently-watched': false}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowNow('custom.aiohub_rows.all.watchlist'), ['Watchlist', true]); assert.deepEqual(rowNow('custom.aiohub_rows.all.upnext_new'), ['New for you', false]);
  // The manager places the Trakt rows in the hub's Home and sets how each starts: Watchlist after Trending Movies, New for you
  // on (kept here as a hub saved it before, as Recently Aired, next to an MDBList watchlist that was off). Ada follows that, with
  // her own choice on top; Ben, without Trakt, gets nothing of it. Each row from before turns into what it is now, where it was.
  const hubNow = (await owner('GET', '/api/state')).body.hub, traktRow = (id, title = id, on = true) => ({id, title, kind: 'Series', source: 'Trakt', origin: 'hub', on, core: true});
  const placedRows = [hubNow.rows[0], traktRow('watchlist'), traktRow('mdblist-watchlist', 'Watchlist', false), traktRow('recently-aired', 'Recently Aired for You'), ...hubNow.rows.slice(1)];
  assert.equal((await owner('PUT', '/api/hub', {host: hubNow.host, hostUrl: hubNow.hostUrl, serverName: hubNow.serverName, addons: hubNow.addons, defaults: hubNow.defaults, rows: placedRows, order: hubNow.groups.map(group => group.id), v: hubNow.v})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const catalogs = playerOf('Ada')[1].config.catalogs.map(item => item.id), at = id => catalogs.indexOf(id);
  assert.ok(at('tmdb.trending') < at('custom.aiohub_rows.all.watchlist') && at('custom.aiohub_rows.all.watchlist') < at('custom.aiohub_rows.all.upnext_new'), catalogs.join(' '));
  assert.deepEqual(rowNow('custom.aiohub_rows.all.upnext_new'), ['New for you', true]); assert.deepEqual(rowNow('custom.aiohub_rows.all.watchlist'), ['watchlist', true]);
  assert.equal(at('custom.aiohub_rows.movie.recommended'), at('custom.aiohub_rows.all.watchlist') + 1, 'a row the hub did not place follows the one before it');
  // Saved, the hub's Home holds them under what they are now: one Watchlist, and New for you.
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.rows.slice(1, 3).map(row => [row.id, row.title, row.on]), [['watchlist', 'watchlist', true], ['new-for-you', 'New for you', true]]);
  assert.deepEqual(rowsOf(playerOf('Ben')[1].config).map(([id]) => id), []);
  const back = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {host: back.host, hostUrl: back.hostUrl, serverName: back.serverName, addons: back.addons, defaults: back.defaults, rows: hubNow.rows, order: back.groups.map(group => group.id), v: back.v})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  // The site says the older link is still there and no longer needed; removing it keeps her Trakt rows.
  let shown = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal(shown.aiomTrakt, true); assert.equal(shown.trakt, true);
  assert.equal((await owner('DELETE', '/api/people/ada/trakt')).status, 200);
  shown = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal(shown.aiomTrakt, false); assert.equal(shown.trakt, true);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config).map(([id]) => id), served.map(item => item.id));
  assert.equal(trakt.reads.length, 0, 'nothing is read from Trakt until AIOMetadata asks');
});
// Her Trakt sync turned on, as she does it from her own page. Its turn in the cron is put off, so the tests of sending that follow
// are only that; what comes back from Trakt is tested further down, where her turn is made due on purpose.
const syncOn = async (earlier = false) => {assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: true, earlier})).status, 200); sql("UPDATE sync SET checked = 9000000000 WHERE person = 'ada'");};
const matchingOf = async () => (await adaSite('GET', '/api/state')).body.hub.people[0].matching;
test('connecting Trakt alone sends nothing: a film played through, a tick and the cron say nothing to Trakt, and nothing is kept to send, until she turns sync on', async () => {
  // Connected by her manager a moment ago: sync is off, and has never been asked about.
  assert.deepEqual(await matchingOf(), {on: false, earlier: false, passed: false, ask: false, good: 0, failing: null, why: null, waiting: null});
  const STAR = pack('movie', 'tt0076759'), state = () => sql(`SELECT scrobbled, scrobbled_at, position FROM plays WHERE item = '${STAR}'`)[0];
  HELD[STAR] = {Id: STAR, Type: 'Movie', Name: 'Star Wars', ProviderIds: {Tmdb: '11', Imdb: 'tt0076759'}, RunTimeTicks: 6000e7, UserData: {}};
  trakt.calls = []; trakt.refused = []; trakt.reads = [];
  // Ten minutes of it played (so nothing about it is brief), paused, carried on, finished at 90%, then ticked as watched.
  await say('/Sessions/Playing', {ItemId: STAR, PositionTicks: 0}, 700); await pause(400);
  await say('/Sessions/Playing/Progress', {ItemId: STAR, PositionTicks: 300e7, IsPaused: false}, 400); await pause(400);
  await say('/Sessions/Playing/Progress', {ItemId: STAR, PositionTicks: 600e7, IsPaused: true}, 100); await pause(400);
  await say('/Sessions/Playing/Progress', {ItemId: STAR, PositionTicks: 600e7, IsPaused: false}); await pause(400);
  await say('/Sessions/Playing/Stopped', {ItemId: STAR, PositionTicks: 5400e7}); await pause(600);
  await say(`/Users/${jf}/PlayedItems/${STAR}`, {}); await pause(800);
  // The hub noted the play for her Activity, as for anyone. Trakt heard nothing, was refused nothing, and nothing waits for it.
  assert.ok(state().position > 0, 'kept here'); assert.equal(state().scrobbled, null); assert.equal(state().scrobbled_at, null);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.refused, []); assert.deepEqual(waiting(), []);
  // Left running by an app that went quiet: the five-minute cron has nothing to stop on Trakt for her, and reads nothing of hers.
  await say('/Sessions/Playing', {ItemId: STAR, PositionTicks: 5400e7}); await pause(400);
  sql(`UPDATE plays SET updated = updated - 3600 WHERE item = '${STAR}'`); await cron(); await pause(500);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []); assert.deepEqual(trakt.reads.filter(read => ['/sync/last_activities', '/sync/playback', '/sync/watched/shows'].includes(read.where)), [], 'and Trakt is not asked what she watched elsewhere');
  // A play left marked as "told" from before sync was what sending goes by, and a call of hers still in the outbox from then
  // (as for someone connected before this, with sync off): the cron sends neither, and lets both go.
  sql(`UPDATE plays SET scrobbled = 'playing', updated = unixepoch() - 3600 WHERE item = '${STAR}'`);
  sql(`INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) SELECT id, 'ada', '${STAR}', 'stop', '/scrobble/stop', '{"movie":{"ids":{"tmdb":11}},"progress":90}', unixepoch() - 60, 1, 0, 0 FROM hubs`);
  sql(`INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) SELECT id, 'ada', 'carry', 'mark', '/sync/history', '{"movies":[]}', unixepoch() - 60, 1, unixepoch() + 9000, 0 FROM hubs`);
  await cron(); await pause(500);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.refused, []); assert.deepEqual(waiting(), [], 'dropped, due or not'); assert.equal(state().scrobbled, null);
  // Only she can turn it on, from her own page: her manager is refused, and it stays off.
  assert.equal((await owner('POST', '/api/people/ada/matching', {on: true})).status, 403); assert.equal((await matchingOf()).on, false);
  // Star Wars is taken away again, for the tests after.
  sql(`DELETE FROM plays WHERE item = '${STAR}'; DELETE FROM sittings WHERE item = '${STAR}'`);
  // She turns it on: from here what she watches goes to Trakt as it plays (the tests that follow).
  await syncOn(); assert.equal((await matchingOf()).on, true); assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').matching.on, true);
});
test('with sync on, a film played, paused, carried on, skipped ahead and finished reaches Trakt as start (once enough has played), pause, start, start, stop', async () => {
  const film = {movie: {ids: {tmdb: 27205, imdb: 'tt1375666'}}};
  // Its first ten minutes play over ten minutes (reports dated back), so the stop at the end counts (see brief in trakt.ts).
  // Trakt hears nothing as it starts, nor half a minute in: only once two minutes have played, with how far in it is by then.
  await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0}, 700); await pause(600);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 30e7, IsPaused: false}, 670); await pause(600);
  assert.deepEqual(trakt.calls, [], 'nothing yet'); assert.equal(sql(`SELECT scrobbled FROM plays WHERE item = '${FILM}'`)[0].scrobbled, 'held');
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 150e7, IsPaused: false}, 550); await heard(1);
  // Plain progress is not passed on; a pause is, at once, and only once however often the app says it is still paused.
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 180e7, IsPaused: false}, 520);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true}, 100); await heard(2);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true});
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: false}); await heard(3);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 620e7, IsPaused: false});
  // Skipped ahead half an hour: Trakt is told the new place.
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 2400e7, IsPaused: false}); await heard(4);
  await say('/Sessions/Playing/Stopped', {ItemId: FILM, PositionTicks: 5400e7});
  assert.deepEqual(await heard(5), [
    {path: '/scrobble/start', body: {...film, progress: 2.5}}, {path: '/scrobble/pause', body: {...film, progress: 10}},
    {path: '/scrobble/start', body: {...film, progress: 10}}, {path: '/scrobble/start', body: {...film, progress: 40}},
    {path: '/scrobble/stop', body: {...film, progress: 90}},
  ]);
  assert.ok(trakt.calls.every(call => call.auth === 'trakt-access-1'));
  // The app then ticks it as watched, as many do: Trakt already counted the stop, so nothing more is sent.
  await say(`/Users/${jf}/PlayedItems/${FILM}`, {}); await pause(800);
  assert.equal(trakt.calls.length, 5);
});
test('an episode goes by its show’s ids with its season and number, and a repeated stop (409) counts as done', async () => {
  trakt.calls = []; trakt.stop = 409;
  const episode = {show: {ids: {tmdb: 1399}}, episode: {season: 1, number: 3}};
  // (Its start goes with the first report after two minutes have played.)
  await say('/Sessions/Playing', {ItemId: EP3, PositionTicks: 0}, 300); await pause(400); assert.deepEqual(trakt.calls, []);
  await say('/Sessions/Playing/Progress', {ItemId: EP3, PositionTicks: 280e7, IsPaused: false}, 20); await heard(1);
  await say('/Sessions/Playing/Stopped', {ItemId: EP3, PositionTicks: 5700e7});
  assert.deepEqual(await heard(2), [{path: '/scrobble/start', body: {...episode, progress: 4.67}}, {path: '/scrobble/stop', body: {...episode, progress: 95}}]);
  trakt.stop = 201;
});
test('an episode opened, run to the end and left (seen it already) is no watch: nothing to Trakt, and not on Activity', async () => {
  // A sitting of its own (the one above was over an hour ago), and Trakt not yet told this one was watched.
  const data = HELD[EP3].UserData, ticks = fake.ticks.length, was = sql(`SELECT position, playing, updated, scrobbled, scrobbled_at, parts FROM plays WHERE item = '${EP3}'`)[0], value = v => v == null ? 'NULL' : typeof v === 'number' ? v : `'${v}'`;
  sql(`UPDATE sittings SET started = started - 7200, updated = updated - 7200 WHERE item = '${EP3}'`); sql(`UPDATE plays SET scrobbled = NULL WHERE item = '${EP3}'`);
  trakt.calls = [];
  await say('/Sessions/Playing', {ItemId: EP3, PositionTicks: 0}); await pause(400);
  await say('/Sessions/Playing/Progress', {ItemId: EP3, PositionTicks: 5600e7, IsPaused: false}); await pause(400);
  assert.equal(sql(`SELECT scrobbled FROM plays WHERE item = '${EP3}'`)[0].scrobbled, 'held');
  // Its start, its stop, the app's tick as it moves on, and the cron after: none of it reaches Trakt, which never shows it as
  // being watched.
  await say('/Sessions/Playing/Stopped', {ItemId: EP3, PositionTicks: 5700e7}); await pause(400);
  await say(`/Users/${jf}/PlayedItems/${EP3}`, {}); await pause(400);
  sql(`UPDATE plays SET updated = updated - 3600 WHERE item = '${EP3}'`); await cron(); await pause(400);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []); assert.equal(sql(`SELECT scrobbled FROM plays WHERE item = '${EP3}'`)[0].scrobbled, 'stopped');
  // Activity keeps the earlier sitting, where a few minutes were played, and leaves this one out.
  const shown = (await owner('GET', '/api/activity')).body.sittings.filter(row => row.item === EP3);
  assert.deepEqual(shown.map(row => row.parts), ['0-280']);
  // Put back as it was, for the tests after (the card's comparison, For you).
  sql(`DELETE FROM sittings WHERE item = '${EP3}' AND parts != '0-280'`); sql(`UPDATE sittings SET started = started + 7200, updated = updated + 7200 WHERE item = '${EP3}'`);
  sql(`UPDATE plays SET ${Object.entries(was).map(([key, v]) => `${key} = ${value(v)}`).join(', ')} WHERE item = '${EP3}'`); HELD[EP3].UserData = data; fake.ticks.length = ticks;
});
test('Trakt hears nothing of a sitting until enough of it has played: a brief open says nothing and disturbs nothing; past two minutes one start goes, with how far in', async () => {
  const BLADE = pack('movie', 'tt0083658'), film = {movie: {ids: {tmdb: 78, imdb: 'tt0083658'}}}, state = () => sql(`SELECT scrobbled, scrobbled_at FROM plays WHERE item = '${BLADE}'`)[0];
  // Each part below is a sitting of its own: the one before is made to have ended two hours ago.
  const later = () => sql(`UPDATE sittings SET started = started - 7200, updated = updated - 7200 WHERE item = '${BLADE}'`);
  HELD[BLADE] = {Id: BLADE, Type: 'Movie', Name: 'Blade Runner', ProviderIds: {Tmdb: '78', Imdb: 'tt0083658'}, RunTimeTicks: 6000e7, UserData: {}};
  trakt.calls = []; trakt.refused = [];
  // Opened, thirty seconds played, paused, closed: Trakt gets no call at all, then or from the cron after, so it never shows her
  // as watching it. Anything of this sitting still waiting to be sent goes with it.
  await say('/Sessions/Playing', {ItemId: BLADE, PositionTicks: 0}, 40); await pause(400); assert.equal(state().scrobbled, 'held');
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 30e7, IsPaused: false}, 10); await pause(300);
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 30e7, IsPaused: true}, 5); await pause(300);
  sql(`INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) SELECT id, 'ada', '${BLADE}', 'start', '/scrobble/start', '{}', unixepoch(), 1, unixepoch() + 9000, 0 FROM hubs`);
  await say('/Sessions/Playing/Stopped', {ItemId: BLADE, PositionTicks: 30e7}); await pause(800);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.refused, []); assert.deepEqual(waiting(), []); assert.equal(state().scrobbled, 'stopped');
  sql(`UPDATE plays SET updated = updated - 3600 WHERE item = '${BLADE}'`); await cron(); await pause(400); assert.deepEqual(trakt.calls, []);
  // The hub's own Activity is as it was: the sitting is there while it is under way, and left out once over (too little played).
  assert.deepEqual((await owner('GET', '/api/activity')).body.sittings.filter(row => row.item === BLADE), []);
  // Played past two minutes: nothing at one minute, then exactly one start, with how far in it is by then. From there on a
  // pause, carrying on and the stop go as they always did.
  later(); await say('/Sessions/Playing', {ItemId: BLADE, PositionTicks: 30e7}, 200); await pause(300);
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 90e7, IsPaused: false}, 140); await pause(400); assert.deepEqual(trakt.calls, []);
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 180e7, IsPaused: false}, 50);
  assert.deepEqual(await heard(1), [{path: '/scrobble/start', body: {...film, progress: 3}}]); assert.equal(state().scrobbled, 'playing');
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 240e7, IsPaused: false}); await pause(400); assert.equal(trakt.calls.length, 1, 'one start, not one a report');
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 240e7, IsPaused: true}); await heard(2);
  await say('/Sessions/Playing/Progress', {ItemId: BLADE, PositionTicks: 240e7, IsPaused: false}); await heard(3);
  await say('/Sessions/Playing/Stopped', {ItemId: BLADE, PositionTicks: 300e7});
  assert.deepEqual((await heard(4)).map(call => [call.path, call.body.progress]), [['/scrobble/start', 3], ['/scrobble/pause', 4], ['/scrobble/start', 4], ['/scrobble/stop', 5]]);
  // Carried on a few minutes later (the same sitting, which already counts): it starts at once, as before.
  trakt.calls = []; await say('/Sessions/Playing', {ItemId: BLADE, PositionTicks: 300e7});
  assert.deepEqual(await heard(1), [{path: '/scrobble/start', body: {...film, progress: 5}}]);
  await say('/Sessions/Playing/Stopped', {ItemId: BLADE, PositionTicks: 4800e7}); await heard(2); assert.equal(state().scrobbled, 'watched');
  // Hours later she opens it for a moment and closes it. Trakt hears nothing, so the spot and the watch it holds stay as they
  // are; and it still counts as watched here, so the app's tick from the list soon after is not sent as a second play.
  const told = state(); later(); trakt.calls = [];
  await say('/Sessions/Playing', {ItemId: BLADE, PositionTicks: 0}, 20); await pause(400); assert.equal(state().scrobbled, 'held-watched');
  await say('/Sessions/Playing/Stopped', {ItemId: BLADE, PositionTicks: 15e7}); await pause(600);
  assert.deepEqual(state(), told, 'as Trakt last knew it'); assert.deepEqual(trakt.calls, []);
  sql(`UPDATE sittings SET updated = updated - 120 WHERE item = '${BLADE}'`); await say(`/Users/${jf}/PlayedItems/${BLADE}`, {}); await pause(800);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []);
  // Blade Runner is taken away again, for the tests after.
  sql(`DELETE FROM plays WHERE item = '${BLADE}'; DELETE FROM sittings WHERE item = '${BLADE}'`);
});
test('a file that runs longer than listed: Trakt gets the listed episode as watched from a stop past its end, and a pause there stays a pause', async () => {
  // Listed at 6000 seconds, as every title here; the file runs on. A report past the listed length by more than the margin (5%
  // here) flags it (front.ts, note). How far in is still told against the listed length, 100 at most: a start and a stop go as
  // they always did, so the stop counts as a watch of the listed title. Only the pause is held under 80%, where Trakt keeps a spot.
  const LONG = pack('movie', 'tt0071562'), film = {movie: {ids: {tmdb: 240, imdb: 'tt0071562'}}}, state = () => sql(`SELECT scrobbled, over FROM plays WHERE item = '${LONG}'`)[0];
  HELD[LONG] = {Id: LONG, Type: 'Movie', Name: 'The Long Cut', ProviderIds: {Tmdb: '240', Imdb: 'tt0071562'}, UserData: {}};
  trakt.calls = [];
  await say('/Sessions/Playing', {ItemId: LONG, PositionTicks: 0}, 700); await pause(600);
  await say('/Sessions/Playing/Progress', {ItemId: LONG, PositionTicks: 150e7, IsPaused: false}, 550); await heard(1); assert.equal(state().over, 0);
  // Skipped to past the listed end, paused there, carried on, stopped.
  await say('/Sessions/Playing/Progress', {ItemId: LONG, PositionTicks: 6400e7, IsPaused: false}, 100); await heard(2); assert.equal(state().over, 6400);
  await say('/Sessions/Playing/Progress', {ItemId: LONG, PositionTicks: 6400e7, IsPaused: true}); await heard(3); assert.equal(state().scrobbled, 'paused');
  await say('/Sessions/Playing/Progress', {ItemId: LONG, PositionTicks: 6400e7, IsPaused: false}); await heard(4);
  await say('/Sessions/Playing/Stopped', {ItemId: LONG, PositionTicks: 6400e7});
  assert.deepEqual(await heard(5), [
    {path: '/scrobble/start', body: {...film, progress: 2.5}}, {path: '/scrobble/start', body: {...film, progress: 100}},
    {path: '/scrobble/pause', body: {...film, progress: 79.99}}, {path: '/scrobble/start', body: {...film, progress: 100}},
    {path: '/scrobble/stop', body: {...film, progress: 100}},
  ]);
  assert.deepEqual(state(), {scrobbled: 'watched', over: 6400}); assert.deepEqual(waiting(), []);
  // Taken away again, for the tests after.
  sql(`DELETE FROM plays WHERE item = '${LONG}'; DELETE FROM sittings WHERE item = '${LONG}'`); trakt.calls = [];
});
test('ticking a title as watched adds it to Trakt history', async () => {
  trakt.calls = []; sql(`UPDATE sittings SET updated = updated - 120 WHERE item = '${ITEM}'`); // its brief play earlier is over: this tick is from the list
  assert.equal((await say(`/Users/${jf}/PlayedItems/${ITEM}`, {})).status, 200);
  const [call] = await heard(1);
  assert.equal(call.path, '/sync/history'); assert.deepEqual(call.body.movies.map(({ids}) => ids), [{tmdb: 603, imdb: 'tt0133093'}]);
  assert.ok(Math.abs(Date.parse(call.body.movies[0].watched_at) - Date.now()) < 60_000); assert.equal(trakt.calls.length, 1);
});
test('a play left running by an app that went quiet is stopped on Trakt by the five-minute cron', async () => {
  // One film left at 85%, one at the very start; then half an hour without a report, as if the app was closed.
  trakt.calls = [];
  // (The first played for a few minutes up to there.)
  await say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 4900e7}, 300); await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0});
  await say('/Sessions/Playing/Progress', {ItemId: LEFT, PositionTicks: 5100e7, IsPaused: false}, 100); await heard(2); await pause(400);
  sql("UPDATE plays SET updated = updated - 3600 WHERE scrobbled IN ('playing', 'paused')");
  trakt.calls = [];
  await cron();
  // Only the film left at 85% is sent (Trakt records it as watched). The one left at the very start has nothing to keep, and the
  // episode whose stop Trakt already had (409) was done then, so neither is sent.
  assert.deepEqual(await heard(1), [{path: '/scrobble/stop', body: {movie: {ids: {tmdb: 550, imdb: 'tt0137523'}}, progress: 85}}]);
  await cron(); await pause(500); assert.equal(trakt.calls.length, 1);
});
test('a call Trakt turns away (429) is kept and goes through a few seconds later, after the app has its answer', async () => {
  trakt.calls = []; trakt.refused = []; trakt.refuse = 1;
  assert.equal((await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0})).status, 204);
  for (let i = 0; i < 100 && !trakt.calls.length; i++) await pause(100);
  assert.deepEqual(trakt.refused.map(call => call.path), ['/scrobble/start']); assert.deepEqual(trakt.calls.map(call => call.path), ['/scrobble/start']);
  await pause(300); assert.deepEqual(waiting(), []);
});
test('while Trakt keeps refusing, calls wait in order: a stop ends a waiting pause, a tick stays, a start gone stale is let go', async () => {
  trakt.calls = []; trakt.refused = []; trakt.refuse = 1000;
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true}); await pause(400);
  sql(`UPDATE sittings SET parts = '0-600' WHERE item = '${FILM}'`); // ten minutes played, so its stop counts (see brief in trakt.ts)
  await say('/Sessions/Playing/Stopped', {ItemId: FILM, PositionTicks: 5400e7}); await pause(400);
  await say(`/Users/${jf}/PlayedItems/${EP}`, {}); await pause(400);
  await say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 0});
  await pause(12_000); // the tries soon after, in the background, are over
  assert.deepEqual(waiting().map(row => row.kind), ['stop', 'mark', 'start']); assert.equal(trakt.calls.length, 0);
  assert.ok(trakt.refused.every(call => ['/scrobble/pause', '/scrobble/stop'].includes(call.path)), 'only the first in line is tried');
  // Trakt takes calls again an hour on. The finished film goes to history at the time it was stopped; the tick keeps its own
  // time; the start from an hour ago would be wrong by now, so it is let go.
  sql("UPDATE trakt_outbox SET next = 0, made = made - 3600"); trakt.refuse = 0;
  const ticked = JSON.parse(sql("SELECT body FROM trakt_outbox WHERE kind = 'mark'")[0].body);
  await cron(); const sent = await heard(2);
  assert.deepEqual(sent.map(call => call.path), ['/sync/history', '/sync/history']);
  assert.deepEqual(sent[0].body.movies.map(({ids}) => ids), [{tmdb: 27205, imdb: 'tt1375666'}]); assert.ok(Math.abs(Date.parse(sent[0].body.movies[0].watched_at) - (Date.now() - 3600_000)) < 120_000);
  assert.deepEqual(sent[1].body, ticked); assert.deepEqual(sent[1].body.shows[0].seasons, [{number: 1, episodes: [{number: 2, watched_at: ticked.shows[0].seasons[0].episodes[0].watched_at}]}]);
  assert.deepEqual(waiting(), []); await cron(); await pause(500); assert.equal(trakt.calls.length, 2);
});
test('told how long to wait on a write (429 with Retry-After), new calls are kept untried, in order, until the wait is over', async () => {
  trakt.calls = []; trakt.refused = []; trakt.refuse = 1; trakt.retryAfter = 200;
  const time = Math.floor(Date.now() / 1000), held = () => sql("SELECT at FROM rows_cache WHERE person = 'ada' AND kind = 'trakt-wait-send'");
  await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0});
  for (let i = 0; i < 100 && !trakt.refused.length; i++) await pause(100);
  assert.deepEqual(trakt.refused.map(call => call.path), ['/scrobble/start']);
  // The wait is kept by hub and person, apart from the one for reads, and her page can say until when.
  await pause(300); assert.equal(held().length, 1); assert.ok(held()[0].at > time + 150 && held()[0].at <= time + 215, JSON.stringify(held()));
  assert.deepEqual(sql("SELECT 1 AS n FROM rows_cache WHERE kind = 'trakt-wait'"), [], 'reads are not held up');
  assert.ok((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').matching.until > time + 150);
  // Trakt would take calls again, but it said to wait: what she does meanwhile is kept, not tried. A pause takes the place of the
  // waiting start of the same film, as it always did; a start of another film goes behind it.
  trakt.refuse = 0;
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true}); await pause(400);
  await say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 0});
  await pause(9000); // the tries soon after, in the background, are over
  await cron(); await pause(500);
  assert.deepEqual(waiting().map(row => row.kind), ['pause', 'start']); assert.deepEqual(trakt.calls, [], 'nothing reaches Trakt during the wait'); assert.equal(trakt.refused.length, 1, 'and nothing more is turned away');
  assert.ok(sql('SELECT next FROM trakt_outbox').every(row => row.next > time + 150), 'each is due when the wait is over');
  // The wait is over: they go through, in the order they came.
  resumed(); await cron(); const sent = await heard(2);
  assert.deepEqual(sent.map(call => call.path), ['/scrobble/pause', '/scrobble/start']); assert.deepEqual(waiting(), []);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').matching.until, undefined);
  // A refusal that says no time (Cloudflare's) starts no wait: tried again soon after, as before.
  trakt.retryAfter = 0; trakt.calls = []; trakt.refused = []; trakt.refuse = 1;
  await say('/Sessions/Playing/Progress', {ItemId: LEFT, PositionTicks: 300e7, IsPaused: true});
  for (let i = 0; i < 100 && !trakt.calls.length; i++) await pause(100);
  assert.deepEqual(trakt.refused.map(call => call.path), ['/scrobble/pause']); assert.deepEqual(trakt.calls.map(call => call.path), ['/scrobble/pause']); assert.deepEqual(held(), []);
  await pause(300); assert.deepEqual(waiting(), []);
});
test('a connection near its end is renewed once, and the new pair is kept', async () => {
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.deepEqual(trakt.revoked, [{token: 'trakt-access-1', client_id: 'local-trakt-client'}]);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').history, null);
  // Connected again with an hour left: the next calls renew it first, once, however many arrive together.
  // (A new connection starts with sync off, whatever it was before: she turns it on again.)
  trakt.expiresIn = 3600; await connect(); assert.equal((await matchingOf()).on, false); await syncOn(); trakt.calls = [];
  await Promise.all([say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0}), say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 0})]);
  await heard(2);
  assert.deepEqual(trakt.refreshed, [{refresh_token: 'trakt-refresh-2', client_id: 'local-trakt-client', redirect_uri: `${BASE}/api/trakt/callback`, grant_type: 'refresh_token'}]);
  assert.deepEqual(trakt.calls.map(call => call.path).sort(), ['/scrobble/start', '/scrobble/start']);
  // The renewed pair is what is used from then on, and it is not renewed again.
  trakt.calls = []; await say(`/Users/${jf}/PlayedItems/${LEFT}`, {}); await heard(1);
  assert.equal(trakt.calls[0].auth, 'trakt-access-3'); assert.equal(trakt.refreshed.length, 1);
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').history, {username: 'adatrakt', again: false});
});
// What the page lists as missing on either side (the day's look is shown even when nothing is).
const missing = drift => drift ? [...drift.toMdblist, ...drift.toTrakt] : [];
// What the day's look found for her, less what she left out, as the hub keeps it (it is no part of what a page loads any more:
// the cron copies it across by itself). Each play with the key she would leave it out by.
const lookOf = () => {
  const row = sql("SELECT result, skipped, at FROM drift WHERE person = 'ada'")[0]; if (!row?.result) return null;
  const found = JSON.parse(row.result), skip = new Set(JSON.parse(row.skipped ?? '[]')), keyOf = miss => `${miss.kind}/${miss.tmdb}${miss.season == null ? '' : `:${miss.season}:${miss.episode}`}@${miss.at}`;
  const keep = list => list.filter(miss => !skip.has(keyOf(miss))).map(miss => ({...miss, key: keyOf(miss)}));
  return {checked: row.at, toMdblist: keep(found.toMdblist), toTrakt: keep(found.toTrakt)};
};
test('once a day her Trakt and MDBList are compared over two weeks, a few steps a run, only with her Trakt sync on; what differs is hers alone and goes across by itself', async () => {
  const T = {e3: ago(1), inception: ago(2), e2: ago(3), e1: ago(3.1), pulp: ago(4), fight: ago(5), gump: ago(6), knight: ago(7), old: ago(20)}, plus = (time, hours) => new Date(Date.parse(time) + hours * 3600e3).toISOString();
  trakt.history = [{watched_at: T.inception, type: 'movie', movie: MOVIE.inception}, {watched_at: T.e2, type: 'episode', episode: {season: 1, number: 2}, show: BB}, {watched_at: T.e1, type: 'episode', episode: {season: 1, number: 1}, show: BB},
    {watched_at: T.fight, type: 'movie', movie: MOVIE.fight}, {watched_at: T.gump, type: 'movie', movie: MOVIE.gump}, {watched_at: T.knight, type: 'movie', movie: MOVIE.knight}, {watched_at: T.old, type: 'movie', movie: MOVIE.pulp}];
  // MDBList noted the same first episode ten minutes later and Fight Club three hours later (the same viewings), has an episode and
  // a film Trakt lacks, and lacks Inception and the second episode. A play from three weeks ago is outside the window.
  lists.plays = {'show/1396': [{season_num: 1, episode_num: 1, watched_at: plus(T.e1, 1 / 6)}, {season_num: 1, episode_num: 3, watched_at: T.e3}, {season_num: 1, episode_num: 1, watched_at: T.old}],
    'movie/550': [{watched_at: plus(T.fight, 3)}], 'movie/680': [{watched_at: T.pulp}], 'movie/13': [{watched_at: T.gump}], 'movie/155': [{watched_at: T.knight}]};
  lists.recent = {movies: [MOVIE.fight, MOVIE.pulp, MOVIE.gump, MOVIE.knight].map(movie => ({last_watched_at: T.fight, movie})), shows: [], episodes: [{last_watched_at: T.e3, episode: {season: 1, number: 3, show: BB}}]};
  assert.deepEqual(waiting(), []); trakt.calls = []; const posted = fake.watched.length;
  // Before four in the morning (UTC) nothing is looked at.
  await cron(); assert.deepEqual(sql('SELECT * FROM drift'), []);
  // (What she watched here and MDBList lacks is sent by a daily step of its own, tested next: counted as done here, so this test is
  // only the look.)
  sql("INSERT INTO drift (hub, person, day, lists_day) SELECT id, 'ada', '', '9999-12-31' FROM hubs");
  const day = Date.UTC(2026, 5, 1, 4, 5);
  // With her Trakt sync off the day's look does not run at all: neither Trakt nor MDBList is asked, and nothing is kept.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); trakt.reads = []; lists.reads = [];
  await cron(day); await cron(day + 60e3);
  assert.deepEqual(sql('SELECT day, work, result FROM drift'), [{day: '', work: null, result: null}]); assert.deepEqual(trakt.reads, []); assert.deepEqual(lists.reads, []);
  // On again, with her earlier plays ticked (below, what MDBList has from before sync was turned on may go to Trakt too).
  await syncOn(true);
  // The day's look: six titles to ask MDBList about, so it takes two runs.
  await cron(day); assert.equal(sql('SELECT work IS NOT NULL AS busy FROM drift')[0].busy, 1);
  await cron(day + 300e3); assert.deepEqual(sql('SELECT day, work FROM drift'), [{day: '2026-06-01', work: null}]);
  assert.equal(trakt.reads.filter(read => read.where === '/sync/history').length, 1, 'Trakt is read once for the look');
  assert.match(trakt.reads.find(read => read.where === '/sync/history').query, /start_at=.*end_at=.*page=1&limit=100/);
  // Looking wrote nothing anywhere.
  assert.deepEqual(trakt.calls, []); assert.equal(fake.watched.length, posted);
  const mine = lookOf(), line = miss => [miss.name, miss.season ?? null, miss.episode ?? null, new Date(miss.at * 1000).toISOString()];
  assert.deepEqual(mine.toMdblist.map(line), [['Inception', null, null, T.inception], ['Breaking Bad', 1, 2, T.e2]]);
  assert.deepEqual(mine.toTrakt.map(line), [['Breaking Bad', 1, 3, T.e3], ['Pulp Fiction', null, null, T.pulp]]);
  assert.ok(mine.checked > 0, 'when it was checked');
  // It is hers: no page is given any of it (hers or her manager's), and the manager cannot touch it.
  assert.ok(!('drift' in (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada'))); assert.ok(!('drift' in (await adaSite('GET', '/api/state')).body.hub.people[0]));
  assert.equal((await owner('POST', '/api/people/ada/drift', {})).status, 403);
  // A play she says is not right is left out, now and in later looks, and is never copied.
  const pulp = mine.toTrakt.find(miss => miss.name === 'Pulp Fiction');
  assert.equal((await owner('POST', '/api/people/ada/drift', {skip: pulp.key})).status, 403);
  assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: pulp.key})).status, 200);
  assert.deepEqual(lookOf().toTrakt.map(line), [['Breaking Bad', 1, 3, T.e3]]);
  // What she watched here before (some of it before sync was on) would go to Trakt too; here she leaves it out, so what goes
  // below is only the day's look. (Copying watched-here plays is tested on its own, further down.)
  const here = (await adaSite('GET', '/api/people/ada/carry')).body;
  assert.ok(here.trakt && here.lists && here.watched.some(entry => entry.trakt === 'add'), JSON.stringify(here));
  for (const entry of [...here.watched, ...here.partway]) assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: entry.key})).status, 200);
  // Nothing is copied from her page any more (a press there only ever leaves plays out): the next run does it by itself.
  assert.deepEqual((await adaSite('POST', '/api/people/ada/drift', {})).body, {}); await pause(300); assert.deepEqual(trakt.calls, []); assert.equal(fake.watched.length, posted);
  // The next run copies exactly the missing plays across, each with its own date, once.
  await cron(day + 600e3); await heard(1);
  assert.deepEqual(trakt.calls.map(({path, body}) => ({path, body})), [{path: '/sync/history', body: {shows: [{ids: {tmdb: 1396, imdb: 'tt0903747'}, seasons: [{number: 1, episodes: [{number: 3, watched_at: T.e3}]}]}]}}]);
  assert.deepEqual(fake.watched.slice(posted), [{movies: [{ids: {tmdb: 27205, imdb: 'tt1375666'}, watched_at: T.inception}], shows: [{ids: {tmdb: 1396, imdb: 'tt0903747'}, seasons: [{number: 1, episodes: [{number: 2, watched_at: T.e2}]}]}]}]);
  assert.deepEqual(missing(lookOf()), []);
  // The next day both have everything but the play she skipped, which stays out: nothing is shown.
  trakt.history.unshift({watched_at: T.e3, type: 'episode', episode: {season: 1, number: 3}, show: BB});
  lists.plays['movie/27205'] = [{watched_at: T.inception}]; lists.plays['show/1396'].push({season_num: 1, episode_num: 2, watched_at: T.e2}); trakt.calls = [];
  await cron(day + DAY * 1e3); await cron(day + DAY * 1e3 + 300e3);
  assert.deepEqual(sql('SELECT day, work IS NULL AS done FROM drift'), [{day: '2026-06-02', done: 1}]);
  assert.deepEqual(missing(lookOf()), []); assert.deepEqual(trakt.calls, []);
  // A day MDBList does not answer: no differences are made up from it, and the look is tried again on the next run.
  lists.refuse = true; await cron(day + 2 * DAY * 1e3);
  assert.deepEqual(sql('SELECT day, json_extract(work, \'$.tries\') AS tries FROM drift'), [{day: '2026-06-03', tries: 1}]);
  assert.deepEqual(missing(lookOf()), []);
  lists.refuse = false; await cron(day + 2 * DAY * 1e3 + 300e3); await cron(day + 2 * DAY * 1e3 + 600e3);
  assert.equal(sql('SELECT work FROM drift')[0].work, null); assert.deepEqual(missing(lookOf()), []);
});
test('once a day what she watched here and her MDBList lacks is sent by itself: once, with its name kept, never what she left out, and only after she played something', async () => {
  // A film her server holds as watched, played through the hub an hour ago, which MDBList never heard of. Everything else she
  // watched here she left out in the test above.
  const JAWS = pack('movie', 'tt0073195'), left = () => sql("SELECT lists_day, lists_at FROM drift WHERE person = 'ada'")[0], sent = from => fake.watched.slice(from).flatMap(body => body.movies ?? []).map(movie => movie.ids.tmdb);
  HELD[JAWS] = {Id: JAWS, Type: 'Movie', Name: 'Jaws', ProviderIds: {Tmdb: '578', Imdb: 'tt0073195'}, RunTimeTicks: 6000e7, UserData: {Played: true, LastPlayedDate: ago(0.04)}};
  sql(`INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', '${JAWS}', 'Jaws', 'Movie', 6000, 6000, 'Strand · Mac', 0, unixepoch() - 3600, '' FROM hubs`);
  sql("UPDATE drift SET lists_day = NULL WHERE person = 'ada'"); assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].lists, true);
  const day = Date.UTC(2026, 5, 10, 4, 5), posted = fake.watched.length, pauses = fake.pauses.length;
  // Before four in the morning (UTC) nothing is sent. From then, a run the other steps leave alone looks, and sends it.
  await cron(Date.UTC(2026, 5, 10, 3)); assert.equal(fake.watched.length, posted); assert.equal(left().lists_day, null);
  // (Runs a minute apart here, to stay before five, when the day's For you picking starts.)
  for (let run = 0; run < 12 && !left().lists_at; run++) await cron(day + run * 60e3);
  assert.equal(left().lists_day, '2026-06-10'); assert.ok(left().lists_at > 0, 'a whole look');
  assert.deepEqual(sent(posted), [578]); assert.equal(fake.pauses.length, pauses, 'nothing she left out');
  assert.equal(fake.watched.at(-1).movies[0].watched_at, HELD[JAWS].UserData.LastPlayedDate, 'with the date she watched it');
  // Kept with its name, for What was synced on her own page (never the manager's), and counted in Background work.
  const did = (await adaSite('GET', '/api/people/ada/matching/synced')).body.synced.find(item => item.title === 'Jaws');
  assert.deepEqual({...did, at: 0}, {title: 'Jaws', detail: 'Movie', to: 'mdblist', spot: false, at: 0}); assert.equal((await owner('GET', '/api/people/ada/matching/synced')).status, 403);
  const jobs = (await owner('GET', '/api/state')).body.hub.jobs; assert.equal(jobs.listers, 1); assert.ok(jobs.listed > 0);
  // The same day it is not looked at again; the next day, with nothing played since, neither her server nor MDBList is asked.
  const signIns = fake.signIns; await cron(day + 40 * 60e3); assert.equal(fake.signIns, signIns);
  sql("UPDATE plays SET updated = updated - 3 * 86400 WHERE person = 'ada'");
  for (let run = 0; run < 6; run++) await cron(day + DAY * 1e3 + run * 60e3);
  assert.equal(left().lists_day, '2026-06-11'); assert.equal(fake.signIns, signIns, 'nothing played since'); assert.deepEqual(sent(posted), [578]);
  // She deletes it from her MDBList and watches something else here: the look runs, and Jaws stays deleted (sent once).
  sql(`UPDATE plays SET updated = unixepoch() WHERE person = 'ada' AND item = '${JAWS}'`);
  for (let run = 0; run < 6 && left().lists_day !== '2026-06-12'; run++) await cron(day + 2 * DAY * 1e3 + run * 60e3);
  assert.equal(left().lists_day, '2026-06-12'); assert.ok(fake.signIns > signIns, 'looked'); assert.deepEqual(sent(posted), [578]);
  // MDBList not answering: quietly tried again the next day, and nothing is made up.
  sql(`UPDATE plays SET updated = unixepoch() WHERE person = 'ada' AND item = '${JAWS}'; DELETE FROM sent WHERE person = 'ada' AND play = 'w:movie/578'; UPDATE drift SET day = '2026-06-13', work = NULL WHERE person = 'ada'`); lists.refuse = true;
  const at = left().lists_at; for (let run = 0; run < 6 && left().lists_day !== '2026-06-13'; run++) await cron(day + 3 * DAY * 1e3 + run * 60e3);
  lists.refuse = false; assert.equal(left().lists_day, '2026-06-13'); assert.equal(left().lists_at, at); assert.deepEqual(sent(posted), [578]);
  // Jaws is taken away again, for the tests after.
  sql(`DELETE FROM plays WHERE person = 'ada' AND item = '${JAWS}'; DELETE FROM sent WHERE person = 'ada' AND play = 'w:movie/578'; UPDATE drift SET work = NULL WHERE person = 'ada'; UPDATE plays SET updated = updated + 3 * 86400 WHERE person = 'ada'`);
});
test('the rows address answers with IMDb ids from her Trakt, page by page, renewing the connection when Trakt refuses it', async () => {
  const get = async url => {const answer = await fetch(url); return {status: answer.status, body: await answer.json().catch(() => null)};};
  const address = served[0].sourceUrl.split('/catalog/')[0];
  const manifest = (await get(`${address}/manifest.json`)).body;
  assert.deepEqual(manifest.resources, ['catalog']);
  assert.deepEqual(manifest.catalogs.map(item => `${item.type}/${item.id}`), ['all/watchlist', 'all/history', 'movie/recommended', 'series/recommended', 'series/up_next', 'all/upnext_new']);
  // Trakt no longer takes the access token it has: the first read renews the connection once, then carries on.
  const renewed = trakt.refreshed.length; trakt.valid.clear(); trakt.reads = [];
  const list = await get(served[0].sourceUrl);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.metas, [{id: 'tt0133093', type: 'movie', name: 'Meta Movie'}, {id: 'tt0944947', type: 'series', name: 'Meta Show'}, {id: 'tmdb:550', type: 'movie', name: 'Fight Club'}]);
  assert.equal(trakt.refreshed.length, renewed + 1); assert.equal(trakt.reads.at(-1).auth, `trakt-access-${trakt.issued}`);
  // Recommendations leave out what is on the watchlist or collected, and come twenty at a time, the way AIOMetadata pages.
  const films = served.find(item => item.id === 'custom.aiohub_rows.movie.recommended').sourceUrl;
  const first = (await get(films)).body.metas, last = (await get(films.replace(/\.json$/, '/skip=40.json'))).body.metas, past = (await get(films.replace(/\.json$/, '/skip=60.json'))).body.metas;
  assert.equal(first.length, 20); assert.deepEqual(first[0], {id: 'tt9000001', type: 'movie', name: 'Film 1'}); assert.deepEqual(last.map(item => item.id), ['tt9000041', 'tt9000042', 'tt9000043', 'tt9000044', 'tt9000045']); assert.deepEqual(past, []);
  const asked = trakt.reads.filter(read => read.where === '/recommendations/movies');
  assert.equal(asked.length, 1, 'later pages come from what was just read'); assert.match(asked[0].query, /ignore_collected=true/); assert.match(asked[0].query, /ignore_watchlisted=true/);
  const next = (await get(served.find(item => item.id === 'custom.aiohub_rows.series.up_next').sourceUrl)).body.metas;
  assert.deepEqual(next, [{id: 'tt0903747', type: 'series', name: 'Breaking Bad'}]);
  assert.match(trakt.reads.filter(read => read.where === '/sync/progress/up_next')[0].query ?? '', /limit=50/);
  // New for you: new episodes of her shows and films on her watchlist now out to watch at home, newest first, a show once by its
  // newest episode. Never a special, anything still to come, a show she dropped or hid from her progress on Trakt, or a title Trakt
  // has as watched. The first time, three calendars back (Trakt gives about a month at a time), her latest plays and what she hid.
  const FARGO = {title: 'Fargo', ids: {imdb: 'tt2802850', tmdb: 60622}}, LOST = {title: 'Lost', ids: {imdb: 'tt0411008', tmdb: 4607}}, DEXTER = {title: 'Dexter', ids: {imdb: 'tt0773262', tmdb: 1405}}, date = days => ago(days).slice(0, 10);
  trakt.calendar = {shows: [{first_aired: ago(9), episode: {season: 5, number: 2}, show: BB}, {first_aired: ago(2), episode: {season: 5, number: 3}, show: BB}, {first_aired: ago(40), episode: {season: 2, number: 1}, show: FARGO},
    {first_aired: ago(3), episode: {season: 0, number: 7}, show: {title: 'A special', ids: {imdb: 'tt7000001', tmdb: 70001}}}, {first_aired: ago(-0.5), episode: {season: 9, number: 1}, show: {title: 'Not out yet', ids: {imdb: 'tt7000002', tmdb: 70002}}},
    {first_aired: ago(6), episode: {season: 6, number: 1}, show: LOST}, {first_aired: ago(7), episode: {season: 8, number: 1}, show: DEXTER}],
    dvd: [{released: date(4), movie: MOVIE.heat}, {released: date(70), movie: MOVIE.gump}, {released: date(20), movie: MOVIE.pulp}, {released: date(-1), movie: MOVIE.knight}]};
  // Pulp Fiction she watched on Trakt soon after it came out, with over a hundred plays since: her plays are read as far back as the calendars.
  trakt.hidden = {progress_watched: [{type: 'show', show: DEXTER}], dropped: [{type: 'show', show: LOST}]};
  trakt.history = [...Array.from({length: 120}, (_, n) => ({watched_at: ago(1 + n / 100), type: 'movie', movie: film(500 + n)})), {watched_at: ago(19), type: 'movie', movie: MOVIE.pulp}];
  const fresh = served.find(item => item.id === 'custom.aiohub_rows.all.upnext_new').sourceUrl, newOf = async (url = fresh) => (await get(url)).body.metas.map(item => item.name);
  const later = () => sql("UPDATE rows_cache SET at = at - 3600 WHERE person = 'ada' AND kind = 'new'");
  // Trakt turning the hub away the first time: nothing yet, and the next look still reads all three calendars.
  trakt.refuseReads = true; assert.deepEqual(await newOf(), []); trakt.refuseReads = false; waited(); later(); trakt.reads = [];
  assert.deepEqual((await get(fresh)).body.metas, [{id: 'tt0903747', type: 'series', name: 'Breaking Bad'}, {id: 'tt0113277', type: 'movie', name: 'Heat'}, {id: 'tt2802850', type: 'series', name: 'Fargo'}, {id: 'tt0109830', type: 'movie', name: 'Forrest Gump'}]);
  assert.deepEqual(trakt.reads.map(read => read.where), ['/calendars/my/shows', '/calendars/my/dvd', '/calendars/my/shows', '/calendars/my/dvd', '/calendars/my/shows', '/calendars/my/dvd', '/sync/history', '/sync/history', '/users/hidden/progress_watched', '/users/hidden/dropped']);
  assert.ok(trakt.reads.slice(0, 6).every(read => /^\d{4}-\d\d-\d\d\/33$/.test(read.query)), 'a calendar is asked for 33 days at a time'); assert.equal(new Set(trakt.reads.slice(0, 6).map(read => read.query)).size, 3);
  // Asked again within minutes, nothing is read. Her address from before, for Recently Aired, still answers: the shows.
  trakt.reads = []; assert.deepEqual(await newOf(), ['Breaking Bad', 'Heat', 'Fargo', 'Forrest Gump']); assert.deepEqual(await newOf(`${address}/catalog/series/recently_aired.json`), ['Breaking Bad', 'Fargo']); assert.deepEqual(trakt.reads, []);
  // A title leaves once she started it here, at once and with nothing asked of Trakt: two minutes or more of it played, not less.
  const hubIs = sql('SELECT id FROM hubs')[0].id, heat = pack('movie', 'tt0113277'), played = (item, title, detail, parts) => sql(`INSERT INTO plays (hub, person, item, title, detail, parts, updated) VALUES ('${hubIs}', 'ada', '${item}', '${title}', '${detail}', '${parts}', unixepoch()) ON CONFLICT (hub, person, item) DO UPDATE SET parts = excluded.parts`);
  played(heat, 'Heat', 'Movie', '0-90'); assert.deepEqual(await newOf(), ['Breaking Bad', 'Heat', 'Fargo', 'Forrest Gump']);
  played(heat, 'Heat', 'Movie', '0-90 300-340'); assert.deepEqual(await newOf(), ['Breaking Bad', 'Fargo', 'Forrest Gump']);
  // A show leaves once its newest episode is started, not an earlier one.
  played(pack('episode', 'tt0903747', 5, 2), 'Breaking Bad', 'Season 5 · Episode 2', '0-900'); assert.deepEqual(await newOf(), ['Breaking Bad', 'Fargo', 'Forrest Gump']);
  played(pack('episode', 'tt0903747', 5, 3), 'Breaking Bad', 'Season 5 · Episode 3', '0-900'); assert.deepEqual(await newOf(), ['Fargo', 'Forrest Gump']); assert.deepEqual(trakt.reads, []);
  sql(`DELETE FROM plays WHERE person = 'ada' AND item IN ('${heat}', '${pack('episode', 'tt0903747', 5, 2)}', '${pack('episode', 'tt0903747', 5, 3)}')`);
  // Later it is read again: the latest calendar only, and her latest plays (what she hid is kept a day). Trakt has an earlier
  // episode as watched, so the show stays. Pulp Fiction, which left as watched, stays away though her latest plays no longer say so.
  trakt.history = [{watched_at: ago(0.5), type: 'episode', episode: {season: 5, number: 2}, show: BB}]; later();
  assert.deepEqual(await newOf(), ['Breaking Bad', 'Heat', 'Fargo', 'Forrest Gump']); assert.deepEqual(trakt.reads.map(read => read.where), ['/calendars/my/shows', '/calendars/my/dvd', '/sync/history']);
  // The newest episode watched on Trakt: the show leaves. A newer one out brings it back. Fargo and Forrest Gump, out longer ago
  // than the calendar read now reaches, stay until she starts them.
  trakt.history = [{watched_at: ago(0.2), type: 'episode', episode: {season: 5, number: 3}, show: BB}]; later(); assert.deepEqual(await newOf(), ['Heat', 'Fargo', 'Forrest Gump']);
  trakt.calendar.shows.push({first_aired: ago(0.1), episode: {season: 5, number: 4}, show: BB}); later(); assert.deepEqual(await newOf(), ['Breaking Bad', 'Heat', 'Fargo', 'Forrest Gump']);
  // While Trakt turns the hub away: the list as it was.
  later(); trakt.refuseReads = true; assert.deepEqual(await newOf(), ['Breaking Bad', 'Heat', 'Fargo', 'Forrest Gump']); trakt.refuseReads = false; waited(); trakt.history = [];
  // Kept by hub and person, with what left: never under a bare name.
  assert.deepEqual(sql("SELECT person, kind FROM rows_cache WHERE kind IN ('new', 'hidden') ORDER BY kind"), [{person: 'ada', kind: 'hidden'}, {person: 'ada', kind: 'new'}]);
  // Asked again within minutes, Trakt is not asked again.
  const reads = trakt.reads.length; await get(served[0].sourceUrl); assert.equal(trakt.reads.length, reads);
  // Later, while Trakt turns the hub away: the last list it gave, and Trakt is not asked again on every page.
  sql('UPDATE rows_cache SET at = at - 3600'); trakt.refuseReads = true;
  assert.deepEqual((await get(served[0].sourceUrl)).body.metas.map(item => item.id), ['tt0133093', 'tt0944947', 'tmdb:550']); assert.equal(trakt.reads.length, reads + 1);
  assert.equal((await get(served[0].sourceUrl)).body.metas.length, 3); assert.equal(trakt.reads.length, reads + 1);
  trakt.refuseReads = false; waited();
  // Recently Watched: newest first, films and shows together, a show once however many of its episodes were watched.
  trakt.history = [{watched_at: ago(1), type: 'episode', episode: {season: 1, number: 3}, show: BB}, {watched_at: ago(2), type: 'movie', movie: MOVIE.inception},
    {watched_at: ago(3), type: 'episode', episode: {season: 1, number: 2}, show: BB}, {watched_at: ago(5), type: 'movie', movie: MOVIE.fight}];
  const watched = served.find(item => item.id === 'custom.aiohub_rows.all.history').sourceUrl;
  assert.deepEqual((await get(watched)).body.metas, [{id: 'tt0903747', type: 'series', name: 'Breaking Bad'}, {id: 'tt1375666', type: 'movie', name: 'Inception'}, {id: 'tt0137523', type: 'movie', name: 'Fight Club'}]);
  // A long watchlist: a further page of a hundred is read only when someone scrolls that far, and never past Trakt's last.
  trakt.watchlist = Array.from({length: 230}, (_, n) => ({type: 'movie', movie: film(n + 100)})); sql("DELETE FROM rows_cache WHERE kind LIKE 'watchlist%'");
  const pages = () => trakt.reads.filter(read => read.where === '/sync/watchlist/all/added/desc').map(read => new URLSearchParams(read.query).get('page')), at20 = skip => get(served[0].sourceUrl.replace(/\.json$/, `/skip=${skip}.json`)).then(got => got.body.metas.map(item => item.id));
  trakt.reads = [];
  assert.deepEqual((await get(served[0].sourceUrl)).body.metas.length, 20); assert.deepEqual(pages(), ['1']);
  assert.deepEqual(await at20(80), Array.from({length: 20}, (_, n) => `tt${9000180 + n}`)); assert.deepEqual(pages(), ['1']);
  assert.deepEqual(await at20(100), Array.from({length: 20}, (_, n) => `tt${9000200 + n}`)); assert.deepEqual(pages(), ['1', '2']);
  assert.deepEqual(await at20(220), Array.from({length: 10}, (_, n) => `tt${9000320 + n}`)); assert.deepEqual(pages(), ['1', '2', '3']);
  assert.deepEqual(await at20(240), []); assert.deepEqual(await at20(400), []); assert.deepEqual(pages(), ['1', '2', '3']);
  trakt.watchlist = null; sql("DELETE FROM rows_cache WHERE kind LIKE 'watchlist%'");
  // One Watchlist from both: her Trakt's and her MDBList's as one list, newest added first. A title on both is there once, as
  // Trakt has it and where Trakt puts it (MDBList knows this one only by its TMDB id, and says it was added later).
  const both = async () => {sql("DELETE FROM rows_cache WHERE kind LIKE '%watchlist%'"); return (await get(served[0].sourceUrl)).body.metas.map(item => item.id);};
  trakt.watchlist = [{type: 'movie', listed_at: ago(1), movie: MOVIE.inception}, {type: 'show', listed_at: ago(5), show: BB}, {type: 'movie', listed_at: ago(9), movie: MOVIE.pulp}];
  lists.watchlist = [{id: 1396, mediatype: 'show', imdb_id: null, title: 'Breaking Bad', ids: {imdb: null, tmdb: 1396}, watchlist_at: ago(2)}, {id: 13, mediatype: 'movie', imdb_id: 'tt0109830', title: 'Forrest Gump', watchlist_at: ago(7)}];
  assert.deepEqual(await both(), ['tt1375666', 'tt0903747', 'tt0109830', 'tt0110912']);
  // A title only MDBList has, added there after everything on Trakt, leads. Titles MDBList stamped with one shared moment (a
  // watchlist copied over in one go: more than five alike) say nothing of when each was added, however late the stamp: they
  // come last, in MDBList's own order, and the one of them Trakt has too stays where Trakt puts it.
  const stamp = ago(0.2), copied = n => ({id: 9100 + n, mediatype: 'movie', imdb_id: `tt${9100000 + n}`, title: `Copied ${n}`, watchlist_at: stamp}), earlier = lists.watchlist;
  lists.watchlist = [{id: 680, mediatype: 'movie', imdb_id: 'tt0110912', title: 'Pulp Fiction', watchlist_at: stamp}, ...[1, 2, 3, 4, 5].map(copied), {id: 949, mediatype: 'movie', imdb_id: 'tt0113277', title: 'Heat', watchlist_at: ago(0.5)}, ...earlier];
  assert.deepEqual(await both(), ['tt0113277', 'tt1375666', 'tt0903747', 'tt0109830', 'tt0110912', 'tt9100001', 'tt9100002', 'tt9100003', 'tt9100004', 'tt9100005']);
  // Five alike are a handful, not a copy: placed by their date like any other.
  lists.watchlist = lists.watchlist.filter(item => item.id !== 680);
  assert.deepEqual((await both()).slice(0, 7), ['tt9100001', 'tt9100002', 'tt9100003', 'tt9100004', 'tt9100005', 'tt0113277', 'tt1375666']);
  lists.watchlist = earlier;
  // Where MDBList does not say when a title was added, each list keeps its own order and they take turns.
  lists.watchlist = [lists.watchlist[1], lists.watchlist[0]].map(({watchlist_at: _, ...item}) => item);
  assert.deepEqual(await both(), ['tt1375666', 'tt0109830', 'tt0903747', 'tt0110912']);
  // Only one of them holding anything: that one, as it is.
  trakt.watchlist = []; assert.deepEqual(await both(), ['tt0109830', 'tmdb:1396']);
  trakt.watchlist = null; lists.watchlist = []; sql("DELETE FROM rows_cache WHERE kind LIKE '%watchlist%'");
  // Without the token, or with a made-up one, there is nothing here.
  assert.equal((await get(`${BASE}/api/rows/rnotarealtokenatallnotreal/manifest.json`)).status, 404);
  assert.equal((await get(`${address}/catalog/movie/nothing.json`)).status, 404);
  // Disconnected from the hub with no other Trakt: the rows only Trakt fills leave her Home on the next sync, and the address
  // answers with nothing of Trakt's. The Watchlist stays for her MDBList, and Recommended for what she watched.
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.ok(!rowsOf(playerOf('Ada')[1].config).some(([id]) => /\.(up_next|upnext_new)$/.test(id)), 'no Trakt rows left'); assert.deepEqual((await get(fresh)).body, {metas: []});
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').trakt, false);
  assert.deepEqual((await get(served[0].sourceUrl)).body, {metas: []});
});
test('Recently Watched follows each person’s accounts (Trakt, else MDBList, else what they played here), and nobody sees anyone else’s', async () => {
  const get = async url => {const answer = await fetch(url); return {status: answer.status, body: await answer.json().catch(() => null)};};
  const urlOf = (name, id) => playerOf(name)[1].config.catalogs.find(item => item.id === id).sourceUrl, hubId = sql('SELECT id FROM hubs')[0].id;
  // Trakt gone, her MDBList key still there: the Watchlist is her MDBList's now, at the same address; Recommended stays (worked
  // out from what she watched, further down); Recently Watched keeps its address.
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config), [['custom.aiohub_rows.all.watchlist', 'all', 'Watchlist', true], ['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true],
    ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', false]]);
  assert.equal(urlOf('Ada', 'custom.aiohub_rows.all.watchlist'), served[0].sourceUrl);
  // A Home of her own made before she had any account, so with no Watchlist on it: the Watchlist comes first, on.
  const plain = (await owner('GET', '/api/state')).body.hub, self = plain.people.find(person => person.id === 'ada');
  assert.equal((await owner('PUT', '/api/people/ada', {...self, rows: plain.rows})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config)[0], ['custom.aiohub_rows.all.watchlist', 'all', 'Watchlist', true]); assert.equal(playerOf('Ada')[1].config.catalogs[0].id, 'custom.aiohub_rows.all.watchlist');
  assert.equal((await owner('PUT', '/api/people/ada', {...self, rows: null, v: (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').v})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  const adaWatched = urlOf('Ada', 'custom.aiohub_rows.all.history');
  assert.equal(adaWatched, served.find(item => item.id === 'custom.aiohub_rows.all.history').sourceUrl);
  // From her MDBList: films and shows together, newest first, a show once however many of its episodes she watched.
  lists.recent = {movies: [{last_watched_at: ago(3), movie: MOVIE.pulp}, {last_watched_at: ago(1), movie: MOVIE.gump}], shows: [], episodes: [{last_watched_at: ago(2), episode: {season: 1, number: 4, show: BB}}, {last_watched_at: ago(4), episode: {season: 1, number: 3, show: BB}}]};
  lists.reads = [];
  const fromLists = [{id: 'tt0109830', type: 'movie', name: 'Forrest Gump'}, {id: 'tt0903747', type: 'series', name: 'Breaking Bad'}, {id: 'tt0110912', type: 'movie', name: 'Pulp Fiction'}];
  assert.deepEqual((await get(adaWatched)).body.metas, fromLists);
  // Kept like Trakt's rows: asked again within minutes, MDBList is not asked again.
  assert.deepEqual((await get(adaWatched)).body.metas, fromLists); assert.deepEqual(lists.reads, ['/mdblist/sync/watched']);
  // Her MDBList watchlist, newest added first: IMDb ids where MDBList has them, else TMDB.
  lists.watchlist = [{id: 27205, mediatype: 'movie', imdb_id: 'tt1375666', title: 'Inception', ids: {imdb: 'tt1375666', tmdb: 27205}}, {id: 1396, mediatype: 'show', imdb_id: 'tt0903747', title: 'Breaking Bad'}, {id: 550, mediatype: 'movie', imdb_id: null, title: 'Fight Club', ids: {imdb: null, tmdb: 550}}];
  const theirList = urlOf('Ada', 'custom.aiohub_rows.all.watchlist'); sql("DELETE FROM rows_cache WHERE kind LIKE 'mdb_watchlist%'"); lists.reads = [];
  // The address her setup had for it before still answers, until the setup is next brought in step.
  assert.equal((await get(theirList.replace('/all/watchlist.json', '/all/mdblist_watchlist.json'))).body.metas.length, 3); assert.deepEqual(lists.reads, ['/watchlist/items@0']); lists.reads = [];
  assert.deepEqual((await get(theirList)).body.metas, [{id: 'tt1375666', type: 'movie', name: 'Inception'}, {id: 'tt0903747', type: 'series', name: 'Breaking Bad'}, {id: 'tmdb:550', type: 'movie', name: 'Fight Club'}]);
  // A long one is read a hundred at a time, a further page only once someone scrolls that far, and never past its end.
  lists.watchlist = Array.from({length: 150}, (_, n) => ({id: 9000 + n, mediatype: 'movie', imdb_id: `tt${9000000 + n}`, title: `Film ${n}`})); sql("DELETE FROM rows_cache WHERE kind LIKE 'mdb_watchlist%'"); lists.reads = [];
  const at20 = skip => get(theirList.replace(/\.json$/, `/skip=${skip}.json`)).then(got => got.body.metas.map(item => item.id));
  assert.equal((await get(theirList)).body.metas.length, 20); assert.deepEqual(lists.reads, ['/watchlist/items@0']);
  assert.deepEqual(await at20(100), Array.from({length: 20}, (_, n) => `tt${9000100 + n}`)); assert.deepEqual(lists.reads, ['/watchlist/items@0', '/watchlist/items@100']);
  assert.equal((await at20(140)).length, 10); assert.deepEqual(await at20(160), []); assert.equal(lists.reads.length, 2);
  assert.deepEqual(sql("SELECT person, kind FROM rows_cache WHERE kind LIKE 'mdb%' ORDER BY kind"), [{person: 'ada', kind: 'mdb_history'}, {person: 'ada', kind: 'mdb_watchlist'}, {person: 'ada', kind: 'mdb_watchlist.2'}, {person: 'ada', kind: 'mdb_watchlist.3'}], 'each page kept on its own, and the end after the last');
  // Ben has neither. His first play here puts Recently Watched and the Recommended rows on his Home by itself, without anyone opening the site.
  assert.deepEqual(rowsOf(playerOf('Ben')[1].config), []);
  const bensSignin = (await owner('GET', '/api/people/ben/signin')).body, bensApp = JSON.parse((await raw('/Users/AuthenticateByName', '', {method: 'POST', body: JSON.stringify({Username: 'Ben', Pw: bensSignin.password})})).text);
  assert.equal((await raw('/Sessions/Playing', bensApp.AccessToken, {method: 'POST', body: JSON.stringify({ItemId: ITEM, PositionTicks: 0})})).status, 204);
  for (let n = 0; n < 50 && !rowsOf(playerOf('Ben')[1].config).length; n++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(rowsOf(playerOf('Ben')[1].config), [['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true], ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', true]]);
  const benWatched = urlOf('Ben', 'custom.aiohub_rows.all.history');
  assert.notEqual(benWatched, adaWatched);
  sql("DELETE FROM plays WHERE person = 'ben'");
  // What he played here, newest first, a show once, known by its id on his own server. An id it can't place is left out.
  sql(`INSERT INTO plays (hub, person, item, title, detail, updated) VALUES ('${hubId}', 'ben', '${pack('movie', 'tt0114709')}', 'Toy Story', 'Movie', 100), ('${hubId}', 'ben', '${pack('episode', 'tt0944947', 1, 2)}', 'Meta Show', 'Season 1 · Episode 2', 300),
    ('${hubId}', 'ben', '${pack('episode', 'tt0944947', 1, 1)}', 'Meta Show', 'Season 1 · Episode 1', 200), ('${hubId}', 'ben', 'not-a-title-id', 'Unknown', 'Movie', 400)`);
  const bens = [{id: 'tt0944947', type: 'series', name: 'Meta Show'}, {id: 'tt0114709', type: 'movie', name: 'Toy Story'}];
  assert.deepEqual((await get(benWatched)).body.metas, bens);
  // His address has nothing else of anyone's: no MDBList watchlist, no Trakt rows. Hers never has his plays, and his never her lists.
  const benAt = benWatched.split('/catalog/')[0];
  for (const row of ['all/mdblist_watchlist', 'all/watchlist', 'movie/recommended']) assert.deepEqual((await get(`${benAt}/catalog/${row}.json`)).body, {metas: []}, row);
  assert.deepEqual((await get(adaWatched)).body.metas, fromLists);
  // The hub's own Home (no single person) has none of these rows.
  const hubHome = [...fake.homes.values()].find(home => !home.config.jellyfinUserName);
  assert.ok(hubHome && !hubHome.config.catalogs.some(item => /^custom\./.test(item.id)), 'the hub’s Home has no one’s own rows');
  // Without her MDBList key: what she played here, never Ben's, and her MDBList answers are let go.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist/key')).status, 200);
  assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'ada' AND kind LIKE 'mdb%'"), []);
  assert.deepEqual((await get(theirList)).body, {metas: []});
  const hers = (await get(adaWatched)).body.metas, mine = sql("SELECT title FROM plays WHERE person = 'ada' ORDER BY updated DESC").map(row => row.title);
  assert.ok(hers.length > 0 && hers.every(item => mine.includes(item.name)), JSON.stringify(hers)); assert.equal(hers[0].name, mine[0]);
  assert.ok(!hers.some(item => item.name === 'Toy Story'));
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config), [['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true], ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', false]]);
  // Her key back, as before.
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'}); assert.deepEqual(await syncAll(), {state: 'ok'});
  lists.recent = {movies: [], shows: [], episodes: []}; lists.watchlist = [];
});
const hubRows = async rows => {const state = (await owner('GET', '/api/state')).body.hub; assert.equal((await owner('PUT', '/api/hub', {...state, rows})).status, 200); return syncAll();};
const catalogsOf = name => playerOf(name)[1].config.catalogs, collectionsOf = name => playerOf(name)[1].config.collections ?? [];
test('suggested rows reach the player apps: TMDB ones with the TMDB key alone, MDBList ones where a key reads them', async () => {
  const before = (await owner('GET', '/api/state')).body.hub.rows, add = (id, title, kind = 'Collection') => ({id, title, kind, source: 'TMDB', origin: 'hub', on: true});
  // Bond (one TMDB collection), Wizarding World (two, as tabs), Marvel (a TMDB search and an MDBList list), Star Wars (MDBList only),
  // and a single MDBList list. The hub has no MDBList key; Ada has her own, Ben has none.
  await hubRows([add('sg.bond', 'James Bond', 'Movies, in order'), add('sg.wizarding-world', 'Wizarding World'), add('sg.mcu', 'Marvel Cinematic Universe'), add('sg.star-wars', 'Star Wars'), add('mdblist.33459.movie', 'Best Picture Winners', 'Movies'), ...before]);
  const bond = catalogsOf('Ben').find(item => item.id === 'tmdb.collection.645');
  assert.deepEqual({...bond}, {id: 'tmdb.collection.645', type: 'movie', name: 'James Bond', source: 'tmdb', metadata: {listId: '645', sortDirection: 'asc', hideUnreleased: true}, enabled: true, showInHome: true});
  // The rows for children Ben gets under the Kids limit are left aside here (see the Kids test below).
  const tabs = name => Object.fromEntries(collectionsOf(name).filter(item => item.id.startsWith('aiohub-') && !/sg-(kids-channels|animation-studios)$/.test(item.id)).map(item => [item.id, item.folders.map(folder => [folder.title, folder.sources[0].catalogId])]));
  assert.deepEqual(tabs('Ben'), {'aiohub-sg-wizarding-world': [['Harry Potter', 'tmdb.collection.1241'], ['Fantastic Beasts', 'tmdb.collection.435259']], 'aiohub-sg-mcu': [['Movies', 'tmdb.discover.movie.mcu.aiohub']]});
  assert.deepEqual(tabs('Ada'), {'aiohub-sg-wizarding-world': [['Harry Potter', 'tmdb.collection.1241'], ['Fantastic Beasts', 'tmdb.collection.435259']], 'aiohub-sg-mcu': [['Movies', 'tmdb.discover.movie.mcu.aiohub'], ['Shows', 'mdblist.32047']], 'aiohub-sg-star-wars': [['Movies', 'mdblist.198749'], ['Shows', 'mdblist.202585']]});
  // A tab's source is in the setup, on, and kept off Home; the search carries its params, the content limit applies as everywhere.
  const mcu = catalogsOf('Ben').find(item => item.id === 'tmdb.discover.movie.mcu.aiohub');
  assert.equal(mcu.enabled, true); assert.equal(mcu.showInHome, false); // Ben is under the Kids limit: TMDB itself is asked for rated titles only, so the tab comes full.
  assert.deepEqual(mcu.metadata.discover.params, {with_keywords: '180547', sort_by: 'primary_release_date.asc', 'primary_release_date.lte': '__tmdb_date__:today:to', certification_country: 'US', certification: 'G|PG'});
  assert.deepEqual(catalogsOf('Ada').find(item => item.id === 'tmdb.discover.movie.mcu.aiohub').metadata.discover.params, {with_keywords: '180547', sort_by: 'primary_release_date.asc', 'primary_release_date.lte': '__tmdb_date__:today:to'});
  assert.equal(catalogsOf('Ben').some(item => item.id.startsWith('mdblist.')), false, 'nothing that needs MDBList without a key');
  assert.ok(catalogsOf('Ada').some(item => item.id === 'mdblist.33459' && item.showInHome));
  // Taken off Home again: gone from both setups, and nothing else of theirs changed.
  await hubRows(before);
  for (const name of ['Ada', 'Ben']) {assert.deepEqual(tabs(name), {}); assert.deepEqual(catalogsOf(name).filter(item => /^tmdb\.(collection|discover)\.(?!\w+\.(trending|network|studio|popular|fy)[-.])|^mdblist\.(33459|32047|198749)$/.test(item.id)).map(item => item.id), []);}
});
test('a pasted link is checked where the list lives; one that can’t be used says why', async () => {
  const find = (who, link) => who('POST', '/api/lists', {link});
  assert.deepEqual((await find(owner, 'https://trakt.tv/users/someone/lists/heist?sort=rank')).body, {id: 'trakt.list.9001', title: 'Heist classics', kind: 'Movies & shows', source: 'Trakt'});
  assert.match((await find(owner, 'https://trakt.tv/users/someone/lists/secret')).body.message, /isn’t public/);
  assert.deepEqual((await find(owner, 'https://www.themoviedb.org/list/8300-festival')).body, {id: 'tmdb.list.8300', title: 'Festival picks', kind: 'Movies & shows', source: 'TMDB'});
  assert.match((await find(owner, 'themoviedb.org/list/8301')).body.message, /empty/);
  assert.deepEqual((await find(owner, 'https://letterboxd.com/someone/list/noir/')).body, {id: 'letterboxd.aBc12', title: 'Noir essentials', kind: 'Movies', source: 'Letterboxd'});
  assert.equal((await find(owner, 'https://letterboxd.com/someone/list/nothing-here/')).status, 404);
  // MDBList: the hub has no key, so the manager is told; Ada's own key reads it from her page.
  assert.match((await find(owner, 'https://mdblist.com/lists/someone/a-list')).body.message, /MDBList key first/);
  assert.deepEqual((await find(adaSite, 'https://mdblist.com/lists/someone/a-list')).body, {id: 'mdblist.5151.series', title: 'A list', kind: 'Series', source: 'MDBList'});
  assert.match((await find(owner, 'https://trakt.tv/shows/breaking-bad')).body.message, /not a list link/);
  assert.match((await find(owner, 'https://example.com/list')).body.message, /Trakt, Letterboxd, MDBList or TMDB/);
  // Each becomes a row the player apps get, in the list's own order.
  const before = (await owner('GET', '/api/state')).body.hub.rows, row = (id, title) => ({id, title, kind: 'List', source: 'Link', origin: 'hub', on: true});
  await hubRows([row('trakt.list.9001', 'Heist classics'), row('tmdb.list.8300', 'Festival picks'), row('letterboxd.aBc12', 'Noir essentials'), ...before]);
  const got = id => {const item = catalogsOf('Ben').find(catalog => catalog.id === id); return item && [item.type, item.source, item.showInHome, item.metadata];};
  assert.deepEqual([got('trakt.list.9001'), got('tmdb.list.8300'), got('letterboxd.aBc12')], [['all', 'trakt', true, {privacy: 'public'}], ['all', 'tmdb', true, {listId: '8300'}], ['all', 'letterboxd', true, {isWatchlist: false, identifier: 'aBc12'}]]);
  await hubRows(before);
  assert.equal(catalogsOf('Ben').some(item => /^(trakt|tmdb)\.list\.|^letterboxd\./.test(item.id)), false);
});
test('her own lists and what her watching suggests are hers alone, from her own page', async () => {
  trakt.expiresIn = 7 * 86400; await connect();
  // Never the manager's to see, even for her.
  assert.equal((await owner('GET', '/api/people/ada/lists')).status, 403); assert.equal((await owner('GET', '/api/people/ada/because')).status, 403);
  const got = (await adaSite('GET', '/api/people/ada/lists')).body.lists;
  // Her own lists as one row to add, the ones she liked as another, then each list by itself.
  assert.deepEqual(got, [{id: 'trakt-lists', title: 'My Trakt lists', kind: 'Collection · 1 list', source: 'Trakt · your lists'}, {id: 'trakt-liked-lists', title: 'Trakt lists I liked', kind: 'Collection · 1 list', source: 'Trakt · lists you liked'}, {id: 'trakt-mine.501', title: 'Heist nights', kind: 'List · 2 titles', source: 'Trakt · your list'}, {id: 'trakt-liked.777', title: 'Liked one', kind: 'List · 1 title', source: 'Trakt · liked'}, {id: 'mdblist.4242.movie', title: 'Award winners', kind: 'List · 60 titles', source: 'MDBList · your list'}]);
  // Kept a while, for her alone: asking again reads neither service.
  const reads = trakt.reads.length; assert.deepEqual((await adaSite('GET', '/api/people/ada/lists')).body.lists, got); assert.equal(trakt.reads.length, reads);
  assert.deepEqual(sql("SELECT person FROM rows_cache WHERE kind = 'lists'"), [{person: 'ada'}]);
  // "Because you watched": from her own Trakt pages and plays only. Ben watching Pixar never reaches her suggestions.
  const id = sql('SELECT id FROM hubs')[0].id;
  sql(`INSERT INTO rows_cache (hub, person, kind, at, items) VALUES ('${id}', 'ada', 'history.9', 0, '[{"id":"tt0076759","type":"movie","name":"Star Wars"},{"id":"tmdb:120","type":"movie","name":"The Fellowship of the Ring"}]'), ('${id}', 'ben', 'history', 0, '[{"id":"tt0114709","type":"movie","name":"Toy Story"}]')`);
  assert.deepEqual((await adaSite('GET', '/api/people/ada/because')).body.because, {'sg.star-wars': 'Star Wars', 'sg.middle-earth': 'The Fellowship of the Ring'});
  // Her private Trakt list on her Home: served by the hub through her own login, in the list's order, like her watchlist.
  const ada = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal((await owner('PUT', '/api/people/ada', {...ada, rows: [{id: 'trakt-mine.501', title: 'Heist nights', kind: 'List', source: 'Trakt · your list', origin: 'own', on: true}, ...(await owner('GET', '/api/state')).body.hub.rows]})).status, 200);
  await syncAll();
  const served = catalogsOf('Ada').find(item => item.id === 'custom.aiohub_rows.all.list_mine_501');
  assert.ok(served?.showInHome && served.enabled, 'her list is a row in her setup');
  const metas = await (await fetch(served.sourceUrl)).json();
  assert.deepEqual(metas.metas.map(meta => meta.id), ['tt0110912', 'tt0903747']);
  assert.ok(trakt.reads.some(read => read.where === '/users/me/lists/501/items' && /page=1/.test(read.query ?? '')));
  assert.deepEqual(sql("SELECT person, kind FROM rows_cache WHERE kind LIKE 'list_mine_501%' ORDER BY kind"), [{person: 'ada', kind: 'list_mine_501'}, {person: 'ada', kind: 'list_mine_501.2'}]);
  // Nobody else's setup has it.
  assert.equal(catalogsOf('Ben').some(item => /list_mine/.test(item.id)), false);
  assert.equal((await owner('PUT', '/api/people/ada', {...ada, rows: null, v: (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').v})).status, 200);
  await syncAll(); assert.equal(catalogsOf('Ada').some(item => /list_mine/.test(item.id)), false);
  // Her own Trakt lists as one row (shelf.ts), as someone who added My Trakt lists before the ones she liked had a row of their
  // own has it. The cron works out each list's picture, the backdrop of its film or show (the best-known: most rated on Trakt; none
  // for one whose best-known has none on TMDB), for her own and the ones she liked alike, and her setup gets a collection: a wide
  // tile for each of her own lists, opening that list. The ones she liked are not in it, nor anywhere until she adds their row.
  const later = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/people/ada', {...ada, rows: [{id: 'trakt-lists', title: 'My Trakt lists', kind: 'Collection · 2 lists', source: 'Trakt · all your lists', origin: 'own', on: true}, ...later.rows], v: later.people.find(person => person.id === 'ada').v})).status, 200);
  for (let i = 0; i < 8 && !sql("SELECT 1 FROM rows_cache WHERE kind = 'shelf'").length; i++) await cron();
  assert.deepEqual(JSON.parse(sql("SELECT items FROM rows_cache WHERE person = 'ada' AND kind = 'shelf'")[0].items), [
    {id: 'trakt-mine.501', title: 'Heist nights', first: 'movie/680', cover: ''}, {id: 'trakt-liked.777', title: 'Liked one', first: 'tv/1396', cover: 'https://image.tmdb.org/t/p/w780/bb-backdrop.jpg'}]);
  await syncAll();
  const shelf = collectionsOf('Ada').find(item => item.id === 'aiohub-trakt-lists');
  const tiles = shelf => shelf?.folders.map(folder => [folder.title, folder.shape, folder.coverImageUrl, folder.sources[0].catalogId]);
  assert.deepEqual(tiles(shelf), [['Heist nights', 'LANDSCAPE', '', 'custom.aiohub_rows.all.list_mine_501']]); assert.equal(shelf.title, 'My Trakt lists');
  assert.ok(catalogsOf('Ada').some(item => item.id === 'custom.aiohub_rows.all.list_mine_501' && !item.showInHome), 'each list is there for its tile, not as a row of its own');
  assert.equal(collectionsOf('Ada').some(item => item.id === 'aiohub-trakt-liked-lists'), false); assert.equal(catalogsOf('Ada').some(item => /list_liked/.test(item.id)), false);
  assert.equal(collectionsOf('Ben').some(item => /^aiohub-trakt-/.test(item.id)), false);
  // Trakt lists I liked, added from Add row: a row of its own after the one above it, from what was worked out already.
  const withLiked = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal((await owner('PUT', '/api/people/ada', {...withLiked, rows: [withLiked.rows[0], {id: 'trakt-liked-lists', title: 'Trakt lists I liked', kind: 'Collection · 1 list', source: 'Trakt · lists you liked', origin: 'own', on: true}, ...withLiked.rows.slice(1)]})).status, 200);
  await syncAll();
  assert.deepEqual(tiles(collectionsOf('Ada').find(item => item.id === 'aiohub-trakt-liked-lists')), [['Liked one', 'LANDSCAPE', 'https://image.tmdb.org/t/p/w780/bb-backdrop.jpg', 'custom.aiohub_rows.all.list_liked_777']]);
  assert.deepEqual(tiles(collectionsOf('Ada').find(item => item.id === 'aiohub-trakt-lists')), [['Heist nights', 'LANDSCAPE', '', 'custom.aiohub_rows.all.list_mine_501']]);
  assert.ok(catalogsOf('Ada').some(item => item.id === 'custom.aiohub_rows.all.list_liked_777' && !item.showInHome));
  // Her Home says which pictures are whose, so each row on the site shows its own.
  assert.deepEqual((await adaSite('GET', '/api/state')).body.hub.people[0].shelfTiles, [{title: 'Liked one', image: 'https://image.tmdb.org/t/p/w780/bb-backdrop.jpg', liked: true}]);
  // Asked again within the day, nothing is worked out again.
  const asked = fake.tmdb.length; await cron(); assert.equal(fake.tmdb.length, asked);
  // Her Home says when the row was last worked out. Her lists as Add row reads them are the same, so a visit leaves it be.
  const shelfAt = () => sql("SELECT at FROM rows_cache WHERE person = 'ada' AND kind = 'shelf'")[0].at, checked = shelfAt();
  assert.ok(checked > 0); assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].shelfAt, checked);
  await adaSite('GET', '/api/people/ada/lists'); assert.equal(shelfAt(), checked);
  // Trakt not answering is no change.
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'lists'"); trakt.refuseReads = true;
  await adaSite('GET', '/api/people/ada/lists'); trakt.refuseReads = false; waited(); assert.equal(shelfAt(), checked);
  // A list renamed on Trakt since: her next visit, with no call of its own to Trakt, has the row worked out again on the next run.
  const mineLists = READS['/users/me/lists']; READS['/users/me/lists'] = [{...mineLists[0], name: 'Heist nights, extended'}];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'lists'"); trakt.reads = [];
  await adaSite('GET', '/api/people/ada/lists');
  assert.deepEqual(trakt.reads.map(read => read.where), ['/users/me/lists', '/users/likes/lists']); assert.equal(shelfAt(), 0);
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].shelfAt, 0);
  for (let i = 0; i < 8 && !shelfAt(); i++) await cron();
  assert.deepEqual(JSON.parse(sql("SELECT items FROM rows_cache WHERE person = 'ada' AND kind = 'shelf'")[0].items).map(list => list.title), ['Heist nights, extended', 'Liked one']);
  READS['/users/me/lists'] = mineLists;
  // "Check my lists now": hers or her manager's to ask, for a Home with the row on, once a minute at most.
  assert.equal((await adaSite('POST', '/api/people/ben/shelf', {})).status, 403); assert.equal((await owner('POST', '/api/people/ben/shelf', {})).status, 409);
  assert.equal((await adaSite('POST', '/api/people/ada/shelf', {})).status, 429, 'just checked');
  sql("UPDATE rows_cache SET at = at - 120 WHERE person = 'ada' AND kind = 'shelf'");
  assert.equal((await adaSite('POST', '/api/people/ada/shelf', {})).status, 200); assert.equal(shelfAt(), 0);
  // The manager's Background work has it due now (under way).
  assert.equal((await owner('GET', '/api/state')).body.hub.jobs.shelfDue, 0);
  assert.equal((await owner('POST', '/api/people/ada/shelf', {})).status, 200); assert.equal(shelfAt(), 0);
  for (let i = 0; i < 8 && !shelfAt(); i++) await cron();
  assert.ok(shelfAt() > 0); assert.deepEqual(sql("SELECT person FROM rows_cache WHERE kind = 'shelf'"), [{person: 'ada'}]);
  assert.equal((await owner('PUT', '/api/people/ada', {...ada, rows: null, v: (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').v})).status, 200);
  await syncAll(); assert.equal(collectionsOf('Ada').some(item => item.id === 'aiohub-trakt-lists'), false);
  // Taken off her Home it is never worked out again, so it is not due either.
  assert.equal((await owner('GET', '/api/state')).body.hub.jobs.shelfDue, null);
  // Trakt disconnected: her lists, like everything read from her Trakt, are forgotten.
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200); assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'ada' AND kind NOT LIKE 'history%'"), []);
});
/* AIOMetadata's id for a film, a show or an episode (under its show), as the hub works it out (worker/here.ts). */
const pack = (kind, imdb, season, episode) => {
  const b = Buffer.alloc(16); b[0] = 0xa1; b[1] = ({movie: 1, series: 2, episode: 4}[kind] << 4) | 1; b[2] = kind === 'movie' ? 1 : 2; b.writeUIntBE(Number(imdb.slice(2)), 3, 6);
  b.writeUInt16BE(kind === 'episode' ? season : 0xffff, 9); b.writeUInt16BE(kind === 'episode' ? episode : 0xffff, 11); b[13] = 1; const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
test('two places are compared and copied across: paused points both ways, a move back Here that echoes nowhere, Here and Trakt (only with Trakt sync on), a move to MDBList', async () => {
  trakt.expiresIn = 7 * 86400; await connect(); trakt.calls = []; trakt.reads = [];
  // Connected, with sync off: anything between her progress and Trakt is refused, looking included, and Trakt is not asked.
  for (const [method, pair] of [['GET', 'here-trakt'], ['POST', 'here-trakt'], ['GET', 'mdblist-trakt'], ['POST', 'mdblist-trakt']]) {
    const got = await adaSite(method, `/api/people/ada/compare/${pair}`, method === 'GET' ? undefined : {}); assert.deepEqual([got.status, got.body.message], [409, 'Trakt sync is off. Turn it on first.']);
  }
  assert.equal((await adaSite('POST', '/api/people/ada/matching/pass', {})).status, 409);
  await pause(300); assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.reads, []);
  // She turns it on (with her earlier plays ticked: everything here was watched before now).
  await syncOn(true);
  const T = ago(2), BBS = pack('series', 'tt0903747');
  // What Ada's server holds of titles the other places have: unticked, with running times; one episode it numbers differently.
  for (const [id, item] of [[pack('movie', 'tt0137523'), {Type: 'Movie', Name: 'Fight Club'}], [pack('movie', 'tt1375666'), {Type: 'Movie', Name: 'Inception'}], [pack('movie', 'tt0110912'), {Type: 'Movie', Name: 'Pulp Fiction'}], [pack('movie', 'tt0109830'), {Type: 'Movie', Name: 'Forrest Gump'}],
    [pack('episode', 'tt0903747', 1, 3), {Type: 'Episode', SeriesId: BBS, ParentIndexNumber: 1, IndexNumber: 3}], [pack('episode', 'tt0903747', 2, 9), {Type: 'Episode', SeriesId: BBS, ParentIndexNumber: 2, IndexNumber: 9, Listed: false}]]) HELD[id] = {Id: id, RunTimeTicks: 6000e7, UserData: {}, ...item};
  const compare = (method, pair, body) => adaSite(method, `/api/people/ada/compare/${pair}`, body), forget = () => sql('UPDATE drift SET here = NULL');
  // Only Ada, from her own page.
  assert.equal((await owner('GET', '/api/people/ada/compare/here-trakt')).status, 403);
  assert.equal((await compare('GET', 'sideways')).status, 400);
  // A look that fails says why, in words the page shows as they are, with a status that tells a service that did not answer (503,
  // worth asking again) from something to change first (409). A failed look is never kept.
  const failing = async pair => {forget(); const got = await compare('GET', pair); return [got.status, got.body.message];};
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'playback'"); trakt.refuseReads = true;
  assert.deepEqual(await failing('mdblist-trakt'), [503, 'Trakt didn’t answer just now.']); trakt.refuseReads = false;
  // Trakt said to wait: the answer says until when, her page's state too, and until then nothing of hers is read from Trakt,
  // whoever asks, even though Trakt would answer again.
  forget(); const told = await compare('GET', 'mdblist-trakt'), asked = trakt.reads.length;
  assert.equal(told.status, 503); assert.ok(told.body.until > Date.now() / 1000 && told.body.until < Date.now() / 1000 + 3601, 'until when');
  forget(); assert.equal((await compare('GET', 'mdblist-trakt')).body.until, told.body.until); assert.equal(trakt.reads.length, asked, 'not asked meanwhile');
  waited(); forget(); assert.equal((await compare('GET', 'mdblist-trakt')).status, 200, 'and read again once the wait is over');
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'playback'");
  lists.refuse = true; assert.deepEqual(await failing('mdblist-here'), [503, 'MDBList isn’t taking requests from your key right now. If this lasts a day, paste a new key.']); lists.refuse = false;
  // No player setup made for her yet: said as it is, not as if she had watched nothing.
  sql("UPDATE secrets SET kind = 'aside' WHERE owner = 'ada' AND kind = 'upstream-aiom'");
  assert.deepEqual(await failing('here-trakt'), [409, 'Your player setup isn’t made yet.']);
  sql("UPDATE secrets SET kind = 'upstream-aiom' WHERE owner = 'ada' AND kind = 'aside'");
  assert.deepEqual(sql("SELECT here FROM drift WHERE person = 'ada' AND here IS NOT NULL"), []);

  // On MDBList with Trakt: a paused point MDBList has goes to Trakt, and one Trakt has goes to MDBList (under 80%, dated now).
  lists.playback = [{type: 'movie', progress: 50, paused_at: T, movie: MOVIE.inception}]; trakt.playback = [{type: 'movie', progress: 30.5, paused_at: T, movie: MOVIE.gump}];
  const points = (await compare('GET', 'mdblist-trakt')).body;
  assert.deepEqual(points.lines.map(line => [line.title, line.pct, line.lists, line.trakt]), [['Inception', 50, 'has', 'add'], ['Forrest Gump', 31, 'add', 'has']]);
  const pauses = fake.pauses.length; assert.deepEqual((await compare('POST', 'mdblist-trakt', {})).body, {added: 2, unmatched: 0, more: false, left: 0, switched: false});
  assert.deepEqual((await heard(1)).map(call => [call.path, call.body]), [['/scrobble/pause', {movie: {ids: MOVIE.inception.ids}, progress: 50}]]);
  assert.deepEqual(fake.pauses.slice(pauses), [{movie: {ids: MOVIE.gump.ids}, progress: 31}]);
  // Looked at again at once, with both sides still answering as before: what was just sent is not offered again.
  assert.deepEqual((await compare('GET', 'mdblist-trakt')).body.lines.map(line => line.title), ['Forrest Gump']);

  // Moving back Here. Not before she starts it, and not while her setup still passes ticks on to MDBList.
  lists.playback = [{type: 'movie', progress: 50, paused_at: T, movie: MOVIE.inception}]; trakt.playback = [];
  lists.recent = {movies: [{last_watched_at: T, movie: MOVIE.fight}], episodes: [{last_watched_at: T, episode: {season: 1, number: 3, show: BB}}, {last_watched_at: T, episode: {season: 2, number: 9, show: BB}}]};
  assert.equal((await compare('POST', 'mdblist-here', {switch: true})).status, 409);
  assert.equal((await adaSite('POST', '/api/people/ada/moving', {to: 'here'})).status, 200);
  assert.match((await compare('POST', 'mdblist-here', {switch: true})).body.message, /still switching/);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const [, ada] = playerOf('Ada'); assert.equal(ada.config.playbackReporting, false); assert.equal(ada.config.mdblistWatchTracking, false); assert.equal(ada.config.apiKeys.mdblist, undefined);
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].moving, 'here');
  const back = (await compare('GET', 'mdblist-here')).body;
  assert.deepEqual(back.lines.map(line => [line.title, line.detail, line.pct ?? null, line.here, line.lists]).sort(), [['Breaking Bad', 'Season 1 · Episode 3', null, 'add', 'has'], ['Breaking Bad', 'Season 2 · Episode 9', null, 'add', 'has'], ['Fight Club', 'Movie', null, 'add', 'has'], ['Inception', 'Movie', 50, 'add', 'has']]);
  // The move: ticked with the date MDBList had, the spot kept; the episode Ada's server numbers differently is left out. Nothing
  // reaches Trakt or MDBList (no echo), and only then is she switched.
  const before = {trakt: trakt.calls.length, watched: fake.watched.length, pauses: fake.pauses.length}, ticked = fake.ticks.length, kept = fake.positions.length;
  assert.deepEqual((await compare('POST', 'mdblist-here', {switch: true})).body, {added: 3, unmatched: 1, more: false, left: 0, switched: true});
  assert.deepEqual(fake.ticks.slice(ticked).map(tick => [HELD[tick.id].Name ?? `S${HELD[tick.id].ParentIndexNumber}E${HELD[tick.id].IndexNumber}`, tick.at]).sort(), [['Fight Club', T], ['S1E3', T]]);
  // A spot her server had none of: kept with when it was left there, so Continue Watching orders it truthfully.
  assert.deepEqual(fake.positions.slice(kept).map(point => [HELD[point.id].Name, point.ticks, point.at]), [['Inception', 3000e7, T]]);
  await pause(500); assert.deepEqual({trakt: trakt.calls.length, watched: fake.watched.length, pauses: fake.pauses.length}, before, 'nothing echoed to a tracker');
  const me = (await adaSite('GET', '/api/state')).body.hub.people[0]; assert.equal(me.lists, false); assert.equal(me.moving, null);
  // Her key stays saved, unused for progress: her setup records, reports and hides nothing, and only reads her lists with it.
  assert.equal(me.listsKept, true); assert.equal(me.listsName, 'adalists'); assert.deepEqual(sql("SELECT kind FROM secrets WHERE owner = 'ada' AND kind = 'mdblist'"), [{kind: 'mdblist'}]);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const idle = playerOf('Ada')[1].config;
  assert.deepEqual([idle.playbackReporting, idle.mdblistWatchTracking, idle.hideWatchedMdblist, idle.apiKeys.mdblist], [false, false, false, 'ada-mdblist-key']);
  assert.ok(!JSON.stringify(idle).includes('$reads'));
  // Her own lists are still read with it.
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'lists'"); assert.ok((await adaSite('GET', '/api/people/ada/lists')).body.lists.some(item => item.id === 'mdblist.4242.movie'));

  // Here and Trakt (Trakt only now). Out: plays here that never reached Trakt, and a spot as a paused point. In: a film watched
  // elsewhere and a spot Trakt holds. A play that reached Trakt as it happened is not offered again.
  // (Earlier tests ticked some of these through her apps: here one stays partway and one unwatched.)
  HELD[EP].UserData = {PlayedPercentage: 40}; HELD[LEFT].UserData = {}; HELD[FILM].UserData = {};
  sql(`UPDATE plays SET scrobbled = 'watched', updated = unixepoch() + 5 WHERE person = 'ada' AND item = '${ITEM}'`); forget();
  trakt.history = [{watched_at: ago(1), type: 'movie', movie: MOVIE.pulp}]; trakt.playback = [{type: 'movie', progress: 20, paused_at: ago(1), movie: MOVIE.gump}];
  const both = (await compare('GET', 'here-trakt')).body, line = item => [item.title, item.detail, item.here, item.trakt, item.elsewhere ?? false, item.pct ?? null];
  assert.ok(!both.lines.some(item => item.title === 'Meta Movie'), 'reached Trakt live: not offered');
  assert.deepEqual(both.lines.map(line).sort(), [['Forrest Gump', 'Movie', 'add', 'has', true, 20], ['Meta Show', 'Season 1 · Episode 1', 'has', 'add', false, null], ['Meta Show', 'Season 1 · Episode 2', 'has', 'add', false, 40], ['Pulp Fiction', 'Movie', 'add', 'has', true, null]]);
  const ticks = fake.ticks.length; trakt.calls = [];
  const added = (await compare('POST', 'here-trakt', {})).body; assert.equal(added.added, 4, JSON.stringify(added));
  const sent = await heard(2);
  assert.deepEqual(sent.map(call => call.path).sort(), ['/scrobble/pause', '/sync/history']);
  assert.deepEqual(sent.find(call => call.path === '/scrobble/pause').body, {show: {ids: {tmdb: 1399}}, episode: {season: 1, number: 2}, progress: 40});
  assert.deepEqual(sent.find(call => call.path === '/sync/history').body.shows[0].seasons, [{number: 1, episodes: [{number: 1, watched_at: sent.find(call => call.path === '/sync/history').body.shows[0].seasons[0].episodes[0].watched_at}]}]);
  assert.deepEqual(fake.ticks.slice(ticks).map(tick => HELD[tick.id].Name), ['Pulp Fiction']); assert.equal(fake.positions.at(-1).ticks, 1200e7);
  assert.deepEqual((await compare('GET', 'here-trakt')).body.lines.length, 0, 'done once, nothing offered again');

  // Choosing MDBList from her own page takes up the key she saved before, with nothing to paste. Nothing reports there until her
  // plays have moved over.
  assert.deepEqual((await adaSite('POST', '/api/people/ada/mdblist', {reuse: true, moving: true})).body, {username: 'adalists'});
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Ada')[1].config.playbackReporting, false);
  const moving = (await adaSite('GET', '/api/state')).body.hub.people[0]; assert.equal(moving.lists, false); assert.equal(moving.moving, 'mdblist');
  const to = (await compare('POST', 'here-mdblist', {switch: true})).body; assert.equal(to.switched, true, JSON.stringify(to));
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].lists, true);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Ada')[1].config.playbackReporting, true);
  // The manager choosing Here for her keeps the key too; Remove key is what lets it go. A key pasted again takes effect at once.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(playerOf('Ada')[1].config.mdblistWatchTracking, false); assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').listsKept, true);
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist/key')).status, 200); assert.deepEqual(sql("SELECT kind FROM secrets WHERE owner = 'ada' AND kind = 'mdblist'"), []);
  assert.equal((await owner('POST', '/api/people/ada/mdblist', {reuse: true})).status, 400, 'nothing saved to take up');
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'});
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Ada')[1].config.mdblistWatchTracking, true);
  lists.playback = null; trakt.playback = null; trakt.history = [];
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
});
test('Trakt sync: hers to turn on, asked after her own sign-in with what she watched here before listed; caught up at once, earlier plays only if ticked; the manager’s switch copies first', async () => {
  const me = async () => (await adaSite('GET', '/api/state')).body.hub.people[0];
  // The manager switching her progress goes the same way as hers: back here (copying what only MDBList has first), then to MDBList
  // (copying what only here has), each switching once it is across. Only counts come back; looking stays hers alone.
  assert.equal((await owner('POST', '/api/people/ada/moving', {to: 'here'})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal((await owner('POST', '/api/people/ada/compare/mdblist-here', {})).status, 403, 'copying anything else is hers');
  assert.equal((await owner('GET', '/api/people/ada/compare/mdblist-here')).status, 403);
  const back = (await owner('POST', '/api/people/ada/compare/mdblist-here', {switch: true})).body;
  assert.equal(back.switched, true, JSON.stringify(back)); assert.deepEqual(Object.keys(back).sort(), ['added', 'left', 'more', 'switched', 'unmatched']);
  assert.equal((await me()).lists, false); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal((await owner('POST', '/api/people/ada/mdblist', {reuse: true, moving: true})).status, 200); assert.equal((await me()).moving, 'mdblist');
  assert.equal((await owner('POST', '/api/people/ada/compare/here-mdblist', {switch: true})).body.switched, true); assert.equal((await me()).lists, true);
  // Back to progress here for what follows.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});

  // Something she watched here long ago, before any Trakt was connected (her other plays here were copied or left out earlier).
  const MEMENTO = pack('movie', 'tt0209144');
  HELD[MEMENTO] = {Id: MEMENTO, Type: 'Movie', Name: 'Memento', ProviderIds: {Tmdb: '77', Imdb: 'tt0209144'}, RunTimeTicks: 6000e7, UserData: {Played: true, LastPlayedDate: ago(30)}};
  sql(`INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', '${MEMENTO}', 'Memento', 'Movie', 6000, 6000, 'Strand · Mac', 0, unixepoch() - 30 * 86400, '' FROM hubs`);
  // Connected by her manager: off, and not asked; only she can turn it on, from her own page.
  await connect();
  assert.deepEqual((await me()).matching, {on: false, earlier: false, passed: false, ask: false, good: 0, failing: null, why: null, waiting: null});
  for (const [method, path] of [['POST', ''], ['GET', ''], ['GET', '/synced'], ['POST', '/pass']]) assert.equal((await owner(method, `/api/people/ada/matching${path}`, method === 'GET' ? undefined : {on: true})).status, 403);
  // Connected by herself: asked on her page, with how many things she watched here before connecting.
  const got = issue();
  assert.equal((await adaSite('POST', '/api/people/ada/scrobble/link', {access: got.access_token, refresh: got.refresh_token, lasts: got.expires_in, created: got.created_at, username: 'adatrakt', redirect: `${BASE}/api/trakt/callback`})).status, 200);
  assert.equal((await me()).matching.ask, true);
  const asked = (await adaSite('GET', '/api/people/ada/matching')).body, before = asked.earlier; assert.ok(before > 0, 'all her plays came before this connection');
  // Each one is listed for her (what it is called and when, from the plays kept here), as many as the count says.
  assert.equal(asked.plays.length, before); assert.deepEqual(Object.keys(asked.plays[0]).sort(), ['at', 'detail', 'title']);
  assert.ok(asked.plays.some(play => play.title === 'Memento' && play.detail === 'Movie' && Math.abs(play.at - (Date.now() / 1000 - 30 * 86400)) < 600), JSON.stringify(asked.plays));
  // A film she watched on Trakt yesterday, which her server has unticked; and a spot Trakt holds that is later than hers.
  const HEAT = pack('movie', 'tt0113277'), KNIGHT = pack('movie', 'tt0468569'), GUMP = pack('movie', 'tt0109830');
  HELD[HEAT] = {Id: HEAT, Type: 'Movie', Name: 'Heat', RunTimeTicks: 6000e7, UserData: {}}; HELD[KNIGHT] = {Id: KNIGHT, Type: 'Movie', Name: 'The Dark Knight', RunTimeTicks: 6000e7, UserData: {}};
  HELD[GUMP] = {...HELD[GUMP], UserData: {PlaybackPositionTicks: 600e7, LastPlayedDate: ago(3)}};
  trakt.history = [{watched_at: ago(1), type: 'movie', movie: MOVIE.heat}]; trakt.playback = [{type: 'movie', progress: 50, paused_at: ago(1), movie: MOVIE.gump}];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'playback'"); trakt.calls = []; const ticks = fake.ticks.length, spots = fake.positions.length;
  // She says yes, without her earlier plays: caught up at once from her page. Trakt's film is ticked here and its later spot kept;
  // nothing from before connecting reaches Trakt.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: true, earlier: false})).status, 200);
  assert.equal((await me()).matching.ask, false); assert.equal((await me()).matching.on, true);
  const caught = (await adaSite('POST', '/api/people/ada/matching/pass', {})).body;
  assert.equal(caught.trakt, 0, JSON.stringify(caught)); assert.equal(caught.home, 2, JSON.stringify(caught));
  assert.deepEqual(fake.ticks.slice(ticks).map(tick => HELD[tick.id].Name), ['Heat']); assert.deepEqual(fake.positions.slice(spots).map(spot => [HELD[spot.id].Name, spot.ticks]), [['Forrest Gump', 3000e7]]);
  await pause(300); assert.deepEqual(trakt.calls, [], 'nothing from before connecting');
  // What was synced, on her own page: each with its name, where it went, and whether it was a paused spot.
  const did = (await adaSite('GET', '/api/people/ada/matching/synced')).body.synced;
  // The spot took the place of an earlier one of hers, so it reads as updated; the film was added.
  assert.deepEqual(did.slice(0, 2).map(item => [item.title, item.detail, item.to, item.spot, !!item.updated]).sort(), [['Forrest Gump', 'Movie', 'here', true, true], ['Heat', 'Movie', 'here', false, false]]); assert.ok(did[0].at > Date.now() / 1000 - 60);
  assert.equal(HELD[GUMP].UserData.LastPlayedDate, trakt.playback[0].paused_at, 'dated when it was left on Trakt');
  // Ticking her earlier plays too: they go to Trakt through the outbox (here Trakt turns the first try away, so it waits there).
  trakt.refuse = 1;
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: true, earlier: true})).status, 200);
  const earlier = (await adaSite('POST', '/api/people/ada/matching/pass', {})).body; assert.ok(earlier.trakt >= 1, JSON.stringify(earlier));
  // As many went as her page had listed, less the ones her server does not hold as watched (this test's stand-in server never
  // noted those plays; a real one notes what is played through it), and what went is no longer offered.
  const rows = sql("SELECT item, title, detail, ids FROM plays WHERE person = 'ada'"), state = play => HELD[rows.find(row => row.title === play.title && row.detail === play.detail)?.item]?.UserData ?? {};
  const holds = asked.plays.filter(play => state(play).Played || (state(play).PlayedPercentage >= 1 && state(play).PlayedPercentage < 80));
  assert.equal(earlier.trakt + earlier.left, holds.length, JSON.stringify({earlier, listed: asked.plays, holds, rows, sent: sql("SELECT place, play, item FROM sent WHERE person = 'ada'")}));
  assert.ok((await adaSite('GET', '/api/people/ada/matching/synced')).body.synced.some(item => item.title === 'Memento' && item.to === 'trakt' && !item.spot));
  const after = (await adaSite('GET', '/api/people/ada/matching')).body; assert.equal(after.earlier, before - earlier.trakt, 'what was sent is not offered again'); assert.ok(!after.plays.some(play => play.title === 'Memento'));
  assert.ok(waiting().some(call => call.path === '/sync/history'), 'kept in the outbox'); assert.equal(trakt.refused.at(-1).path, '/sync/history');
  // The five-minute run sends it once it is due (a couple of seconds on).
  await pause(2500); await cron(); assert.deepEqual(waiting(), []);
  assert.ok(trakt.calls.some(call => call.path === '/sync/history' && call.body.movies?.some(movie => movie.ids.tmdb === 77)), 'Memento, from before connecting, reached Trakt');
  // Sent once: another pass sends nothing more.
  trakt.calls = []; assert.equal((await adaSite('POST', '/api/people/ada/matching/pass', {})).body.trakt, 0); await pause(300); assert.deepEqual(trakt.calls, []);
  // The manager sees that it is on, and the Background work row counts her.
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').matching.on, true);
  assert.equal((await owner('GET', '/api/state')).body.hub.jobs.matching, 1);
  // Background work says how often her turn comes: one person each five-minute run, so every 20 minutes at least, and longer once
  // more than four people sync, whichever hub they are in. Only the minutes are given, never how many people.
  assert.equal((await owner('GET', '/api/state')).body.hub.jobs.syncEvery, 20);
  sql(`INSERT INTO sync (hub, person, matching) VALUES ${[1, 2, 3, 4, 5].map(n => `('elsewhere', 'p${n}', 1)`).join(', ')}; INSERT INTO secrets (hub, owner, kind, value) VALUES ${[1, 2, 3, 4, 5].map(n => `('elsewhere', 'p${n}', 'trakt-scrobble', 'x')`).join(', ')}`);
  const jobs = (await owner('GET', '/api/state')).body.hub.jobs; assert.equal(jobs.syncEvery, 30); assert.equal(jobs.matching, 1); assert.equal(jobs.syncAll, undefined);
  sql("DELETE FROM sync WHERE hub = 'elsewhere'; DELETE FROM secrets WHERE hub = 'elsewhere'");
});
test('the cron keeps her in sync: one cheap look a turn, real work only when Trakt moved; adds only, deletions stay deleted, a later spot wins', async () => {
  const due = () => sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"), reads = () => trakt.reads.map(read => read.where);
  const stamp = (watched, paused = trakt.activity.movies.paused_at) => {trakt.activity = {movies: {watched_at: watched, paused_at: paused}, episodes: {watched_at: '2020-01-01T00:00:00.000Z', paused_at: '2020-01-01T00:00:00.000Z'}};};
  const KNIGHT = pack('movie', 'tt0468569'), ALIEN = pack('movie', 'tt0078748'), ticks = () => fake.ticks.map(tick => HELD[tick.id].Name);
  HELD[ALIEN] = {Id: ALIEN, Type: 'Movie', Name: 'Alien', RunTimeTicks: 6000e7, UserData: {}};
  stamp(ago(1)); due(); await cron(); assert.ok(sql("SELECT stamps FROM sync WHERE person = 'ada'")[0].stamps, 'the stamps are kept after a good look');
  // Her first turn with nothing to do reads, once, the shows she watched on Trakt (Next Up, below): none, so that is done with.
  trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities', '/sync/watched/shows']);
  // Nothing moved: Trakt is asked one cheap question and nothing else, and the run is not busy (For you may still run after it).
  trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities']);
  // A film on Trakt she left out on her own page stays out of sync too: never ticked here.
  const SEVEN = pack('movie', 'tt0114369'); HELD[SEVEN] = {Id: SEVEN, Type: 'Movie', Name: 'Se7en', RunTimeTicks: 6000e7, UserData: {}};
  assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: 'i:movie/807'})).status, 200);
  trakt.history.unshift({watched_at: ago(0.02), type: 'movie', movie: {title: 'Se7en', ids: {imdb: 'tt0114369', tmdb: 807}}}); stamp(ago(0.02));
  const left = fake.ticks.length; due(); await cron(); assert.deepEqual(ticks().slice(left), [], 'left out'); assert.ok(!HELD[SEVEN].UserData.Played);
  // A film finished in another Trakt app: ticked here on her next turn.
  trakt.history.unshift({watched_at: ago(0.01), type: 'movie', movie: MOVIE.knight}); stamp(ago(0.01)); const before = fake.ticks.length;
  trakt.reads = []; due(); await cron(); assert.deepEqual(ticks().slice(before), ['The Dark Knight']); assert.deepEqual(reads(), ['/sync/last_activities', '/sync/history']);
  // She unticks it here; Trakt moves again for something else. It is never ticked again: sent once.
  HELD[KNIGHT].UserData = {}; trakt.history.unshift({watched_at: ago(0.005), type: 'movie', movie: {title: 'Alien', ids: {imdb: 'tt0078748', tmdb: 348}}}); stamp(ago(0.005));
  due(); await cron(); assert.deepEqual(ticks().slice(before), ['The Dark Knight', 'Alien']);
  stamp(ago(0.001)); due(); await cron(); assert.deepEqual(ticks().slice(before), ['The Dark Knight', 'Alien'], 'deleted stays deleted');
  // A film the hub itself sent to Trakt as she watched it here: Trakt lists it, and it is not brought back (her server is not even
  // asked).
  sql(`UPDATE plays SET scrobbled_at = unixepoch() WHERE person = 'ada' AND item = '${FILM}'`); assert.ok(sql(`SELECT ids FROM plays WHERE person = 'ada' AND item = '${FILM}'`)[0].ids);
  trakt.history.unshift({watched_at: ago(0.0005), type: 'movie', movie: MOVIE.inception}); HELD[FILM].UserData = {}; stamp(ago(0.0005));
  const signIns = fake.signIns; due(); await cron(); assert.deepEqual(ticks().slice(before), ['The Dark Knight', 'Alien']); assert.equal(fake.signIns, signIns, 'her server not asked');
  // A spot Trakt holds that is older than hers is left alone; nothing is ever unticked.
  const spots = fake.positions.length, HEAT = pack('movie', 'tt0113277');
  HELD[HEAT].UserData = {PlaybackPositionTicks: 900e7, LastPlayedDate: ago(0.01)}; trakt.playback = [{type: 'movie', progress: 40, paused_at: ago(0.5), movie: MOVIE.heat}];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'playback'"); stamp(ago(0.001), ago(0.5)); due(); await cron();
  assert.equal(fake.positions.length, spots, 'an older spot does not replace hers'); assert.equal(HELD[ALIEN].UserData.Played, true);
  // She carries on with it in another Trakt app: the later spot takes the place of hers, dated when she left it there (so Continue
  // Watching, newest first, has it in the right place), and What was synced says it was updated. Nothing is ticked.
  const moved = () => fake.positions.slice(spots).map(spot => [HELD[spot.id].Name, spot.ticks, spot.at]), point = (movie, progress, paused_at) => ({type: 'movie', progress, paused_at, movie}), ticked = fake.ticks.length;
  // Every spot Trakt holds is looked at again (as when its stamp moved for another title), so only the rules decide.
  const again = async list => {trakt.playback = list; sql("UPDATE sync SET stamps = json_set(stamps, '$.p', 1), checked = 0 WHERE person = 'ada'"); await cron();};
  const LATER = ago(0.001); HELD[HEAT].UserData = {PlaybackPositionTicks: 900e7, LastPlayedDate: ago(0.1)};
  trakt.playback = [point(MOVIE.heat, 60, LATER)]; stamp(trakt.activity.movies.watched_at, LATER); due(); await cron();
  assert.deepEqual(moved(), [['Heat', 3600e7, LATER]]); assert.deepEqual(HELD[HEAT].UserData, {PlaybackPositionTicks: 3600e7, LastPlayedDate: LATER}); assert.equal(fake.ticks.length, ticked);
  const listed = (await adaSite('GET', '/api/people/ada/matching/synced')).body.synced[0]; assert.deepEqual([listed.title, listed.detail, listed.to, listed.spot, listed.updated], ['Heat', 'Movie', 'here', true, true]);
  assert.deepEqual(sql("SELECT play FROM sent WHERE person = 'ada' AND place = 'here' AND title = 'Heat' AND play LIKE 'ir:%'"), [{play: `ir:movie/949@${LATER}`}]);
  // That spot came once: she goes back to an earlier one here, and it is not put over hers again. Nor is anything else:
  // a film her server has as watched keeps no spot (watched beats part-watched); spots she left out on her page stay out, under
  // either key a page gives one; and a spot the hub itself sent to Trakt as she paused here is not brought back as if it were new.
  HELD[HEAT].UserData = {PlaybackPositionTicks: 900e7, LastPlayedDate: ago(0.1)}; HELD[KNIGHT].UserData = {PlaybackPositionTicks: 300e7, LastPlayedDate: ago(0.1)};
  HELD[SEVEN].UserData = {PlaybackPositionTicks: 300e7, LastPlayedDate: ago(0.1)};
  const INCEPTION = pack('movie', 'tt1375666'), was = HELD[INCEPTION].UserData; HELD[INCEPTION].UserData = {PlaybackPositionTicks: 600e7, LastPlayedDate: ago(0.1)};
  for (const key of ['ip:movie/155', 'pt:movie/807']) assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: key})).status, 200);
  sql(`UPDATE plays SET scrobbled_at = unixepoch() - 30 WHERE person = 'ada' AND item = '${FILM}'`);
  const all = [point(MOVIE.heat, 60, LATER), point({title: 'Alien', ids: {imdb: 'tt0078748', tmdb: 348}}, 30, ago(0.0005)), point(MOVIE.knight, 50, ago(0.0005)), point({title: 'Se7en', ids: {imdb: 'tt0114369', tmdb: 807}}, 50, ago(0.0005)), point(MOVIE.inception, 45, ago(0.0003))];
  await again(all); assert.equal(moved().length, 1, JSON.stringify(moved()));
  assert.deepEqual(HELD[ALIEN].UserData.PlaybackPositionTicks, undefined, 'a watched film keeps no spot'); assert.equal(HELD[ALIEN].UserData.Played, true);
  assert.deepEqual([HEAT, KNIGHT, SEVEN, INCEPTION].map(id => HELD[id].UserData.PlaybackPositionTicks), [900e7, 300e7, 300e7, 600e7]);
  // The same spot on Trakt with nothing of the hub's sent near it is one she left in another app: it takes the place of hers.
  sql(`UPDATE plays SET scrobbled_at = unixepoch() - 7200 WHERE person = 'ada' AND item = '${FILM}'`); await again(all);
  assert.deepEqual(moved().slice(1), [['Inception', 2700e7, all[4].paused_at]]);
  // A spot within 1% of where hers is stays as it is, however much later (nothing to gain by writing it).
  HELD[HEAT].UserData = {PlaybackPositionTicks: 3030e7, LastPlayedDate: ago(0.1)}; await again([point(MOVIE.heat, 50, ago(0.0001))]); assert.equal(moved().length, 2);
  HELD[INCEPTION].UserData = was; HELD[KNIGHT].UserData = {}; HELD[SEVEN].UserData = {}; trakt.playback = [];
  // Trakt not answering: tried again later, quietly; only after three days does her page say so.
  trakt.refuseReads = true; due(); await cron(); trakt.refuseReads = false;
  const row = sql("SELECT failing, why, checked FROM sync WHERE person = 'ada'")[0]; assert.ok(row.failing > 0); assert.equal(row.why, 'Trakt didn’t answer just now.'); assert.ok(row.checked + 1200 > Date.now() / 1000, 'asked again when Trakt says, not before'); waited();
  due(); await cron(); assert.equal(sql("SELECT failing FROM sync WHERE person = 'ada'")[0].failing, null, 'a good look clears it');
});
test('Next Up: the latest episode of each show she watched on Trakt in the last 120 days is ticked here with its own date, a few a turn, once, and nothing goes back to Trakt', async () => {
  const due = () => sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"), reads = () => trakt.reads.map(read => read.where), MAY = Date.UTC(2026, 4, 1, 4);
  const show = (n, title) => ({title, ids: {trakt: 7700 + n, imdb: `tt77000${String(n).padStart(2, '0')}`, tmdb: 7700 + n}}), ticked = from => fake.ticks.slice(from).map(tick => `${HELD[tick.id].SeriesName} ${HELD[tick.id].ParentIndexNumber}x${HELD[tick.id].IndexNumber}`);
  // An episode as her server holds it, under its show, unticked unless said; and a show as Trakt has it: each episode with when
  // it was last watched (the show's own date is the latest of them, a special's included).
  const held = (of, season, episode, more = {}) => {
    const id = pack('episode', of.ids.imdb, season, episode), series = pack('series', of.ids.imdb);
    HELD[series] = {Id: series, Type: 'Series', Name: of.title, ProviderIds: {Tmdb: String(of.ids.tmdb), Imdb: of.ids.imdb}};
    HELD[id] = {Id: id, Type: 'Episode', SeriesId: series, SeriesName: of.title, ParentIndexNumber: season, IndexNumber: episode, RunTimeTicks: 6000e7, UserData: {}, ...more};
    return id;
  };
  const seen = (of, ...episodes) => ({plays: episodes.length, last_watched_at: episodes.map(([, , at]) => at).sort().at(-1), show: of,
    seasons: [...new Set(episodes.map(([season]) => season))].map(number => ({number, episodes: episodes.filter(([season]) => season === number).map(([, episode, at]) => ({number: episode, plays: 1, last_watched_at: at}))}))});
  const SEV = show(1, 'Severance'), OLD = show(2, 'Long Ago'), HAD = show(3, 'Seen Here'), OUT = show(4, 'Left Out'), HID = show(5, 'Hidden'), DROP = show(6, 'Dropped'), ODD = show(7, 'Numbered Apart'), TIE = show(8, 'Whole Season'), MORE = [show(9, 'Ninth'), show(10, 'Tenth'), show(11, 'Eleventh')], NONE = show(13, 'No Episode');
  const AT = {sev: ago(40), tie: ago(50), odd: ago(30), had: ago(19), more: [ago(60), ago(70), ago(100)]};
  // Severance: the one she watched most lately is 2x3, forty days back (a later episode watched before it, and a special watched
  // yesterday, are not it); she started it here once, so a play of it is kept here. A show last watched 130 days back; one Trakt
  // names no last episode for; one whose latest her server already has; one she left out on her page; one hidden and one dropped
  // on Trakt; one her server numbers differently; a season marked watched all at once.
  const SEV_EP = held(SEV, 2, 3); held(SEV, 2, 2); held(SEV, 3, 1); const OLD_EP = held(OLD, 1, 5), NONE_EP = held(NONE, 1, 1), HAD_EP = held(HAD, 1, 2, {UserData: {Played: true, LastPlayedDate: AT.had}}), OUT_EP = held(OUT, 1, 4), HID_EP = held(HID, 1, 1), DROP_EP = held(DROP, 1, 1);
  const ODD_EP = held(ODD, 3, 1, {Listed: false}); for (const n of [1, 2, 3]) held(TIE, 1, n); MORE.forEach(of => held(of, 4, 2));
  trakt.watched = [seen(OLD, [1, 5, ago(130)]), seen(SEV, [1, 1, ago(200)], [3, 1, ago(90)], [2, 2, ago(41)], [2, 3, AT.sev], [0, 1, ago(1)]), {...seen(NONE, [1, 1, ago(15)]), none: true}, seen(HAD, [1, 2, ago(20)]), seen(OUT, [1, 4, ago(25)]), seen(HID, [1, 1, ago(10)]), seen(DROP, [1, 1, ago(11)]),
    seen(ODD, [3, 1, AT.odd]), seen(TIE, [1, 1, AT.tie], [1, 3, AT.tie], [1, 2, AT.tie]), ...MORE.map((of, n) => seen(of, [4, 1, ago(110)], [4, 2, AT.more[n]]))];
  trakt.hidden = {progress_watched: [{type: 'show', show: HID}], dropped: [{type: 'show', show: DROP}]};
  assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: `i:show/${OUT.ids.tmdb}:1:4`})).status, 200);
  sql(`INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', '${SEV_EP}', 'Severance', 'Season 2 · Episode 3', 600, 6000, 'Strand · Mac', 0, unixepoch() - 45 * 86400, '' FROM hubs`);
  // The day's pass for plays that never reached Trakt, before any of it: whatever it has to send goes now, and is not counted below.
  due(); await cron(MAY); await heard(0); for (let n = 0; n < 5 && waiting().length; n++) {await pause(2500); await cron();}
  assert.deepEqual(waiting(), []);
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind IN ('backfill', 'hidden')"); trakt.calls = []; trakt.reads = [];
  const before = fake.ticks.length, posted = fake.watched.length, ONE = '/shows/progress/watched', queued = () => JSON.parse(sql("SELECT items FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'")[0].items);
  // Her next turn with nothing else to do: one short read of the shows she watched (no seasons or episodes in it), the shows she
  // hid or dropped, and then one read for each of the three shows this run takes, newest first: Severance, the one with no last
  // episode (done with), and the one her server already has.
  due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities', '/sync/watched/shows', '/users/hidden/progress_watched', '/users/hidden/dropped', ONE, ONE, ONE]);
  assert.match(trakt.reads[1].query, /extended=noseasons/); assert.deepEqual(trakt.reads.slice(4).map(read => read.query), Array(3).fill('specials=false&last_activity=watched'));
  assert.deepEqual(ticked(before), ['Severance 2x3']);
  // With the date Trakt has for that episode, which her server keeps: that is what Next Up goes by.
  assert.deepEqual(fake.ticks.slice(before).map(tick => tick.at), [AT.sev]); assert.equal(HELD[SEV_EP].UserData.LastPlayedDate, AT.sev); assert.equal(HELD[SEV_EP].UserData.Played, true);
  // The rest wait: only the shows inside 120 days were kept (not the old one), less the two hidden or dropped and these three.
  assert.deepEqual(queued().list.map(of => of.name), ['Left Out', 'Numbered Apart', 'Whole Season', 'Ninth', 'Tenth', 'Eleventh']);
  // The next runs carry on where this one stopped, three shows each, without asking Trakt for the list again: the one she left out
  // and the one her server numbers differently are not ticked, the season marked at once is (its last episode); then the last three.
  trakt.reads = []; await cron(); assert.deepEqual(reads(), ['/sync/last_activities', ONE, ONE, ONE]); assert.deepEqual(ticked(before), ['Severance 2x3', 'Whole Season 1x3']); assert.equal(queued().list.length, 3);
  trakt.reads = []; await cron(); assert.deepEqual(reads(), ['/sync/last_activities', ONE, ONE, ONE]);
  assert.deepEqual(ticked(before), ['Severance 2x3', 'Whole Season 1x3', 'Ninth 4x2', 'Tenth 4x2', 'Eleventh 4x2']); assert.deepEqual(fake.ticks.slice(before + 1).map(tick => tick.at), [AT.tie, ...AT.more]); assert.deepEqual(queued(), {page: 0, list: []});
  // Never ticked: the old one (and not given a newer date), the one with no last episode, the one she left out, the hidden and
  // the dropped, the one her server numbers differently (never guessed), and nothing but the latest of a show. The one her
  // server already had keeps its own date.
  for (const id of [OLD_EP, NONE_EP, OUT_EP, HID_EP, DROP_EP, ODD_EP, pack('episode', SEV.ids.imdb, 2, 2), pack('episode', SEV.ids.imdb, 3, 1), pack('episode', MORE[0].ids.imdb, 4, 1)]) assert.ok(!HELD[id]?.UserData?.Played, HELD[id]?.SeriesName);
  assert.equal(HELD[HAD_EP].UserData.LastPlayedDate, AT.had, 'left as it was');
  // What was synced lists each tick, as any other play brought here.
  const did = (await adaSite('GET', '/api/people/ada/matching/synced')).body.synced.slice(0, 5).map(item => [item.title, item.detail, item.to, item.spot]);
  assert.deepEqual(did.sort(), [['Eleventh', 'Season 4 · Episode 2', 'here', false], ['Ninth', 'Season 4 · Episode 2', 'here', false], ['Severance', 'Season 2 · Episode 3', 'here', false], ['Tenth', 'Season 4 · Episode 2', 'here', false], ['Whole Season', 'Season 1 · Episode 3', 'here', false]]);
  // Every key by hub and person: what is kept of it, and what was noted as sent.
  assert.deepEqual(sql("SELECT person, count(*) AS n FROM rows_cache WHERE kind = 'backfill' GROUP BY hub, person"), [{person: 'ada', n: 1}]);
  assert.deepEqual(sql(`SELECT DISTINCT person FROM sent WHERE play LIKE '%show/77%'`), [{person: 'ada'}]);
  // Done: a later turn asks Trakt its one cheap question and her server nothing. She unticks one here; it stays unticked.
  HELD[SEV_EP].UserData = {}; const signIns = fake.signIns; trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities']); assert.equal(fake.signIns, signIns);
  // Nothing bounced: not as it was ticked, and not on the day's pass for plays here that never reached Trakt, which looks at the
  // episode (she had started it here, and her server now has it watched) and finds it noted as something Trakt already has. Trakt's
  // history, as this stand-in gives it, does not list it, so nothing else could have held it back. Nor the day's look at Trakt
  // and MDBList, on a run her turn is not due in. Nor anything to MDBList.
  HELD[SEV_EP].UserData = {Played: true, LastPlayedDate: AT.sev};
  due(); await cron(MAY + 86400e3); sql("UPDATE sync SET checked = 9000000000 WHERE person = 'ada'"); await cron(MAY + 86400e3 + 300e3); await pause(600);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []); assert.equal(fake.watched.length, posted);
  assert.deepEqual(sql(`SELECT place, play, title FROM sent WHERE person = 'ada' AND play LIKE '%show/${SEV.ids.tmdb}:%' ORDER BY place`), [{place: 'here', play: `i:show/${SEV.ids.tmdb}:2:3`, title: 'Severance'}, {place: 'trakt', play: `w:show/${SEV.ids.tmdb}:2:3`, title: null}]);
  // Sync turned off and on again starts it over: Trakt is read once more, and what was ticked before is not ticked twice (the one
  // she unticked stays so).
  const stamps = sql("SELECT stamps FROM sync WHERE person = 'ada'")[0].stamps; HELD[SEV_EP].UserData = {};
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: true, earlier: true})).status, 200); assert.equal(sql("SELECT count(*) AS n FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'")[0].n, 1, 'kept while sync stays on');
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: true, earlier: true})).status, 200);
  assert.equal(sql("SELECT count(*) AS n FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'")[0].n, 0);
  sql(`UPDATE sync SET stamps = '${stamps}', checked = 0 WHERE person = 'ada'`); trakt.reads = []; const again = fake.ticks.length; await cron(); await cron(); await cron();
  assert.deepEqual(reads(), ['/sync/last_activities', '/sync/watched/shows', ONE, ONE, ONE, '/sync/last_activities', ONE, ONE, ONE, '/sync/last_activities', ONE, ONE, ONE]); assert.equal(fake.ticks.length, again); assert.ok(!HELD[SEV_EP].UserData.Played); assert.deepEqual(queued(), {page: 0, list: []});
  // A list too long to parse within a run (over a megabyte) is not parsed and not asked for again: Next Up is done with for her.
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'"); trakt.big = true; trakt.reads = []; due(); await cron();
  assert.deepEqual(reads(), ['/sync/last_activities', '/sync/watched/shows']); assert.deepEqual(queued(), {page: 0, list: [], big: true}); assert.equal(fake.ticks.length, again);
  trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities'], 'not tried every turn'); trakt.big = false;
  // With her progress kept in MDBList she gets none of it: her server reads MDBList itself, so nothing is read for it or written there.
  const NEW = show(12, 'Twelfth'), NEW_EP = held(NEW, 1, 1); trakt.watched = [seen(NEW, [1, 1, ago(3)])];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'; UPDATE people SET data = json_set(data, '$.lists', json('true')) WHERE id = 'ada'");
  const quiet = fake.signIns; trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities']); assert.equal(fake.signIns, quiet); assert.equal(fake.ticks.length, again); assert.equal(fake.watched.length, posted);
  assert.ok(!HELD[NEW_EP].UserData.Played); assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'ada' AND kind = 'backfill'"), []);
  // As she was, for what follows: progress here, nothing more for Next Up to do.
  sql("UPDATE people SET data = json_set(data, '$.lists', json('false')) WHERE id = 'ada'; DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'hidden'"); trakt.watched = []; trakt.hidden = {progress_watched: [], dropped: []};
  trakt.reads = []; due(); await cron(); assert.deepEqual(reads(), ['/sync/last_activities', '/sync/watched/shows']); trakt.reads = []; trakt.calls = [];
});
test('with progress in MDBList and sync on, what the daily look finds goes across by itself, through the outbox, once', async () => {
  trakt.refuse = 0;
  // Her progress in MDBList again (the key she saved, at once), and a day's look that found a play MDBList has and Trakt lacks.
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'});
  // Pulp Fiction just now; Forrest Gump a day ago, before she connected Trakt. She agreed to send earlier plays, then took it back.
  sql("UPDATE sync SET earlier = 0 WHERE person = 'ada'");
  const day = Date.UTC(2026, 6, 1, 5), at = Math.floor(Date.now() / 1000) - 5, found = JSON.stringify({since: 0, trakt: 1, mdblist: 2, toMdblist: [], toTrakt: [{kind: 'movie', tmdb: 680, imdb: 'tt0110912', name: 'Pulp Fiction', at}, {kind: 'movie', tmdb: 13, imdb: 'tt0109830', name: 'Forrest Gump', at: at - 86400}]});
  const looked = () => sql(`INSERT INTO drift (hub, person, day, result, at) SELECT id, 'ada', '2026-07-01', '${found}', unixepoch() FROM hubs WHERE true ON CONFLICT (hub, person) DO UPDATE SET day = excluded.day, result = excluded.result, work = NULL, fixed = NULL`);
  // Her sync turn is not due, so the run goes to the daily look.
  looked(); sql("UPDATE sync SET checked = 9000000000 WHERE person = 'ada'"); trakt.history = []; trakt.calls = [];
  await cron(day); await heard(1);
  assert.deepEqual(trakt.calls.map(call => [call.path, call.body.movies?.map(movie => movie.ids.tmdb)]), [['/sync/history', [680]]], 'not the one from before connecting');
  // Hers is never shown: it went across by itself, and the one held back is off the list too (so it is not tried every run).
  assert.deepEqual(sql("SELECT json_array_length(result, '$.toTrakt') AS n FROM drift WHERE person = 'ada'"), [{n: 0}]);
  // She deletes it on Trakt; the next look finds it missing again. It stays deleted.
  looked(); trakt.calls = []; await cron(day + 300e3); await pause(500); assert.deepEqual(trakt.calls, []);
  // A film finished in another Trakt app, with her progress in MDBList: added to her MDBList (her server reads it there), once.
  // One she left out on her page, from the daily look (kept by title and time), stays out.
  const ALIEN = {title: 'Alien', ids: {imdb: 'tt0078748', tmdb: 348}}, posted = fake.watched.length, out = ago(0.0002);
  assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: `movie/578@${Date.parse(out) / 1000}`})).status, 200);
  trakt.history = [{watched_at: ago(0.0001), type: 'movie', movie: ALIEN}, {watched_at: out, type: 'movie', movie: {title: 'Jaws', ids: {imdb: 'tt0073195', tmdb: 578}}}]; trakt.activity = {...trakt.activity, movies: {...trakt.activity.movies, watched_at: ago(0.0001)}};
  sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"); await cron();
  assert.deepEqual(fake.watched.slice(posted).map(body => body.movies?.map(movie => movie.ids.tmdb)), [[348]]);
  trakt.activity = {...trakt.activity, movies: {...trakt.activity.movies, watched_at: new Date().toISOString()}}; sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"); await cron();
  assert.equal(fake.watched.length, posted + 1, 'sent once');
  // Sync off, and Trakt disconnected, for what follows.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200);
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200); assert.deepEqual(sql("SELECT * FROM sync WHERE person = 'ada'"), []);
  sql("DELETE FROM drift WHERE person = 'ada'"); trakt.history = []; trakt.playback = null; lists.playback = null;
});
test('sync turned off is off both ways at once: what was waiting to be sent is dropped, a play here says nothing, Trakt is not read, her page’s passes are refused; what she watched meanwhile goes only if she ticks it', async () => {
  const GODFATHER = pack('movie', 'tt0068646'), film = {tmdb: 238, imdb: 'tt0068646'}, state = () => sql(`SELECT scrobbled FROM plays WHERE item = '${GODFATHER}'`)[0]?.scrobbled ?? null, MOON = pack('movie', 'tt1182345');
  HELD[GODFATHER] = {Id: GODFATHER, Type: 'Movie', Name: 'The Godfather', ProviderIds: {Tmdb: '238', Imdb: 'tt0068646'}, RunTimeTicks: 6000e7, UserData: {}};
  HELD[MOON] = {Id: MOON, Type: 'Movie', Name: 'Moon', ProviderIds: {Tmdb: '17431', Imdb: 'tt1182345'}, RunTimeTicks: 6000e7, UserData: {}};
  const played = async item => {
    await say('/Sessions/Playing', {ItemId: item, PositionTicks: 0}, 700); await pause(300);
    await say('/Sessions/Playing/Progress', {ItemId: item, PositionTicks: 300e7, IsPaused: false}, 400); await pause(300);
    await say('/Sessions/Playing/Stopped', {ItemId: item, PositionTicks: 5400e7}); await pause(300);
  };
  // She signs in to Trakt herself: asked, once. "Not now" is an answer: sync stays off, and her page does not ask again.
  const got = issue(), link = () => adaSite('POST', '/api/people/ada/scrobble/link', {access: got.access_token, refresh: got.refresh_token, lasts: got.expires_in, created: got.created_at, username: 'adatrakt', redirect: `${BASE}/api/trakt/callback`});
  assert.equal((await link()).status, 200); assert.deepEqual([(await matchingOf()).ask, (await matchingOf()).on], [true, false]);
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); assert.deepEqual([(await matchingOf()).ask, (await matchingOf()).on], [false, false]);
  // On. Trakt turns writes away for now, so what she watches waits in the outbox: a film finished.
  trakt.history = []; trakt.playback = []; sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind = 'playback'");
  await syncOn(); trakt.calls = []; trakt.refused = []; trakt.refuse = 1000;
  await played(GODFATHER);
  await pause(12_000); // the tries soon after, in the background, are over
  assert.deepEqual(waiting().map(call => call.kind), ['stop'], JSON.stringify(waiting())); assert.ok(trakt.refused.length > 0); assert.equal(state(), 'watched'); assert.ok((await matchingOf()).waiting > 0);
  // A heart of hers waits too, for Favorites: her other, separate switch.
  sql(`INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) SELECT id, 'ada', 'heart:movie:tt0068646', 'heart', '/sync/watchlist', '{"movies":[{"ids":{"tmdb":238}}]}', unixepoch(), 1, unixepoch() + 9000, 0 FROM hubs`);
  // She turns sync off. What waited to tell Trakt of her watching is dropped at once, not left; the heart stays. The film counts
  // as never sent, which it was not.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200);
  assert.deepEqual(waiting().map(call => call.kind), ['heart']); assert.equal(state(), null); assert.equal((await matchingOf()).on, false);
  // Trakt takes calls again, and has something new of hers from another app: the cron sends nothing and brings nothing back,
  // and does not even ask Trakt what changed.
  trakt.refuse = 0; trakt.calls = []; trakt.refused = []; trakt.reads = [];
  trakt.history = [{watched_at: ago(0.01), type: 'movie', movie: {title: 'Moon', ids: {imdb: 'tt1182345', tmdb: 17431}}}]; trakt.activity = {...trakt.activity, movies: {...trakt.activity.movies, watched_at: new Date().toISOString()}};
  const ticks = fake.ticks.length, posted = fake.watched.length;
  await cron(); await cron(); await pause(500);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.refused, []); assert.deepEqual(trakt.reads, []); assert.equal(fake.ticks.length, ticks); assert.equal(fake.watched.length, posted); assert.ok(!HELD[MOON].UserData.Played);
  // She watches the film again, pauses, finishes, ticks it: nothing goes, nothing is kept to go, and nothing is noted as told.
  await played(GODFATHER); await say(`/Users/${jf}/PlayedItems/${GODFATHER}`, {}); await pause(800);
  sql(`UPDATE plays SET updated = updated - 3600 WHERE item = '${GODFATHER}'`); await cron(); await pause(500);
  assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.refused, []); assert.deepEqual(waiting().map(call => call.kind), ['heart']); assert.equal(state(), null);
  sql(`UPDATE plays SET updated = unixepoch() - 60 WHERE item = '${GODFATHER}'`);
  // Her page's own passes do nothing either, and her manager cannot turn it on for her.
  assert.equal((await adaSite('POST', '/api/people/ada/matching/pass', {})).status, 409); assert.equal((await adaSite('POST', '/api/people/ada/compare/here-trakt', {})).status, 409);
  assert.equal((await owner('POST', '/api/people/ada/matching', {on: true, earlier: true})).status, 403); assert.equal((await matchingOf()).on, false);
  await pause(300); assert.deepEqual(trakt.calls, []); assert.deepEqual(trakt.reads, []);
  // (The heart has gone to Trakt meanwhile, as far as this test goes: calls of hers go one at a time, in order, behind it.)
  sql("DELETE FROM trakt_outbox WHERE person = 'ada' AND kind = 'heart'");
  // Turned on again: what she watched while it was off is among her earlier plays, listed for her, and stays off Trakt until she
  // ticks them. (Her server holds the film as watched: her app's tick went there.)
  const asked = (await adaSite('GET', '/api/people/ada/matching')).body; assert.ok(asked.plays.some(play => play.title === 'The Godfather'), JSON.stringify(asked.plays));
  trakt.history = []; await syncOn(); const first = (await adaSite('POST', '/api/people/ada/matching/pass', {})).body; assert.equal(first.trakt, 0, JSON.stringify(first));
  await pause(500); assert.deepEqual(trakt.calls, [], 'not without her tick');
  await syncOn(true); const second = (await adaSite('POST', '/api/people/ada/matching/pass', {})).body; assert.ok(second.trakt >= 1, JSON.stringify(second)); await heard(1);
  assert.ok(trakt.calls.some(call => call.path === '/sync/history' && call.body.movies?.some(movie => movie.ids.tmdb === film.tmdb)), JSON.stringify(trakt.calls));
  // And from here on what she plays goes as it plays, again.
  sql(`UPDATE sittings SET started = started - 7200, updated = updated - 7200 WHERE item = '${GODFATHER}'`); trakt.calls = [];
  await say('/Sessions/Playing', {ItemId: GODFATHER, PositionTicks: 0}, 300); await pause(300); await say('/Sessions/Playing/Progress', {ItemId: GODFATHER, PositionTicks: 280e7, IsPaused: false}, 20);
  assert.deepEqual((await heard(1)).map(call => call.path), ['/scrobble/start']);
  // As she was, for what follows: sync off, Trakt disconnected, and these two films taken away again.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200);
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200); assert.deepEqual(waiting(), []);
  sql(`DELETE FROM plays WHERE item = '${GODFATHER}'; DELETE FROM sittings WHERE item = '${GODFATHER}'; DELETE FROM sent WHERE person = 'ada' AND (play LIKE '%movie/238%' OR item = '${GODFATHER}'); DELETE FROM drift WHERE person = 'ada'`);
  trakt.history = []; trakt.playback = null; trakt.calls = []; trakt.reads = [];
});
test('a save brings a few setups in step at once, and nobody waits on rows that did not change', async () => {
  const state = (await owner('GET', '/api/state')).body.hub, before = state.defaults.unreleased;
  // A change at the hub touches the hub's own setup and everyone's: read and written two at a time, never all at once, never one by one.
  fake.slow = 150; fake.most = 0;
  assert.equal((await owner('PUT', '/api/hub', {...state, defaults: {...state.defaults, unreleased: !before}})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'}); fake.slow = 0;
  assert.equal(fake.most, 2, 'two setups at a time');
  for (const [, home] of fake.homes) assert.equal(home.config.hideUnreleasedDigital, !before);
  // Nothing changed: no setup is read or written again.
  fake.most = 0; assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(fake.most, 0);

  const look = async path => {fake.catalogs = []; const rows = (await owner('GET', path)).body.rows; return {rows, asked: fake.catalogs.splice(0)};};
  const first = await look('/api/previews');
  assert.ok(first.asked.length >= 4 && first.rows['trending-movies']?.length === 2, 'the rows are asked for once');
  assert.deepEqual((await look('/api/previews')).asked, [], 'then kept');
  // The same row for two people, and for the hub: each from their own setup, never one shared answer.
  const ada = await look('/api/previews?person=ada'), ben = await look('/api/previews?person=ben');
  const [hubAt, adaAt, benAt] = [first, ada, ben].map(found => found.rows['trending-movies'][0].split('/')[3]);
  assert.equal(new Set([hubAt, adaAt, benAt]).size, 3);
  assert.equal(adaAt, playerOf('Ada')[0]); assert.equal(benAt, playerOf('Ben')[0]);
  assert.deepEqual((await look('/api/previews?person=ada')).asked, []);

  // Rows only put in another order: nothing asked again. One row turned on: only that row.
  const now = (await owner('GET', '/api/state')).body.hub, rows = now.rows;
  const put = async next => {const hub_ = (await owner('GET', '/api/state')).body.hub; assert.equal((await owner('PUT', '/api/hub', {...hub_, rows: next})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});};
  await put([...rows].reverse()); assert.deepEqual((await look('/api/previews')).asked, []);
  const off = rows.find(item => item.id === 'popular-movies'); assert.equal(off?.on, false);
  await put(rows.map(item => item.id === 'popular-movies' ? {...item, on: true} : item));
  const turned = await look('/api/previews'); assert.equal(turned.asked.length, 1); assert.ok(turned.rows['popular-movies']);
  // Ada follows the hub's Home: on her own setup, only that row is asked for too.
  const hers = await look('/api/previews?person=ada'); assert.equal(hers.asked.length, 1); assert.ok(hers.rows['popular-movies']);
  // Blurring episode pictures changes no row's posters: nothing asked again. A setting that changes every row (the posters) asks for
  // every row again.
  const blur = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...blur, defaults: {...blur.defaults, spoilers: !blur.defaults.spoilers}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual((await look('/api/previews')).asked, []);
  const plain = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...plain, defaults: {...plain.defaults, posters: 'plain'}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal((await look('/api/previews')).asked.length, turned.asked.length + first.asked.length);
  const back = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...back, rows, defaults: {...back.defaults, posters: plain.defaults.posters, unreleased: before, spoilers: blur.defaults.spoilers}})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});

  // Someone removed and added again under the same name is new: nothing kept for the one before comes back.
  const person = {rows: null, settings: {}, can: {arrange: false, add: false, playback: false}, trakt: false, lists: false};
  assert.equal((await owner('PUT', '/api/people/dee', {...person, name: 'Dee', groupId: 'mein'})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  const old = (await look('/api/previews?person=dee')).rows['trending-movies'][0], oldAt = playerOf('Dee')[0];
  assert.equal((await owner('DELETE', '/api/people/dee')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'dee'"), []);
  assert.equal((await owner('PUT', '/api/people/dee', {...person, name: 'Dee', groupId: 'mein'})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  const again = await look('/api/previews?person=dee');
  assert.notEqual(playerOf('Dee')[0], oldAt); assert.ok(again.asked.length > 0); assert.notEqual(again.rows['trending-movies'][0], old);
  assert.equal((await owner('DELETE', '/api/people/dee')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
});
test('a setup another request is still making is waited for quietly; one that never finished is said once', async () => {
  const person = {rows: null, settings: {}, can: {arrange: false, add: false, playback: false}, trakt: false, lists: false};
  assert.equal((await owner('PUT', '/api/people/cy', {...person, name: 'Cy', groupId: 'mein'})).status, 200);
  // Another sync claimed Cy's setup a moment ago (the site syncs on opening and after each save, and two can overlap).
  sql("INSERT INTO ops (hub, kind, target, state, created, updated) SELECT id, 'create-aiom', 'cy', 'requested', unixepoch(), unixepoch() FROM hubs");
  const busy = (await owner('POST', '/api/sync', {})).body;
  assert.deepEqual(busy, {state: 'partial', message: '', more: true});
  // Claimed long ago and never finished: that is said, and nothing is made twice.
  sql("UPDATE ops SET created = created - 600 WHERE target = 'cy'"); const made = fake.made;
  assert.match((await owner('POST', '/api/sync', {})).body.message, /needs a look/); assert.equal(fake.made, made);
  sql("DELETE FROM ops WHERE target = 'cy'"); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.ok(playerOf('Cy'));
  assert.equal((await owner('DELETE', '/api/people/cy')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(playerOf('Cy'), undefined);
});
test('under the Kids limit Trending asks TMDB for rated titles, and only the folders made for children come', async () => {
  // Ben is under the Kids limit: his Trending rows are TMDB searches for rated, recent, popular titles, so they come full.
  const trending = catalogsOf('Ben').filter(item => /^tmdb\.(trending|discover\.\w+\.trending)/.test(item.id)).map(item => [item.id, item.type, item.name, item.metadata?.discover?.params?.certification]).sort((a, b) => a[1].localeCompare(b[1]));
  assert.deepEqual(trending, [['tmdb.discover.movie.trending-kids.aiohub', 'movie', 'Trending Movies', 'G|PG'], ['tmdb.discover.series.trending-kids.aiohub', 'series', 'Trending Shows', 'TV-Y|TV-Y7|TV-G|TV-PG']]);
  // Ada has no limit: Trakt's public Trending charts, read by AIOMetadata's own Trakt app (nobody's Trakt, no key of the hub's).
  assert.deepEqual(catalogsOf('Ada').filter(item => /trending/.test(item.id)).map(item => [item.id, item.source, item.metadata?.traktEndpoint]).sort(), [['trakt.trending.movies', 'trakt', 'trending/movies'], ['trakt.trending.shows', 'trakt', 'trending/shows']]);
  // Ben gets the rows for children too, on, right after his own rows, without anyone adding them; switching one off is his choice.
  assert.deepEqual(collectionsOf('Ben').filter(item => /sg-(kids-channels|animation-studios)$/.test(item.id)).map(item => [item.title, item.folders.length]), [['Kids’ Channels', 9], ['Animation Studios', 8]]);
  // Each folder has its own tile: Kometa's art at a pinned commit, ours for CBBC; the art carries the name, so the title is hidden.
  const tiles = collectionsOf('Ben').filter(item => /sg-(kids-channels|animation-studios)$/.test(item.id)).flatMap(item => item.folders);
  assert.ok(tiles.every(folder => /^https:\/\/raw\.githubusercontent\.com\/(Kometa-Team\/Default-Images\/[0-9a-f]{40}|miraclx\/aiohub\/main\/public\/covers)\/.+\.jpg$/.test(folder.coverImageUrl) && folder.hideTitle));
  assert.equal(tiles.find(folder => folder.title === 'CBBC').coverImageUrl, 'https://raw.githubusercontent.com/miraclx/aiohub/main/public/covers/cbbc.jpg');
  assert.match(tiles.find(folder => folder.title === 'Nick Jr.').coverImageUrl, /\/network\/color\/Nick%20Jr\.jpg$/);
  assert.equal(catalogsOf('Ben').find(item => item.id === 'tmdb.discover.series.network-166.aiohub').metadata.discover.params.certification, 'TV-Y|TV-Y7|TV-G|TV-PG');
  const ben = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ben');
  const pick = async on => {const me = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ben'); assert.equal((await owner('PUT', '/api/people/ben', {name: me.name, groupId: me.groupId, rows: me.rows, picks: {...me.picks, 'sg.kids-channels': on}, settings: me.settings, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});};
  await pick(false); assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ben').rows, ben.rows, 'still following');
  assert.ok(!collectionsOf('Ben').some(item => /sg-kids-channels$/.test(item.id)));
  await pick(true); assert.ok(collectionsOf('Ben').some(item => /sg-kids-channels$/.test(item.id)));
  // Folders: with Ada under the Kids limit and her MDBList key reading the lists, only the children's folders come; a collection with
  // none of them (by service) does not come at all. Under Teen she keeps every folder but Adult Animation.
  const limitAda = async limit => {const me = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
    assert.equal((await owner('PUT', '/api/people/ada', {name: me.name, groupId: me.groupId, rows: me.rows, settings: {...me.settings, limit}, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v})).status, 200);
    assert.deepEqual(await syncAll(), {state: 'ok'});
    return Object.fromEntries(collectionsOf('Ada').filter(item => !item.id.startsWith('aiohub-')).map(item => [item.title, item.folders.map(folder => folder.title)]));};
  const all = await limitAda('all');
  assert.ok(all['Movies by Genre'].includes('Adult Animation') && all['Movies by Service']?.length > 0, JSON.stringify(Object.keys(all)));
  const kids = await limitAda('kids');
  const services = ['Apple TV', 'Netflix', 'Disney+', 'HBO Max', 'Prime Video', 'Paramount+'];
  assert.deepEqual(kids, {'Movies by Service': services, 'Shows by Service': services, 'Movies by Genre': ['Animated Comedies', 'Animation', 'Family Movie Night', 'Favorite Cartoons', 'Kids', 'Lovable Monsters'], 'Shows by Genre': ['Kids', 'Nature'], 'Mixed Genre Collections': ['Learning Corner']});
  // A service's folder is TMDB's where-to-watch for it, rated and made for children, never the public list.
  const netflix = collectionsOf('Ada').find(item => item.title === 'Shows by Service').folders.find(folder => folder.title === 'Netflix').sources[0].catalogId, search = catalogsOf('Ada').find(item => item.id === netflix);
  assert.equal(netflix, 'tmdb.discover.series.service-8-gb-kids.aiohub');
  assert.deepEqual(search.metadata.discover.params, {with_watch_providers: '8', watch_region: 'GB', with_watch_monetization_types: 'flatrate', sort_by: 'popularity.desc', 'vote_count.gte': '10', with_genres: '16|10751|10762', certification_country: 'US', certification: 'TV-Y|TV-Y7|TV-G|TV-PG'});
  const teen = await limitAda('teen');
  assert.deepEqual(teen['Movies by Genre'], all['Movies by Genre'].filter(title => title !== 'Adult Animation')); assert.deepEqual(teen['Movies by Service'], all['Movies by Service']);
  assert.equal(collectionsOf('Ada').find(item => item.title === 'Shows by Service').folders.find(folder => folder.title === 'Crunchyroll').sources[0].catalogId, 'mdblist.99202', 'a service TMDB has no place for keeps its list');
  await limitAda('all');
});
test('a group that differs from the hub has a setup of its own, used by no app, so its Home shows as someone in it starts with', async () => {
  const before = fake.homes.size;
  // A new group under the Kids limit, nobody in it yet.
  assert.equal((await owner('PUT', '/api/groups/little', {name: 'Little ones', rows: null, settings: {limit: 'kids'}, paused: false})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(fake.homes.size, before + 1);
  const [uuid, home] = [...fake.homes.entries()].find(([, item]) => item.config.ageRating === 'PG' && !item.config.jellyfinUserName);
  assert.equal(home.config.allowUnratedContent, false);
  assert.ok(home.config.catalogs.some(item => item.id === 'tmdb.discover.movie.trending-kids.aiohub'));
  assert.ok((home.config.collections ?? []).some(item => /sg-kids-channels$/.test(item.id)), 'the rows for children are on it');
  // Its Home tab's posters come from that setup, not the hub's or anyone's.
  fake.catalogs = []; const shown = (await owner('GET', '/api/previews?group=little')).body.rows, asked = fake.catalogs.splice(0);
  assert.ok(asked.length > 0 && asked.every(item => item.startsWith(`${uuid}/`)), JSON.stringify(asked));
  assert.ok(asked.some(item => item.endsWith('/tmdb.discover.movie.trending-kids.aiohub')) && Object.keys(shown).length > 0);
  // No app ever uses it: nobody's player setup points at it.
  for (const [, item] of fake.homes) if (item.config.jellyfinUserName) assert.ok(!JSON.stringify(item.config).includes(uuid));
  // Like the hub again: the setup goes. So does it when the group goes.
  const little = (await owner('GET', '/api/state')).body.hub.groups.find(item => item.id === 'little');
  assert.equal((await owner('PUT', '/api/groups/little', {name: 'Little ones', rows: null, settings: {}, paused: false, v: little.v})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(fake.homes.size, before);
  assert.equal((await owner('DELETE', '/api/groups/little')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(fake.homes.size, before);
});
/* ---------- For you ---------- */
const DEC = Date.UTC(2026, 11, 1, 5, 5), MIN = 60e3;
const fyOf = name => catalogsOf(name).filter(item => /\.fy-|foryou_|^flixpatrol\./.test(item.id));
const picksOf = person => JSON.parse(sql(`SELECT picks FROM foryou WHERE person = '${person}'`)[0]?.picks ?? 'null');
const settle = async time => {for (let n = 0; n < 6 && (sql('SELECT hub FROM foryou_sync').length || n === 0); n++) await cron(time + n * 5 * MIN); assert.deepEqual(sql('SELECT hub FROM foryou_sync'), []);};
const setPerson = async (id, change) => {const me = (await owner('GET', '/api/state')).body.hub.people.find(item => item.id === id);
  const got = await owner('PUT', `/api/people/${id}`, {name: me.name, groupId: me.groupId, rows: me.rows, picks: me.picks, settings: me.settings, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v, ...change(me)}); assert.equal(got.status, 200, JSON.stringify(got.body));};
const KINDS = ['because', 'series', 'pickup', 'crew', 'genres', 'different', 'seasonal', 'top10'], only = (...kinds) => KINDS.filter(kind => !kinds.includes(kind));
// The order of the kinds nobody changed (FOR_YOU_ORDER in data.ts).
const KINDS_IN_ORDER = ['series', 'pickup', 'because', 'crew', 'genres', 'seasonal', 'top10', 'different'];
test('For you: three places through each person’s Home, on their own setups only, each switched off like a Trakt row', async () => {
  assert.equal((await owner('GET', '/api/state')).body.hub.front, true);
  // Before anything is picked each place holds something popular, the same for anyone, so any sync writes the same.
  const ids = catalogsOf('Ada').map(item => item.id), at = id => ids.indexOf(id);
  assert.deepEqual(fyOf('Ada').map(item => [item.id, item.name]), [['tmdb.discover.movie.fy-popular-movie.aiohub', 'Popular movies lately'], ['tmdb.discover.series.fy-popular-series.aiohub', 'Popular shows lately'], ['tmdb.discover.movie.fy-acclaimed-movie.aiohub', 'Well-liked movies of recent years']]);
  // After the second, fifth and eighth shared rows.
  assert.ok(at('trakt.trending.shows') < at('tmdb.discover.movie.fy-popular-movie.aiohub') && at('tmdb.discover.movie.fy-popular-movie.aiohub') < ids.lastIndexOf('tmdb.top_rated'), JSON.stringify(ids));
  assert.ok(at('tmdb.discover.series.fy-popular-series.aiohub') < at('tmdb.discover.movie.fy-acclaimed-movie.aiohub'));
  // Under the Kids limit the same, asked for rated titles; shows only made for children (AIOMetadata sends TMDB no rating for shows).
  const ben = Object.fromEntries(fyOf('Ben').map(item => [item.id, item.metadata.discover.params]));
  assert.equal(ben['tmdb.discover.movie.fy-popular-movie-kids.aiohub'].certification, 'G|PG'); assert.equal(ben['tmdb.discover.series.fy-popular-series-kids.aiohub'].with_genres, '16|10751|10762');
  // Nothing for the hub's own setup or a group's: only a person has anything to pick for.
  for (const [, home] of fake.homes) if (!home.config.jellyfinUserName) assert.ok(!home.config.catalogs.some(item => /\.fy-|foryou_/.test(item.id)));
  // Switched off while following the Home above: a pick, like a Trakt row; they still follow it.
  await setPerson('ada', me => ({picks: {...me.picks, 'for-you-2': false}})); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(item => item.id === 'ada').rows, null);
  assert.deepEqual(fyOf('Ada').map(item => item.name), ['Popular movies lately', 'Well-liked movies of recent years']);
  await setPerson('ada', me => ({picks: {...me.picks, 'for-you-2': true}})); assert.deepEqual(await syncAll(), {state: 'ok'});
  // A place saved with a Home keeps no name of its own.
  const hubNow = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...hubNow, rows: [{id: 'for-you-1', title: 'Mine now', kind: 'For you', source: 'Picked daily', origin: 'hub', on: true, core: true}, ...hubNow.rows]})).status, 200);
  assert.equal((await owner('GET', '/api/state')).body.hub.rows[0].title, 'For you');
  assert.equal((await owner('PUT', '/api/hub', {...(await owner('GET', '/api/state')).body.hub, rows: hubNow.rows})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
});
test('once a day after five (UTC) each person is picked for, one a run, and then a run of its own brings their setups in step', async () => {
  // What Ada watched (MDBList): Inception yesterday, The Dark Knight, an episode of Breaking Bad, Fight Club; and here, Fargo a month ago.
  lists.recent = {movies: [{last_watched_at: ago(1), movie: MOVIE.inception}, {last_watched_at: ago(2), movie: MOVIE.knight}, {last_watched_at: ago(6), movie: MOVIE.fight}], shows: [], episodes: [{last_watched_at: ago(4), episode: {season: 1, number: 2, show: BB}}]};
  sql("DELETE FROM rows_cache WHERE kind LIKE 'mdb_history%'"); sql("DELETE FROM plays WHERE person = 'ada'"); const hubId = sql('SELECT id FROM hubs')[0].id;
  sql(`INSERT INTO plays (hub, person, item, title, detail, updated, ids) VALUES ('${hubId}', 'ada', 'fargo-s1e3', 'Fargo', 'Season 1 · Episode 3', ${Math.floor(Date.now() / 1000) - 30 * DAY}, '{"show":{"ids":{"tmdb":60622}},"episode":{"season":1,"number":3}}')`);
  const versions = () => playerOf('Ada')[1].config.configVersion;
  // Someone picked for before waits for five; someone never picked for (just added) is picked at any hour.
  await cron(DEC - 40 * MIN); assert.deepEqual(sql('SELECT person, day FROM foryou ORDER BY person'), [{person: 'ada', day: '2000-01-01'}, {person: 'ben', day: '2000-01-01'}], 'nothing before five');
  sql("DELETE FROM foryou WHERE person = 'ben'"); await cron(DEC - 35 * MIN);
  assert.deepEqual(sql('SELECT person, day FROM foryou ORDER BY person'), [{person: 'ada', day: '2000-01-01'}, {person: 'ben', day: '2026-12-01'}], 'someone new is picked before five');
  sql('DELETE FROM foryou'); sql('DELETE FROM foryou_sync');
  fake.tmdb = []; await cron(DEC);
  assert.deepEqual(sql('SELECT person FROM foryou'), [{person: 'ada'}], 'one person a run');
  // Asked from nothing kept, everything she could be picked fits in the run's calls: Top 10, worked out last, was reached too.
  assert.ok(fake.tmdb.length > 0 && fake.tmdb.length + fake.flix.length <= 22 && fake.flix.length === 1, `${fake.tmdb.length} calls`);
  const v = versions(); await cron(DEC + 5 * MIN);
  assert.deepEqual(sql('SELECT person FROM foryou ORDER BY person'), [{person: 'ada'}, {person: 'ben'}]); assert.equal(versions(), v, 'nobody’s setup is written while people are still being picked');
  await settle(DEC + 10 * MIN);
  const ada = picksOf('ada'), kinds = Object.values(ada).map(pick => pick.kind);
  assert.deepEqual(Object.keys(ada), ['for-you-1', 'for-you-2', 'for-you-3']); assert.equal(new Set(Object.values(ada).map(pick => pick.key)).size, 3);
  assert.equal(new Set(kinds).size, 3, `one of each kind: ${kinds}`); assert.ok(kinds.some(kind => ['because', 'series', 'pickup'].includes(kind)), kinds.join());
  // Each place's catalog is named by its pick, in the same write.
  assert.deepEqual(fyOf('Ada').map(item => item.name), Object.values(ada).map(pick => pick.name));
  // The manager sees the names on her Home tab.
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.people.find(item => item.id === 'ada').forYou, Object.fromEntries(Object.entries(ada).map(([place, pick]) => [place, pick.name])));
  // Ben is under the Kids limit: only TMDB searches for films, asked for rated titles. With nothing watched, the season leads.
  const ben = Object.values(picksOf('ben'));
  assert.ok(ben.every(pick => !pick.serve && !pick.chart && (pick.kind === 'popular' || (['crew', 'genres', 'seasonal'].includes(pick.kind) && pick.type === 'movie'))), JSON.stringify(ben));
  assert.equal(ben[0].name, 'Christmas movies');
  assert.deepEqual(fyOf('Ben')[0].metadata.discover.params, {with_keywords: '207317', sort_by: 'popularity.desc', 'vote_count.gte': '50', 'primary_release_date.lte': '__tmdb_date__:today:to', certification_country: 'US', certification: 'G|PG'});
  // Done for the day: later runs ask nothing more and write nothing.
  const kept = sql('SELECT person, at FROM foryou ORDER BY person'), after = versions(); fake.tmdb = [];
  await cron(DEC + 40 * MIN); assert.deepEqual(sql('SELECT person, at FROM foryou ORDER BY person'), kept); assert.deepEqual(fake.tmdb, []);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.equal(versions(), after, 'a sync from the site writes the same');
});
test('a pick the hub fills comes from its own id, less what was watched, never under a limit; name and titles change in one write', async () => {
  // Only "because you watched": her three newest titles each have a row, the newest first.
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('because')}}));
  await cron(DEC + 60 * MIN); await settle(DEC + 65 * MIN);
  assert.deepEqual(Object.values(picksOf('ada')).map(pick => [pick.name, pick.serve]), [['Because you watched Inception', 'foryou_because_m27205'], ['Because you watched The Dark Knight', 'foryou_because_m155'], ['Because you watched Breaking Bad', 'foryou_because_s1396']]);
  // The site is told each pick's kind, to say where it came from; the hub's background work counts who is picked for today.
  const state = (await owner('GET', '/api/state')).body.hub;
  assert.deepEqual(state.people.find(person => person.id === 'ada').forYouKinds, {'for-you-1': 'because', 'for-you-2': 'because', 'for-you-3': 'because'});
  assert.equal(state.jobs.forYouHour, 5); assert.ok(state.jobs.everyone >= 2 && state.jobs.pickedAt > 0);
  const rows = fyOf('Ada'), inception = rows.find(item => item.id === 'custom.aiohub_rows.movie.foryou_because_m27205');
  assert.equal(inception.name, 'Because you watched Inception'); assert.match(inception.sourceUrl, /\/api\/rows\/r[\w-]{20,}\/catalog\/movie\/foryou_because_m27205\.json$/);
  // Its titles: TMDB's recommendations for Inception, less Fight Club and The Dark Knight, which she watched.
  const metas = (await (await fetch(inception.sourceUrl)).json()).metas;
  assert.equal(metas[0].id, 'tmdb:157336'); assert.ok(!metas.some(item => ['tmdb:550', 'tmdb:155', 'tmdb:27205'].includes(item.id)) && metas.length === 10, JSON.stringify(metas.map(item => item.id)));
  // Next in the series: The Dark Knight's films that are out and she has not seen, in release order.
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('series')}}));
  const before = playerOf('Ada')[1].config.configVersion; await cron(DEC + 90 * MIN); await settle(DEC + 95 * MIN);
  const after = playerOf('Ada')[1].config, series = after.catalogs.find(item => item.id === 'custom.aiohub_rows.movie.foryou_series_263');
  // One write took the old rows out and put the new one in, name and address together.
  assert.equal(after.configVersion, before + 1); assert.equal(series.name, 'Next in The Dark Knight'); assert.ok(!after.catalogs.some(item => /foryou_because/.test(item.id)));
  assert.deepEqual((await (await fetch(series.sourceUrl)).json()).metas.map(item => item.name), ['Batman Begins', 'The Dark Knight Rises']);
  // An address is read by its id alone, whatever is picked today: the old one still lists Inception's.
  assert.equal((await (await fetch(inception.sourceUrl)).json()).metas[0].id, 'tmdb:157336');
  // Under a limit the hub fills nothing, whatever is asked: Ben's own address answers empty for the same row.
  const bens = catalogsOf('Ben').find(item => item.id === 'custom.aiohub_rows.all.history');
  if (bens) assert.deepEqual((await (await fetch(bens.sourceUrl.replace('/catalog/all/history.json', '/catalog/movie/foryou_because_m27205.json'))).json()).metas, []);
});
test('a director she watched, her genre, and a show she left: searches AIOMetadata runs, and a row of shows to pick back up', async () => {
  // Under the Kids limit she would have no director's row: none of his films is rated for children, so it is not picked.
  await setPerson('ada', me => ({settings: {...me.settings, limit: 'kids', forYouOff: only('crew')}}));
  await cron(DEC + 96 * MIN); await settle(DEC + 98 * MIN);
  assert.deepEqual(Object.values(picksOf('ada')).map(pick => pick.kind), ['popular', 'popular', 'popular']);
  await setPerson('ada', me => ({settings: {...me.settings, limit: 'all', forYouOff: only('crew', 'genres', 'pickup')}}));
  await cron(DEC + 100 * MIN); await settle(DEC + 105 * MIN);
  const picks = Object.values(picksOf('ada'));
  assert.deepEqual(picks.map(pick => pick.name).sort(), ['Drama movies for you', 'More from Christopher Nolan', 'Pick back up']);
  const rows = Object.fromEntries(fyOf('Ada').map(item => [item.name, item]));
  assert.equal(rows['More from Christopher Nolan'].metadata.discover.params.with_crew, '525');
  assert.deepEqual(rows['Drama movies for you'].metadata.discover.params, {with_genres: '18', sort_by: 'vote_average.desc', 'vote_count.gte': '500', 'primary_release_date.lte': '__tmdb_date__:today:to'});
  // Fargo: last played a month ago, at season 1 episode 3, with five seasons out. Breaking Bad, watched this week, is not in it.
  // Its id says upnext, so AIOMetadata does not hide a show part watched from it.
  assert.equal(rows['Pick back up'].id, 'custom.aiohub_rows.series.foryou_upnext_60622');
  assert.deepEqual((await (await fetch(rows['Pick back up'].sourceUrl)).json()).metas, [{id: 'tmdb:60622', type: 'series', name: 'Fargo'}]);
});
test('Top 10 comes from FlixPatrol through AIOMetadata, and a chart the hub put in is taken out again; picks move on the next day', async () => {
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('top10')}}));
  await cron(DEC + 120 * MIN); await settle(DEC + 125 * MIN);
  assert.deepEqual(fyOf('Ada').filter(item => item.source === 'flixpatrol').map(item => [item.id, item.type, item.name, item.metadata.countrySlug]),
    [['flixpatrol.netflix.world.movie', 'movie', 'Top 10 movies on Netflix in the world', 'world'], ['flixpatrol.netflix.world.series', 'series', 'Top 10 shows on Netflix in the world', 'world']]);
  assert.deepEqual(fake.flix, ['global'], 'the charts are read once a day per hub (the world’s are global.json)');
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: ['top10']}}));
  await cron(DEC + 150 * MIN); await settle(DEC + 155 * MIN);
  assert.ok(!catalogsOf('Ada').some(item => item.id.startsWith('flixpatrol.')), 'gone with the pick');
  // The next day what filled a place yesterday counts for less, so the places move on.
  const today = Object.values(picksOf('ada')).map(pick => pick.key);
  await cron(DEC + 86400e3); await cron(DEC + 86400e3 + 5 * MIN); await settle(DEC + 86400e3 + 10 * MIN);
  assert.deepEqual(JSON.parse(sql("SELECT before FROM foryou WHERE person = 'ada'")[0].before).slice(0, 3), today);
  assert.notDeepEqual(Object.values(picksOf('ada')).map(pick => pick.key), today);
  // Back to following the hub's choice (her own empty list would keep every kind on whatever the hub mutes).
  await setPerson('ada', me => {const {forYouOff: _, ...settings} = me.settings; return {settings};}); sql("DELETE FROM plays WHERE item = 'fargo-s1e3'");
});
test('a fourth place holds nothing until it has a pick; a kind muted for the whole hub is picked for nobody', async () => {
  const day3 = DEC + 2 * 86400e3, hubNow = (await owner('GET', '/api/state')).body.hub, place = n => ({id: `for-you-${n}`, title: 'For you', kind: 'For you', source: 'Picked daily', origin: 'hub', on: true, core: true});
  await cron(day3); await cron(day3 + 5 * MIN); await settle(day3 + 10 * MIN);
  assert.equal(Object.values(picksOf('ben'))[0].kind, 'seasonal');
  // The hub's Home gets a fourth place and the hub mutes the season.
  assert.equal((await owner('PUT', '/api/hub', {...hubNow, rows: [...hubNow.rows, place(1), place(2), place(3), place(4)], defaults: {...hubNow.defaults, forYouOff: ['seasonal']}})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(fyOf('Ada').length, 3, 'nothing for the new place before its pick');
  await cron(day3 + 30 * MIN); await cron(day3 + 35 * MIN); await settle(day3 + 40 * MIN);
  assert.deepEqual(Object.keys(picksOf('ada')), ['for-you-1', 'for-you-2', 'for-you-3', 'for-you-4']); assert.equal(fyOf('Ada').length, 4);
  assert.ok(!Object.values(picksOf('ben')).some(pick => pick.kind === 'seasonal') && !Object.values(picksOf('ada')).some(pick => pick.kind === 'seasonal'), JSON.stringify(sql('SELECT person, day, sig FROM foryou')) + JSON.stringify([picksOf('ada'), picksOf('ben')]));
  const back = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...back, rows: hubNow.rows, defaults: hubNow.defaults})).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
});
// Runs the cron from `time` (each person's day's picking) until everyone is picked for that day, then until their setups are in step.
const pickDay = async time => {
  const day = new Date(time).toISOString().slice(0, 10);
  for (let n = 0; n < 12 && sql(`SELECT 1 FROM foryou WHERE day != '${day}'`).length; n++) await cron(time + n * 5 * MIN);
  assert.deepEqual(sql(`SELECT person FROM foryou WHERE day != '${day}'`), []); await settle(time + 60 * MIN);
};
const keysOn = person => Object.values(picksOf(person)).map(pick => pick.key);
test('a change to someone’s places or kinds of pick is picked for on the next run at any hour; the day’s own picking still starts at five', async () => {
  const day4 = DEC + 3 * 86400e3, early = day4 - 3 * 60 * MIN;
  // The hub's Home went back to three places after the last picking: before five, both are picked for again on the next runs, as of that day.
  await cron(early); await cron(early + 5 * MIN); await settle(early + 10 * MIN);
  assert.deepEqual(sql('SELECT person, day FROM foryou ORDER BY person'), [{person: 'ada', day: '2026-12-03'}, {person: 'ben', day: '2026-12-03'}]);
  assert.deepEqual(Object.keys(picksOf('ada')), ['for-you-1', 'for-you-2', 'for-you-3']); assert.equal(fyOf('Ada').length, 3);
  // Nothing else changed: nobody is picked for again before five.
  const kept = sql('SELECT person, at FROM foryou ORDER BY person'); await cron(early + 40 * MIN); assert.deepEqual(sql('SELECT person, at FROM foryou ORDER BY person'), kept);
  // She keeps only because-you-watched: the next run picks for her alone, and the run after brings her setup in step.
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('because')}}));
  await cron(early + 45 * MIN);
  assert.ok(Object.values(picksOf('ada')).every(pick => pick.kind === 'because'), JSON.stringify(picksOf('ada')));
  assert.deepEqual(sql("SELECT person, at FROM foryou WHERE person = 'ben'"), kept.filter(row => row.person === 'ben'), 'one person a run, and only who changed');
  await settle(early + 50 * MIN); assert.ok(fyOf('Ada').length === 3 && fyOf('Ada').every(item => /foryou_because_/.test(item.id)), JSON.stringify(fyOf('Ada').map(item => item.id)));
  assert.deepEqual(sql('SELECT person, day FROM foryou ORDER BY person'), [{person: 'ada', day: '2026-12-03'}, {person: 'ben', day: '2026-12-03'}], 'still as of that day');
  // At five the day's own picking comes as before.
  await cron(day4); await cron(day4 + 5 * MIN); await settle(day4 + 10 * MIN);
  assert.deepEqual(sql('SELECT person, day FROM foryou ORDER BY person'), [{person: 'ada', day: '2026-12-04'}, {person: 'ben', day: '2026-12-04'}]);
});
test('older watching has its turn in because-you-watched: two titles from months ago, a different two each day, read from deeper in her Trakt history', async () => {
  const day5 = DEC + 4 * 86400e3, day6 = DEC + 5 * 86400e3, OLD = {680: 'Pulp Fiction', 13: 'Forrest Gump', 949: 'Heat'};
  // Her Trakt: four titles this week, thirty more in the weeks before (each a few times), and three films months ago, past the
  // first hundred plays Trakt gives at once.
  trakt.expiresIn = 7 * 86400; await connect();
  const play = (days, movie) => ({watched_at: ago(days), type: 'movie', movie});
  trakt.history = [play(1, MOVIE.inception), play(2, MOVIE.knight), {watched_at: ago(4), type: 'episode', episode: {season: 1, number: 2}, show: BB}, play(6, MOVIE.fight),
    ...Array.from({length: 120}, (_, n) => play(8 + Math.floor(n / 4) * 0.5, film(200 + Math.floor(n / 4)))), play(90, MOVIE.pulp), play(100, MOVIE.gump), play(120, MOVIE.heat)];
  const olderAsked = () => fake.tmdb.map(where => /^movie\/(\d+)\/recommendations$/.exec(where)?.[1]).filter(id => OLD[id]);
  const historyReads = () => trakt.reads.filter(read => read.where === '/sync/history' && !/start_at/.test(read.query ?? '')).length;
  // From nothing kept: neither her history nor TMDB's answers.
  sql("DELETE FROM rows_cache WHERE (person = 'ada' AND kind LIKE 'history%') OR person = '#tmdb'"); fake.tmdb = []; trakt.reads = [];
  await pickDay(day5);
  // Her four newest titles and two of the older ones seed rows: still six asks. Trakt was read two pages deep for them, not more.
  const first = olderAsked();
  assert.equal(new Set(first).size, 2, JSON.stringify(fake.tmdb)); assert.equal(fake.tmdb.filter(where => /recommendations$/.test(where)).length, 6, JSON.stringify(fake.tmdb));
  assert.equal(historyReads(), 2);
  const names = Object.values(picksOf('ada')).map(pick => pick.name);
  // The next day another two: the one left out yesterday is among them.
  fake.tmdb = []; await pickDay(day6);
  const second = olderAsked();
  assert.deepEqual(second, Object.keys(OLD).filter(id => !first.includes(id)), JSON.stringify(fake.tmdb));
  // An older title's row can take a place (its own recency counts as a fixed share, not nothing); the row's name is as ever.
  names.push(...Object.values(picksOf('ada')).map(pick => pick.name));
  assert.ok(names.some(name => Object.values(OLD).some(title => name === `Because you watched ${title}`)), names.join(' / '));
  // From any time: the two newest titles and four older, so all three older ones seed a row today, picked or among the options.
  await setPerson('ada', me => ({settings: {...me.settings, forYouBecause: 'any'}})); await cron(day6 + 62 * MIN);
  const seeded = [...Object.values(picksOf('ada')), ...JSON.parse(sql("SELECT pool FROM foryou WHERE person = 'ada'")[0].pool).options].map(pick => pick.key);
  assert.ok(Object.keys(OLD).every(id => seeded.includes(`because:m${id}`)), seeded.join());
  await setPerson('ada', me => {const {forYouBecause: _, ...settings} = me.settings; return {settings};});
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200); trakt.history = [];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind LIKE 'history%'");
});
test('something different: a well-liked movie genre she has not been watching, a new one each day, rated under a limit, and left out when switched off', async () => {
  const day6 = DEC + 5 * 86400e3, day7 = DEC + 6 * 86400e3, watched = ['878', '28', '80', '18'];
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('different')}}));
  await cron(day6 + 70 * MIN); await settle(day6 + 75 * MIN);
  const [pick] = Object.values(picksOf('ada')), row = fyOf('Ada')[0];
  assert.equal(pick.kind, 'different'); assert.match(pick.name, /^Something different: [A-Z][\w -]+ movies$/);
  assert.equal(row.name, pick.name); assert.ok(!watched.includes(row.metadata.discover.params.with_genres), row.metadata.discover.params.with_genres);
  assert.deepEqual({...row.metadata.discover.params, with_genres: '*'}, {with_genres: '*', sort_by: 'vote_average.desc', 'vote_count.gte': '1000', 'primary_release_date.lte': '__tmdb_date__:today:to'});
  // Under the Kids limit it is still picked, as TMDB is asked for rated titles, and from a genre that suits children.
  await setPerson('ada', me => ({settings: {...me.settings, limit: 'kids'}}));
  await cron(day6 + 80 * MIN); await settle(day6 + 85 * MIN); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(Object.values(picksOf('ada'))[0].kind, 'different'); assert.equal(fyOf('Ada')[0].metadata.discover.params.certification, 'G|PG');
  assert.ok(['16', '12', '35', '10751', '14', '10402'].includes(fyOf('Ada')[0].metadata.discover.params.with_genres), fyOf('Ada')[0].metadata.discover.params.with_genres);
  // The next day another genre.
  await pickDay(day7);
  assert.equal(Object.values(picksOf('ada'))[0].kind, 'different'); assert.notEqual(Object.values(picksOf('ada'))[0].key, pick.key);
  // Switched off, it is picked no more.
  await setPerson('ada', me => ({settings: {...me.settings, limit: 'all', forYouOff: ['different']}}));
  await cron(day7 + 70 * MIN); await settle(day7 + 75 * MIN);
  assert.ok(!Object.values(picksOf('ada')).some(item => item.kind === 'different') && !fyOf('Ada').some(item => /fy-different/.test(item.id)), JSON.stringify(picksOf('ada')));
});
test('with nothing new watched the places move on through what there is, not back and forth between two sets', async () => {
  // Nothing changes from day to day (the kind that changes each day is off): the last few days' picks count for less, the latest most.
  const days = [];
  for (let n = 7; n < 11; n++) {await pickDay(DEC + n * 86400e3); days.push(keysOn('ada').sort().join());}
  for (let n = 2; n < days.length; n++) assert.notEqual(days[n], days[n - 2], days.join(' / '));
  const before = JSON.parse(sql("SELECT before FROM foryou WHERE person = 'ada'")[0].before);
  assert.ok(before.length > 3 && before.length <= 12, JSON.stringify(before));
  await setPerson('ada', me => {const {forYouOff: _, ...settings} = me.settings; return {settings};});
});
const poolOf = person => JSON.parse(sql(`SELECT pool FROM foryou WHERE person = '${person}'`)[0]?.pool ?? '{}');
const detailOf = async (who = owner) => (await who('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').forYouDetail;
const place_ = (place, body, who = adaSite, person = 'ada') => who('POST', `/api/people/${person}/foryou/${place}`, body);
test('each pick keeps what it came from, and the day’s pick keeps its other options and why the other kinds have nothing', async () => {
  const day = DEC + 11 * 86400e3; await pickDay(day);
  const picks = picksOf('ada'), pool = poolOf('ada'), on = Object.values(picks).map(pick => pick.key);
  // Her Home says when her places were picked and the hour the day's picking starts.
  const mine = (await adaSite('GET', '/api/state')).body.hub;
  assert.equal(mine.forYouHour, 5); assert.equal(mine.people[0].pickedAt, sql("SELECT at FROM foryou WHERE person = 'ada'")[0].at);
  // A pick worked out from a title says which, and when she watched it; the kind's facts otherwise. The site words them.
  for (const pick of [...Object.values(picks), ...pool.options]) {
    if (pick.kind === 'because') {assert.equal(`Because you watched ${pick.why.title}`, pick.name); assert.ok(pick.why.seen > 0 && /^[ms]\d+$/.test(pick.seed), JSON.stringify(pick));}
    else if (pick.kind === 'crew') assert.ok(pick.why.who && pick.why.title && pick.seed, JSON.stringify(pick));
    else if (['genres', 'different', 'top10'].includes(pick.kind)) assert.ok(pick.why.title, JSON.stringify(pick));
  }
  // About ten other options, best first, none of them on a place; and each kind with nothing, with why.
  assert.ok(pool.options.length >= 5 && pool.options.length <= 10, JSON.stringify(pool.options.map(pick => pick.key)));
  assert.ok(!pool.options.some(pick => on.includes(pick.key)));
  // Places and options come in the order of the kinds: one of each kind that has something, then round again.
  const kinds = [...Object.values(picks), ...pool.options].map(pick => pick.kind).filter(kind => kind !== 'popular'), firsts = [...new Set(kinds)];
  assert.deepEqual(firsts, KINDS_IN_ORDER.filter(kind => firsts.includes(kind))); assert.deepEqual(kinds.slice(0, firsts.length), firsts, kinds.join());
  assert.equal(pool.none.pickup, 'none', JSON.stringify(pool.none));
  // The site is told the names, kinds and reasons, never what fills a row.
  const detail = await detailOf(adaSite);
  assert.deepEqual(Object.keys(detail.places), Object.keys(picks)); assert.deepEqual(detail.options.map(pick => pick.key), pool.options.map(pick => pick.key)); assert.deepEqual(detail.never, []);
  assert.ok(![...Object.values(detail.places), ...detail.options].some(pick => pick.params || pick.serve || pick.chart || pick.score !== undefined));
  // Ben, under the Kids limit, with nothing watched: what the hub fills is not for him, and the rest has too little to go on.
  const ben = poolOf('ben').none;
  assert.equal(ben.because, 'limit'); assert.equal(ben.top10, 'limit'); assert.equal(ben.genres, 'watching');
});
test('an option goes in at once and as often as wanted, without asking TMDB, and the apps follow; never one on another row; hers or her manager’s', async () => {
  const day = DEC + 11 * 86400e3, before = picksOf('ada'), {options} = await detailOf(), option = options.at(-1);
  assert.equal((await place_('for-you-2', {use: option.key}, adaSite, 'ben')).status, 403);
  assert.equal((await place_('trending-movies', {use: option.key})).status, 400); assert.equal((await place_('for-you-2', {})).status, 400);
  fake.tmdb = []; assert.equal((await place_('for-you-2', {use: option.key})).status, 200);
  const after = picksOf('ada');
  assert.equal(after['for-you-2'].key, option.key); assert.deepEqual([after['for-you-1'], after['for-you-3']], [before['for-you-1'], before['for-you-3']]); assert.deepEqual(fake.tmdb, []);
  // What it held is among the options again, and counts as lately picked; the option it took is on a row now, so no other row can have it.
  assert.ok(poolOf('ada').options.some(pick => pick.key === before['for-you-2'].key) && !poolOf('ada').options.some(pick => pick.key === option.key));
  assert.equal(JSON.parse(sql("SELECT before FROM foryou WHERE person = 'ada'")[0].before)[0], before['for-you-2'].key);
  assert.equal((await place_('for-you-3', {use: option.key}, owner)).status, 409);
  assert.ok(!(await detailOf()).options.some(pick => Object.values(picksOf('ada')).some(on => on.key === pick.key)));
  // Her apps get it as they get any pick: the hub's setups are brought in step.
  assert.equal(sql('SELECT hub FROM foryou_sync').length, 1); await settle(day + 100 * MIN);
  assert.deepEqual(fyOf('Ada').map(item => item.name), Object.values(picksOf('ada')).map(pick => pick.name));
  // As often as wanted, by her or her manager.
  assert.equal((await place_('for-you-2', {use: before['for-you-2'].key}, owner)).status, 200); assert.equal(picksOf('ada')['for-you-2'].key, before['for-you-2'].key);
  await settle(day + 110 * MIN);
});
test('a row kept stays through the daily pick until let go; a kept pick that may no longer be used there is let go', async () => {
  const day = DEC + 12 * 86400e3; await pickDay(day);
  const low = (await detailOf()).options.at(-1);
  assert.equal((await place_('for-you-3', {use: low.key})).status, 200); await settle(day + 70 * MIN);
  // Keeping changes nothing in the apps.
  assert.equal((await place_('for-you-3', {keep: true})).status, 200); assert.equal(picksOf('ada')['for-you-3'].keep, true);
  assert.equal((await detailOf(adaSite)).places['for-you-3'].keep, true); assert.deepEqual(sql('SELECT hub FROM foryou_sync'), []);
  await pickDay(day + 86400e3);
  assert.equal(picksOf('ada')['for-you-3'].key, low.key); assert.equal(picksOf('ada')['for-you-3'].keep, true);
  assert.ok(!Object.entries(picksOf('ada')).some(([place, pick]) => place !== 'for-you-3' && pick.key === low.key));
  // Choosing another option for a kept row keeps the row kept, with the new one.
  const other = (await detailOf()).options[0];
  assert.equal((await place_('for-you-3', {use: other.key})).status, 200); assert.deepEqual([picksOf('ada')['for-you-3'].key, picksOf('ada')['for-you-3'].keep], [other.key, true]);
  assert.equal((await place_('for-you-3', {use: low.key})).status, 200); await settle(day + 86400e3 + 70 * MIN);
  // Let go, it changes at the next daily pick.
  assert.equal((await place_('for-you-3', {keep: false})).status, 200); assert.equal(picksOf('ada')['for-you-3'].keep, undefined);
  await pickDay(day + 2 * 86400e3); assert.notEqual(picksOf('ada')['for-you-3'].key, low.key);
  // Kept, then its kind switched off: it goes, as any pick of a kind switched off.
  const kept = picksOf('ada')['for-you-1'];
  assert.equal((await place_('for-you-1', {keep: true})).status, 200);
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: [kept.kind]}})); await cron(day + 2 * 86400e3 + 70 * MIN);
  assert.ok(!Object.values(picksOf('ada')).some(pick => pick.kind === kept.kind || pick.keep), JSON.stringify(picksOf('ada')));
  assert.equal(poolOf('ada').none[kept.kind], 'off');
  await setPerson('ada', me => {const {forYouOff: _, ...settings} = me.settings; return {settings};}); await settle(day + 2 * 86400e3 + 75 * MIN);
});
test('“Not from this title again”: the row changes at once, and nothing is picked from that title until it counts again', async () => {
  const day = DEC + 15 * 86400e3; await pickDay(day);
  const [place, pick] = Object.entries(picksOf('ada')).find(([, item]) => item.seed);
  // A row not worked out from a title has no title to leave out.
  const plain = Object.keys(picksOf('ada')).find(other => !picksOf('ada')[other].seed);
  if (plain) assert.equal((await place_(plain, {never: true})).status, 409);
  assert.equal((await place_(place, {never: true})).status, 200);
  const now = picksOf('ada');
  assert.notEqual(now[place]?.key, pick.key); assert.notEqual(now[place]?.seed, pick.seed);
  assert.ok(!poolOf('ada').options.some(item => item.seed === pick.seed)); assert.equal(sql('SELECT hub FROM foryou_sync').length, 1);
  assert.deepEqual((await detailOf(adaSite)).never, [{seed: pick.seed, title: pick.why.title}]);
  await settle(day + 70 * MIN);
  // The next day it seeds nothing: no row, no option.
  await pickDay(day + 86400e3);
  assert.ok(![...Object.values(picksOf('ada')), ...poolOf('ada').options].some(item => item.seed === pick.seed), JSON.stringify([picksOf('ada'), poolOf('ada').options]));
  // It counts again, from the next pick.
  assert.equal((await adaSite('POST', '/api/people/ada/foryou/never', {seed: pick.seed})).status, 200);
  assert.deepEqual((await detailOf()).never, []);
});
// A run of the cron may go to other work first (Trakt sync, the day's Trakt and MDBList look, a few steps a run): runs until
// hers is picked for again.
const atOf = () => sql("SELECT at FROM foryou WHERE person = 'ada'")[0].at;
const repick = async time => {const was = atOf(); for (let n = 0; n < 12 && atOf() === was; n++) await cron(time + n * MIN);};
test('rows fill from the top of the order of the kinds, round again when there are more rows than kinds; the setting is checked', async () => {
  const day = DEC + 17 * 86400e3; await pickDay(day);
  // Each row from the next kind in her order that has something today, one of each.
  const kinds = Object.values(picksOf('ada')).map(pick => pick.kind), none = poolOf('ada').none;
  assert.deepEqual(kinds, KINDS_IN_ORDER.filter(kind => !none[kind]).slice(0, 3), JSON.stringify([kinds, none]));
  // One moved to the top fills the first row.
  await setPerson('ada', me => ({settings: {...me.settings, forYouOrder: ['different', 'series', 'pickup', 'because', 'crew', 'genres', 'seasonal', 'top10']}}));
  await repick(day + 70 * MIN);
  assert.equal(picksOf('ada')['for-you-1'].kind, 'different', JSON.stringify(picksOf('ada')));
  // Two kinds on for three rows: round again from the top, a second of the first kind (another title), before any stand-in.
  await setPerson('ada', me => {const {forYouOrder: _, ...settings} = me.settings; return {settings: {...settings, forYouOff: only('because', 'crew')}};}); await repick(day + 71 * MIN);
  const two = Object.values(picksOf('ada'));
  assert.deepEqual(two.map(pick => pick.kind), ['because', 'crew', 'because'], JSON.stringify(two)); assert.notEqual(two[0].seed, two[2].seed);
  // A row kept stays and counts as its kind's row: with crew first now, the other two are crew's, then because's second.
  assert.equal((await place_('for-you-1', {keep: true})).status, 200);
  await setPerson('ada', me => ({settings: {...me.settings, forYouOrder: ['crew', 'series', 'pickup', 'because']}})); await repick(day + 72 * MIN);
  const kept = Object.values(picksOf('ada'));
  assert.deepEqual(kept.map(pick => [pick.kind, !!pick.keep]), [['because', true], ['crew', false], ['because', false]], JSON.stringify(kept)); assert.equal(kept[0].key, two[0].key);
  assert.equal((await place_('for-you-1', {keep: false})).status, 200);
  // Checked as it is saved: known kinds only, each once; the rest of the order is made up from the default.
  await setPerson('ada', me => ({settings: {...me.settings, forYouOrder: ['top10', 'bogus', 'top10']}}));
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').settings.forYouOrder, ['top10']);
  const me = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal((await owner('PUT', '/api/people/ada', {name: me.name, groupId: me.groupId, rows: me.rows, picks: me.picks, settings: {...me.settings, forYouBecause: 'sometimes'}, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v})).status, 400);
  assert.equal((await owner('PUT', '/api/people/ada', {name: me.name, groupId: me.groupId, rows: me.rows, picks: me.picks, settings: {...me.settings, forYouOrder: 'top10'}, can: me.can, paused: me.paused, trakt: me.trakt, lists: me.lists, v: me.v})).status, 400);
  // Less of a kind (from a row's sheet) saves her order with it one step down, and she is picked for again under it.
  const less = ['series', 'pickup', 'crew', 'because', 'genres', 'seasonal', 'top10', 'different'], at = atOf();
  await setPerson('ada', me => ({settings: {...me.settings, forYouOrder: less}}));
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').settings.forYouOrder, less);
  await repick(day + 75 * MIN); assert.notEqual(atOf(), at);
  await setPerson('ada', me => {const {forYouOrder: _, forYouOff: _o, ...settings} = me.settings; return {settings};}); await cron(day + 80 * MIN); await settle(day + 85 * MIN);
});
test('a finished watch picks one row again within minutes, with what was just watched: the lowest not kept, once a title, a few times a day', async () => {
  const day = DEC + 18 * 86400e3, fresh = () => JSON.parse(sql("SELECT fresh FROM foryou WHERE person = 'ada'")[0].fresh);
  await setPerson('ada', me => ({settings: {...me.settings, forYouOff: only('because', 'crew')}})); await pickDay(day);
  const picking = async time => {for (let n = 0; n < 12 && fresh().due; n++) await cron(time + n * MIN);};
  const before = picksOf('ada'), dueNow = async () => {for (let i = 0; i < 40 && !fresh().due; i++) await pause(150); return fresh().due;};
  // She plays The Matrix to the end on her TV (95%): noted as finished, and the next run picks her lowest row again.
  await say('/Sessions/Playing', {ItemId: MATRIX, PositionTicks: 0}, 700); await pause(400);
  await say('/Sessions/Playing/Stopped', {ItemId: MATRIX, PositionTicks: 5700e7}); assert.ok(await dueNow(), JSON.stringify(fresh()));
  fake.tmdb = []; await picking(day + 70 * MIN);
  const after = picksOf('ada');
  assert.deepEqual([after['for-you-1'], after['for-you-2']], [before['for-you-1'], before['for-you-2']], 'only one row changes');
  assert.equal(after['for-you-3'].name, 'Because you watched The Matrix', JSON.stringify(after)); assert.equal(fresh().due, 0); assert.equal(fresh().at.length, 1);
  assert.ok(fake.tmdb.length + fake.flix.length <= 22, `${fake.tmdb.length} calls`);
  // What it held counts as lately picked; her apps get it as any pick, The Matrix Reloaded first.
  assert.equal(JSON.parse(sql("SELECT before FROM foryou WHERE person = 'ada'")[0].before)[0], before['for-you-3'].key);
  assert.equal(sql('SELECT hub FROM foryou_sync').length, 1); await settle(day + 75 * MIN);
  const row = fyOf('Ada').find(item => item.id === 'custom.aiohub_rows.movie.foryou_because_m603');
  assert.equal((await (await fetch(row.sourceUrl)).json()).metas[0].name, 'The Matrix Reloaded');
  // The same title finished again counts no more.
  const was = sql("SELECT picks, fresh FROM foryou WHERE person = 'ada'")[0];
  await say('/Sessions/Playing', {ItemId: MATRIX, PositionTicks: 0}, 700); await pause(400); await say('/Sessions/Playing/Stopped', {ItemId: MATRIX, PositionTicks: 5800e7}); await pause(800);
  await cron(day + 90 * MIN); assert.deepEqual(sql("SELECT picks, fresh FROM foryou WHERE person = 'ada'")[0], was);
  // Another title, with her lowest row kept: the row above it is the one picked again.
  assert.equal((await place_('for-you-3', {keep: true})).status, 200); const held = picksOf('ada');
  await say('/Sessions/Playing', {ItemId: OTHER, PositionTicks: 0}, 700); await pause(400); await say('/Sessions/Playing/Stopped', {ItemId: OTHER, PositionTicks: 5900e7}); assert.ok(await dueNow());
  await picking(day + 95 * MIN);
  const now = picksOf('ada'); assert.deepEqual([now['for-you-1'], now['for-you-3']], [held['for-you-1'], held['for-you-3']]); assert.equal(fresh().at.length, 2);
  assert.equal(now['for-you-2'].kind, 'crew'); assert.equal(now['for-you-2'].name, 'More from Lana Wachowski');
  await settle(day + 100 * MIN);
  // A few a day at most: past that a finish is let go, and nothing changes.
  sql(`UPDATE foryou SET fresh = json_set(fresh, '$.due', ${Math.floor(Date.now() / 1000)}, '$.at', json('[${[1, 2, 3].map(n => Math.floor(Date.now() / 1000) - n * 60).join(',')}]')) WHERE person = 'ada'`);
  const capped = picksOf('ada'); await picking(day + 105 * MIN);
  assert.deepEqual(picksOf('ada'), capped); assert.equal(fresh().due, 0); assert.deepEqual(sql('SELECT hub FROM foryou_sync'), []);
  assert.equal((await place_('for-you-3', {keep: false})).status, 200);
  // A file that runs longer than listed (6000 seconds listed) is not finished by its share of the listed length. The sitting that
  // first plays past the listed end cannot know where the end is: no finish. The next one, left at 95% of the listed length, is
  // well short of where the first got to: no finish either. One that gets to within 5% of that point is.
  const LONGER = 'a1110100-0000-eaf7-78ff-ffffff090000', keptFresh = sql("SELECT fresh FROM foryou WHERE person = 'ada'")[0].fresh, calls = trakt.calls.length;
  const sit = async to => {sql(`UPDATE sittings SET started = started - 7200, updated = updated - 7200 WHERE item = '${LONGER}'`); await say('/Sessions/Playing', {ItemId: LONGER, PositionTicks: 0}, 700); await pause(400); await say('/Sessions/Playing/Stopped', {ItemId: LONGER, PositionTicks: to * 1e7}); await pause(800);};
  await sit(6500); assert.deepEqual(sql(`SELECT over FROM plays WHERE item = '${LONGER}'`), [{over: 6500}]); assert.ok(!fresh().seen?.includes(LONGER) && !fresh().due, JSON.stringify(fresh()));
  await sit(5700); assert.ok(!fresh().seen?.includes(LONGER) && !fresh().due, JSON.stringify(fresh()));
  await sit(6400); assert.ok(await dueNow()); assert.ok(fresh().seen.includes(LONGER));
  assert.deepEqual(sql(`SELECT position, reached FROM sittings WHERE item = '${LONGER}' ORDER BY started`), [{position: 6500, reached: 0}, {position: 5700, reached: 6500}, {position: 6400, reached: 6500}]);
  // Taken away again, with the finish it noted, for the tests after.
  sql(`DELETE FROM plays WHERE item = '${LONGER}'; DELETE FROM sittings WHERE item = '${LONGER}'; UPDATE foryou SET fresh = '${keptFresh.replace(/'/g, "''")}' WHERE person = 'ada'`); trakt.calls.length = calls;
  await setPerson('ada', me => {const {forYouOff: _, ...settings} = me.settings; return {settings};}); await settle(day + 110 * MIN);
});
test('Recommended rows without Trakt: worked out once a day from what was watched, less what was watched or is on a watchlist; under a content limit only what is rated for it, Trakt’s own included', async () => {
  const get = async url => (await (await fetch(url)).json()).metas.map(item => item.id), hubId = sql('SELECT id FROM hubs')[0].id, NIGHT = Date.UTC(2027, 1, 1, 22, 5);
  const urlOf = (name, type) => playerOf(name)[1].config.catalogs.find(item => item.id === `custom.aiohub_rows.${type}.recommended`).sourceUrl, kept = () => sql("SELECT person, json_extract(items, '$.limit') AS made FROM rows_cache WHERE kind = 'recs' ORDER BY person");
  // Cy: no accounts at all, and nothing watched yet, so no rows of his own.
  assert.equal((await owner('PUT', '/api/people/cy', {rows: null, settings: {}, can: {arrange: false, add: false, playback: false}, trakt: false, lists: false, name: 'Cy', groupId: 'mein'})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual(rowsOf(playerOf('Cy')[1].config), []);
  // He watched two films and a show here: the two rows and Recently Watched come to his Home, the rows empty until worked out.
  const play = (ids, title, detail, ago) => `('${hubId}', 'cy', '${title}', '${title}', '${detail}', '${JSON.stringify(ids)}', unixepoch() - ${ago})`;
  sql(`INSERT INTO plays (hub, person, item, title, detail, ids, updated) VALUES ${[play({movie: {ids: {tmdb: 27205, imdb: 'tt1375666'}}}, 'Inception', 'Movie', 100), play({movie: {ids: {tmdb: 155, imdb: 'tt0468569'}}}, 'The Dark Knight', 'Movie', 200),
    play({show: {ids: {tmdb: 1396, imdb: 'tt0903747'}}, episode: {season: 1, number: 1}}, 'Breaking Bad', 'Season 1 · Episode 1', 300)].join(', ')}`);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Cy')[1].config), [['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true], ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', true]]);
  assert.deepEqual(await get(urlOf('Cy', 'movie')), []);
  // Ada, with her MDBList and no Trakt: a film she watched whose recommendations hold one already on her watchlist.
  await setPerson('ada', () => ({rows: null, picks: {}}));
  TMDB['movie/4242/recommendations'] = {results: [{id: 4243, title: 'On her list', vote_average: 7}, {id: 4244, title: 'Not on it', vote_average: 7}, {id: 4245, title: 'Adult', adult: true, vote_average: 7}]};
  lists.recent = {movies: [{last_watched_at: ago(-30), movie: {title: 'Seed', ids: {imdb: 'tt4242000', tmdb: 4242}}}], shows: [], episodes: []}; lists.watchlist = [{id: 4243, mediatype: 'movie', imdb_id: 'tt4243000', title: 'On her list'}];
  sql("DELETE FROM rows_cache WHERE person = 'ada' AND (kind LIKE 'mdb%' OR kind = 'recs')");
  // Runs before the hour it starts at leave it be (the tests' own hour: RECS_HOUR in tests/run.sh; four in the morning otherwise).
  for (let n = 0; n < 30; n++) await cron(NIGHT + n * MIN);
  assert.deepEqual(kept(), []);
  // From then, a run with nothing else to do works out one person's rows: everyone with a Recommended row on, once.
  const late = n => Date.UTC(2027, 1, 1, 23, n % 58); for (let n = 0; n < 60 && kept().length < 3; n++) await cron(late(n));
  assert.deepEqual(kept(), [{person: 'ada', made: 'all'}, {person: 'ben', made: 'kids'}, {person: 'cy', made: 'all'}]);
  // His rows: TMDB's recommendations for each title he watched, one from each in turn, never one he watched, naming none of them.
  assert.deepEqual(await get(urlOf('Cy', 'movie')), [550, 272, 157336, 7100, 1124, 7101, 77, 7102, 49026, 7103, 7000, 7104, 7001, 7105, 7002, 7106, 7003, 7107, 7004, 7005].map(id => `tmdb:${id}`));
  assert.deepEqual(await get(urlOf('Cy', 'series')), Array.from({length: 10}, (_, n) => `tmdb:${7300 + n}`));
  assert.deepEqual(await get(urlOf('Cy', 'movie').replace(/\.json$/, '/skip=20.json')), []);
  // Hers leave out what is on her watchlist, and anything TMDB marks adult. Each person's are kept under their own name.
  const hers = await get(urlOf('Ada', 'movie')); assert.ok(hers.includes('tmdb:4244'), hers.join(' ')); assert.ok(!hers.includes('tmdb:4243') && !hers.includes('tmdb:4245') && !hers.includes('tmdb:4242'));
  assert.ok(!(await get(urlOf('Cy', 'movie'))).includes('tmdb:4244'));
  // Kept a day: later runs ask TMDB nothing more. The manager's Background work says when it last ran, and for how many.
  const asked = fake.tmdb.length; for (let n = 0; n < 3; n++) await cron(late(n)); assert.equal(fake.tmdb.length, asked);
  const jobs = (await owner('GET', '/api/state')).body.hub.jobs; assert.equal(jobs.recs, 3); assert.ok(jobs.recsAt > 0 && jobs.recsDue > 0);
  // Under a content limit, at once: nothing is listed that is not known to be rated for it, so nothing until the ratings are looked up.
  await setPerson('cy', me => ({settings: {...me.settings, limit: 'kids'}}));
  assert.deepEqual(await get(urlOf('Cy', 'movie')), []); assert.deepEqual(await get(urlOf('Cy', 'series')), []);
  const made = person => kept().find(row => row.person === person)?.made, until = async (person, limit) => {for (let n = 0; n < 60 && made(person) !== limit; n++) await cron(late(n)); assert.equal(made(person), limit);};
  fake.tmdb = []; await until('cy', 'kids');
  // Each title's US rating is asked of TMDB, a film and a show in turn. Kids: G and PG films (every rating a film carries must
  // pass), TV-PG and below. One with no US rating, or one TMDB did not answer for, is left out.
  assert.ok(fake.tmdb.includes('movie/7100/release_dates') && fake.tmdb.includes('tv/7300/content_ratings'), fake.tmdb.join(' '));
  assert.deepEqual(await get(urlOf('Cy', 'movie')), ['tmdb:7100', 'tmdb:1124']); assert.deepEqual(await get(urlOf('Cy', 'series')), ['tmdb:7300']);
  // Teens: PG-13 and TV-14 too. A rating looked up once is kept for him, and not asked for again.
  await setPerson('cy', me => ({settings: {...me.settings, limit: 'teen'}}));
  assert.deepEqual(await get(urlOf('Cy', 'movie')), ['tmdb:157336', 'tmdb:7100', 'tmdb:1124']); assert.deepEqual(await get(urlOf('Cy', 'series')), ['tmdb:7300', 'tmdb:7302']);
  fake.tmdb = []; sql("DELETE FROM rows_cache WHERE person = '#tmdb' AND kind LIKE '%release_dates' OR kind LIKE '%content_ratings'"); await until('cy', 'teen');
  assert.ok(!fake.tmdb.includes('movie/7100/release_dates') && !fake.tmdb.includes('movie/550/release_dates'), fake.tmdb.join(' '));
  assert.deepEqual(await get(urlOf('Cy', 'movie')), ['tmdb:157336', 'tmdb:7100', 'tmdb:1124']);
  // With Trakt connected and no limit the rows are Trakt's own. Under a limit Trakt's are listed only as far as they are rated
  // for it (the hub's own check), ahead of what was worked out.
  trakt.expiresIn = 7 * 86400; await connect();
  assert.deepEqual((await get(urlOf('Ada', 'movie'))).slice(0, 2), ['tt9000001', 'tt9000002']);
  await setPerson('ada', me => ({settings: {...me.settings, limit: 'kids'}}));
  assert.ok(!(await get(urlOf('Ada', 'movie'))).some(id => /^tt90000/.test(id)), 'none of Trakt’s before it is rated');
  await until('ada', 'kids');
  const rated = await get(urlOf('Ada', 'movie')); assert.equal(rated[0], 'tt9000001'); assert.ok(!rated.includes('tt9000002'));
  // Both rows taken off a Home: what was kept for them goes, and is not worked out again.
  await setPerson('cy', () => ({picks: {'recommended-movies': false, 'recommended-series': false}}));
  for (let n = 0; n < 12 && made('cy'); n++) await cron(late(n)); assert.equal(made('cy'), undefined);
  await setPerson('ada', me => {const {limit: _, ...settings} = me.settings; return {settings};}); assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.equal((await owner('DELETE', '/api/people/cy')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'cy'"), []);
});
/* Favorites from the Trakt watchlist (worker/hearts.ts, and the hook in worker/front.ts). Six titles her server has, one it does not. */
const FAV = Object.fromEntries([['one', 'tt7000001', 71], ['two', 'tt7000002', 72], ['three', 'tt7000003', 73], ['four', 'tt7000004', 74], ['five', 'tt7000005', 75], ['mine', 'tt7000006', 76]].map(([name, imdb, tmdb]) => [name, {id: pack('movie', imdb), imdb, tmdb}]));
const FAV_SHOW = {id: pack('series', 'tt7000010'), imdb: 'tt7000010', tmdb: 80}, FAV_EP = pack('episode', 'tt7000010', 1, 1);
const listedFilm = (title, days) => ({type: 'movie', movie: {title: title.imdb, ids: {imdb: title.imdb, tmdb: title.tmdb}}, listed_at: ago(days)});
// Her hearts on her own server, the hearts the hub or an app made there since `from`, and what reached Trakt's watchlist calls.
const hearted = () => [...(fake.favs.get(uuid) ?? [])].sort(), heartWrites = from => fake.hearts.slice(from).map(write => `${write.on ? '+' : '-'}${Object.entries(FAV).find(([, title]) => title.id === write.id)?.[0] ?? write.id}`);
const listCalls = () => trakt.calls.filter(call => call.path.startsWith('/sync/watchlist')).map(({path, body}) => ({path, body})), removes = () => trakt.calls.filter(call => call.path === '/sync/watchlist/remove').length;
const ledgerOf = () => Object.fromEntries(sql("SELECT key, state FROM hearts WHERE person = 'ada' ORDER BY key").map(row => [row.key, row.state]));
// Which of them the hub itself saw on her Trakt watchlist, and what her setup says of hearts right now: where they go, and whether
// it tells MDBList of what she does (MDBList sync on).
const seenOf = () => Object.fromEntries(sql("SELECT key, seen FROM hearts WHERE person = 'ada' ORDER BY key").map(row => [row.key, row.seen]));
const setupOf = () => {const config = playerOf('Ada')[1].config; return [config.jellyfinWatchlistServices, config.mdblistWatchTracking];};
const FAV_NEVER = {id: pack('movie', 'tt7000030'), imdb: 'tt7000030', tmdb: 99};
// Her turn comes again at once, with the Watchlist read afresh, as if twenty minutes had passed.
const heartsTurn = async () => {sql("UPDATE favs SET checked = 0; DELETE FROM rows_cache WHERE kind LIKE 'watchlist%'"); await cron();};
const favorites = (who, on) => who('POST', '/api/people/ada/favorites', {on});
const heartsOf = async who => (await who('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').hearts;
let keptInLists = false;
const tap = (id, method, other = false) => raw(other ? `/UserFavoriteItems/${id}?userId=${jf}` : `/Users/${jf}/FavoriteItems/${id}`, token, {method});
test('the watchlist as Favorites is offered to anyone with Trakt on the hub, with or without an MDBList key of their own; with MDBList alone there is no switch, and her setup itself shows her MDBList watchlist as Favorites', async () => {
  for (const title of [...Object.values(FAV), FAV_SHOW]) HELD[title.id] = {Id: title.id, Type: title === FAV_SHOW ? 'Series' : 'Movie', Name: title.imdb, ProviderIds: {Tmdb: String(title.tmdb), Imdb: title.imdb}};
  HELD[FAV_EP] = {Id: FAV_EP, Type: 'Episode', Name: 'One', SeriesId: FAV_SHOW.id, ParentIndexNumber: 1, IndexNumber: 1, ProviderIds: {}};
  // Her MDBList key is kept and Trakt is not connected: not offered, and refused. Her setup sends hearts to her MDBList itself.
  keptInLists = (await adaSite('GET', '/api/state')).body.hub.people[0].lists;
  assert.equal(sql("SELECT count(*) AS n FROM secrets WHERE owner = 'ada' AND kind = 'mdblist'")[0].n, 1); assert.equal(await heartsOf(adaSite), null);
  const refused = await favorites(adaSite, true); assert.equal(refused.status, 409); assert.equal(refused.body.message, 'Connect Trakt first.');
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual(setupOf(), [['mdblist'], keptInLists]);
  trakt.calls.length = 0; fake.hearts.length = 0; trakt.watchlist = [listedFilm(FAV.one, 1), listedFilm(FAV.two, 2)]; await connect();
  // Trakt connected too, her key kept and her MDBList sync off: offered, on her own page only, and off to start with. Trakt
  // leads, and with MDBList not synced her setup keeps hearts on the server, so nothing hearted reaches MDBList.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(setupOf(), [['server'], false]); assert.deepEqual(await heartsOf(adaSite), {on: false}); assert.equal(await heartsOf(owner), null);
  assert.deepEqual(sql('SELECT person FROM favs'), []);
  // The key gone, and her setup brought in step: Trakt alone, hearts on the server, still offered.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist/key')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(setupOf(), [['server'], false]);
  assert.deepEqual(await heartsOf(adaSite), {on: false}); assert.equal(await heartsOf(owner), null);
});
test('a manager cannot turn Favorites from the watchlist on for someone', async () => {
  const got = await favorites(owner, true); assert.equal(got.status, 403); assert.equal(got.body.message, 'Only they can do this, from their own page');
  assert.equal((await favorites(owner, false)).status, 403); assert.deepEqual(sql('SELECT person FROM favs'), []); assert.deepEqual(await heartsOf(adaSite), {on: false});
  // Nor answer the offer for hearts she already had.
  assert.equal((await owner('POST', '/api/people/ada/favorites/add', {})).status, 403); assert.equal((await owner('POST', '/api/people/ada/favorites/later', {})).status, 403);
});
test('with the switch off (as it starts) the hook does nothing and the cron step does nothing', async () => {
  const before = fake.hearts.length, signIns = fake.signIns, reads = trakt.reads.length;
  assert.equal((await tap(FAV.mine.id, 'POST')).status, 200); assert.equal((await tap(FAV_SHOW.id, 'POST', true)).status, 200); assert.equal((await tap(FAV_SHOW.id, 'DELETE', true)).status, 200);
  await cron(); await cron(); await pause(700);
  // Her own heart is on her server and nowhere else; the hub hearted nothing, read nothing of Trakt's and signed in nowhere.
  assert.deepEqual(listCalls(), []); assert.deepEqual(heartWrites(before), ['+mine', `+${FAV_SHOW.id}`, `-${FAV_SHOW.id}`]); assert.deepEqual(hearted(), [FAV.mine.id]);
  // (Another cron step may read her Trakt meanwhile, for her For you rows: Up Next and her history. Never her watchlist.)
  assert.equal(fake.signIns, signIns); assert.deepEqual(trakt.reads.slice(reads).map(read => read.where).filter(where => where.startsWith('/sync/watchlist')), [], JSON.stringify(trakt.reads.slice(reads).map(read => read.where))); assert.deepEqual(ledgerOf(), {});
  // The offer cannot be answered either while it is off.
  assert.equal((await adaSite('POST', '/api/people/ada/favorites/add', {})).status, 409); assert.deepEqual(listCalls(), []);
});
test('switched on, her Trakt watchlist is hearted on her own server, newest first, a few a run, each once; a heart of her own is left hers; none of it is echoed to Trakt', async () => {
  // Newest first: one … five, with a title her server does not have and the one she hearted herself in between.
  const GHOST = {imdb: 'tt7999999', tmdb: 7999};
  trakt.watchlist = [listedFilm(FAV.one, 1), listedFilm(GHOST, 1.5), listedFilm(FAV.two, 2), listedFilm(FAV.mine, 2.5), listedFilm(FAV.three, 3), listedFilm(FAV.four, 4), listedFilm(FAV.five, 5)];
  assert.equal((await favorites(adaSite, true)).status, 200); assert.deepEqual(await heartsOf(adaSite), {on: true}); assert.equal(await heartsOf(owner), null);
  // The Background work row on the Hub page has it, by a count only.
  const jobs = (await owner('GET', '/api/state')).body.hub.jobs; assert.equal(jobs.hearting, 1); assert.equal(jobs.hearted, 0);
  // Her setup saying hearts go on to MDBList while MDBList sync is off (a key of hers kept, before its next save): nothing is
  // written, since a heart of the hub's would land in an account that is not synced.
  const from = fake.hearts.length, config = playerOf('Ada')[1].config; config.jellyfinWatchlistServices = ['mdblist'];
  await heartsTurn(); assert.deepEqual(heartWrites(from), []); config.jellyfinWatchlistServices = ['server'];
  // Four a run, newest first; the next run takes the rest by itself, and the one after has nothing to do.
  await heartsTurn(); assert.deepEqual(heartWrites(from), ['+one', '+two', '+three', '+four']);
  await cron(); assert.deepEqual(heartWrites(from), ['+one', '+two', '+three', '+four', '+five']);
  await heartsTurn(); await heartsTurn(); assert.deepEqual(heartWrites(from).length, 5);
  assert.deepEqual(hearted(), Object.values(FAV).map(title => title.id).sort());
  assert.deepEqual(ledgerOf(), {'movie:tt7000001': 'hub', 'movie:tt7000002': 'hub', 'movie:tt7000003': 'hub', 'movie:tt7000004': 'hub', 'movie:tt7000005': 'hub', 'movie:tt7000006': 'own', 'movie:tt7999999': 'miss'});
  // Each heart the hub made, and hers that it found while Trakt listed it, is noted as seen on Trakt; the title her server lacks is not.
  assert.deepEqual(seenOf(), {'movie:tt7000001': 1, 'movie:tt7000002': 1, 'movie:tt7000003': 1, 'movie:tt7000004': 1, 'movie:tt7000005': 1, 'movie:tt7000006': 1, 'movie:tt7999999': 0});
  assert.equal(sql("SELECT listed FROM hearts WHERE key = 'movie:tt7000001'")[0].listed, Math.floor(Date.parse(trakt.watchlist[0].listed_at) / 1000));
  assert.ok((await owner('GET', '/api/state')).body.hub.jobs.hearted > 0);
  // The hub's own hearts went straight to her server, never through the hook: Trakt heard of no watchlist change.
  assert.deepEqual(listCalls(), []);
  // Her server takes a heart away by itself (as it may once the title is watched): not put back, run after run, until Trakt
  // lists the title anew, and then once.
  fake.favs.get(uuid).delete(FAV.two.id); await heartsTurn(); await heartsTurn(); assert.deepEqual(heartWrites(from).length, 5); assert.ok(!hearted().includes(FAV.two.id));
  trakt.watchlist = trakt.watchlist.map(entry => entry.movie.ids.imdb === FAV.two.imdb ? listedFilm(FAV.two, 0.01) : entry);
  await heartsTurn(); await heartsTurn(); assert.deepEqual(heartWrites(from).slice(5), ['+two']); assert.deepEqual(listCalls(), []);
});
test('every heart on her server gone at once (a setup made again): nothing is removed from Trakt, and nothing is hearted again in a loop', async () => {
  const from = fake.hearts.length, listed = trakt.watchlist.length;
  fake.favs.get(uuid).clear();
  for (let n = 0; n < 3; n++) await heartsTurn();
  await pause(700);
  assert.equal(removes(), 0); assert.deepEqual(listCalls(), []); assert.equal(trakt.watchlist.length, listed); assert.deepEqual(heartWrites(from), []);
  // Put back as they were, for what follows.
  for (const title of Object.values(FAV)) fake.favs.get(uuid).add(title.id);
});
test('a Trakt removal is only ever sent from the hook that hears an app’s own DELETE: no other file can', async () => {
  const {readFileSync, readdirSync} = await import('node:fs'), dir = new URL('../worker/', import.meta.url);
  const naming = readdirSync(dir).filter(name => readFileSync(new URL(name, dir), 'utf8').includes('watchlist/remove'));
  assert.deepEqual(naming, ['front.ts']);
  const source = readFileSync(new URL('front.ts', dir), 'utf8'); assert.equal(source.split("'/sync/watchlist/remove'").length, 2, 'built in one place');
  assert.ok(!/from '\.\/trakt'/.test(readFileSync(new URL('hearts.ts', dir), 'utf8').replace("import {LINK} from './trakt';", '')), 'the cron step imports nothing that sends to Trakt');
  // The one other place that sends a heart to Trakt (the offer for hearts she already had, api.ts) names only the add.
  assert.equal(readdirSync(dir).filter(name => readFileSync(new URL(name, dir), 'utf8').includes("kind: 'unheart'")).join(), 'front.ts');
});
test('in step with Trakt: a title that left the watchlist loses its heart when the hub saw it there (one it made, or hers found hearted while listed), never one that was never on Trakt; a list Trakt did not give, or an empty one, is never read as everything having left', async () => {
  const from = fake.hearts.length, all = trakt.watchlist;
  // Two hearts that were never on her Trakt watchlist: one she made on her server that the hub never heard of, and one an app
  // made that the hook sent on but Trakt never listed (noted as hers, not seen there).
  HELD[FAV_NEVER.id] = {Id: FAV_NEVER.id, Type: 'Movie', Name: FAV_NEVER.imdb, ProviderIds: {Tmdb: String(FAV_NEVER.tmdb), Imdb: FAV_NEVER.imdb}};
  fake.favs.get(uuid).add(FAV_SHOW.id); fake.favs.get(uuid).add(FAV_NEVER.id);
  sql(`INSERT INTO hearts (hub, person, key, item, state, listed, at, seen) SELECT id, 'ada', 'movie:${FAV_NEVER.imdb}', '${FAV_NEVER.id}', 'own', 1, 1, 0 FROM hubs`);
  // Trakt not answering, with nothing kept; then a watchlist that reads as empty: no heart is touched.
  trakt.refuseReads = true; await heartsTurn(); trakt.refuseReads = false; waited();
  trakt.watchlist = []; await heartsTurn(); await heartsTurn();
  assert.deepEqual(heartWrites(from), []); assert.equal(hearted().length, 8);
  // One the hub hearted and the one she hearted herself (found hearted while Trakt listed it) both leave her watchlist: both
  // lose their hearts on her server. The two that were never on Trakt keep theirs, run after run.
  trakt.watchlist = all.filter(entry => ![FAV.three.imdb, FAV.mine.imdb].includes(entry.movie.ids.imdb));
  await heartsTurn(); await heartsTurn(); await heartsTurn();
  assert.deepEqual(heartWrites(from).sort(), ['-mine', '-three']); assert.ok(!hearted().includes(FAV.mine.id)); assert.ok(!hearted().includes(FAV.three.id));
  assert.ok(hearted().includes(FAV_SHOW.id)); assert.ok(hearted().includes(FAV_NEVER.id));
  assert.equal(ledgerOf()['movie:tt7000003'], 'left'); assert.equal(ledgerOf()['movie:tt7000006'], 'left'); assert.equal(ledgerOf()[`movie:${FAV_NEVER.imdb}`], 'own');
  // None of that reached Trakt.
  await pause(500); assert.deepEqual(listCalls(), []); assert.equal(removes(), 0);
  // As it was, for what follows: the two extra hearts gone again.
  fake.favs.get(uuid).delete(FAV_SHOW.id); fake.favs.get(uuid).delete(FAV_NEVER.id); sql(`DELETE FROM hearts WHERE key = 'movie:${FAV_NEVER.imdb}'`); sql('UPDATE favs SET found = NULL');
});
test('a heart made in an app adds the title to her Trakt watchlist, and one taken away in an app removes it: films and shows only, by their ids, once the server took it', async () => {
  const from = fake.hearts.length;
  // Kept, so its going shows.
  await heartsTurn(); assert.ok(sql("SELECT kind FROM rows_cache WHERE person = 'ada' AND kind = 'watchlist'").length);
  // A film she takes the heart off (one the hub made), by one address; a show she hearts, by the other.
  assert.equal((await tap(FAV.four.id, 'DELETE')).status, 200);
  for (let n = 0; n < 50 && listCalls().length < 1; n++) await pause(100);
  assert.deepEqual(listCalls(), [{path: '/sync/watchlist/remove', body: {movies: [{ids: {tmdb: 74, imdb: 'tt7000004'}}]}}]);
  assert.equal((await tap(FAV_SHOW.id, 'POST', true)).status, 200);
  for (let n = 0; n < 50 && listCalls().length < 2; n++) await pause(100);
  assert.deepEqual(listCalls()[1], {path: '/sync/watchlist', body: {shows: [{ids: {tmdb: 80, imdb: 'tt7000010'}}]}});
  await pause(400);
  assert.equal(ledgerOf()['movie:tt7000004'], 'gone'); assert.equal(ledgerOf()['series:tt7000010'], 'own');
  // What the hook sent on is hers, and not yet seen on Trakt: only the list itself can say it got there.
  assert.equal(seenOf()['series:tt7000010'], 0); assert.equal(seenOf()['movie:tt7000004'], 0);
  assert.deepEqual(sql("SELECT kind FROM rows_cache WHERE person = 'ada' AND kind LIKE 'watchlist%'"), [], 'her kept Watchlist row is read again');
  assert.ok(!trakt.watchlist.some(entry => entry.movie?.ids.imdb === FAV.four.imdb)); assert.ok(trakt.watchlist.some(entry => entry.show?.ids.imdb === FAV_SHOW.imdb));
  // An episode, a title with no ids Trakt could use, and a heart her server refused (a title it does not have): nothing is sent.
  assert.equal((await tap(FAV_EP, 'POST')).status, 200); assert.equal((await tap(OTHER, 'POST')).status, 200); assert.equal((await tap(pack('movie', 'tt7999999'), 'DELETE')).status, 404);
  await pause(800); assert.equal(listCalls().length, 2);
  // The cron after: her own heart on the show stays hers, the film she un-hearted is not hearted again though Trakt lists it
  // still (as while its remove waits), and nothing more reaches Trakt.
  trakt.watchlist.push(listedFilm(FAV.four, 4));
  const writes = fake.hearts.length; await heartsTurn(); await heartsTurn(); assert.deepEqual(heartWrites(writes), []);
  assert.ok(hearted().includes(FAV_SHOW.id)); assert.ok(!hearted().includes(FAV.four.id)); await pause(400); assert.equal(listCalls().length, 2);
  // A call Trakt turns away waits in the outbox like any other, and goes through after.
  trakt.refuse = 1; assert.equal((await tap(FAV.five.id, 'DELETE')).status, 200);
  for (let n = 0; n < 100 && listCalls().length < 3; n++) await pause(100);
  assert.deepEqual(listCalls()[2], {path: '/sync/watchlist/remove', body: {movies: [{ids: {tmdb: 75, imdb: 'tt7000005'}}]}}); await pause(500); assert.deepEqual(waiting(), []);
  assert.ok(from < fake.hearts.length);
});
test('a heart an app made and the hook sent on is kept in step once Trakt lists it: leaving the watchlist then takes the heart away on her server, and nothing is removed from Trakt for it', async () => {
  // The show she hearted in an app is on her Trakt watchlist now (the hook's add): the next look sees it there.
  await heartsTurn(); assert.equal(ledgerOf()['series:tt7000010'], 'own'); assert.equal(seenOf()['series:tt7000010'], 1);
  // She takes it off her watchlist on Trakt itself: its heart goes on her server, by the hub, straight there.
  const writes = fake.hearts.length, sent = listCalls().length, gone = removes();
  trakt.watchlist = trakt.watchlist.filter(entry => entry.show?.ids.imdb !== FAV_SHOW.imdb);
  await heartsTurn(); await heartsTurn(); await pause(500);
  assert.deepEqual(heartWrites(writes), [`-${FAV_SHOW.id}`]); assert.ok(!hearted().includes(FAV_SHOW.id)); assert.equal(ledgerOf()['series:tt7000010'], 'left');
  assert.equal(listCalls().length, sent, 'Trakt heard nothing'); assert.equal(removes(), gone);
});
test('hearts she already had that her Trakt watchlist lacks are counted by the cron and offered once: added only when she asks, a few dozen at most, and never offered again after Not now', async () => {
  // Three hearts of her own that were never on Trakt, made on her server directly (the hook never heard of them).
  const EXTRA = Object.fromEntries([['a', 'tt7000021', 91], ['b', 'tt7000022', 92], ['c', 'tt7000023', 93]].map(([name, imdb, tmdb]) => [name, {id: pack('movie', imdb), imdb, tmdb}]));
  for (const title of Object.values(EXTRA)) {HELD[title.id] = {Id: title.id, Type: 'Movie', Name: title.imdb, ProviderIds: {Tmdb: String(title.tmdb), Imdb: title.imdb}}; fake.favs.get(uuid).add(title.id);}
  fake.favs.get(uuid).delete(OTHER); fake.favs.get(uuid).delete(FAV_EP);
  const had = hearted(), sent = listCalls().length, reads = fake.favReads, foundOf = () => JSON.parse(sql("SELECT found FROM favs WHERE person = 'ada'")[0].found ?? 'null');
  // Not counted when the page loads, and not on every run: only once the count is due (a few times a day).
  assert.deepEqual(await heartsOf(adaSite), {on: true}); await heartsTurn(); assert.equal(fake.favReads, reads); assert.deepEqual(await heartsOf(adaSite), {on: true});
  sql('UPDATE favs SET found_at = 0'); await heartsTurn(); assert.equal(fake.favReads, reads + 1);
  // What is on the watchlist, what the hub hearted or took away, and what she un-hearted are not among them: only the three.
  assert.deepEqual(foundOf().list.map(heart => heart.key).sort(), ['movie:tt7000021', 'movie:tt7000022', 'movie:tt7000023']); assert.equal(foundOf().more, false);
  assert.deepEqual(await heartsOf(adaSite), {on: true, extra: 3, more: false}); assert.equal(await heartsOf(owner), null);
  // Counting wrote nothing anywhere: no heart moved, and Trakt heard nothing.
  assert.deepEqual(hearted(), had); await pause(400); assert.equal(listCalls().length, sent);
  // A server that ignores the filter and lists every title adds nothing: only what it says is hearted counts.
  fake.unfiltered = true; sql('UPDATE favs SET found_at = 0'); await heartsTurn(); fake.unfiltered = false; assert.equal(foundOf().list.length, 3);
  // The count is hours old by the time she answers: a heart she took off in an app since (the hook noted it) is no part of the
  // offer any more. Add them sends the other two and leaves that one off Trakt.
  assert.equal((await tap(EXTRA.c.id, 'DELETE')).status, 200); for (let n = 0; n < 50 && listCalls().length < sent + 1; n++) await pause(100); await pause(300);
  assert.equal(ledgerOf()['movie:tt7000023'], 'gone'); const early = await adaSite('POST', '/api/people/ada/favorites/add', {}); assert.deepEqual(early.body, {added: 2, more: false});
  for (let n = 0; n < 50 && listCalls().length < sent + 2; n++) await pause(100); await pause(300);
  assert.deepEqual(listCalls().at(-1), {path: '/sync/watchlist', body: {movies: [{ids: {tmdb: 91, imdb: 'tt7000021'}}, {ids: {tmdb: 92, imdb: 'tt7000022'}}]}}); assert.equal(ledgerOf()['movie:tt7000023'], 'gone');
  // Back as it was for what follows (that add and her un-heart undone here and on the stand-in), and counted again.
  sql("DELETE FROM hearts WHERE key LIKE '%:tt700002_'"); fake.favs.get(uuid).add(EXTRA.c.id); trakt.watchlist = trakt.watchlist.filter(entry => !/^tt700002/.test((entry.movie ?? entry.show).ids.imdb)); trakt.calls.splice(-2);
  sql('UPDATE favs SET found_at = 0'); await heartsTurn(); assert.equal(foundOf().list.length, 3);
  // Not now: kept for those three, which are never offered again, however often they are counted. Nothing is sent.
  assert.deepEqual((await adaSite('POST', '/api/people/ada/favorites/later', {})).body, {added: 0}); assert.deepEqual(await heartsOf(adaSite), {on: true});
  for (const key of ['movie:tt7000021', 'movie:tt7000022', 'movie:tt7000023']) assert.equal(ledgerOf()[key], 'pass');
  sql('UPDATE favs SET found_at = 0'); await heartsTurn(); assert.equal(foundOf(), null); assert.deepEqual(await heartsOf(adaSite), {on: true}); await pause(300); assert.equal(listCalls().length, sent);
  // Passed on, they stay out of step on purpose: never taken away for not being on Trakt.
  await heartsTurn(); assert.deepEqual(hearted(), had);
  // A new set later (two more hearts): offered again, and Add them sends one watchlist add for both, through the outbox, noted
  // as hers. Only ever an add.
  const MORE = Object.fromEntries([['d', 'tt7000024', 94], ['e', 'tt7000025', 95]].map(([name, imdb, tmdb]) => [name, {id: pack(name === 'e' ? 'series' : 'movie', imdb), imdb, tmdb}]));
  for (const [name, title] of Object.entries(MORE)) {HELD[title.id] = {Id: title.id, Type: name === 'e' ? 'Series' : 'Movie', Name: title.imdb, ProviderIds: {Tmdb: String(title.tmdb), Imdb: title.imdb}}; fake.favs.get(uuid).add(title.id);}
  sql('UPDATE favs SET found_at = 0'); await heartsTurn(); assert.deepEqual(await heartsOf(adaSite), {on: true, extra: 2, more: false}); assert.equal(listCalls().length, sent, 'never by itself');
  const writes = fake.hearts.length, added = await adaSite('POST', '/api/people/ada/favorites/add', {}); assert.deepEqual(added.body, {added: 2, more: false});
  for (let n = 0; n < 50 && listCalls().length < sent + 1; n++) await pause(100);
  assert.deepEqual(listCalls().slice(sent), [{path: '/sync/watchlist', body: {movies: [{ids: {tmdb: 94, imdb: 'tt7000024'}}], shows: [{ids: {tmdb: 95, imdb: 'tt7000025'}}]}}]);
  assert.equal(ledgerOf()['movie:tt7000024'], 'own'); assert.equal(ledgerOf()['series:tt7000025'], 'own'); assert.deepEqual(await heartsOf(adaSite), {on: true});
  // Asked again, there is nothing left to add; and once Trakt lists them the next look counts them seen there, writing no heart.
  assert.deepEqual((await adaSite('POST', '/api/people/ada/favorites/add', {})).body, {added: 0}); await pause(300); assert.equal(listCalls().length, sent + 1);
  await heartsTurn(); assert.equal(seenOf()['movie:tt7000024'], 1); assert.equal(seenOf()['series:tt7000025'], 1); assert.deepEqual(heartWrites(writes), []);
  // Capped: with more hearts than the offer holds, it holds fifty and says there are more; Add them sends those fifty in one call.
  const MANY = Array.from({length: 55}, (_, n) => ({id: pack('movie', `tt71${String(n).padStart(5, '0')}`), imdb: `tt71${String(n).padStart(5, '0')}`, tmdb: 7100000 + n}));
  for (const title of MANY) {HELD[title.id] = {Id: title.id, Type: 'Movie', Name: title.imdb, ProviderIds: {Tmdb: String(title.tmdb), Imdb: title.imdb}}; fake.favs.get(uuid).add(title.id);}
  sql('UPDATE favs SET found_at = 0'); await heartsTurn(); assert.deepEqual(await heartsOf(adaSite), {on: true, extra: 50, more: true});
  const capped = await adaSite('POST', '/api/people/ada/favorites/add', {}); assert.deepEqual(capped.body, {added: 50, more: true});
  for (let n = 0; n < 50 && listCalls().length < sent + 2; n++) await pause(100);
  assert.equal(listCalls().at(-1).path, '/sync/watchlist'); assert.equal(listCalls().at(-1).body.movies.length, 50); assert.equal(removes(), 2, 'only the two her own app asked for, earlier');
  // Those gone again, with their notes, for what follows.
  for (const title of [...MANY, ...Object.values(EXTRA), ...Object.values(MORE)]) {fake.favs.get(uuid).delete(title.id); delete HELD[title.id];}
  sql("DELETE FROM hearts WHERE key LIKE 'movie:tt71_____' OR key LIKE '%:tt700002_'"); sql('UPDATE favs SET found = NULL'); trakt.watchlist = trakt.watchlist.filter(entry => !/^tt(71|700002)/.test((entry.movie ?? entry.show).ids.imdb));
});
test('with her own MDBList key too, Trakt still leads: MDBList sync on, her setup passes hearts on to MDBList itself and the cron step runs as before; MDBList sync off, hearts stay on her server; the hub never calls MDBList for a heart, and removes nothing from Trakt outside the hook', async () => {
  const mdbHearts = () => lists.all.filter(call => /watchlist/.test(call) && !call.startsWith('GET ')), turns = async n => {for (let i = 0; i < n; i++) await heartsTurn();};
  // Her key saved, with MDBList sync on: the switch stays as she set it, the ledger stays, and her setup now sends hearts on to
  // MDBList by itself (['mdblist'] with tracking on).
  const ledger = ledgerOf(), gone = removes();
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'}); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(setupOf(), [['mdblist'], true]); assert.deepEqual(await heartsOf(adaSite), {on: true}); assert.deepEqual(ledgerOf(), ledger); assert.equal(await heartsOf(owner), null);
  lists.all.length = 0;
  // The cron step runs for ['mdblist']: a title newly on her Trakt watchlist is hearted on her server, and one that left it
  // (the hub's own heart) loses its heart there. Her server does the rest for MDBList; the hub asks nothing of MDBList.
  const from = fake.hearts.length; trakt.watchlist = [listedFilm(FAV.four, 0), ...trakt.watchlist.filter(entry => entry.movie?.ids.imdb !== FAV.one.imdb && entry.movie?.ids.imdb !== FAV.four.imdb)];
  await turns(3); assert.deepEqual(heartWrites(from).sort(), ['+four', '-one']); assert.equal(ledgerOf()['movie:tt7000001'], 'left'); assert.equal(ledgerOf()['movie:tt7000004'], 'hub');
  await pause(400); assert.equal(removes(), gone, 'no Trakt removal from the cron'); assert.deepEqual(mdbHearts(), []);
  // The hook, the same: an app's heart adds to Trakt and an app's un-heart removes from Trakt, the only removal there is.
  const sent = listCalls().length;
  assert.equal((await tap(FAV.one.id, 'POST')).status, 200); for (let n = 0; n < 50 && listCalls().length < sent + 1; n++) await pause(100);
  assert.deepEqual(listCalls().at(-1), {path: '/sync/watchlist', body: {movies: [{ids: {tmdb: 71, imdb: 'tt7000001'}}]}});
  assert.equal((await tap(FAV.one.id, 'DELETE')).status, 200); for (let n = 0; n < 50 && listCalls().length < sent + 2; n++) await pause(100);
  assert.deepEqual(listCalls().at(-1), {path: '/sync/watchlist/remove', body: {movies: [{ids: {tmdb: 71, imdb: 'tt7000001'}}]}}); await pause(400);
  assert.equal(removes(), gone + 1); assert.deepEqual(mdbHearts(), [], 'the hub itself never writes a heart to MDBList');
  // A title taken off her MDBList watchlist changes nothing on Trakt and is not put back: the hub does not read MDBList for
  // hearts at all, and its looks at Trakt find nothing to do.
  const writes = fake.hearts.length; lists.watchlist = []; await turns(2); await pause(300); assert.deepEqual(heartWrites(writes), []); assert.equal(removes(), gone + 1);
  // Her setup saying anything else right now (hearts to MDBList with tracking off, as between a change and its save): nothing
  // is written by the hub until it is saved.
  const config = playerOf('Ada')[1].config; config.mdblistWatchTracking = false;
  trakt.watchlist = [listedFilm(FAV.one, 0), ...trakt.watchlist]; await turns(2); assert.deepEqual(heartWrites(writes), []); config.mdblistWatchTracking = true;
  await turns(2); assert.deepEqual(heartWrites(writes), ['+one']);
  // MDBList sync off, her key kept: her setup keeps hearts on the server (['server'], nothing passed on), and the hub goes on as
  // with Trakt alone: its own writes go to her server and nowhere else.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(setupOf(), [['server'], false]); assert.deepEqual(await heartsOf(adaSite), {on: true});
  const off = fake.hearts.length; lists.all.length = 0; trakt.watchlist = trakt.watchlist.filter(entry => entry.movie?.ids.imdb !== FAV.one.imdb);
  await turns(2); assert.deepEqual(heartWrites(off), ['-one']); await pause(300); assert.deepEqual(mdbHearts(), []); assert.equal(removes(), gone + 1);
  // Switched off and on with the key kept: no heart moves, nothing is removed from Trakt.
  assert.equal((await favorites(adaSite, false)).status, 200); await cron(); await pause(300); assert.equal(removes(), gone + 1); assert.equal((await favorites(adaSite, true)).status, 200);
  // The key gone again, as it was: Trakt alone.
  assert.equal((await owner('DELETE', '/api/people/ada/mdblist/key')).status, 200); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual(setupOf(), [['server'], false]);
});
/* Shows to tick whole: each with a Season title per season and its episodes, as her server would list them. */
const LONG = {id: pack('series', 'tt7300000'), imdb: 'tt7300000', tmdb: 7300}, HUGE = {id: pack('series', 'tt7400000'), imdb: 'tt7400000', tmdb: 7400}, BURST = {id: pack('series', 'tt7600000'), imdb: 'tt7600000', tmdb: 7600};
const seasonOf = (show, n) => `season-${show.imdb}-${n}`, episodeOf = (show, s, e) => pack('episode', show.imdb, s, e);
const hold = (show, name, seasons) => {
  HELD[show.id] = {Id: show.id, Type: 'Series', Name: name, ProviderIds: {Tmdb: String(show.tmdb), Imdb: show.imdb}};
  for (const [s, count] of Object.entries(seasons)) {
    HELD[seasonOf(show, s)] = {Id: seasonOf(show, s), Type: 'Season', Name: `Season ${s}`, SeriesId: show.id, SeriesName: name, IndexNumber: Number(s)};
    for (let e = 1; e <= count; e++) HELD[episodeOf(show, Number(s), e)] = {Id: episodeOf(show, Number(s), e), Type: 'Episode', Name: `Episode ${e}`, SeriesId: show.id, SeriesName: name, ParentIndexNumber: Number(s), IndexNumber: e, RunTimeTicks: 3000e7, ProviderIds: {}};
  }
};
const tick = (id, method = 'POST') => raw(`/Users/${jf}/PlayedItems/${id}`, token, {method, ...(method === 'POST' ? {body: '{}'} : {})});
const playsOf = title => sql(`SELECT item, detail, position, duration, playing, ids, scrobbled FROM plays WHERE person = 'ada' AND title = '${title}'`);
const landed = async (title, n) => {for (let i = 0; i < 60 && playsOf(title).length < n; i++) await pause(100); await pause(400); return playsOf(title);};
const marksOf = title => sql(`SELECT count(*) AS n FROM sittings WHERE person = 'ada' AND parts = 'marked' AND item IN (SELECT item FROM plays WHERE person = 'ada' AND title = '${title}')`)[0].n;
const historyCalls = () => trakt.calls.filter(call => call.path === '/sync/history');
test('a tick on a whole season or show is each of its episodes ticked, never one play of the season or show; over sixty episodes nothing is noted; a tick taken away is sent nowhere; and while her Trakt sync is off what she finished here joins Recently Watched', async () => {
  hold(LONG, 'Long Show', {1: 20, 2: 3}); hold(HUGE, 'Huge Show', {1: 61});
  // Her Trakt is connected and its sync is off (never turned on for this connection).
  assert.equal((await matchingOf()).on, false); trakt.calls.length = 0;
  // Season 1 ticked whole in an app, as one request for the season: twenty plays, one an episode, each at its end and a line of
  // its own on Activity, and none for the season itself.
  assert.equal((await tick(seasonOf(LONG, 1))).status, 200);
  const first = await landed('Long Show', 20), numbered = (season, count) => Array.from({length: count}, (_, n) => `Season ${season} · Episode ${n + 1}`).sort();
  assert.deepEqual(first.map(row => row.detail).sort(), numbered(1, 20)); assert.deepEqual(first.map(row => row.item).sort(), Array.from({length: 20}, (_, n) => episodeOf(LONG, 1, n + 1)).sort());
  assert.ok(first.every(row => row.position === 3000 && row.duration === 3000 && row.playing === 0 && row.ids === null && row.scrobbled === null), JSON.stringify(first[0]));
  assert.deepEqual(sql(`SELECT item FROM plays WHERE person = 'ada' AND item IN ('${seasonOf(LONG, 1)}', '${LONG.id}')`), [], 'never a play of the season or the show'); assert.equal(marksOf('Long Show'), 20);
  // The whole show ticked: what is finished here already stays as it was, and season 2's three episodes join.
  assert.equal((await tick(LONG.id)).status, 200); const all = await landed('Long Show', 23);
  assert.deepEqual(all.map(row => row.detail).sort(), [...numbered(1, 20), ...numbered(2, 3)].sort()); assert.equal(marksOf('Long Show'), 23);
  // More than sixty episodes, as a season or as a show: nothing is noted. Nor for a season her server lists no episodes for.
  HELD['season-none'] = {Id: 'season-none', Type: 'Season', Name: 'Season 9', SeriesId: 'nothing-here', SeriesName: 'Gone Show', IndexNumber: 9};
  for (const id of [seasonOf(HUGE, 1), HUGE.id, 'season-none']) assert.equal((await tick(id)).status, 200);
  await pause(1500); assert.deepEqual(playsOf('Huge Show'), []); assert.deepEqual(playsOf('Gone Show'), []);
  assert.deepEqual(sql(`SELECT item FROM plays WHERE person = 'ada' AND item IN ('${seasonOf(HUGE, 1)}', '${HUGE.id}', 'season-none')`), []);
  // The season's tick taken away in the app: her server hears, and nothing else changes anywhere.
  assert.equal((await tick(seasonOf(LONG, 1), 'DELETE')).status, 200); await pause(600); assert.equal(playsOf('Long Show').length, 23);
  // With sync off none of it reached Trakt or waits to.
  assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []);
  // Recently Watched, while her Trakt sync is off: Trakt's history and what she finished or ticked here as one list, newest
  // first, each title once. One only begun here is not in it.
  const watched = playerOf('Ada')[1].config.catalogs.find(item => item.id === 'custom.aiohub_rows.all.history').sourceUrl, fresh = () => sql("DELETE FROM rows_cache WHERE person = 'ada' AND kind LIKE 'history%'");
  const row = async () => {const out = []; for (let skip = 0; skip < 200; skip += 20) {const page = (await (await fetch(skip ? watched.replace(/\.json$/, `/skip=${skip}.json`) : watched)).json()).metas; out.push(...page); if (page.length < 20) break;} return out;};
  const SEEN = pack('movie', 'tt7500001'), HALF = pack('movie', 'tt7500002');
  sql(`INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', '${SEEN}', 'Seen Through', 'Movie', 5800, 6000, 'Test · Phone', 0, unixepoch() - 600, '' FROM hubs;
    INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', '${HALF}', 'Half Seen', 'Movie', 900, 6000, 'Test · Phone', 0, unixepoch() - 30, '' FROM hubs`);
  const longOnTrakt = {title: 'Long Show', ids: {imdb: LONG.imdb, tmdb: LONG.tmdb}};
  trakt.history = [{watched_at: ago(2), type: 'movie', movie: MOVIE.heat}, {watched_at: ago(5), type: 'episode', episode: {season: 1, number: 1}, show: longOnTrakt}, {watched_at: ago(6), type: 'movie', movie: MOVIE.gump}]; fresh();
  const off = await row(), names = off.map(meta => meta.name);
  assert.equal(names[0], 'Long Show', 'ticked here just now, though Trakt has it from five days ago'); assert.equal(names.filter(name => name === 'Long Show').length, 1, 'a title in both shows once');
  assert.ok(names.includes('Seen Through')); assert.ok(!names.includes('Half Seen')); assert.ok(names.indexOf('Seen Through') < names.indexOf('Heat')); assert.ok(names.indexOf('Heat') < names.indexOf('Forrest Gump'));
  assert.equal(new Set(off.map(meta => meta.id)).size, off.length); assert.deepEqual(off.find(meta => meta.name === 'Long Show'), {id: LONG.imdb, type: 'series', name: 'Long Show'});
  // With her Trakt sync on it is Trakt's history alone again (Trakt then has what she watches here too).
  await syncOn(); fresh();
  assert.deepEqual(await row(), [{id: 'tt0113277', type: 'movie', name: 'Heat'}, {id: LONG.imdb, type: 'series', name: 'Long Show'}, {id: 'tt0109830', type: 'movie', name: 'Forrest Gump'}]);
  sql(`DELETE FROM plays WHERE person = 'ada' AND item IN ('${SEEN}', '${HALF}')`);
});
test('with Trakt sync on: a season ticked whole is one history add for its episodes, a burst of twenty single ticks is twenty plays and twenty history adds sent one at a time, and an episode un-ticked afterwards is not ticked again by sync', async () => {
  hold(BURST, 'Burst Show', {1: 20, 2: 4});
  assert.equal((await matchingOf()).on, true); trakt.calls.length = 0; trakt.history = [];
  // Season 2, one request: four plays here, and one add to her Trakt history naming all four under the show, dated now.
  assert.equal((await tick(seasonOf(BURST, 2))).status, 200);
  const season = await landed('Burst Show', 4); for (let n = 0; n < 50 && historyCalls().length < 1; n++) await pause(100); await pause(300);
  assert.equal(season.length, 4); assert.equal(historyCalls().length, 1); const [show] = historyCalls()[0].body.shows;
  assert.deepEqual(show.ids, {tmdb: 7600, imdb: 'tt7600000'}); assert.deepEqual(show.seasons.map(item => [item.number, item.episodes.map(episode => episode.number)]), [[2, [1, 2, 3, 4]]]);
  assert.ok(show.seasons[0].episodes.every(episode => Math.abs(Date.parse(episode.watched_at) - Date.now()) < 60_000)); assert.equal(historyCalls()[0].body.movies, undefined);
  // Each episode keeps what Trakt knows it by and that Trakt was told, as a single tick does.
  const kept = playsOf('Burst Show'); assert.ok(kept.every(row => row.scrobbled === 'watched' && row.position === 3000)); assert.deepEqual(kept.map(row => JSON.parse(row.ids).episode.number).sort(), [1, 2, 3, 4]);
  assert.deepEqual(JSON.parse(kept[0].ids).show, {ids: {tmdb: 7600, imdb: 'tt7600000'}});
  // Ticked again whole: nothing new here, and nothing more to Trakt.
  assert.equal((await tick(seasonOf(BURST, 2))).status, 200); await pause(1200); assert.equal(historyCalls().length, 1); assert.equal(playsOf('Burst Show').length, 4);
  // She takes the tick off two of them in the app: her server hears and Trakt does not. Trakt lists all four as watched (its
  // own copy of what the hub sent); her next turn of sync does not tick them back.
  assert.equal((await tick(episodeOf(BURST, 2, 1), 'DELETE')).status, 200); assert.equal((await tick(seasonOf(BURST, 2), 'DELETE')).status, 200); await pause(500);
  assert.equal(trakt.calls.length, 1, 'nothing is un-watched on Trakt');
  const onTrakt = {title: 'Burst Show', ids: {imdb: BURST.imdb, tmdb: BURST.tmdb}}, at = new Date().toISOString(), ticks = fake.ticks.length;
  trakt.history = [1, 2, 3, 4].map(number => ({watched_at: at, type: 'episode', episode: {season: 2, number}, show: onTrakt}));
  trakt.activity = {movies: trakt.activity.movies, episodes: {watched_at: at, paused_at: trakt.activity.episodes.paused_at}};
  for (const id of [1, 2, 3, 4].map(number => episodeOf(BURST, 2, number))) HELD[id].UserData = {};
  sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"); await cron(); sql("UPDATE sync SET checked = 0 WHERE person = 'ada'"); await cron();
  assert.deepEqual(fake.ticks.slice(ticks).filter(tick => HELD[tick.id]?.SeriesId === BURST.id), [], 'not ticked again'); sql("UPDATE sync SET checked = 9000000000 WHERE person = 'ada'");
  // Twenty episodes ticked one by one at once, as an app marking "up to here" might: each request is its own, Trakt takes one write a second
  // and turns the rest of the burst away (as it does), and the outbox sends what waits one at a time until all twenty are there, each once.
  trakt.calls.length = 0; trakt.pace = 1000; trakt.refused.length = 0;
  const burst = await Promise.all(Array.from({length: 20}, (_, n) => tick(episodeOf(BURST, 1, n + 1)))); assert.ok(burst.every(answer => answer.status === 200));
  for (let n = 0; n < 80 && playsOf('Burst Show').length < 24; n++) await pause(250);
  for (let round = 0; round < 12 && (waiting().length || historyCalls().length < 20); round++) {await pause(1500); resumed(); await cron();}
  const twenty = playsOf('Burst Show').filter(row => row.detail.startsWith('Season 1 ·'));
  assert.deepEqual(twenty.map(row => row.detail).sort(), Array.from({length: 20}, (_, n) => `Season 1 · Episode ${n + 1}`).sort()); assert.ok(twenty.every(row => row.position === row.duration && row.duration > 0 && row.playing === 0 && row.scrobbled === 'watched'), JSON.stringify(twenty.find(row => row.scrobbled !== 'watched')));
  assert.equal(marksOf('Burst Show'), 24);
  const sent = historyCalls().flatMap(call => call.body.shows.flatMap(item => item.seasons.flatMap(part => part.episodes.map(episode => `${part.number}:${episode.number}`))));
  assert.deepEqual(sent.sort(), Array.from({length: 20}, (_, n) => `1:${n + 1}`).sort(), 'twenty history adds, each episode once'); assert.equal(historyCalls().length, 20);
  assert.ok(trakt.refused.length > 0, 'the burst was turned away, and what waited went out one at a time'); assert.deepEqual(waiting(), []);
  trakt.pace = 0; trakt.calls.length = 0; trakt.history = [];
});
test('earlier plays are offered once, with sync on: Not now is kept for the plays from before this turning on, and a later turning on offers its own', async () => {
  const me = async () => (await adaSite('GET', '/api/state')).body.hub.people[0].matching, earlier = async () => (await adaSite('GET', '/api/people/ada/matching')).body.earlier;
  // The switch drives what it always did: off, then on, with nothing else asked.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); assert.deepEqual([(await me()).on, (await me()).earlier, (await me()).passed], [false, false, false]);
  assert.deepEqual(sql("SELECT matching, earlier FROM sync WHERE person = 'ada'"), [{matching: 0, earlier: 0}]);
  // What she ticked here while sync was off (the whole show, further up) is from before this turning on.
  await pause(1100); await syncOn(); assert.deepEqual(sql("SELECT matching, earlier FROM sync WHERE person = 'ada'"), [{matching: 1, earlier: 0}]);
  const count = await earlier(); assert.ok(count >= 23, String(count)); assert.equal((await me()).passed, false);
  // Not now: hers alone to say, and nothing is sent for it.
  trakt.calls.length = 0;
  assert.equal((await owner('POST', '/api/people/ada/matching/later', {})).status, 403);
  assert.equal((await adaSite('POST', '/api/people/ada/matching/later', {})).status, 200); assert.equal((await me()).passed, true); assert.equal((await me()).earlier, false);
  await pause(400); assert.deepEqual(trakt.calls, []); assert.deepEqual(waiting(), []);
  // Still kept after a look at the page, and while sync stays on.
  assert.equal((await me()).passed, true);
  // Off and on again later: a new turning on, so its earlier plays are offered once more.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); await pause(1100); await syncOn();
  assert.equal((await me()).passed, false); assert.ok(await earlier() >= 23);
  // Sync off again for what follows, with nothing left waiting.
  assert.equal((await adaSite('POST', '/api/people/ada/matching', {on: false})).status, 200); assert.deepEqual(waiting(), []);
});
test('turned off, nothing more is sent and no heart moves; disconnecting Trakt turns it off and clears the ledger without touching hearts or Trakt', async () => {
  // With her own MDBList key and MDBList sync on, so every path here runs while her setup passes hearts on to MDBList.
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key'})).body, {username: 'adalists'}); assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual(setupOf(), [['mdblist'], true]);
  const calls = () => listCalls().length, sent = calls(), had = hearted(), listed = trakt.watchlist.length, gone = removes();
  // Off: an app's DELETE and POST pass through to her server and go no further; the cron leaves her alone.
  assert.equal((await favorites(adaSite, false)).status, 200); assert.deepEqual(await heartsOf(adaSite), {on: false});
  assert.equal((await tap(FAV.two.id, 'DELETE')).status, 200); assert.equal((await tap(FAV.two.id, 'POST')).status, 200);
  const writes = fake.hearts.length; await cron(); await cron(); await pause(700);
  assert.equal(calls(), sent); assert.deepEqual(heartWrites(writes), []); assert.deepEqual(hearted(), had); assert.equal(trakt.watchlist.length, listed);
  assert.ok(Object.keys(ledgerOf()).length > 5, 'the ledger stays for when it is turned on again');
  // On again: the hub finds the hearts as its ledger left them. Then Trakt is disconnected: the switch and the ledger go.
  assert.equal((await favorites(adaSite, true)).status, 200); await heartsTurn();
  const before = fake.hearts.length; assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.deepEqual(sql('SELECT person FROM favs'), []); assert.deepEqual(sql('SELECT key FROM hearts'), []);
  await cron(); assert.equal((await tap(FAV.two.id, 'DELETE')).status, 200); assert.equal((await tap(FAV.two.id, 'POST')).status, 200); await pause(700);
  assert.equal(calls(), sent); assert.equal(removes(), gone, 'none but the ones her own app asked for, earlier'); assert.equal(trakt.watchlist.length, listed);
  assert.deepEqual(heartWrites(before), ['-two', '+two'], 'only her own app’s'); assert.deepEqual(hearted(), had);
  const refused = await favorites(adaSite, true); assert.equal(refused.status, 409); assert.equal(refused.body.message, 'Connect Trakt first.'); assert.equal(await heartsOf(adaSite), null);
  // As it was before these tests: her MDBList key kept, Trakt not connected.
  assert.deepEqual((await owner('POST', '/api/people/ada/mdblist', {key: 'ada-mdblist-key', ...(keptInLists ? {} : {keep: true})})).body, {username: 'adalists'}); assert.deepEqual(await syncAll(), {state: 'ok'}); trakt.watchlist = null;
});
test('pictures go to the hub’s own Home setup, never to a person’s', async () => {
  const [home] = [...fake.homes.entries()].find(([, item]) => !item.config.jellyfinAppPassword);
  for (const token_ of ['', token]) {
    const picture = await raw(`/Items/${ITEM}/Images/Primary?tag=x`, token_);
    assert.equal(picture.status, 302); assert.equal(picture.location, `${UP}/jellyfin/${home}/Items/${ITEM}/Images/Primary?tag=x`);
  }
});
test('signing out and removing a person', async () => {
  assert.equal((await raw('/Sessions/Logout', token, {method: 'POST'})).status, 204);
  assert.equal((await raw('/System/Info', token)).status, 401);
  // Removed with Favorites from his watchlist on and hearts in its ledger (put there directly): both go with him, and nothing
  // is taken off anyone's Trakt.
  Object.assign(playerOf('Ben')[1].config, {jellyfinWatchlistServices: ['mdblist'], mdblistWatchTracking: true});
  sql("INSERT INTO favs (hub, person) SELECT id, 'ben' FROM hubs; INSERT INTO hearts (hub, person, key, item, state, listed, at) SELECT id, 'ben', 'movie:tt7000001', 'x', 'hub', 1, 1 FROM hubs");
  const removesBefore = removes();
  assert.equal((await owner('DELETE', '/api/people/ben')).status, 200);
  await cron(); await pause(500); assert.deepEqual(sql('SELECT person FROM favs'), []); assert.deepEqual(sql('SELECT person FROM hearts'), []); assert.equal(removes(), removesBefore);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(playerOf('Ben'), undefined); assert.equal(fake.homes.size, 2);
  assert.ok(!players().variants.some(item => item.id === 'hub-c-ben'));
});
test('deleting the hub removes every setup', async () => {
  const me = (await owner('GET', '/api/state')).body;
  const done = await owner('POST', '/api/hub/delete', {password: 'correct horse'});
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(fake.homes.size, 0); assert.equal(fake.configs.size, 0); assert.ok(me);
});
