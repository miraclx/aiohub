// Runs against `wrangler dev --var FRONT:aiometadata` with a throwaway local database. No real accounts or upstream calls.
// Each person is served by their own AIOMetadata setup, which the hub makes, keeps in step and removes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
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
const VIEW = 'b220f707-f7e5-0b8e-9314-1314e52c6304', EP = 'a1110100-0000-eaf7-78ff-ffffff020000', EP_HELD = 'a1110100-0000-eaf7-78ff-ffffff030000', SHOW = 'a1210200-0000-eaf7-78ff-ffffff040000';
const HELD = {
  [ITEM]: {Id: ITEM, Type: 'Movie', Name: 'Meta Movie', ProviderIds: {Tmdb: '603', Imdb: 'tt0133093'}, UserData: {Played: true, LastPlayedDate: '2026-11-01T20:00:00.000Z'}},
  [EP]: {Id: EP, Type: 'Episode', Name: 'Two', SeriesId: SHOW, SeriesName: 'Meta Show', ParentIndexNumber: 1, IndexNumber: 2, ProviderIds: {}, UserData: {PlayedPercentage: 40}},
  [EP_HELD]: {Id: EP_HELD, Type: 'Episode', Name: 'One', SeriesId: SHOW, SeriesName: 'Meta Show', ParentIndexNumber: 1, IndexNumber: 1, ProviderIds: {}, UserData: {Played: true}},
  [SHOW]: {Id: SHOW, Type: 'Series', Name: 'Meta Show', ProviderIds: {Tmdb: '1399'}},
};
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk; const body = raw ? JSON.parse(raw) : {};
  const [id, pass] = request.headers.authorization?.startsWith('Basic ') ? atob(request.headers.authorization.slice(6)).split(':') : [];
  const mine = () => fake.configs.get(id)?.password === pass ? fake.configs.get(id) : null;
  if (request.url.startsWith('/tmdb')) return send(request.url.includes('api_key=good-tmdb-key') ? 200 : 401, {});
  if (request.url.startsWith('/mdblist/user')) return send(request.url.includes('apikey=ada-mdblist-key') ? 200 : 403, {username: 'adalists'});
  if (request.url.startsWith('/mdblist/') && !request.url.includes('apikey=ada-mdblist-key')) return send(403, {});
  if (request.url.startsWith('/mdblist/sync/history/movie/tmdb/603')) return send(200, {plays: fake.watched.some(body => body.movies?.length) ? [{season_num: null}] : []});
  if (request.url.startsWith('/mdblist/sync/history/show/tmdb/1399')) return send(200, {plays: [{season_num: 1, episode_num: 1}]});
  if (request.url.startsWith('/mdblist/sync/playback')) return send(200, []);
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
    if (rest.startsWith(`/Users/${uuid}/Items/`)) return send(200, {Id: ITEM, Name: 'Meta Movie', ServerId: uuid, UserData: {Key: uuid}, Poster: `${UP}/jellyfin/${uuid}/Items/${ITEM}/Images/Primary`});
    return send(200, {Seen: rest});
  }
  send(404, {});
}).listen(8798, '127.0.0.1').unref();

const owner = client(), at = () => `/h/${hub.code}`;
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
  assert.deepEqual(players().jellyfin?.personas ?? [], []);
  assert.ok(!(players().presets ?? []).some(item => item.instanceId === 'h01' && item.enabled));
  assert.ok(!(players().catalogModifications ?? []).length);
  // What production carries on AIOStreams (the content limit, skipping intros) is set on each person's own server.
  assert.equal(ada.config.ageRating, 'None'); assert.equal(ben.config.ageRating, 'PG');
  assert.equal(ada.config.jellyfinSkipSource, 'auto'); assert.equal(ben.config.jellyfinSkipSource, 'off');
  // Both are ready to sign in, as far as the site can tell.
  const shown = (await owner('GET', '/api/state')).body.hub.people;
  assert.ok(shown.every(person => person.ready !== false), JSON.stringify(shown.map(person => [person.id, person.ready])));
  // Nothing changed, so a second sync writes nothing.
  const versions = [...fake.homes.values()].map(home => home.config.configVersion);
  assert.deepEqual(await syncAll(), {state: 'ok'}); assert.deepEqual([...fake.homes.values()].map(home => home.config.configVersion), versions);
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
test('a person copies what they watched here to their MDBList, after seeing the plan', async () => {
  // A film played, an episode stopped partway, another ticked as watched: all through the hub, which keeps a note of each.
  const say = (path, body) => raw(path, token, {method: 'POST', body: JSON.stringify(body)});
  assert.equal((await say('/Sessions/Playing/Stopped', {ItemId: EP, PositionTicks: 600e7})).status, 204);
  assert.equal((await say(`/Users/${jf}/PlayedItems/${EP_HELD}`, {})).status, 200);
  await new Promise(resolve => setTimeout(resolve, 500));
  // Only Ada, from her own page.
  assert.equal((await owner('GET', '/api/people/ada/carry')).status, 403);
  const ada = client(), link = (await owner('GET', '/api/people/ada/signin')).body.link.split('/join/')[1];
  assert.equal((await ada('POST', '/api/join', {token: link, password: 'ada own password'})).status, 200);
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
