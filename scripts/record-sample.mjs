// Records the made-up hub behind the preview (/?sample) into src/sample/recorded.json.
// It runs against the local test Worker that `tests/run.sh sample` starts (a throwaway local database, no real accounts):
// it builds a small hub through the hub's own API and player address, then keeps the answers the pages ask for.
//   npm run sample:record   builds the hub and writes the file
//   npm run sample:check    builds the hub and only says whether the file still has the shape the Worker answers with
// Everything here is invented: the people, the titles, the keys, the places. Nothing is read from any real hub.
import http from 'node:http';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8799', UP = 'http://127.0.0.1:8798', CHECK = process.argv.includes('--check');
const FILE = new URL('../src/sample/recorded.json', import.meta.url);
const say = text => console.log(`sample: ${text}`), pause = ms => new Promise(done => setTimeout(done, ms));
const hash = text => {let h = 7; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h;};

/* ---------- invented titles ---------- */
const A = ['Quiet', 'Paper', 'Copper', 'Winter', 'Hollow', 'Bright', 'Distant', 'Amber', 'Silver', 'Northern', 'Second', 'Borrowed'];
const B = ['Signal', 'Atlas', 'Parade', 'Meadow', 'Lantern', 'Harvest', 'Compass', 'Station', 'Orchard', 'Tide', 'Summer', 'Letters'];
const made = id => `The ${A[id % A.length]} ${B[Math.floor(id / A.length) % B.length]}`;
// The id AIOMetadata gives a title on a person's own server, worked out from its TMDB id (worker/here.ts, packed).
function packed(kind, tmdb, season, episode) {
  const bytes = new Uint8Array(16), s = kind === 4 ? season : 0xffff, e = kind === 4 ? episode : 0xffff;
  bytes[0] = 0xa1; bytes[1] = (kind << 4) | 2; bytes[2] = kind === 1 ? 1 : 2;
  for (let at = 8, rest = tmdb; at >= 3; at--, rest = Math.floor(rest / 256)) bytes[at] = rest % 256;
  bytes[9] = s >> 8; bytes[10] = s & 255; bytes[11] = e >> 8; bytes[12] = e & 255; bytes[13] = 1;
  const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const HELD = {};
const movie = (tmdb, name, minutes) => {const Id = packed(1, tmdb); HELD[Id] = {Id, Type: 'Movie', Name: name, RunTimeTicks: minutes * 60e7, ProviderIds: {Tmdb: String(tmdb)}}; return Id;};
const show = (tmdb, name) => {const Id = packed(2, tmdb); HELD[Id] = {Id, Type: 'Series', Name: name, ProviderIds: {Tmdb: String(tmdb)}}; return Id;};
const episode = (tmdb, season, number, minutes) => {const Id = packed(4, tmdb, season, number), SeriesId = packed(2, tmdb); HELD[Id] = {Id, Type: 'Episode', Name: `Episode ${number}`, SeriesId, SeriesName: HELD[SeriesId].Name, ParentIndexNumber: season, IndexNumber: number, RunTimeTicks: minutes * 60e7, ProviderIds: {}}; return Id;};
const GLASS = movie(910001, 'Glass Garden', 104), KITES = movie(910002, 'Paper Kites', 92), ORBIT = movie(910003, 'The Quiet Orbit', 118), ENGINES = movie(910004, 'Small Engines', 96), FERRY = movie(910005, 'Midnight Ferry', 88);
show(920001, 'Harbor Lights'); show(920002, 'North of Nowhere');
const HARBOR = {s1e1: episode(920001, 1, 1, 48), s2e3: episode(920001, 2, 3, 50), s2e4: episode(920001, 2, 4, 50)};
const NORTH = {e7: episode(920002, 1, 7, 44), e8: episode(920002, 1, 8, 44), e9: episode(920002, 1, 9, 46)};
const NAMES = {910001: 'Glass Garden', 910002: 'Paper Kites', 910003: 'The Quiet Orbit', 910004: 'Small Engines', 910005: 'Midnight Ferry', 920001: 'Harbor Lights', 920002: 'North of Nowhere'};
const nameOf = id => NAMES[id] ?? made(id);

/* ---------- stand-ins: AIOStreams, AIOMetadata (each setup also a Jellyfin server), TMDB, Trakt, MDBList ---------- */
const fake = {configs: new Map(), homes: new Map(), made: 0, missed: new Set(), trakt: 0};
const uuidOf = n => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000aa`;
const films = (from, count) => Array.from({length: count}, (_, n) => ({id: from + n, title: made(from + n), name: made(from + n), vote_average: 7.2 + (n % 5) / 5, release_date: '2021-03-01', first_air_date: '2021-03-01'}));
function tmdb(where, ask) {
  const [kind, id, more] = where.split('/'), n = Number(id);
  if (kind === 'discover') return {results: films(930000 + hash(ask.toString()) % 5000, 20)};
  if (kind === 'collection') return {name: `${made(n)} Collection`, parts: films(n * 3 % 90000 + 940000, 3)};
  if (more === 'recommendations' || more === 'similar') return {results: films(950000 + n % 4000 * 10, 10)};
  if (more === 'release_dates') return {results: [{iso_3166_1: 'US', release_dates: [{certification: 'PG'}]}]};
  if (more === 'content_ratings') return {results: [{iso_3166_1: 'US', rating: 'TV-PG'}]};
  if (more) return null;
  if (kind === 'movie') return {id: n, title: nameOf(n), belongs_to_collection: n % 2 ? {id: 960000 + n % 100, name: `${nameOf(n)} Collection`} : null, genres: [{id: 18}, {id: 35}], credits: {crew: [{id: 970000 + n % 7, name: ['Ines Okoro', 'Tomas Vale', 'Mira Chen', 'Jon Abara', 'Lena Whit', 'Sami Dane', 'Ola Reyes'][n % 7], job: 'Director'}]}};
  if (kind === 'tv') return {id: n, name: nameOf(n), genres: [{id: 18}], last_episode_to_air: {season_number: 2, episode_number: 6}, backdrop_path: '/sample.jpg'};
  return null;
}
const WATCHLIST = [{type: 'movie', listed_at: '2026-01-01T00:00:00.000Z', movie: {title: 'Small Engines', year: 2022, ids: {trakt: 4, tmdb: 910004}}}, {type: 'show', listed_at: '2026-01-01T00:00:00.000Z', show: {title: 'North of Nowhere', year: 2021, ids: {trakt: 12, tmdb: 920002}}}];
const TRAKT = {
  '/sync/last_activities': {movies: {watched_at: '2020-01-01T00:00:00.000Z', paused_at: '2020-01-01T00:00:00.000Z'}, episodes: {watched_at: '2020-01-01T00:00:00.000Z', paused_at: '2020-01-01T00:00:00.000Z'}},
  '/sync/watchlist/all/added/desc': WATCHLIST,
  '/recommendations/movies': films(980000, 12).map(item => ({title: item.title, year: 2021, ids: {trakt: item.id, tmdb: item.id}})),
  '/recommendations/shows': films(981000, 8).map(item => ({title: item.title, year: 2021, ids: {trakt: item.id, tmdb: item.id}})),
  '/users/me/lists': [{name: 'Weekend rewatches', privacy: 'private', item_count: 24, ids: {trakt: 501, slug: 'weekend-rewatches'}}, {name: 'Heist nights', privacy: 'public', item_count: 12, ids: {trakt: 502, slug: 'heist-nights'}}],
  '/users/likes/lists': [{type: 'list', list: {name: 'Sunday slow films', privacy: 'public', item_count: 18, ids: {trakt: 777}}}],
};
function traktAnswer(request, path, body, send, answer) {
  if (path === '/oauth/token') {const n = ++fake.trakt; return send(200, {access_token: `sample-access-${n}`, refresh_token: `sample-refresh-${n}`, expires_in: 7 * 86400, created_at: Math.floor(Date.now() / 1000), token_type: 'bearer', scope: 'public'});}
  if (path === '/oauth/revoke') return send(200, {});
  if (path === '/users/settings') return send(200, {user: {username: 'ada_watches', ids: {slug: 'ada-watches'}}});
  const [where, query] = path.split('?');
  if (request.method === 'GET') {
    const items = /\/lists\/\d+\/items$/.test(where) ? films(982000 + hash(where) % 500, 4).map(item => ({type: 'movie', movie: {title: item.title, year: 2021, votes: 100, ids: {trakt: item.id, tmdb: item.id}}})) : TRAKT[where] ?? (/^\/shows\/\d+\/progress/.test(where) ? null : []);
    if (!items) return send(404, {});
    const ask = new URLSearchParams(query ?? ''), limit = Number(ask.get('limit')) || 100, page = Number(ask.get('page')) || 1;
    answer.writeHead(200, {'content-type': 'application/json', 'x-pagination-page': String(page), 'x-pagination-page-count': String(Array.isArray(items) ? Math.max(1, Math.ceil(items.length / limit)) : 1)});
    return answer.end(JSON.stringify(Array.isArray(items) && ask.has('page') ? items.slice((page - 1) * limit, page * limit) : items));
  }
  if (path === '/sync/watchlist' || path === '/sync/history') return send(201, {added: {movies: 0, shows: 0, episodes: 0}, existing: {movies: 0, shows: 0}, not_found: {movies: [], shows: [], episodes: []}});
  if (path.endsWith('/remove')) return send(200, {deleted: {movies: 0, episodes: 0, shows: 0}, not_found: {movies: [], shows: [], seasons: [], episodes: [], ids: []}});
  return send(201, {});
}
const KEYS = new Set(['hub-mdblist-key', 'dev-mdblist-key']);
function mdblist(request, path, send) {
  const [where, query] = path.split('?'), ask = new URLSearchParams(query ?? '');
  if (!KEYS.has(ask.get('apikey'))) return send(403, {});
  if (where === '/user') return send(200, {username: ask.get('apikey') === 'dev-mdblist-key' ? 'dev_lists' : 'ourplace'});
  if (where === '/lists/user') return send(200, [{id: 4242, name: 'Award winners', slug: 'award-winners', items: 60, mediatype: 'movie'}, {id: 4243, name: 'Under 90 minutes', slug: 'under-90-minutes', items: 41, mediatype: 'movie'}]);
  if (where === '/lists/liked') return send(200, {lists: [{id: 6161, name: 'Rainy day shows', slug: 'rainy-day-shows', items: 15, mediatype: 'show', user_name: 'someone'}], pagination: {page: 1, limit: 50, offset: 0, total: 1, has_more: false}});
  if (/^\/lists\/\d+\/items$/.test(where)) return send(200, [{id: 910001, rank: 1, title: 'Glass Garden', mediatype: 'movie', ids: {tmdb: 910001}}]);
  if (/^\/lists\/[\w.-]+\/[\w.-]+$/.test(where)) return send(200, [{id: 5151, name: where.split('/')[3].replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), mediatype: 'movie', items: 30}]);
  if (where === '/watchlist/items') return send(200, Number(ask.get('offset')) ? [] : [{id: 910005, title: 'Midnight Ferry', mediatype: 'movie', ids: {tmdb: 910005}, watchlist_at: '2026-01-01T00:00:00.000Z'}]);
  if (where === '/sync/playback') return send(200, []);
  if (where === '/sync/watched' && request.method === 'GET') return send(200, {movies: [], shows: [], episodes: []});
  if (/^\/sync\/history\/(movie|show)\//.test(where)) return send(200, {type: where.split('/')[3], play_count: 0, truncated: false, plays: []});
  if (where === '/sync/watched') return send(200, {added: {movies: 1}, not_found: {movies: [], shows: [], episodes: []}});
  if (where.startsWith('/scrobble/')) return send(201, {action: where.split('/')[2]});
  return send(200, {});
}
const standIn = http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk; let body = {}; try {body = raw ? JSON.parse(raw) : {};} catch { /* not JSON */ }
  const url = request.url, [id, pass] = request.headers.authorization?.startsWith('Basic ') ? atob(request.headers.authorization.slice(6)).split(':') : [];
  const mine = () => fake.configs.get(id)?.password === pass ? fake.configs.get(id) : null;
  if (url.startsWith('/notice/')) {answer.writeHead(204); return answer.end();}
  if (url === '/') return send(200, {});
  if (url.startsWith('/trakt/')) return traktAnswer(request, url.slice(6), body, send, answer);
  if (url.startsWith('/mdblist/')) return mdblist(request, url.slice(8), send);
  if (url.startsWith('/tmdb3/')) {const [where, query] = url.slice(7).split('?'), found = tmdb(where, new URLSearchParams(query ?? '')); return found ? send(200, found) : send(404, {});}
  const chart = /^\/flix\/([a-z-]+)\.json$/.exec(url);
  if (chart) return send(200, {region: chart[1], charts: [{catalog_id: 'netflix.movies', entries: films(990000, 10).map((item, n) => ({rank: n + 1, title: item.title, tmdb: {id: item.id, media_type: 'movie'}}))}, {catalog_id: 'netflix.series', entries: films(991000, 10).map((item, n) => ({rank: n + 1, title: item.title, tmdb: {id: item.id, media_type: 'tv'}}))}]});
  if (url.startsWith('/tmdb')) return send(200, {});
  if (url === '/api/v1/status') return send(200, {data: {settings: {protected: false, presets: ['custom', 'torrentio', 'comet', 'meteor', 'stremthru-torz', 'library'].map(ID => ({ID}))}}});
  if (url === '/api/config' && request.method === 'GET') return send(200, {addonVersion: '4.1.0'});
  if (url === '/api/config/save') {const uuid = uuidOf(++fake.made); fake.homes.set(uuid, {password: body.password, config: {...body.config, configVersion: 1}}); return send(200, {success: true, userUUID: uuid});}
  if (url.startsWith('/api/config/')) {
    const home = fake.homes.get(url.split('/').pop()); if (!home || home.password !== body.password) return send(401, {});
    if (url.includes('/load/')) return send(200, {success: true, config: home.config});
    if (url.includes('/update/')) {if (body.baseVersion !== home.config.configVersion) return send(409, {}); home.config = {...body.config, configVersion: home.config.configVersion + 1}; return send(200, {success: true});}
    if (url.includes('/delete-user/')) {fake.homes.delete(url.split('/').pop()); return send(200, {success: true});}
  }
  // A row's titles as a player app would get them: seven pictures, told apart by row (the preview draws its own in their place).
  const row = /^\/stremio\/([^/]+)\/catalog\/([^/]+)\/([^/]+)\.json$/.exec(url);
  if (row) return send(200, {metas: Array.from({length: 7}, (_, n) => ({poster: `https://img.test/${row[3]}/${n}.jpg`}))});
  if (url.startsWith('/stremio/')) return send(200, {metas: []});
  if (url.startsWith('/api/v1/user')) {
    if (request.method === 'POST') {const uuid = `cfg-${fake.configs.size + 1}`; fake.configs.set(uuid, {password: body.password, config: body.config}); return send(201, {success: true, data: {uuid}});}
    if (!mine()) return send(401, {});
    if (request.method === 'GET') return send(200, {success: true, data: {userData: {...mine().config}, encryptedPassword: 'sample-sealed'}});
    if (request.method === 'PUT') {mine().config = body.config; return send(200, {success: true});}
    if (request.method === 'DELETE') {fake.configs.delete(id); return send(200, {success: true});}
  }
  if (url === '/jellyfin/System/Info/Public') return send(200, {Id: 'sampleserverid', ServerName: 'AIOStreams'});
  const jf = /^\/jellyfin\/([0-9a-f-]{36})(\/.*)$/.exec(url);
  if (jf) {
    const [, uuid, rest] = jf, home = fake.homes.get(uuid); if (!home) return send(404, {});
    if (/^\/Items\/[^/]+\/Images\//.test(rest)) {answer.writeHead(200, {'content-type': 'image/jpeg'}); return answer.end('jpeg');}
    if (rest === '/Users/AuthenticateByName') return !home.config.jellyfinAppPassword || body.Pw !== home.config.jellyfinAppPassword ? send(401, {}) : send(200, {AccessToken: `aiom-token-${uuid}`, ServerId: uuid, User: {Id: uuid, Name: home.config.jellyfinUserName, ServerId: uuid}, SessionInfo: {UserId: uuid, Id: uuid.replace(/-/g, '')}});
    if (!(request.headers.authorization ?? '').includes(`Token="aiom-token-${uuid}"`)) return send(401, {});
    if (rest === '/System/Info') return send(200, {Id: uuid, ServerName: 'AIOMetadata', LocalAddress: `${UP}/jellyfin/${uuid}`});
    if (rest === '/Users') return send(200, [{Id: uuid, Name: home.config.jellyfinUserName}]);
    if (rest.startsWith('/Sessions/')) return send(204, {});
    if (rest.startsWith('/UserViews')) return send(200, {Items: []});
    if (/^\/(Videos\/[^/]+\/stream|Items\/[^/]+\/(Download|File))/i.test(rest)) {answer.writeHead(200, {'content-type': 'video/mp4'}); return answer.end('film');}
    const tick = /^\/(?:Users\/[^/]+\/PlayedItems|UserPlayedItems)\/([^/?]+)/.exec(rest);
    if (tick) return send(200, {Played: request.method === 'POST'});
    if (/^\/(?:Users\/[^/]+\/FavoriteItems|UserFavoriteItems)\//.test(rest)) return send(200, {IsFavorite: request.method === 'POST'});
    if (/^\/Users\/[^/]+\/Items\/[^/?]+\/UserData/.test(rest)) return send(200, {});
    if (rest.startsWith('/Shows/')) {const series = decodeURIComponent(rest.split('/')[2]); return send(200, {Items: Object.values(HELD).filter(item => item.SeriesId === series)});}
    if (rest.startsWith(`/Users/${uuid}/Items?`)) {const ids = new URLSearchParams(rest.split('?')[1]).get('Ids'); return send(200, {Items: ids ? ids.split(',').map(item => HELD[item]).filter(Boolean) : []});}
    if (rest.startsWith(`/Users/${uuid}/Items/`)) {const held = HELD[decodeURIComponent(rest.split('/').pop().split('?')[0])]; return held ? send(200, {...held, ServerId: uuid, UserData: {Key: uuid}}) : send(404, {});}
    if (rest.startsWith('/Items')) return send(200, {Items: []});
  }
  fake.missed.add(`${request.method} ${url.split('?')[0]}`);
  send(404, {});
}).listen(8798, '127.0.0.1');

/* ---------- the hub's own API, as the site calls it ---------- */
function client() {
  const jar = new Map();
  return async (method, path, body, headers = {}) => {
    const answer = await fetch(BASE + path, {method, headers: {origin: BASE, 'content-type': 'application/json', cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    for (const set of answer.headers.getSetCookie()) {const [pair] = set.split(';'), at = pair.indexOf('='); if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1)); else jar.delete(pair.slice(0, at));}
    return {status: answer.status, body: await answer.json().catch(() => null)};
  };
}
const owner = client();
const ok = async (who, method, path, body, headers) => {const got = await who(method, path, body, headers); if (got.status >= 300) throw new Error(`${method} ${path} answered ${got.status}: ${JSON.stringify(got.body)}`); return got.body;};
const stateOf = async () => (await ok(owner, 'GET', '/api/state')).hub;
const syncAll = async () => {for (let i = 0; i < 12; i++) {const got = await ok(owner, 'POST', '/api/sync', {}); if (!got.more) return got;} throw new Error('the apps never caught up');};
const cron = (time = Date.now()) => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}&time=${time}`).then(answer => answer.text());
const sql = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', command], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});

/* ---------- the made-up hub ---------- */
const PEOPLE = [
  {id: 'ada', name: 'Ada', groupId: 'family', can: {arrange: true, add: true, playback: true, limit: false}, settings: {}},
  {id: 'ben', name: 'Ben', groupId: 'family', can: {arrange: true, add: false, playback: false, limit: false}, settings: {limit: 'kids'}},
  {id: 'chi', name: 'Chi', groupId: 'family', can: {arrange: true, add: true, playback: true, limit: false}, settings: {}},
  {id: 'dev', name: 'Dev', groupId: 'friends', can: {arrange: true, add: true, playback: true, limit: false}, settings: {languages: ['English', 'Hindi']}},
  {id: 'eve', name: 'Eve', groupId: 'friends', can: {arrange: true, add: true, playback: false, limit: false}, settings: {}},
];
const JOINED = ['ada', 'ben', 'dev', 'eve'], HOME = {city: 'Lagos', country: 'NG', net: 'SpaceX Services, Inc.'}, AWAY = {city: 'Nairobi', country: 'KE', net: 'Safaricom Limited'}, ABROAD = {city: 'London', country: 'GB', net: 'British Telecommunications PLC'};
// Player apps as they name themselves (the Client and Device of their sign-in, worker/front.ts).
const DEVICES = {
  ada: [{key: 'tv', app: 'Wholphin', name: 'Living room TV', where: HOME}, {key: 'phone', app: 'Streamyfin', name: 'Ada’s iPhone', where: HOME}],
  ben: [{key: 'tablet', app: 'Nuvio', name: 'Ben’s tablet', where: HOME}],
  dev: [{key: 'tv', app: 'Odin', name: 'Apple TV', where: AWAY}, {key: 'laptop', app: 'Jellyfin Web', name: 'Chrome', where: AWAY}],
  eve: [{key: 'phone', app: 'Strand', name: 'Eve’s iPhone', where: ABROAD}],
};
let code = '';
const kept = {};
const seats = {};
const head = (seat, ago = 0) => ({'content-type': 'application/json', authorization: `MediaBrowser Client="${seat.app}", Device="${encodeURIComponent(seat.name)}", DeviceId="sample-${seat.person}-${seat.key}", Version="1.0"${seat.token ? `, Token="${seat.token}"` : ''}`,
  'x-test-city': seat.where.city, 'x-test-country': seat.where.country, 'x-test-net': seat.where.net, ...(ago ? {'x-test-ago': String(Math.round(ago))} : {})});
const player = async (seat, method, path, body, ago = 0) => {const answer = await fetch(`${BASE}/h/${code}${path}`, {method, headers: head(seat, ago), body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'}); await answer.arrayBuffer(); if (answer.status >= 400) throw new Error(`${seat.app} ${method} ${path} answered ${answer.status}`); return answer;};
const MIN = 60, HOUR = 3600, DAY = 86400;
/* One sitting, played through in no time. It began `from` seconds ago and went as `script` says: ['play', a, b] plays from minute a
   of the title to minute b (starting somewhere other than where it was is a jump), ['pause', n] sits paused for n minutes.
   The app reports every five minutes, as apps do every few seconds. `end`: 'stop' (the app says it stopped), or nothing (it is
   still going, or went quiet without a word). Returns where it was left, for a report made later (carryOn). */
async function sitting(seat, item, from, script, end) {
  let t = 0, at = script[0][1], paused = false, begun = false;
  const tell = async (kind = '/Progress') => {await player(seat, 'POST', `/Sessions/Playing${kind}`, {ItemId: item, PositionTicks: Math.round(at * 60e7), ...(kind === '/Progress' ? {IsPaused: paused} : {})}, Math.max(0, from - t * MIN)); await pause(260);};
  for (const [what, a, b] of script) {
    if (what === 'pause') {paused = true; t += 0.05; await tell(); for (let left = a; left > 0; left -= 9) {t += Math.min(9, left); if (left > 9) await tell();} continue;}
    if (!begun) {begun = true; await tell('');} else if (paused || a !== at) {paused = false; at = a; t += 0.05; await tell();}
    while (at < b) {const step = Math.min(5, b - at); at += step; t += step; await tell();}
  }
  if (end) {t += 0.05; await tell('/Stopped');}
  return {seat, item, at, from, t};
}
/* The same player, heard from once more just now, still playing: the minutes since count as played. */
const carryOn = left => player(left.seat, 'POST', '/Sessions/Playing/Progress', {ItemId: left.item, PositionTicks: Math.round((left.at + Math.max(0, left.from / MIN - left.t)) * 60e7), IsPaused: false});

async function build() {
  const offer = (await client()('GET', '/api/open')).body;
  await ok(owner, 'POST', '/api/signup', {password: 'sample password', code: 'local-claim', hub: offer.hub, proof: offer.proof});
  await ok(owner, 'PUT', '/api/account', {name: 'Sam', theme: 'dark'});
  // A hub just made, before anything is set up: what the preview starts first-time setup from.
  kept.fresh = {'GET /api/state': await ok(owner, 'GET', '/api/state')};
  for (const [name, key] of [['TorBox', 'sample-torbox-key'], ['Real-Debrid', 'sample-realdebrid-key'], ['AllDebrid', 'sample-alldebrid-key']]) await ok(owner, 'PUT', `/api/services/${encodeURIComponent(name)}`, {key});
  await ok(owner, 'PUT', '/api/keys/tmdb', {key: 'sample-tmdb-key'}); await ok(owner, 'PUT', '/api/keys/mdblist', {key: 'hub-mdblist-key'});
  let hub = await stateOf(); code = hub.code;
  await ok(owner, 'PUT', '/api/groups/family', {name: 'Family', rows: null, settings: {}});
  await ok(owner, 'PUT', '/api/groups/friends', {name: 'Friends', rows: hub.rows.map(row => row.id === 'mixed-genre' ? {...row, on: false} : row), settings: {quality: 'saver', maxSizeGb: 10, debrid: 'Real-Debrid'}});
  hub = await stateOf();
  await ok(owner, 'PUT', '/api/hub', {host: hub.host, hostUrl: hub.hostUrl, serverName: 'Our place', addons: hub.addons, defaults: hub.defaults, rows: hub.rows, order: ['family', 'friends'], v: hub.v});
  for (const person of PEOPLE) await ok(owner, 'PUT', `/api/people/${person.id}`, {name: person.name, groupId: person.groupId, rows: null, settings: person.settings, can: person.can, paused: false, trakt: false, lists: false});
  await syncAll();
  // Everyone but Chi opens their link and chooses a password.
  const site = {};
  for (const id of JOINED) {site[id] = client(); await ok(site[id], 'POST', '/api/join', {token: (await ok(owner, 'GET', `/api/people/${id}/signin`)).link.split('/join/')[1], password: `sample ${id} password`});}
  // Ada connects Trakt and turns sync and Watchlist on; Dev connects MDBList alone and turns its sync on; Ben and Eve connect nothing.
  await ok(site.ada, 'POST', '/api/people/ada/scrobble/link', {access: 'sample-access-0', refresh: 'sample-refresh-0', lasts: 7 * 86400, created: Math.floor(Date.now() / 1000), username: 'ada_watches', slug: 'ada-watches', redirect: `${BASE}/api/trakt/callback`});
  await ok(site.ada, 'POST', '/api/people/ada/matching', {on: true, earlier: false});
  await ok(site.dev, 'POST', '/api/people/dev/mdblist', {key: 'dev-mdblist-key', keep: true});
  await syncAll();
  await ok(site.ada, 'POST', '/api/people/ada/favorites', {on: true});
  await ok(site.dev, 'POST', '/api/people/dev/mdblist', {reuse: true, moving: true}); await syncAll();
  const moved = {};
  for (let i = 0; i < 10; i++) {moved.answer = await ok(site.dev, 'POST', '/api/people/dev/compare/here-mdblist', {switch: true}); if (moved.answer.switched || !moved.answer.more) break;}
  await syncAll(); kept.dev = {'POST /api/people/dev/compare/here-mdblist': moved.answer};
  // Ada has a Home of her own: the group's, with a row of her own Trakt lists.
  const ada = (await stateOf()).people.find(person => person.id === 'ada');
  await ok(owner, 'PUT', '/api/people/ada', {name: ada.name, groupId: ada.groupId, picks: ada.picks, settings: ada.settings, can: ada.can, paused: false, trakt: ada.trakt, lists: ada.lists, v: ada.v,
    rows: [...hub.rows.slice(0, 5), {id: 'trakt-lists', title: 'My lists', kind: 'Collection · 2 lists', source: 'Trakt · your lists', origin: 'own', on: true}, ...hub.rows.slice(5)]});
  await syncAll();
  await ok(owner, 'PUT', '/api/notice', {address: 'https://example.com/hooks/home-changed'}); await ok(owner, 'PUT', '/api/notice/page', {address: 'https://example.com/refresh-setup'});
  // A passkey on the manager's account: only its public half is ever sent, so one made here is as good as a device's.
  const start = await ok(owner, 'POST', '/api/account/passkeys/options', {}), b64 = bytes => Buffer.from(bytes).toString('base64url');
  const pair = generateKeyPairSync('ec', {namedCurve: 'P-256'});
  await ok(owner, 'POST', '/api/account/passkeys', {id: b64(createHash('sha256').update('sample passkey').digest()), key: b64(pair.publicKey.export({type: 'spki', format: 'der'})), alg: -7, clientData: b64(JSON.stringify({type: 'webauthn.create', challenge: b64(start.challenge), origin: BASE})), challenge: start.challenge, proof: start.proof, name: 'Mac · Safari'});

  // Player apps sign in, each as itself.
  for (const [person, list] of Object.entries(DEVICES)) for (const device of list) {
    const seat = {...device, person}, password = (await ok(owner, 'GET', `/api/people/${person}/signin`)).password;
    const signed = await (await fetch(`${BASE}/h/${code}/Users/AuthenticateByName`, {method: 'POST', headers: head(seat), body: JSON.stringify({Username: PEOPLE.find(item => item.id === person).name, Pw: password})})).json();
    if (!signed.AccessToken) throw new Error(`${seat.app} could not sign in as ${person}`);
    seats[`${person}/${device.key}`] = {...seat, token: signed.AccessToken, user: signed.User.Id};
  }
  // Dev names his laptop, as anyone can under Devices (a browser signs in under its own name).
  await ok(owner, 'PUT', `/api/people/dev/devices/${(await stateOf()).people.find(person => person.id === 'dev').devices.find(device => device.name === 'Chrome').id}`, {name: 'Dev’s laptop'});
  await pause(21_000);
  const tv = seats['ada/tv'], phone = seats['ada/phone'], tablet = seats['ben/tablet'], odin = seats['dev/tv'], laptop = seats['dev/laptop'], strand = seats['eve/phone'];
  // Earlier in the week, oldest first.
  await sitting(odin, GLASS, 4 * DAY + 2 * HOUR, [['play', 0, 73]], 'stop');                                   // Dev: stopped at 70%
  await sitting(tv, FERRY, 3 * DAY + 3 * HOUR, [['play', 0, 104]], 'stop');                                   // Ada: a file that runs longer than listed
  await sitting(strand, GLASS, 3 * DAY, [['play', 0, 14], ['play', 31, 49], ['pause', 6], ['play', 70, 91]], 'stop'); // Eve: three parts, two skips
  await sitting(laptop, NORTH.e7, 2 * DAY + HOUR, [['play', 0, 43.5]], 'stop');
  await sitting(tv, FERRY, 2 * DAY + 4 * HOUR, [['play', 60, 103]], 'stop');                                  // Ada again: this time it is known where it ends
  await sitting(tablet, HARBOR.s1e1, DAY + 5 * HOUR, [['play', 0, 47.5]], 'stop');
  await sitting(tablet, ENGINES, DAY + 3 * HOUR, [['play', 0, 39.5]], 'stop');                                // Ben: stopped at 41%
  await sitting(phone, GLASS, DAY + 2 * HOUR, [['play', 0, 103]], 'stop');                                    // Ada: finished, then marked unwatched today
  await sitting(odin, NORTH.e8, DAY + HOUR, [['play', 0, 43.5]], 'stop');
  // Today.
  await sitting(tv, HARBOR.s2e3, 5 * HOUR, [['play', 0, 49]], 'stop');
  await sitting(tablet, KITES, 2 * HOUR + 40 * MIN, [['play', 0, 91]], 'stop');
  await sitting(laptop, NORTH.e9, 70 * MIN, [['play', 0, 21]]);                                               // Dev's laptop went quiet without saying it stopped
  await sitting(odin, ORBIT, 40 * MIN, [['play', 0, 33.5], ['pause', 6]]);                                    // Dev: paused a few minutes ago
  const now = await sitting(tv, HARBOR.s2e4, 34 * MIN, [['play', 0, 10], ['play', 16, 39.5]]);                // Ada: watching now, having skipped ahead once
  await player(phone, 'DELETE', `/UserPlayedItems/${GLASS}`); await pause(500);                               // Ada marks Glass Garden unwatched in an app
  await player(strand, 'POST', `/Users/${strand.user}/PlayedItems/${ENGINES}`, {}); await pause(400);         // Eve ticks one as watched
  // Titles saved to a device to watch later.
  await player(phone, 'GET', `/Items/${KITES}/Download`, undefined, 6 * HOUR); await player(strand, 'GET', `/Items/${ORBIT}/Download`, undefined, DAY + 4 * HOUR); await pause(600);
  // The background work runs a few times: Trakt sync, then one person's For you picks a run.
  await ok(site.ada, 'POST', '/api/people/ada/matching/pass', {});
  // (Dated after the hours the daily work starts at and well before midnight UTC, so every run is on the same day.)
  const day = new Date().toISOString().slice(0, 10), time = Math.min(Math.max(Date.now(), Date.parse(`${day}T06:10:00Z`)), Date.parse(`${day}T22:00:00Z`));
  for (let run = 0; run < 16; run++) {await cron(time + run * 5 * MIN * 1000); await pause(900);}
  await syncAll();
  // Devices were last used at different times.
  sql(`UPDATE devices SET seen = seen - 97200 WHERE name = 'Ada’s iPhone'; UPDATE devices SET seen = seen - 9000 WHERE name = 'Ben’s tablet'; UPDATE devices SET seen = seen - 4200 WHERE name = 'Dev’s laptop'; UPDATE devices SET seen = seen - 3 * 86400 WHERE name = 'Eve’s iPhone';`);
  await carryOn(now); await pause(400);
  return site;
}

/* ---------- what the pages ask for ---------- */
async function record(site) {
  const answers = {...kept}, keep = async (who, as, method, path, body) => {const got = await who(method, path, body, as === 'owner' ? {} : {'x-as': as}); if (got.status >= 300) throw new Error(`${as}: ${method} ${path} answered ${got.status}: ${JSON.stringify(got.body)}`); (answers[as] ??= {})[`${method} ${path}`] = got.body;};
  const hub = await stateOf();
  for (const path of ['/api/state', '/api/activity', '/api/previews', '/api/open']) await keep(owner, 'owner', 'GET', path);
  for (const group of hub.groups) await keep(owner, 'owner', 'GET', `/api/previews?group=${group.id}`);
  for (const person of hub.people) {await keep(owner, 'owner', 'GET', `/api/previews?person=${person.id}`); await keep(owner, 'owner', 'GET', `/api/people/${person.id}/signin`);}
  await keep(owner, 'owner', 'POST', '/api/hub/advanced', {password: 'sample password'});
  await keep(owner, 'owner', 'POST', '/api/account/recovery', {});
  await keep(owner, 'owner', 'POST', '/api/lists', {link: 'https://mdblist.com/lists/someone/cosy-mysteries'});
  // A person's own view, opened the way their manager opens it: their link, in the manager's browser.
  for (const person of hub.people) {
    const token = answers.owner[`GET /api/people/${person.id}/signin`].link.split('/join/')[1];
    await keep(owner, 'owner', 'POST', '/api/join', {token}); answers.owner[`POST /api/join ${person.id}`] = answers.owner['POST /api/join']; delete answers.owner['POST /api/join'];
    if (!person.joined) continue;
    for (const path of ['/api/state', '/api/activity', '/api/previews', `/api/people/${person.id}/signin`, `/api/people/${person.id}/because`]) await keep(owner, person.id, 'GET', path);
    if ((person.history && !person.history.again) || person.lists) await keep(owner, person.id, 'GET', `/api/people/${person.id}/lists`);
    if (person.matching?.on) {await keep(owner, person.id, 'GET', `/api/people/${person.id}/matching`); await keep(owner, person.id, 'GET', `/api/people/${person.id}/matching/synced`); await keep(owner, person.id, 'POST', `/api/people/${person.id}/matching/pass`, {});}
  }
  await keep(owner, 'owner', 'POST', '/api/sync', {});
  await keep(owner, 'owner', 'PUT', '/api/host', {aiostreams: '', aiometadata: ''});
  void site;
  return answers;
}
/* Nothing of the local run is kept that looks like a key or an address of this machine: sign-in details, tokens and setup ids are
   replaced with readable made-up ones, and the hub's own address with a mark the preview fills in. */
const WORDS = ['maple', 'river', 'copper', 'lantern', 'meadow', 'harbor', 'ember', 'willow', 'pebble', 'comet'];
const password = seed => {const h = hash(seed); return `${WORDS[h % 10]}-${WORDS[(h >>> 4) % 10]}-${WORDS[(h >>> 8) % 10]}-${10 + (h >>> 12) % 90}`;};
function scrubbed(answers) {
  const hubCode = answers.owner['GET /api/state'].hub.code;
  for (const [as, list] of Object.entries(answers)) for (const [key, answer] of Object.entries(list)) {
    const person = /\/api\/people\/([^/]+)\/signin$/.exec(key)?.[1];
    if (person) {answer.password = password(`app ${person}`); answer.link = `{site}#/join/sample-${person}`; if (answer.pin) answer.pin = String(100000 + hash(person) % 900000);}
    if (key === 'POST /api/account/recovery') answer.codes = answer.codes.map((_, n) => `sample-${1000 + n * 731 % 9000}-${2000 + n * 419 % 8000}`);
    if (key === 'GET /api/open') {answer.hub = 'n3w4ub'; answer.proof = 'sample-proof';}
    if (key === 'POST /api/hub/advanced') {
      let n = 0; const door = found => {if (!found) return; const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; found.open = found.open.replace(found.id, id).replace(/\/stremio\/[^/]+\/[^/]+\/configure$/, `/stremio/${id}/configure`); found.id = id; found.password = password(`setup ${n}`);};
      door(answer.aiostreams); for (const found of [answer.aiometadata, ...(answer.own ?? [])]) {door(found); if (found) found.open = found.open.replace(UP, 'https://aiometadata.example');}
    }
    void as;
  }
  const text = JSON.stringify(answers).replaceAll(`${UP}/api/auth/trakt`, 'https://aiometadata.example/api/auth/trakt').replaceAll(`${UP}/jellyfin`, 'https://aiometadata.example/jellyfin').replaceAll(UP, 'https://aiostreams.example').replaceAll(BASE, '{site}').replaceAll(BASE.replace('127.0.0.1', 'localhost'), '{site}')
    .replaceAll(`"code":"${hubCode}"`, '"code":"k7m2x9"').replaceAll('local-trakt-client', 'sample-trakt-client');
  if (/127\.0\.0\.1|localhost|sample password/.test(text)) throw new Error('something of the local run is still in the recording');
  return JSON.parse(text);
}
/* The shape of an answer: every key it has, a few levels down, with lists read as one item holding every key any of theirs has.
   Values, ids and times are left out, so two recordings of the same Worker have the same shape. */
function shape(value, depth = 4) {
  if (Array.isArray(value)) {const items = value.map(item => shape(item, depth)); return [items.every(item => typeof item === 'string') ? [...new Set(items)].sort().join('|') : items.reduce((all, item) => typeof item === 'object' && item && !Array.isArray(item) ? {...all, ...item} : all, {})];}
  if (value && typeof value === 'object') return depth ? Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key], depth - 1)])) : 'object';
  return value === null ? 'null' : typeof value;
}
/* What two shapes differ by, as short lines. A value that is there in one and null in the other is not a difference. */
function differences(was, now, at = '') {
  const out = [], loose = value => value === 'null' || value === undefined;
  if (typeof was !== 'object' || typeof now !== 'object' || !was || !now) {if (was !== now && !loose(was) && !loose(now) && !(typeof was === 'string' && typeof now === 'string' && (was === '' || now === ''))) out.push(`${at}: was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`); return out;}
  if (Array.isArray(was) !== Array.isArray(now)) return [`${at}: a list on one side only`];
  if (Array.isArray(was)) return differences(was[0], now[0], `${at}[]`);
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (!(key in was)) {if (!loose(now[key])) out.push(`${at}.${key}: new`);} else if (!(key in now)) {if (!loose(was[key])) out.push(`${at}.${key}: gone`);} else out.push(...differences(was[key], now[key], `${at}.${key}`));
  }
  return out;
}
/* A person's view differs from their manager's in a few places only: those are kept, not the whole answer twice. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function slim(answers) {
  const whole = answers.owner['GET /api/state'].hub;
  for (const [as, list] of Object.entries(answers)) if (as !== 'owner' && as !== 'fresh') {
    const mine = list['GET /api/state'].hub, me = mine.people[0], theirs = whole.people.find(person => person.id === as);
    list['GET /api/state'] = {role: 'person', personId: as, differs: Object.fromEntries(Object.entries(mine).filter(([key, value]) => key !== 'people' && key !== 'groups' && !same(value, whole[key]))), absent: Object.keys(whole).filter(key => !(key in mine)),
      self: Object.fromEntries(Object.entries(me).filter(([key, value]) => !same(value, theirs[key])))};
  }
  return answers;
}

try {
  const answers = scrubbed(await record(await build())), shapes = Object.fromEntries(Object.entries(answers).map(([as, list]) => [as, Object.fromEntries(Object.entries(list).map(([key, answer]) => [key, shape(answer)]))]));
  if (fake.missed.size) say(`stand-ins had no answer for: ${[...fake.missed].join(', ')}`);
  if (CHECK) {
    const kept = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null, found = kept ? differences(kept.shapes, shapes) : ['src/sample/recorded.json is missing'];
    if (found.length) {console.log(`✖ sample: the preview’s recorded answers no longer match the Worker (${found.length}). Run npm run sample:record. First: ${found.slice(0, 6).join('; ')}`); process.exitCode = 1;}
    else say('recorded answers match the Worker (ok)');
  } else {
    const at = answers.owner['GET /api/activity'].now, body = {at, answers: slim(answers), shapes};
    mkdirSync(new URL('.', FILE), {recursive: true});
    writeFileSync(FILE, `${JSON.stringify({stamp: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12), ...body})}\n`);
    say(`recorded ${Object.values(answers).reduce((sum, list) => sum + Object.keys(list).length, 0)} answers for ${Object.keys(answers).length} views into src/sample/recorded.json`);
  }
} catch (error) {console.log(`✖ sample: ${error.message}`); process.exitCode = 1;} finally {standIn.close(); standIn.closeAllConnections?.();}
