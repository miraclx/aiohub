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
const fake = {configs: new Map(), homes: new Map(), made: 0, signIns: 0, watched: [], pauses: []};
const uuidOf = n => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000aa`, ITEM = 'a1110100-0000-eaf7-78ff-ffffff010000';
// What Ada's own server holds: a film she watched, an episode she is partway through, one MDBList already has, and their show.
const FILM = 'a1110100-0000-eaf7-78ff-ffffff050000', LEFT = 'a1110100-0000-eaf7-78ff-ffffff060000', EP3 = 'a1110100-0000-eaf7-78ff-ffffff070000';
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
};
// Trakt: single-use refresh tokens, and every call as Ada logged. Each title above runs 6000 seconds. `refuse` turns that many
// writes away with a 429, as Trakt's Cloudflare does to the shared addresses Workers call from; `refuseReads` does it to reads.
const trakt = {history: [], watchlist: null, calls: [], reads: [], issued: 0, valid: new Set(), refresh: '', expiresIn: 7 * 86400, refreshed: [], revoked: [], stop: 201, refuse: 0, refused: [], refuseReads: false};
// What Ada's Trakt holds, for the rows the hub serves: a watchlist with a film, a show (twice: once by an episode) and a film known
// only by its TMDB id; 45 recommended films; one show with an episode to watch.
const film = n => ({title: `Film ${n}`, year: 2000, ids: {trakt: n, imdb: `tt${String(9000000 + n)}`, tmdb: 9000 + n}});
const WATCHLIST = [{type: 'movie', movie: {title: 'Meta Movie', ids: {imdb: 'tt0133093', tmdb: 603}}}, {type: 'show', show: {title: 'Meta Show', ids: {imdb: 'tt0944947', tmdb: 1399}}},
    {type: 'episode', episode: {season: 1, number: 1}, show: {title: 'Meta Show', ids: {imdb: 'tt0944947', tmdb: 1399}}}, {type: 'movie', movie: {title: 'Fight Club', ids: {imdb: null, tmdb: 550}}}, {type: 'movie', movie: {title: 'No ids', ids: {}}}];
// Her Trakt history, newest first (set by the tests below), and her MDBList: plays per title, and what it lists as watched lately.
const DAY = 86400, ago = days => new Date((Math.floor(Date.now() / 1000) - Math.round(days * DAY)) * 1000).toISOString();
const MOVIE = {inception: {title: 'Inception', ids: {imdb: 'tt1375666', tmdb: 27205}}, fight: {title: 'Fight Club', ids: {imdb: 'tt0137523', tmdb: 550}}, pulp: {title: 'Pulp Fiction', ids: {imdb: 'tt0110912', tmdb: 680}},
  gump: {title: 'Forrest Gump', ids: {imdb: 'tt0109830', tmdb: 13}}, knight: {title: 'The Dark Knight', ids: {imdb: 'tt0468569', tmdb: 155}}};
const BB = {title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}};
const lists = {plays: {}, recent: {movies: [], shows: [], episodes: []}, refuse: false};
const READS = {
  '/sync/watchlist/all/added/desc': () => trakt.watchlist ?? WATCHLIST,
  '/sync/history': () => trakt.history,
  '/recommendations/movies': Array.from({length: 45}, (_, n) => film(n + 1)),
  '/recommendations/shows': [{title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}}],
  '/sync/progress/up_next': [{show: {title: 'Breaking Bad', ids: {imdb: 'tt0903747', tmdb: 1396}}, progress: {aired: 62, completed: 10}}],
};
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
  if (!trakt.valid.has(auth)) return send(401, {});
  if (path === '/users/settings') return send(200, {user: {username: 'adatrakt'}});
  // Reads for the rows the hub serves. Kept apart from the calls that write, which the tests below count exactly.
  const [where, query] = path.split('?');
  if (request.method === 'GET' && READS[where]) {
    trakt.reads.push({where, query, auth}); if (trakt.refuseReads) return send(429, {});
    // Paged as Trakt pages, by `page` and `limit` with its page count; history between `start_at` and `end_at`.
    const ask = new URLSearchParams(query ?? ''), from = Date.parse(ask.get('start_at') ?? '') || 0, to = Date.parse(ask.get('end_at') ?? '') || Infinity;
    const all = (typeof READS[where] === 'function' ? READS[where]() : READS[where]).filter(item => !item.watched_at || (Date.parse(item.watched_at) >= from && Date.parse(item.watched_at) <= to));
    const limit = Number(ask.get('limit')) || 100, page = Number(ask.get('page')) || 1;
    answer.writeHead(200, {'content-type': 'application/json', 'x-pagination-page': String(page), 'x-pagination-page-count': String(Math.max(1, Math.ceil(all.length / limit)))});
    return answer.end(JSON.stringify(ask.has('page') ? all.slice((page - 1) * limit, page * limit) : all));
  }
  if (trakt.refuse > 0) {trakt.refuse--; trakt.refused.push({path, body}); return send(429, {});}
  trakt.calls.push({path, body, auth});
  return send(path === '/scrobble/stop' ? trakt.stop : 201, {});
}
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk; const body = raw ? JSON.parse(raw) : {};
  const [id, pass] = request.headers.authorization?.startsWith('Basic ') ? atob(request.headers.authorization.slice(6)).split(':') : [];
  const mine = () => fake.configs.get(id)?.password === pass ? fake.configs.get(id) : null;
  if (request.url.startsWith('/trakt/')) return traktAnswer(request, request.url.slice(6), body, send, answer);
  if (request.url.startsWith('/tmdb')) return send(request.url.includes('api_key=good-tmdb-key') ? 200 : 401, {});
  // AIOMetadata's own Trakt connection, as it describes a Token ID.
  if (request.url === '/api/oauth/token/info') return body.tokenId === 'aiom-trakt-token-id-1' ? send(200, {provider: 'trakt', username: 'adatrakt'}) : send(404, {});
  if (request.url.startsWith('/mdblist/user')) return send(request.url.includes('apikey=ada-mdblist-key') ? 200 : 403, {username: 'adalists'});
  if (request.url.startsWith('/mdblist/') && !request.url.includes('apikey=ada-mdblist-key')) return send(403, {});
  if (request.url.startsWith('/mdblist/sync/history/movie/tmdb/603')) return send(200, {plays: fake.watched.some(body => body.movies?.length) ? [{season_num: null}] : []});
  if (request.url.startsWith('/mdblist/sync/history/show/tmdb/1399')) return send(200, {plays: [{season_num: 1, episode_num: 1}]});
  if (request.url.startsWith('/mdblist/sync/playback')) return send(200, []);
  if (request.url.startsWith('/mdblist/') && lists.refuse) return send(503, {});
  const history = /^\/mdblist\/sync\/history\/(movie|show)\/tmdb\/(\d+)/.exec(request.url);
  if (history && lists.plays[`${history[1]}/${history[2]}`]) return send(200, {type: history[1], play_count: lists.plays[`${history[1]}/${history[2]}`].length, truncated: false, plays: lists.plays[`${history[1]}/${history[2]}`]});
  if (history) return send(200, {type: history[1], play_count: 0, truncated: false, plays: []});
  if (request.url.startsWith('/mdblist/sync/watched?') && request.method === 'GET') return send(200, lists.recent);
  if (request.url.startsWith('/mdblist/sync/watched')) {fake.watched.push(body); return send(200, {added: {movies: 1}, not_found: {movies: [], shows: [], episodes: []}});}
  if (request.url.startsWith('/mdblist/scrobble/pause')) {fake.pauses.push(body); return send(201, {action: 'pause'});}
  if (request.url === '/api/config/save') {if (!body.config?.apiKeys?.tmdb) return send(400, {}); const uuid = uuidOf(++fake.made); fake.homes.set(uuid, {password: body.password, config: {...body.config, configVersion: 1}}); return send(200, {success: true, userUUID: uuid});}
  if (request.url.startsWith('/api/config/')) {
    const home = fake.homes.get(request.url.split('/').pop()); if (!home || home.password !== body.password) return send(401, {});
    if (request.url.includes('/load/')) return send(200, {success: true, config: {...home.config, keptByTheServer: true}});
    if (request.url.includes('/update/')) {if (body.baseVersion !== home.config.configVersion) return send(409, {}); home.config = {...body.config, configVersion: home.config.configVersion + 1}; return send(200, {success: true});}
    if (request.url.includes('/delete-user/')) {fake.homes.delete(request.url.split('/').pop()); return send(200, {success: true});}
  }
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
    if (rest.startsWith(`/Users/${uuid}/Items?Ids=`)) return send(200, {Items: decodeURIComponent(rest.split('Ids=')[1].split('&')[0]).split(',').map(id => HELD[id]).filter(Boolean)});
    if (rest.startsWith(`/Users/${uuid}/Items/`)) {const id = rest.split('/').pop().split('?')[0], {UserData, ...held} = HELD[id] ?? {}; return send(200, {Id: ITEM, Name: 'Meta Movie', ...held, RunTimeTicks: 6000e7, ServerId: uuid, UserData: {Key: uuid}, Poster: `${UP}/jellyfin/${uuid}/Items/${ITEM}/Images/Primary`});}
    return send(200, {Seen: rest});
  }
  send(404, {});
}).listen(8798, '127.0.0.1').unref();

const owner = client(), at = () => `/h/${hub.code}`;
let adaSite;
let hub;
const app = (token, device = 'phone-1') => ({authorization: `MediaBrowser Client="Test", Device="Phone", DeviceId="${device}"${token ? `, Token="${token}"` : ''}`});
const raw = async (path, token, init = {}) => {const answer = await fetch(BASE + at() + path, {...init, headers: {'content-type': 'application/json', ...app(token)}, redirect: 'manual'}); return {status: answer.status, text: await answer.text(), location: answer.headers.get('location')};};
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
  assert.deepEqual(done.body, {watched: 1, partway: 1, missed: 0, more: false});
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
const say = (path, body) => raw(path, token, {method: 'POST', body: JSON.stringify(body)});
// Reports are passed on in the background, after the app has its answer: wait for Trakt to have heard, then a moment more.
const heard = async count => {for (let i = 0; i < 50 && trakt.calls.length < count; i++) await pause(100); await pause(300); return trakt.calls.map(({path, body}) => ({path, body}));};
// What the page does once Trakt's sign-in has come back to it: the login it got from Trakt is handed to the hub.
const connect = async () => {
  const got = issue(), linked = await owner('POST', '/api/people/ada/scrobble/link', {access: got.access_token, refresh: got.refresh_token, lasts: got.expires_in, created: got.created_at, username: 'adatrakt', redirect: `${BASE}/api/trakt/callback`});
  assert.equal(linked.status, 200, JSON.stringify(linked.body)); assert.deepEqual(linked.body, {state: 'connected'});
};
const sql = command => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', command], {cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: ['ignore', 'pipe', 'ignore']}))[0].results;
const waiting = () => sql('SELECT kind, path FROM trakt_outbox ORDER BY id');
// At 03:00 UTC unless told otherwise: before the day's Trakt and MDBList look, which the drift tests run on purpose.
const cron = (time = Date.UTC(2026, 0, 1, 3)) => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}&time=${time}`).then(answer => answer.text());
const rowsOf = config => config.catalogs.filter(item => /^(trakt|custom)\./.test(item.id)).map(item => [item.id, item.type, item.name, item.enabled]);
test('Trakt connected on AIOMetadata, as before: its own Trakt rows and Token ID in her setup', async () => {
  assert.deepEqual((await owner('POST', '/api/people/ada/trakt', {tokenId: 'aiom-trakt-token-id-1'})).body, {username: 'adatrakt'});
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const [, ada] = playerOf('Ada');
  assert.equal(ada.config.apiKeys.traktTokenId, 'aiom-trakt-token-id-1');
  assert.deepEqual(rowsOf(ada.config).map(([id]) => id), ['trakt.watchlist', 'trakt.recommendations.movies', 'trakt.recommendations.shows', 'trakt.upnext', 'trakt.unwatched']);
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
  // The same rows, in the same order and under the same names, now imported from the hub's own addon; Up Next and Recently aired stay off.
  assert.deepEqual(rowsOf(ada.config), [['custom.aiohub_rows.all.watchlist', 'all', 'Watchlist', true], ['custom.aiohub_rows.movie.recommended', 'movie', 'Recommended Movies', true],
    ['custom.aiohub_rows.series.recommended', 'series', 'Recommended Shows', true], ['custom.aiohub_rows.series.up_next', 'series', 'Up Next', false], ['custom.aiohub_rows.series.recently_aired', 'series', 'Recently Aired for You', false],
    ['custom.aiohub_rows.all.history', 'all', 'Recently Watched', true]]);
  served = ada.config.catalogs.filter(item => item.id.startsWith('custom.'));
  for (const item of served) {
    assert.equal(item.source, 'custom'); assert.ok(item.cacheTTL > 0 && item.cacheTTL <= 900); assert.equal(item.showInHome, true);
    assert.match(item.sourceUrl, new RegExp(`^${BASE}/api/rows/r[\\w-]{20,}/catalog/${item.type}/[a-z_]+\\.json$`));
  }
  // Ahead of the shared rows, as before, and nothing of AIOMetadata's own Trakt left: no Token ID, no hiding by it.
  assert.equal(ada.config.catalogs.findIndex(item => item.id.startsWith('custom.')), 0);
  assert.equal(ada.config.apiKeys.traktTokenId, undefined); assert.equal(ada.config.hideWatchedTrakt, false);
  // Ben has no Trakt: nothing changes for him.
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
  // The manager places the Trakt rows in the hub's Home and sets how each starts: Watchlist after Trending Movies, Recently Aired
  // on. Ada follows that, with her own choice on top; Ben, without Trakt, gets nothing of it.
  const hubNow = (await owner('GET', '/api/state')).body.hub, traktRow = id => ({id, title: id, kind: 'Series', source: 'Trakt', origin: 'hub', on: true, core: true});
  const placedRows = [hubNow.rows[0], traktRow('watchlist'), traktRow('recently-aired'), ...hubNow.rows.slice(1)];
  assert.equal((await owner('PUT', '/api/hub', {host: hubNow.host, hostUrl: hubNow.hostUrl, serverName: hubNow.serverName, addons: hubNow.addons, defaults: hubNow.defaults, rows: placedRows, order: hubNow.groups.map(group => group.id), v: hubNow.v})).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  const catalogs = playerOf('Ada')[1].config.catalogs.map(item => item.id), at = id => catalogs.indexOf(id);
  assert.ok(at('tmdb.trending') < at('custom.aiohub_rows.all.watchlist') && at('custom.aiohub_rows.all.watchlist') < at('custom.aiohub_rows.series.recently_aired'), catalogs.join(' '));
  assert.equal(playerOf('Ada')[1].config.catalogs.find(item => item.id === 'custom.aiohub_rows.series.recently_aired').enabled, true);
  assert.equal(at('custom.aiohub_rows.movie.recommended'), at('custom.aiohub_rows.all.watchlist') + 1, 'a Trakt row the hub did not place follows the one before it');
  assert.deepEqual(rowsOf(playerOf('Ben')[1].config), []);
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
test('a film played, paused, carried on, skipped ahead and finished reaches Trakt as start, pause, start, start, stop', async () => {
  const film = {movie: {ids: {tmdb: 27205, imdb: 'tt1375666'}}};
  await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0}); await heard(1);
  // Plain progress is not passed on; a pause is, at once, and only once however often the app says it is still paused.
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 30e7, IsPaused: false});
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true}); await heard(2);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: true});
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 600e7, IsPaused: false}); await heard(3);
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 620e7, IsPaused: false});
  // Skipped ahead half an hour: Trakt is told the new place.
  await say('/Sessions/Playing/Progress', {ItemId: FILM, PositionTicks: 2400e7, IsPaused: false}); await heard(4);
  await say('/Sessions/Playing/Stopped', {ItemId: FILM, PositionTicks: 5400e7});
  assert.deepEqual(await heard(5), [
    {path: '/scrobble/start', body: {...film, progress: 0}}, {path: '/scrobble/pause', body: {...film, progress: 10}},
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
  await say('/Sessions/Playing', {ItemId: EP3, PositionTicks: 0}); await heard(1);
  await say('/Sessions/Playing/Stopped', {ItemId: EP3, PositionTicks: 5700e7});
  assert.deepEqual(await heard(2), [{path: '/scrobble/start', body: {...episode, progress: 0}}, {path: '/scrobble/stop', body: {...episode, progress: 95}}]);
  trakt.stop = 201;
});
test('ticking a title as watched adds it to Trakt history', async () => {
  trakt.calls = [];
  assert.equal((await say(`/Users/${jf}/PlayedItems/${ITEM}`, {})).status, 200);
  const [call] = await heard(1);
  assert.equal(call.path, '/sync/history'); assert.deepEqual(call.body.movies.map(({ids}) => ids), [{tmdb: 603, imdb: 'tt0133093'}]);
  assert.ok(Math.abs(Date.parse(call.body.movies[0].watched_at) - Date.now()) < 60_000); assert.equal(trakt.calls.length, 1);
});
test('a play left running by an app that went quiet is stopped on Trakt by the five-minute cron', async () => {
  // One film left at 85%, one at the very start; then half an hour without a report, as if the app was closed.
  trakt.calls = [];
  await say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 5100e7}); await say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0}); await heard(2);
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
test('a connection near its end is renewed once, and the new pair is kept', async () => {
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.deepEqual(trakt.revoked, [{token: 'trakt-access-1', client_id: 'local-trakt-client'}]);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').history, null);
  // Connected again with an hour left: the next calls renew it first, once, however many arrive together.
  trakt.expiresIn = 3600; await connect(); trakt.calls = [];
  await Promise.all([say('/Sessions/Playing', {ItemId: FILM, PositionTicks: 0}), say('/Sessions/Playing', {ItemId: LEFT, PositionTicks: 0})]);
  await heard(2);
  assert.deepEqual(trakt.refreshed, [{refresh_token: 'trakt-refresh-2', client_id: 'local-trakt-client', redirect_uri: `${BASE}/api/trakt/callback`, grant_type: 'refresh_token'}]);
  assert.deepEqual(trakt.calls.map(call => call.path).sort(), ['/scrobble/start', '/scrobble/start']);
  // The renewed pair is what is used from then on, and it is not renewed again.
  trakt.calls = []; await say(`/Users/${jf}/PlayedItems/${LEFT}`, {}); await heard(1);
  assert.equal(trakt.calls[0].auth, 'trakt-access-3'); assert.equal(trakt.refreshed.length, 1);
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').history, {username: 'adatrakt', again: false});
});
test('once a day her Trakt and MDBList are compared over two weeks, a few steps a run, and only she sees what differs', async () => {
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
  // The day's look: six titles to ask MDBList about, so it takes two runs.
  const day = Date.UTC(2026, 5, 1, 4, 5);
  await cron(day); assert.equal(sql('SELECT work IS NOT NULL AS busy FROM drift')[0].busy, 1);
  await cron(day + 300e3); assert.deepEqual(sql('SELECT day, work FROM drift'), [{day: '2026-06-01', work: null}]);
  await cron(day + 600e3);
  assert.equal(trakt.reads.filter(read => read.where === '/sync/history').length, 1, 'Trakt is read once, and not again that day');
  assert.match(trakt.reads.find(read => read.where === '/sync/history').query, /start_at=.*end_at=.*page=1&limit=100/);
  // Looking wrote nothing anywhere.
  assert.deepEqual(trakt.calls, []); assert.equal(fake.watched.length, posted);
  const mine = (await adaSite('GET', '/api/state')).body.hub.people[0].drift, line = miss => [miss.name, miss.season ?? null, miss.episode ?? null, new Date(miss.at * 1000).toISOString()];
  assert.deepEqual(mine.toMdblist.map(line), [['Inception', null, null, T.inception], ['Breaking Bad', 1, 2, T.e2]]);
  assert.deepEqual(mine.toTrakt.map(line), [['Breaking Bad', 1, 3, T.e3], ['Pulp Fiction', null, null, T.pulp]]);
  assert.equal(mine.trakt, 6); assert.equal(mine.mdblist, 6);
  // It is hers: the manager sees nothing and cannot copy it.
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').drift, null);
  assert.equal((await owner('POST', '/api/people/ada/drift', {})).status, 403);
  // A play she says is not right is left out, now and in later looks, and Fix leaves it alone.
  const pulp = mine.toTrakt.find(miss => miss.name === 'Pulp Fiction');
  assert.equal((await owner('POST', '/api/people/ada/drift', {skip: pulp.key})).status, 403);
  assert.equal((await adaSite('POST', '/api/people/ada/drift', {skip: pulp.key})).status, 200);
  assert.deepEqual((await adaSite('GET', '/api/state')).body.hub.people[0].drift.toTrakt.map(line), [['Breaking Bad', 1, 3, T.e3]]);
  // Fix, pressed twice at once: exactly the missing plays, each with its own date, sent once.
  const [one, two] = await Promise.all([adaSite('POST', '/api/people/ada/drift', {}), adaSite('POST', '/api/people/ada/drift', {})]);
  assert.deepEqual([one.body, two.body].sort((a, b) => b.trakt - a.trakt), [{trakt: 1, mdblist: 2}, {trakt: 0, mdblist: 0}]);
  assert.deepEqual(trakt.calls.map(({path, body}) => ({path, body})), [{path: '/sync/history', body: {shows: [{ids: {tmdb: 1396, imdb: 'tt0903747'}, seasons: [{number: 1, episodes: [{number: 3, watched_at: T.e3}]}]}]}}]);
  assert.deepEqual(fake.watched.slice(posted), [{movies: [{ids: {tmdb: 27205, imdb: 'tt1375666'}, watched_at: T.inception}], shows: [{ids: {tmdb: 1396, imdb: 'tt0903747'}, seasons: [{number: 1, episodes: [{number: 2, watched_at: T.e2}]}]}]}]);
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].drift, null);
  // The next day both have everything but the play she skipped, which stays out: nothing is shown.
  trakt.history.unshift({watched_at: T.e3, type: 'episode', episode: {season: 1, number: 3}, show: BB});
  lists.plays['movie/27205'] = [{watched_at: T.inception}]; lists.plays['show/1396'].push({season_num: 1, episode_num: 2, watched_at: T.e2}); trakt.calls = [];
  await cron(day + DAY * 1e3); await cron(day + DAY * 1e3 + 300e3);
  assert.deepEqual(sql('SELECT day, work IS NULL AS done FROM drift'), [{day: '2026-06-02', done: 1}]);
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].drift, null); assert.deepEqual(trakt.calls, []);
  // A day MDBList does not answer: no differences are made up from it, and the look is tried again on the next run.
  lists.refuse = true; await cron(day + 2 * DAY * 1e3);
  assert.deepEqual(sql('SELECT day, json_extract(work, \'$.tries\') AS tries FROM drift'), [{day: '2026-06-03', tries: 1}]);
  assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].drift, null);
  lists.refuse = false; await cron(day + 2 * DAY * 1e3 + 300e3); await cron(day + 2 * DAY * 1e3 + 600e3);
  assert.equal(sql('SELECT work FROM drift')[0].work, null); assert.equal((await adaSite('GET', '/api/state')).body.hub.people[0].drift, null);
});
test('the rows address answers with IMDb ids from her Trakt, page by page, renewing the connection when Trakt refuses it', async () => {
  const get = async url => {const answer = await fetch(url); return {status: answer.status, body: await answer.json().catch(() => null)};};
  const address = served[0].sourceUrl.split('/catalog/')[0];
  const manifest = (await get(`${address}/manifest.json`)).body;
  assert.deepEqual(manifest.resources, ['catalog']);
  assert.deepEqual(manifest.catalogs.map(item => `${item.type}/${item.id}`), ['all/watchlist', 'all/history', 'movie/recommended', 'series/recommended', 'series/up_next', 'series/recently_aired']);
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
  const aired = (await get(served.find(item => item.id === 'custom.aiohub_rows.series.recently_aired').sourceUrl)).body.metas;
  assert.deepEqual(aired.map(item => item.id), ['tt0903747']); assert.match(trakt.reads.at(-1).query, /sort_by=recently-aired/);
  // Asked again within minutes, Trakt is not asked again.
  const reads = trakt.reads.length; await get(served[0].sourceUrl); assert.equal(trakt.reads.length, reads);
  // Later, while Trakt turns the hub away: the last list it gave, and Trakt is not asked again on every page.
  sql('UPDATE rows_cache SET at = at - 3600'); trakt.refuseReads = true;
  assert.deepEqual((await get(served[0].sourceUrl)).body.metas.map(item => item.id), ['tt0133093', 'tt0944947', 'tmdb:550']); assert.equal(trakt.reads.length, reads + 1);
  assert.equal((await get(served[0].sourceUrl)).body.metas.length, 3); assert.equal(trakt.reads.length, reads + 1);
  trakt.refuseReads = false;
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
  // Without the token, or with a made-up one, there is nothing here.
  assert.equal((await get(`${BASE}/api/rows/rnotarealtokenatallnotreal/manifest.json`)).status, 404);
  assert.equal((await get(`${address}/catalog/movie/nothing.json`)).status, 404);
  // Disconnected from the hub with no other Trakt: the rows leave her Home on the next sync, and the address answers with nothing.
  assert.equal((await owner('DELETE', '/api/people/ada/scrobble')).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.deepEqual(rowsOf(playerOf('Ada')[1].config), []);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').trakt, false);
  assert.deepEqual((await get(served[0].sourceUrl)).body, {metas: []});
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
  assert.equal((await owner('DELETE', '/api/people/ben')).status, 200);
  assert.deepEqual(await syncAll(), {state: 'ok'});
  assert.equal(playerOf('Ben'), undefined); assert.equal(fake.homes.size, 2);
  assert.ok(!players().variants.some(item => item.id === 'hub-c-ben'));
});
test('deleting the hub removes every setup', async () => {
  const me = (await owner('GET', '/api/state')).body;
  const done = await owner('POST', '/api/hub/delete', {password: 'correct horse'});
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(fake.homes.size, 0); assert.equal(fake.configs.size, 0); assert.ok(me);
});
