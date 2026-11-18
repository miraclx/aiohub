// Runs against `wrangler dev` with a throwaway local database. No real accounts or upstream calls.
import assert from 'node:assert/strict';
import {test} from 'node:test';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8799';
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const answer = await fetch(BASE + path, {method, headers: {origin: BASE, 'content-type': 'application/json', ...(cookie ? {cookie} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    const set = answer.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return {status: answer.status, body: await answer.json().catch(() => null)};
  };
}
import http from 'node:http';
// A stand-in for AIOStreams: holds setups, counts sign-ins, accepts only the token it last gave out, and can be told to refuse everything.
const fake = {signIns: 0, creates: 0, valid: '', refuseAll: false, configs: new Map(), homes: new Map()};
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk; const body = raw ? JSON.parse(raw) : {};
  const [id, pass] = request.headers.authorization?.startsWith('Basic ') ? atob(request.headers.authorization.slice(6)).split(':') : [];
  const mine = () => fake.configs.get(id)?.password === pass ? fake.configs.get(id) : null;
  if (request.url.startsWith('/tmdb')) return send(request.url.includes('api_key=good-tmdb-key') ? 200 : 401, {});
  if (request.url.startsWith('/mdblist/lists/')) return request.url.includes('/someone/heist-nights?apikey=good-mdblist-key') ? send(200, [{id: 4242, name: 'Heist Nights', mediatype: 'movie'}]) : send(404, {});
  if (request.url.startsWith('/mdblist/user')) return request.url.includes('apikey=bens-own-mdblist-key') ? send(200, {username: 'benlists'}) : send(request.url.includes('apikey=good-mdblist-key') ? 200 : 403, {});
  // The stand-in for AIOMetadata: a Home setup per hub, refused without a TMDB key, changed only against the version that was read.
  if (request.url === '/api/config/save') {if (!body.config?.apiKeys?.tmdb) return send(400, {missingKeys: ['tmdb']}); const uuid = `home-${fake.homes.size + 1}`; fake.homes.set(uuid, {password: body.password, config: {...body.config, configVersion: 1}}); return send(200, {success: true, userUUID: uuid, configVersion: 1});}
  if (request.url === '/api/oauth/token/info') return body.tokenId === 'trakt-token-id-0001' ? send(200, {provider: 'trakt', username: 'benwatches'}) : send(404, {error: 'Token not found'});
  if (request.url.startsWith('/api/config/')) {
    const home = fake.homes.get(request.url.split('/').pop()); if (!home || home.password !== body.password) return send(401, {});
    if (request.url.includes('/load/')) return send(200, {success: true, config: {...home.config, keptByTheServer: true}});
    if (request.url.includes('/update/')) {if (body.baseVersion !== home.config.configVersion) return send(409, {error: 'CONFIG_CHANGED'}); home.config = {...body.config, configVersion: home.config.configVersion + 1}; return send(200, {success: true, configVersion: home.config.configVersion});}
    if (request.url.includes('/delete-user/')) {fake.homes.delete(request.url.split('/').pop()); return send(200, {success: true});}
  }
  if (request.url.startsWith('/stremio/')) return send(200, {metas: [{name: 'One', poster: 'https://img.example/1.jpg'}, {name: 'Two', poster: 'https://img.example/2.jpg'}, {name: 'No art'}]});
  if (request.url.startsWith('/api/v1/user')) {
    if (request.method === 'POST') {if (!body.config?.sortCriteria?.global) return send(400, {}); fake.creates++; const uuid = `cfg-${fake.creates}`; fake.configs.set(uuid, {password: body.password, config: body.config}); return send(201, {success: true, data: {uuid}});}
    if (!mine()) return send(401, {});
    if (request.method === 'GET') return send(200, {success: true, data: {userData: {...mine().config, keptByTheServer: true}}});
    if (request.method === 'PUT') {mine().config = body.config; return send(200, {success: true});}
    if (request.method === 'DELETE') {fake.configs.delete(id); return send(200, {success: true});}
  }
  if (request.url === '/jellyfin/Users/AuthenticateByName') {
    const [uuid, name] = String(body.Username).split('/'), config = fake.configs.get(uuid);
    if (!config || config.password !== body.Pw || !config.config.jellyfin.personas.some(user => user.name === name)) return send(401, {});
    fake.signIns++; fake.valid = `up-token-${fake.signIns}`; return send(200, {AccessToken: fake.valid, User: {Id: 'upstream-user-id', Name: name}, SessionInfo: {}});
  }
  const token = /Token="([^"]+)"/.exec(request.headers.authorization ?? '')?.[1];
  if (fake.refuseAll || token !== fake.valid) return send(401, {});
  if (request.url.includes('/Items/ep-7')) return send(200, {Name: 'The One With The Test', Type: 'Episode', SeriesName: 'Harbor Lights', SeriesId: 'show-3', ParentIndexNumber: 2, IndexNumber: 4, RunTimeTicks: 3000 * 1e7});
  if (request.url.startsWith('/jellyfin/Sessions/Playing')) return send(204, {});
  send(200, {Id: 'upstream-user-id', Name: 'x', Via: 'http://127.0.0.1:8798/jellyfin/thing'});
}).listen(8798, '127.0.0.1').unref();
const owner = client(), stranger = client(), guest = client();
let hub, link, password, offer;

test('nothing is readable signed out', async () => {
  assert.equal((await stranger('GET', '/api/state')).status, 401);
  offer = (await stranger('GET', '/api/open')).body;
  assert.equal(offer.signup, true); assert.equal(offer.code, true); assert.match(offer.hub, /^[a-z0-9]{6}$/); assert.ok(offer.proof);
});
test('sign-up needs the setup code, then the site is full', async () => {
  assert.equal((await owner('POST', '/api/signup', {password: 'correct horse', code: 'nope'})).status, 403);
  assert.equal((await owner('POST', '/api/signup', {password: 'short', code: 'local-claim'})).status, 400);
  // Nobody picks their own hub code: one the site did not issue is refused, however it is dressed up.
  assert.equal((await owner('POST', '/api/signup', {password: 'correct horse', code: 'local-claim', hub: 'vanity', proof: offer.proof})).status, 400);
  assert.equal((await owner('POST', '/api/signup', {password: 'correct horse', code: 'local-claim', hub: 'vanity'})).status, 400);
  assert.equal((await owner('POST', '/api/signup', {password: 'correct horse', code: 'local-claim', hub: offer.hub, proof: offer.proof})).status, 200);
  assert.equal((await stranger('POST', '/api/signup', {password: 'correct horse', code: 'local-claim'})).status, 403);
  assert.deepEqual((await stranger('GET', '/api/open')).body, {signup: false, code: true});
});
test('a write from another site is refused', async () => {
  assert.equal((await owner('PUT', '/api/account', {name: 'X', theme: 'dark'}, {origin: 'https://elsewhere.example'})).status, 403);
});
test('the manager builds a hub', async () => {
  hub = (await owner('GET', '/api/state')).body.hub;
  assert.equal(hub.groups.length, 0); assert.equal(hub.me.name, ''); assert.equal(hub.code, offer.hub);
  assert.equal((await owner('PUT', '/api/groups/family', {name: 'Family', rows: null, settings: {}})).status, 200);
  assert.equal((await owner('PUT', '/api/groups/family', {name: 'Family', rows: null, settings: {}})).status, 409);
  assert.equal((await owner('PUT', '/api/groups/friends', {name: 'Friends', rows: null, settings: {quality: 'saver'}})).status, 200);
  assert.equal((await owner('PUT', '/api/groups/friends', {name: 'Friends', rows: null, settings: {quality: 'ultra'}, v: 1})).status, 400);
  const person = {name: 'Ada', groupId: 'family', rows: null, settings: {}, can: {arrange: true, add: false, playback: false}, trakt: false, lists: false};
  assert.equal((await owner('PUT', '/api/people/ada', person)).status, 200);
  assert.equal((await owner('PUT', '/api/people/ada', {...person, name: 'Ada L', v: 1})).status, 200);
  assert.equal((await owner('PUT', '/api/people/ada', {...person, name: 'Stale', v: 1})).status, 409);
  assert.equal((await owner('PUT', '/api/people/ben', {...person, name: 'Ben', groupId: 'gone'})).status, 400);
  assert.equal((await owner('PUT', '/api/people/ben', {...person, name: 'Ben'})).status, 200);
  // The name is the sign-in, so two people in a hub cannot share one, however it is typed.
  assert.equal((await owner('PUT', '/api/people/ada-2', {...person, name: 'ada  l'})).status, 409);
  assert.equal((await owner('PUT', '/api/people/ben', {...person, name: 'Ada-L', v: 1})).status, 409);
  assert.equal((await owner('DELETE', '/api/groups/family')).status, 400);
  const saved = await owner('PUT', '/api/hub', {...hub, defaults: {...hub.defaults, quality: 'best'}});
  assert.equal(saved.status, 200); assert.equal(saved.body.v, 2);
  assert.equal((await owner('PUT', '/api/hub', {...hub, v: 1})).status, 409);
  // Groups are listed in the manager's order, and a whole group can be paused.
  assert.equal((await owner('PUT', '/api/hub', {...hub, defaults: {...hub.defaults, quality: 'best'}, order: ['friends', 'family'], v: 2})).status, 200);
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.groups.map(group => group.id), ['friends', 'family']);
  assert.equal((await owner('PUT', '/api/groups/friends', {name: 'Friends', rows: null, settings: {quality: 'saver'}, paused: true, v: 1})).status, 200);
  assert.equal((await owner('GET', '/api/state')).body.hub.groups.find(group => group.id === 'friends').paused, true);
  assert.equal((await owner('PUT', '/api/groups/friends', {name: 'Friends', rows: null, settings: {quality: 'saver'}, v: 2})).status, 200);
  assert.equal((await owner('PUT', '/api/hub', {...hub, defaults: {...hub.defaults, quality: 'best'}, order: ['family', 'friends'], v: 3})).status, 200);
});
test('sign-in details load one person at a time and never ride in the page', async () => {
  const state = (await owner('GET', '/api/state')).body;
  assert.equal(state.hub.defaults.quality, 'best');
  assert.ok(!JSON.stringify(state).includes('password":"' + 'x') && state.hub.people.every(person => person.password === '' && person.pin === null));
  const details = (await owner('GET', '/api/people/ada/signin')).body;
  assert.match(details.password, /^[a-z]+-[a-z]+-[a-z]+-\d\d$/); assert.match(details.pin, /^\d{6}$/); assert.match(details.link, /#\/join\/i[\w-]{20,}$/);
  link = details.link.split('/join/')[1]; password = details.password;
  assert.ok(!JSON.stringify(state).includes(link) && !JSON.stringify(state).includes(password));
});
test('a debrid key goes in and never comes back', async () => {
  assert.equal((await owner('PUT', '/api/services/TorBox', {key: 'tb-secret-key-123'})).status, 200);
  const state = (await owner('GET', '/api/state')).body;
  assert.deepEqual(state.hub.services, ['TorBox']); assert.ok(!JSON.stringify(state).includes('tb-secret'));
});
test('the TMDB key is checked, stored, and never comes back', async () => {
  assert.equal((await owner('GET', '/api/state')).body.hub.tmdb, false);
  assert.equal((await owner('PUT', '/api/keys/tmdb', {key: 'a-wrong-key'})).status, 400);
  assert.equal((await owner('PUT', '/api/keys/tmdb', {key: 'good-tmdb-key'})).status, 200);
  const state = (await owner('GET', '/api/state')).body; assert.equal(state.hub.tmdb, true); assert.ok(!JSON.stringify(state).includes('good-tmdb-key'));
});
test('an invited person joins and sees only themselves', async () => {
  assert.deepEqual((await guest('POST', '/api/join', {token: 'i-not-a-real-one'})).body, {gone: true});
  assert.deepEqual((await guest('POST', '/api/join', {token: link})).body, {ask: {name: 'Ada L', username: 'Ada L', owner: '', joined: false}});
  assert.equal((await guest('POST', '/api/join', {token: link, password: 'short'})).status, 400);
  const before = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.equal((await guest('POST', '/api/join', {token: link, password: 'my own password'})).status, 200);
  // Joining must not make the manager's open page stale: their next save for this person still goes through.
  const edit = {name: before.name, groupId: before.groupId, rows: before.rows, settings: before.settings, can: before.can, trakt: false, lists: false, v: before.v};
  assert.equal((await owner('PUT', '/api/people/ada', edit)).status, 200);
  const state = (await guest('GET', '/api/state')).body;
  assert.equal(state.role, 'person'); assert.deepEqual(state.hub.people.map(person => person.id), ['ada']);
  assert.deepEqual(state.hub.groups.map(group => group.id), ['family']); assert.equal(state.hub.host, ''); assert.equal(state.hub.me.name, '');
  assert.equal((await client()('POST', '/api/join', {token: link, password: 'wrong password'})).status, 403);
  assert.equal((await client()('POST', '/api/join', {token: link, password: 'my own password'})).status, 200);
});
test('an invited person is held to what the manager allowed', async () => {
  const me = (await guest('GET', '/api/state')).body.hub.people[0], rows = (await guest('GET', '/api/state')).body.hub.rows;
  const mine = {name: me.name, groupId: me.groupId, rows: me.rows, settings: me.settings, can: me.can, trakt: me.trakt, lists: me.lists, v: me.v};
  assert.equal((await guest('PUT', '/api/people/ben', mine)).status, 403);
  assert.equal((await guest('GET', '/api/people/ben/signin')).status, 403);
  assert.equal((await guest('PUT', '/api/people/ada', {...mine, settings: {quality: 'best'}})).status, 403);
  assert.equal((await guest('PUT', '/api/people/ada', {...mine, rows: [...rows, {id: 'mine', title: 'Mine', kind: 'Movies', source: 'TMDB', origin: 'own', on: true}]})).status, 403);
  const reordered = await guest('PUT', '/api/people/ada', {...mine, rows: [...rows].reverse(), can: {arrange: true, add: true, playback: true}, paused: false});
  assert.equal(reordered.status, 200);
  const after = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada');
  assert.deepEqual(after.can, {arrange: true, add: false, playback: false}); assert.equal(after.rows[0].id, rows.at(-1).id);
  for (const [method, path] of [['PUT', '/api/hub'], ['PUT', '/api/groups/family'], ['DELETE', '/api/people/ben'], ['PUT', '/api/services/TorBox'], ['PUT', '/api/keys/tmdb'], ['PUT', '/api/account']]) assert.equal((await guest(method, path, method === 'DELETE' ? undefined : {})).status, 403, path);
});
let player;
test('two passwords: their own for the site, a replaceable one for player apps', async () => {
  // The player password is still the one the hub made; choosing a site password did not touch it, and the manager cannot read the site one.
  const details = (await owner('GET', '/api/people/ada/signin')).body;
  assert.equal(details.password, password); assert.ok(!JSON.stringify(details).includes('my own password'));
  player = (await owner('POST', '/api/people/ada/rotate', {})).body.password;
  assert.notEqual(player, password); assert.equal((await guest('GET', '/api/state')).status, 200, 'replacing the player password must not sign them out of the site');
  assert.equal((await owner('POST', '/api/people/ada/password', {old: 'my own password', password: 'managers cannot'})).status, 404);
  assert.equal((await guest('POST', '/api/people/ada/password', {old: 'nope', password: 'another password'})).status, 403);
  assert.equal((await guest('POST', '/api/people/ada/password', {old: player, password: 'another password'})).status, 403);
  assert.equal((await guest('POST', '/api/people/ada/password', {old: 'my own password', password: 'another password'})).status, 200);
  assert.equal((await guest('GET', '/api/state')).status, 200); assert.equal((await owner('GET', '/api/people/ada/signin')).body.password, player);
  assert.equal((await client()('POST', '/api/join', {token: link, password: player})).status, 403);
  // Forgotten: the manager cannot see it, only let them choose again through their link.
  assert.equal((await guest('POST', '/api/people/ada/reset', {})).status, 404);
  assert.equal((await owner('POST', '/api/people/ada/reset', {})).status, 200); assert.equal((await guest('GET', '/api/state')).status, 401);
  assert.equal((await guest('POST', '/api/join', {token: link})).body.ask.joined, false);
  assert.equal((await guest('POST', '/api/join', {token: link, password: 'chosen again'})).status, 200);
});
test('the player address refuses strangers', async () => {
  const at = `/h/${hub.code}`;
  assert.equal((await stranger('GET', '/h/zzzzzz/System/Info/Public')).status, 404);
  assert.equal((await stranger('GET', `${at}/Users/Me`, undefined, {'x-emby-token': 'hubforged'})).status, 401);
  assert.equal((await stranger('POST', `${at}/Sessions/Playing`, {})).status, 401);
  assert.equal((await stranger('POST', `${at}/Users/AuthenticateByName`, {Username: 'ada', Pw: 'wrong'})).status, 401);
  // Right password, but no AIOStreams user behind this person yet.
  const ready = await stranger('POST', `${at}/Users/AuthenticateByName`, {Username: 'Ada L', Pw: player});
  assert.equal(ready.status, 401); assert.match(ready.body.Message, /not ready/);
  assert.deepEqual((await stranger('GET', `${at}/QuickConnect/Enabled`)).body, true);
});
test('a person called Hub does not share a drawer with the hub’s keys', async () => {
  const person = {name: 'Hub', groupId: 'family', rows: null, settings: {}, can: {arrange: true, add: true, playback: false}, trakt: false, lists: false};
  assert.equal((await owner('PUT', '/api/people/hub', person)).status, 200); assert.equal((await owner('DELETE', '/api/people/hub')).status, 200);
  assert.equal((await owner('PUT', '/api/services/TorBox', {key: 'tb-secret-key-456'})).status, 200); assert.equal((await owner('DELETE', '/api/people/hub')).status, 200);
  assert.deepEqual((await owner('GET', '/api/state')).body.hub.services, ['TorBox']);
});
test('the player address: one kept AIOStreams sign-in, renewed once when refused, never in a loop', async () => {
  const at = `/h/${hub.code}`, app = (token, device = 'd1') => ({authorization: `MediaBrowser Client="Test", Device="TV", DeviceId="${device}"${token ? `, Token="${token}"` : ''}`});
  // Bringing the players in step creates the hub's own setup once, with the people, debrid key, sources and label in it.
  assert.equal((await stranger('POST', '/api/sync', {})).status, 401);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(fake.creates, 1);
  assert.deepEqual((await guest('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(fake.creates, 1, 'a second sync must not create a second setup');
  const setup = [...fake.configs.values()][0].config;
  assert.deepEqual(setup.jellyfin.personas.map(user => [user.id, user.name]), [['ada', 'Ada L'], ['ben', 'Ben']]);
  assert.deepEqual(setup.services, [{id: 'torbox', enabled: true, credentials: {apiKey: 'tb-secret-key-456'}}]);
  assert.deepEqual(setup.presets.filter(item => item.enabled).map(item => item.type), ['stremthruStore', 'torrentio', 'comet', 'meteor', 'custom', 'opensubtitles-v3-plus']);
  assert.deepEqual(setup.presets.find(item => item.type === 'opensubtitles-v3-plus').options.language, ['en']);
  // Home rows: the hub made its own AIOMetadata setup with the TMDB key and the plain rows in the saved order, and pointed AIOStreams at it.
  const home = [...fake.homes.values()][0].config; assert.equal(home.apiKeys.tmdb, 'good-tmdb-key'); assert.equal(home.language, 'en-US'); assert.equal(home.search.providers.series, 'tmdb.search'); assert.equal(home.blurThumbs, false); assert.equal(home.hideUnreleasedDigital, true); assert.equal(home.posterRatingProvider, 'custom'); assert.equal(home.customPosterUrlPattern, 'https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg');
  // Ada put her rows in her own order earlier, so she alone has a second Home setup, and a short list of changes that points her at it.
  assert.equal(fake.homes.size, 2); assert.deepEqual(fake.homes.get('home-2').config.catalogs.slice(0, 2).map(row => row.name), ['Popular Shows', 'Popular Movies']);
  assert.deepEqual(setup.variants.map(item => item.id), ['hub-p-ada']); assert.match(setup.variants[0].script, /^set presets\[instanceId="h01"\]\.options\.manifestUrl = ".*\/stremio\/home-2\/manifest\.json\?v=\d+"$/);
  assert.deepEqual(setup.jellyfin.personas.map(user => user.variants ?? []), [['hub-p-ada'], []]);
  assert.deepEqual(home.catalogs.map(row => [row.id, row.type, row.name, row.enabled]).slice(0, 2), [['tmdb.trending', 'movie', 'Trending Movies', true], ['tmdb.trending', 'series', 'Trending Shows', true]]);
  assert.deepEqual(home.catalogs.filter(row => !row.enabled).map(row => row.name), ['Popular Movies', 'Popular Shows']);
  // The site's row previews are the real contents of each row that is on, and are there for an invited person too.
  const real = (await owner('GET', '/api/previews')).body.rows; assert.deepEqual(real['trending-movies'], ['https://img.example/1.jpg', 'https://img.example/2.jpg']); assert.equal(real['popular-movies'], undefined);
  assert.equal((await stranger('GET', '/api/previews')).status, 401);
  const pointer = setup.presets.find(item => item.type === 'custom').options.manifestUrl; assert.match(pointer, /\/stremio\/home-1\/manifest\.json\?v=\d+$/);
  assert.ok(setup.keptByTheServer === undefined, 'first write is the create itself');
  // Playback defaults travel too: best quality was chosen earlier, with the default 25 GB cap and cached-first order.
  assert.deepEqual(setup.excludedResolutions, []); assert.equal(setup.preferredResolutions[0], '2160p'); assert.deepEqual(setup.size.global.movies, [0, 25e9]);
  assert.deepEqual(setup.sortCriteria.global.slice(0, 2).map(item => item.key), ['library', 'cached']); assert.equal(setup.dynamicAddonFetching.enabled, true); assert.equal(setup.jellyfin.segments, true);
  assert.deepEqual(setup.preferredLanguages, ['English', 'Dual Audio', 'Multi']);
  // A rename reaches the players by read, patch, write: fields the hub does not own survive, and no sign-in detail leaks into page data.
  const ben = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ben');
  assert.equal((await owner('PUT', '/api/people/ben', {name: 'Benjamin', groupId: ben.groupId, rows: ben.rows, settings: ben.settings, can: ben.can, trakt: false, lists: false, v: ben.v})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const after = [...fake.configs.values()][0].config;
  assert.deepEqual(after.jellyfin.personas.map(user => user.name), ['Ada L', 'Benjamin']); assert.equal(after.keptByTheServer, true);
  assert.ok(!JSON.stringify((await owner('GET', '/api/state')).body).includes('cfg-1'));
  // Switching a row off reaches AIOMetadata by read, patch, write, and AIOStreams is told to look again (the address number changes).
  const now = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...now, rows: now.rows.map(row => row.id === 'trending-series' ? {...row, on: false, title: 'Hot Shows'} : row)})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const changed = [...fake.homes.values()][0].config; assert.equal(changed.keptByTheServer, true);
  assert.deepEqual(changed.catalogs.find(row => row.id === 'tmdb.trending' && row.type === 'series').name, 'Hot Shows'); assert.equal(changed.catalogs.find(row => row.name === 'Hot Shows').enabled, false);
  assert.notEqual([...fake.configs.values()][0].config.presets.find(item => item.type === 'custom').options.manifestUrl, pointer);
  // The collection rows need an MDBList key. Without one they stay out; with one they travel as folders over lists, each placed
  // after the plain row above it, and AIOStreams is told to show them as rows and to keep the lists behind them out of sight.
  assert.deepEqual(changed.collections, []); assert.equal((await owner('GET', '/api/state')).body.hub.mdblist, false);
  assert.equal((await owner('PUT', '/api/keys/mdblist', {key: 'a-wrong-key'})).status, 400);
  assert.equal((await owner('PUT', '/api/keys/mdblist', {key: 'good-mdblist-key'})).status, 200);
  const keyed = (await owner('GET', '/api/state')).body; assert.equal(keyed.hub.mdblist, true); assert.ok(!JSON.stringify(keyed).includes('good-mdblist-key'));
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const listed = [...fake.homes.values()][0].config; assert.equal(listed.apiKeys.mdblist, 'good-mdblist-key'); assert.equal(listed.apiKeys.tmdb, 'good-tmdb-key');
  assert.deepEqual(listed.collections.map(item => item.title), ['Movies by Service', 'Shows by Service', 'Movies by Genre', 'Shows by Genre', 'Mixed Genre Collections']);
  assert.deepEqual(listed.collections.map(item => item.folders.length), [8, 9, 50, 18, 5]);
  assert.deepEqual(listed.collections[0].after, {id: 'tmdb.trending', type: 'series'}); assert.deepEqual(listed.collections[2].after, {id: 'tmdb.top_rated', type: 'series'});
  const folder = listed.collections[0].folders[0]; assert.equal(folder.title, 'Apple TV'); assert.match(folder.coverImageUrl, /^https:\/\//);
  assert.equal(listed.catalogs.find(item => item.id === folder.sources[0].catalogId && item.type === folder.sources[0].type).showInHome, false);
  const shown = [...fake.configs.values()][0].config.catalogModifications;
  assert.ok(shown.some(item => item.id === `h01e3b0.aiom.collection.${listed.collections[0].id}` && item.showOnHome)); assert.ok(shown.some(item => item.id === `h01e3b0.${folder.sources[0].catalogId}` && item.enabled === false));
  // Folders can be put in another order and renamed; the ones the site does not mention keep their place after.
  const withLists = (await owner('GET', '/api/state')).body.hub, service = withLists.rows.find(row => row.id === 'movies-by-service');
  assert.equal(service.covers.length, 8);
  assert.equal((await owner('PUT', '/api/hub', {...withLists, rows: withLists.rows.map(row => row.id === 'movies-by-service' ? {...row, covers: [{...row.covers[1], title: 'Red N'}, row.covers[0]]} : row.id === 'mixed-genre' ? {...row, on: false} : row)})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const moved = [...fake.homes.values()][0].config.collections; assert.deepEqual(moved[0].folders.slice(0, 3).map(item => item.title), ['Red N', 'Apple TV', 'Disney+']); assert.equal(moved.length, 4);
  // A pasted MDBList link is looked up with the hub's key and becomes a plain row of its own.
  assert.equal((await owner('POST', '/api/lists', {link: 'https://example.com/nothing'})).status, 400); assert.equal((await owner('POST', '/api/lists', {link: 'https://mdblist.com/lists/someone/not-there'})).status, 404);
  const pick = (await owner('POST', '/api/lists', {link: 'https://mdblist.com/lists/someone/heist-nights'})).body; assert.deepEqual(pick, {id: 'mdblist.4242.movie', title: 'Heist Nights', kind: 'Movies', source: 'MDBList'});
  const listing = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...listing, rows: [{...pick, origin: 'hub', on: true}, ...listing.rows]})).status, 200); assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  assert.deepEqual([...fake.homes.values()][0].config.catalogs[0], {id: 'mdblist.4242', type: 'movie', name: 'Heist Nights', source: 'mdblist', sort: 'default', enabled: true, showInHome: true});
  // Taking the key away takes the collection rows out again.
  assert.equal((await owner('DELETE', '/api/keys/mdblist')).status, 200); assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  assert.deepEqual([...fake.homes.values()][0].config.collections, []); assert.equal([...fake.homes.values()][0].config.apiKeys.mdblist, undefined);
  assert.ok(![...fake.homes.values()][0].config.catalogs.some(item => item.source === 'mdblist'));
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').ready, true);
  const first = await stranger('POST', `${at}/Users/AuthenticateByName`, {Username: 'Ada L', Pw: player}, app());
  assert.equal(first.status, 200); assert.equal(first.body.User.Name, 'Ada L'); assert.match(first.body.AccessToken, /^hub/); assert.notEqual(first.body.User.Id, 'upstream-user-id'); assert.equal(fake.signIns, 1);
  const second = await stranger('POST', `${at}/Users/AuthenticateByName`, {Username: '  ada-l ', Pw: player}, app('', 'd2'));
  assert.equal(second.status, 200); assert.equal(fake.signIns, 1, 'a second app must not sign in to AIOStreams again');
  const me = await stranger('GET', `${at}/Users/Me`, undefined, app(first.body.AccessToken));
  assert.equal(me.status, 200); assert.equal(me.body.Id, first.body.User.Id); assert.equal(me.body.Via, `${BASE}${at}/thing`);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').devices.length, 2);
  const named = (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').devices[0];
  assert.equal((await guest('PUT', `/api/people/ada/devices/${named.id}`, {name: 'Living room'})).status, 200);
  assert.equal((await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ada').devices.find(device => device.id === named.id).name, 'Living room');
  assert.equal((await owner('PUT', `/api/people/ada/devices/${named.id}`, {name: '  '})).status, 400);
  // Quick Connect: a TV asks for a code, the code is approved on the site, and only then is the TV let in, as that person.
  const tv = {authorization: 'MediaBrowser Client="TV App", Device="Living room", DeviceId="tv-1"'};
  assert.deepEqual((await stranger('GET', `${at}/QuickConnect/Enabled`)).body, true);
  const asked = (await stranger('POST', `${at}/QuickConnect/Initiate`, {}, tv)).body; assert.match(asked.Code, /^\d{6}$/); assert.equal(asked.Authenticated, false);
  assert.equal((await stranger('POST', `${at}/Users/AuthenticateWithQuickConnect`, {Secret: asked.Secret}, tv)).status, 401);
  assert.equal((await owner('POST', '/api/people/ada/quick', {code: '000000'})).status, 404);
  assert.equal((await stranger('POST', '/api/people/ada/quick', {code: asked.Code})).status, 401);
  assert.equal((await guest('POST', '/api/people/ben/quick', {code: asked.Code})).status, 403);
  assert.equal((await guest('POST', '/api/people/ada/quick', {code: asked.Code})).status, 200);
  assert.equal((await stranger('GET', `${at}/QuickConnect/Connect?secret=${asked.Secret}`, undefined, tv)).body.Authenticated, true);
  const onTv = await stranger('POST', `${at}/Users/AuthenticateWithQuickConnect`, {Secret: asked.Secret}, tv);
  assert.equal(onTv.status, 200); assert.equal(onTv.body.User.Name, 'Ada L'); assert.equal(fake.signIns, 1);
  assert.equal((await stranger('POST', `${at}/Users/AuthenticateWithQuickConnect`, {Secret: asked.Secret}, tv)).status, 404, 'a code works once');
  assert.equal((await stranger('GET', `${at}/Users/Me`, undefined, {authorization: `${tv.authorization}, Token="${onTv.body.AccessToken}"`})).status, 200);
  // What the app reports while playing shows up under Activity: for the manager, and for the person themselves, never for someone else.
  const say = (path, body) => stranger('POST', `${at}${path}`, body, app(first.body.AccessToken));
  await say('/Sessions/Playing', {ItemId: 'ep-7', PositionTicks: 0}); await say('/Sessions/Playing/Progress', {ItemId: 'ep-7', PositionTicks: 600 * 1e7});
  await say('/Sessions/Playing/Stopped', {ItemId: 'ep-7', PositionTicks: 1500 * 1e7});
  let seen; for (let i = 0; i < 20 && !(seen = (await owner('GET', '/api/activity')).body.plays[0])?.position; i++) await new Promise(done => setTimeout(done, 150));
  assert.deepEqual({...seen, updated: 0}, {person: 'ada', item: 'ep-7', title: 'Harbor Lights', detail: 'Season 2 · Episode 4', position: 1500, duration: 3000, device: 'Test · TV', playing: 0, updated: 0, art: 'show-3'}, 'an episode is pictured by its show');
  assert.equal((await guest('GET', '/api/activity')).body.plays.length, 1); assert.equal((await stranger('GET', '/api/activity')).status, 401);
  // AIOStreams stops accepting the kept sign-in: the hub renews it once and the app never notices.
  fake.valid = 'rotated-away';
  assert.equal((await stranger('GET', `${at}/Users/Me`, undefined, app(first.body.AccessToken))).status, 200); assert.equal(fake.signIns, 2);
  // The other app, still holding the old one in memory, picks up the renewed sign-in without making another.
  assert.equal((await stranger('GET', `${at}/Users/Me`, undefined, app(second.body.AccessToken, 'd2'))).status, 200); assert.equal(fake.signIns, 2);
  // AIOStreams refuses everything: the hub passes the refusal on and stops after its allowance instead of signing in on every request.
  fake.refuseAll = true;
  for (let i = 0; i < 8; i++) assert.equal((await stranger('GET', `${at}/Users/Me`, undefined, app(first.body.AccessToken))).status, 401);
  assert.ok(fake.signIns <= 3, `signed in to AIOStreams ${fake.signIns} times`); fake.refuseAll = false;
  // AIOStreams' own user-switching routes: the token route is never passed on, and the user list shows only the caller.
  const mineOnly = await stranger('POST', `${at}/Users/AuthenticateByName`, {Username: 'Ada L', Pw: player}, app('', 'd7'));
  assert.equal((await stranger('POST', `${at}/AIOStreams/Token`, {UserId: 'anyone'}, app(mineOnly.body.AccessToken, 'd7'))).status, 403);
  assert.equal((await stranger('GET', `${at}/AIOStreams/Token`, undefined, app(mineOnly.body.AccessToken, 'd7'))).status, 403);
});
test('what a group or a person changes for themselves reaches the players as their own short list of changes', async () => {
  const hub = (await owner('GET', '/api/state')).body.hub, group = hub.groups[0], ben = hub.people.find(person => person.id === 'ben');
  // The group prefers smaller files and turns one source off; Ben, in it, wants the best quality and a spare source on.
  assert.equal((await owner('PUT', `/api/groups/${group.id}`, {name: group.name, rows: group.rows, settings: {quality: 'saver', maxSizeGb: 8, sources: ['library', 'comet', 'meteor']}, v: group.v})).status, 200);
  assert.equal((await owner('PUT', '/api/people/ben', {name: ben.name, groupId: ben.groupId, rows: ben.rows, settings: {quality: 'best', sources: ['library', 'comet', 'meteor', 'torz']}, can: ben.can, trakt: false, lists: false, v: ben.v})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const setup = [...fake.configs.values()][0].config, of = id => setup.variants.find(item => item.id === id).script.split('\n');
  assert.deepEqual(setup.variants.map(item => item.id).sort(), [`hub-g-${group.id}`, 'hub-p-ada', 'hub-p-ben']);
  assert.ok(!of(`hub-g-${group.id}`).some(line => line.startsWith('set excludedResolutions = ["'))); // Data saver lets any resolution through when the file is small.
  assert.ok(of(`hub-g-${group.id}`).some(line => line.startsWith('set bitrate = ') && line.includes('"2160p":{"movies":[800000,4000000]'))); assert.ok(of(`hub-g-${group.id}`).includes('set size.global = {"movies":[0,3000000000],"series":[0,1500000000],"anime":[0,1500000000]}'));
  assert.ok(of(`hub-g-${group.id}`).includes('disable presets[type="torrentio"]')); assert.ok(!of(`hub-g-${group.id}`).some(line => line.includes('manifestUrl')));
  assert.ok(!of('hub-p-ben').some(line => line.startsWith('set excludedResolutions'))); assert.ok(of('hub-p-ben').includes('enable presets[type="stremthruTorz"]')); // Best lifts the data saver's size cap back to the group's own limit.
  assert.ok(of('hub-p-ben').includes('set size.global = {"movies":[0,8000000000],"series":[0,8000000000],"anime":[0,8000000000]}'));
  // Data saver keeps files in a small bitrate band and prefers HEVC and AV1; Best widens the band again.
  assert.ok(of(`hub-g-${group.id}`).includes('set preferredEncodes = ["HEVC","AV1"]')); assert.ok(of(`hub-g-${group.id}`).some(line => line.startsWith('set bitrate = {"useMetadataRuntime":true')));
  assert.ok(of('hub-p-ben').includes('set preferredEncodes = []')); assert.ok(of('hub-p-ben').some(line => line.includes('"2160p":{"movies":[1000000,40000000]')));
  assert.deepEqual(setup.jellyfin.personas.find(user => user.id === 'ben').variants, [`hub-g-${group.id}`, 'hub-p-ben']);
  // The spare source is in the setup, switched off for everyone else; the hub's own defaults are untouched.
  assert.equal(setup.presets.find(item => item.type === 'stremthruTorz').enabled, false); assert.deepEqual(setup.excludedResolutions, []);
  // A content limit, subtitles in another language and a source added by its link also travel. The limit rides on the Home address,
  // so it needs no second Home setup.
  const mid = (await owner('GET', '/api/state')).body.hub, family = mid.groups[0], before = fake.homes.size;
  assert.equal((await owner('PUT', '/api/hub', {...mid, addons: [...mid.addons, {id: 'custom-9x', name: 'example.org', note: 'Added by link.', custom: true, url: 'http://example.org/manifest.json'}]})).status, 400);
  assert.equal((await owner('PUT', '/api/hub', {...mid, addons: [...mid.addons, {id: 'custom-9x', name: 'example.org', note: 'Added by link.', custom: true, url: 'https://example.org/manifest.json'}], defaults: {...mid.defaults, sources: [...mid.defaults.sources, 'custom-9x']}})).status, 200);
  assert.equal((await owner('PUT', `/api/groups/${family.id}`, {name: family.name, rows: family.rows, settings: {...family.settings, limit: 'kids', subtitles: ['French', 'Portuguese']}, v: family.v})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(fake.homes.size, before);
  const wider = [...fake.configs.values()][0].config, extra = wider.presets.find(item => item.options.manifestUrl === 'https://example.org/manifest.json');
  assert.equal(extra.enabled, true); assert.deepEqual(extra.options.resources, ['stream']); assert.match(extra.instanceId, /^x[a-z0-9]+$/);
  const lines = wider.variants.find(item => item.id === `hub-g-${family.id}`).script.split('\n');
  assert.ok(lines.some(line => /^set presets\[instanceId="h01"\]\.options\.manifestUrl = ".*\/home-1\/manifest\.json\?v=\d+&contentrating=PG"$/.test(line)), lines.join(' | '));
  assert.ok(lines.includes('set presets[type="opensubtitles-v3-plus"].options.language = ["fr","pt-pt","pt-br"]'));
  assert.ok(!wider.presets.find(item => item.instanceId === 'h01').options.manifestUrl.includes('contentrating'));
  // Taking the source away again takes its entry out of the setup.
  const later = (await owner('GET', '/api/state')).body.hub;
  assert.equal((await owner('PUT', '/api/hub', {...later, addons: later.addons.filter(item => item.id !== 'custom-9x'), defaults: {...later.defaults, sources: later.defaults.sources.filter(item => item !== 'custom-9x')}})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.ok(![...fake.configs.values()][0].config.presets.some(item => item.options.manifestUrl === 'https://example.org/manifest.json'));
  // The group gets a Home of its own: one more setup, named in the group's changes. Following the defaults again removes it.
  const rows = hub.rows.map(row => row.id === 'top-movies' ? {...row, on: false} : row), saved = (await owner('GET', '/api/state')).body.hub.groups[0];
  assert.equal((await owner('PUT', `/api/groups/${group.id}`, {name: group.name, rows, settings: saved.settings, v: saved.v})).status, 200);
  const homes = fake.homes.size; assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(fake.homes.size, homes + 1);
  assert.ok([...fake.configs.values()][0].config.variants.find(item => item.id === `hub-g-${group.id}`).script.includes('manifestUrl'));
  const again = (await owner('GET', '/api/state')).body.hub.groups[0];
  assert.equal((await owner('PUT', `/api/groups/${group.id}`, {name: group.name, rows: null, settings: {}, v: again.v})).status, 200);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(fake.homes.size, homes);
  assert.deepEqual([...fake.configs.values()][0].config.variants.map(item => item.id).sort(), ['hub-p-ada', 'hub-p-ben']);
});

test('the hub’s servers: only the manager, only public https addresses, and a page save cannot change them', async () => {
  assert.equal((await guest('PUT', '/api/host', {aiostreams: '', aiometadata: ''})).status, 403);
  for (const bad of ['http://streams.example', 'https://10.0.0.1', 'https://localhost', 'https://user:pw@streams.example', 'not an address']) assert.equal((await owner('PUT', '/api/host', {aiostreams: bad, aiometadata: ''})).status, 400, bad);
  assert.equal((await owner('PUT', '/api/host', {aiostreams: '', aiometadata: ''})).status, 200);
  const hub = (await owner('GET', '/api/state')).body.hub; assert.equal(hub.hostUrl, ''); assert.deepEqual(hub.missing, []);
  assert.equal((await owner('PUT', '/api/hub', {...hub, hostUrl: 'https://elsewhere.example', metaUrl: 'https://elsewhere.example'})).status, 200);
  assert.equal((await owner('GET', '/api/state')).body.hub.hostUrl, '');
});

test('Trakt: a checked connection gives that person their own rows, and only a deliberate disconnect removes it', async () => {
  const find = async () => (await owner('GET', '/api/state')).body.hub.people.find(person => person.id === 'ben'), mine = () => [...fake.homes.values()].find(home => home.config.apiKeys.traktTokenId);
  assert.match((await owner('GET', '/api/state')).body.hub.traktLink, /\/api\/auth\/trakt\/authorize$/);
  assert.equal((await guest('POST', '/api/people/ben/trakt', {tokenId: 'trakt-token-id-0001'})).status, 403);
  assert.equal((await owner('POST', '/api/people/ben/trakt', {tokenId: 'not-a-real-token-id-0000'})).status, 400); assert.equal((await find()).trakt, false);
  assert.deepEqual((await owner('POST', '/api/people/ben/trakt', {tokenId: 'trakt-token-id-0001'})).body, {username: 'benwatches'});
  const state = (await owner('GET', '/api/state')).body; assert.equal(state.hub.people.find(person => person.id === 'ben').trakt, true); assert.ok(!JSON.stringify(state).includes('trakt-token-id-0001'));
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  const home = mine().config; assert.equal(home.apiKeys.traktTokenId, 'trakt-token-id-0001'); assert.equal(home.hideWatchedTrakt, false);
  assert.deepEqual(home.catalogs.slice(0, 3).map(row => [row.id, row.type, row.source, row.enabled]), [['trakt.watchlist', 'all', 'trakt', true], ['trakt.recommendations.movies', 'movie', 'trakt', true], ['trakt.recommendations.shows', 'series', 'trakt', true]]);
  assert.equal([...fake.homes.values()].filter(item => item.config.apiKeys.traktTokenId).length, 1, 'nobody else gets the connection');
  // His own rows get real posters on the site as well; a row he does not have is not there for someone else.
  assert.deepEqual((await owner('GET', '/api/previews?person=ben')).body.rows.watchlist, ['https://img.example/1.jpg', 'https://img.example/2.jpg']); assert.equal((await owner('GET', '/api/previews')).body.rows.watchlist, undefined);
  assert.equal((await guest('GET', '/api/previews?person=ben')).body.rows.watchlist, undefined, 'an invited person only ever gets their own');
  // An ordinary save of the person cannot switch the connection off, and hiding what's been watched reads from it.
  const ben = await find();
  assert.equal((await owner('PUT', '/api/people/ben', {name: ben.name, groupId: ben.groupId, rows: ben.rows, settings: {...ben.settings, hideWatched: true}, can: ben.can, trakt: false, lists: false, v: ben.v})).status, 200);
  assert.equal((await find()).trakt, true); assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(mine().config.hideWatchedTrakt, true);
  assert.equal((await owner('DELETE', '/api/people/ben/trakt')).status, 200); assert.equal((await find()).trakt, false);
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'}); assert.equal(mine(), undefined);
});

test('MDBList: a person’s own key records only their plays, in their own Home setup', async () => {
  const mine = () => [...fake.homes.values()].find(home => home.config.apiKeys.mdblist === 'bens-own-mdblist-key'), users = () => [...fake.configs.values()][0].config.jellyfin.personas;
  assert.equal((await owner('POST', '/api/people/ben/mdblist', {key: 'someone-elses-wrong-key'})).status, 400);
  assert.deepEqual((await owner('POST', '/api/people/ben/mdblist', {key: 'bens-own-mdblist-key'})).body, {username: 'benlists'});
  const state = (await owner('GET', '/api/state')).body; assert.equal(state.hub.people.find(person => person.id === 'ben').lists, true); assert.ok(!JSON.stringify(state).includes('bens-own-mdblist-key'));
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  assert.equal(mine().config.playbackReporting, true); assert.equal(mine().config.mdblistWatchTracking, true);
  // Everyone else's setups record nothing, and only Ben is left free to have his plays recorded.
  for (const home of fake.homes.values()) if (home !== mine()) {assert.equal(home.config.playbackReporting, false); assert.equal(home.config.mdblistWatchTracking, false);}
  assert.equal(users().find(user => user.id === 'ben').trackers, undefined); assert.deepEqual(users().find(user => user.id === 'ada').trackers, []);
  assert.ok([...fake.configs.values()][0].config.presets.find(item => item.instanceId === 'h01').options.resources.includes('watch_state'));
  assert.equal((await owner('DELETE', '/api/people/ben/mdblist')).status, 200); assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  assert.equal(mine(), undefined); assert.deepEqual(users().find(user => user.id === 'ben').trackers, []);
});

test('advanced: the way into the hub’s own setups is for the manager, behind the password, and never in page data', async () => {
  assert.equal((await guest('POST', '/api/hub/advanced', {password: 'my own password'})).status, 403);
  assert.equal((await owner('POST', '/api/hub/advanced', {password: 'not it'})).status, 403);
  const state = JSON.stringify((await owner('GET', '/api/state')).body), setup = [...fake.configs.entries()][0];
  assert.ok(!state.includes(setup[1].password) && !state.includes(`"${setup[0]}"`));
});

test('a passkey signs the manager in with no hub code or password', async () => {
  const {createHash, sign, KeyObject} = await import('node:crypto'), b = bytes => Buffer.from(bytes).toString('base64url');
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']), key = b(await crypto.subtle.exportKey('spki', pair.publicKey));
  const said = (type, challenge, origin = BASE) => Buffer.from(JSON.stringify({type, challenge: b(Buffer.from(challenge)), origin}));
  const start = (await owner('POST', '/api/account/passkeys/options', {})).body, id = 'credential-one-0123456789';
  // Adding needs a signed-in manager, the site's own challenge, and this site as the origin.
  assert.equal((await stranger('POST', '/api/account/passkeys', {})).status, 401); assert.equal((await guest('POST', '/api/account/passkeys/options', {})).status, 403);
  assert.equal((await owner('POST', '/api/account/passkeys', {id, key, alg: -7, clientData: b(said('webauthn.create', start.challenge, 'https://elsewhere.example')), challenge: start.challenge, proof: start.proof})).status, 400);
  assert.equal((await owner('POST', '/api/account/passkeys', {id, key, alg: -7, clientData: b(said('webauthn.create', 'made-up.9999999999')), challenge: 'made-up.9999999999', proof: start.proof})).status, 400);
  assert.equal((await owner('POST', '/api/account/passkeys', {id, key, alg: -7, clientData: b(said('webauthn.create', start.challenge)), challenge: start.challenge, proof: start.proof, name: 'Mac · Safari'})).status, 200);
  const held = (await owner('GET', '/api/state')).body.hub.me.passkeys; assert.equal(held.length, 1); assert.equal(held[0].name, 'Mac · Safari'); assert.ok(!JSON.stringify(held).includes(key));
  // Signing in: the passkey signs the site's challenge. A wrong signature, another site, or a made-up challenge is refused.
  const attempt = async (change = {}) => {
    const fresh = client(), go = (await fresh('GET', '/api/passkey')).body, origin = change.origin ?? BASE;
    const auth = Buffer.concat([createHash('sha256').update(new URL(BASE).hostname).digest(), Buffer.from([change.absent ? 0 : 5, 0, 0, 0, 1])]), clientData = said('webauthn.get', go.challenge, origin);
    const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(change.other ? Buffer.from('something else') : clientData).digest()]), {key: KeyObject.from(pair.privateKey), dsaEncoding: 'der'});
    const answer = await fresh('POST', '/api/passkey', {id: change.id ?? id, clientData: b(clientData), authData: b(auth), signature: b(signature), challenge: go.challenge, proof: change.proof ?? go.proof});
    return {status: answer.status, fresh};
  };
  for (const change of [{other: true}, {origin: 'https://elsewhere.example'}, {absent: true}, {id: 'unknown'}, {proof: 'forged'}]) assert.equal((await attempt(change)).status, 403, JSON.stringify(change));
  const into = await attempt(); assert.equal(into.status, 200); assert.equal((await into.fresh('GET', '/api/state')).body.role, 'owner');
  // Removed, it stops working; the password still does.
  assert.equal((await owner('DELETE', `/api/account/passkeys/${held[0].id}`)).status, 200); assert.equal((await attempt()).status, 403);
});

test('account: password, recovery codes, sign out', async () => {
  assert.equal((await owner('POST', '/api/account/password', {old: 'wrong', password: 'a new password'})).status, 403);
  assert.equal((await owner('POST', '/api/account/password', {old: 'correct horse', password: 'a new password'})).status, 200);
  const codes = (await owner('POST', '/api/account/recovery', {})).body.codes; assert.equal(codes.length, 10);
  assert.equal((await owner('POST', '/api/signout', {})).status, 200); assert.equal((await owner('GET', '/api/state')).status, 401);
  assert.equal((await owner('POST', '/api/signin', {username: hub.code, password: 'correct horse'})).status, 403);
  assert.equal((await owner('POST', '/api/signin', {username: hub.code.toUpperCase(), recovery: codes[0], password: 'recovered password'})).status, 200);
  assert.equal((await client()('POST', '/api/signin', {username: hub.code.toUpperCase(), recovery: codes[0], password: 'again again'})).status, 403);
  assert.equal((await owner('GET', '/api/account/recovery')).body.left, 9);
  assert.equal((await owner('PUT', '/api/account', {name: 'Sam O', theme: 'light'})).status, 200);
  assert.equal((await owner('GET', '/api/state')).body.hub.me.theme, 'light');
});
test('removing a person removes their sign-in', async () => {
  assert.equal((await owner('DELETE', '/api/people/ada')).status, 200);
  assert.equal((await guest('GET', '/api/state')).status, 401);
  assert.deepEqual((await client()('POST', '/api/join', {token: link})).body, {gone: true});
});
test('deleting the hub also removes its setup on the streaming server', async () => {
  assert.deepEqual((await owner('POST', '/api/sync', {})).body, {state: 'ok'});
  assert.deepEqual([...fake.configs.values()][0].config.jellyfin.personas.map(user => user.name), ['Benjamin'], 'a removed person must leave the players too');
  assert.equal((await guest('POST', '/api/hub/delete', {password: 'x'})).status, 401);
  assert.equal((await owner('POST', '/api/hub/delete', {password: 'not it'})).status, 403); assert.equal(fake.configs.size, 1);
  assert.equal((await owner('POST', '/api/hub/delete', {password: 'recovered password'})).status, 200); assert.equal(fake.configs.size, 0); assert.equal(fake.homes.size, 0);
  assert.equal((await owner('GET', '/api/state')).status, 401); assert.equal((await stranger('GET', '/api/open')).body.signup, true);
});
test('wrong guesses are cut off', async () => {
  const tries = [];
  for (let i = 0; i < 9; i++) tries.push((await stranger('POST', '/api/signin', {username: hub.code, password: 'guess ' + i})).status);
  const cut = tries.indexOf(429);
  // Earlier tests already spent a few wrong guesses on this name; the limit is 8 in ten minutes in total.
  assert.ok(cut > 0 && cut <= 8, String(tries)); assert.ok(tries.slice(0, cut).every(status => status === 403) && tries.slice(cut).every(status => status === 429));
  assert.equal((await stranger('POST', '/api/signin', {username: hub.code, password: 'recovered password'})).status, 429);
});
