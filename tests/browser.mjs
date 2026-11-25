// Drives the real site in a browser against `wrangler dev` with a throwaway local database: create the account, set up, invite, join.
// Usage: node tests/browser.mjs <chromium path> [screenshot dir]
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const BASE = process.env.BASE ?? 'http://localhost:8799', shots = process.argv[3];
const browser = await chromium.launch({executablePath: process.argv[2]}), errors = [];
const open = async () => {const context = await browser.newContext({viewport: {width: 390, height: 844}}), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page;};
const shot = async (page, name) => {if (shots) await page.screenshot({path: `${shots}/real-${name}.png`, fullPage: true});};
const toast = page => page.locator('.toast span');
// Stand-ins for the accounts a person connects: AIOMetadata's description of its own Trakt Token ID, and MDBList's check of a key.
// Nothing else answers, so the players never get set up here; that is not tested here. Trakt itself is answered inside the browser
// (traktIn, below), where the page calls it.
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk;
  if (request.url === '/trakt/oauth/revoke') return send(200, {});
  // Ada's own Trakt lists (one private) and one she liked, read through the hub's Trakt link once she connects it: more than Add
  // row shows at first.
  if (request.url.startsWith('/trakt/users/me/lists')) return send(200, [{name: 'Heist nights', privacy: 'private', item_count: 12, ids: {trakt: 501}},
    ...['Rainy days', 'Space operas', 'Courtroom', 'Road trips', 'Slow cinema'].map((name, n) => ({name, privacy: 'public', item_count: 20 + n, ids: {trakt: 502 + n}}))]);
  if (request.url.startsWith('/trakt/users/likes/lists')) return send(200, [{type: 'list', list: {name: 'Sunday westerns', item_count: 8, ids: {trakt: 777}}}]);
  if (request.url.startsWith('/mdblist/user')) return send(request.url.includes('apikey=ada-mdblist-key') ? 200 : 403, {username: 'adalists'});
  request.socket.destroy(); // as if nothing were there
}).listen(8798, '127.0.0.1').unref();

// Trakt's two hosts, as the page meets them: its sign-in page (signs in at once and goes back with a code), its token exchange
// (busy once, then the login, only for the proof that matches), and the API's account details. The real sign-in host refuses a
// page's Trakt API headers, so this one does too.
const signins = [];
async function traktIn(context) {
  let challenge = '', busy = 1;
  const json = (route, status, body) => route.fulfill({status, headers: {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization,trakt-api-key,trakt-api-version'}, body: JSON.stringify(body)});
  await context.route('https://auth.trakt.tv/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return json(route, 204, {});
    if (url.pathname === '/oauth/authorize') {
      const ask = Object.fromEntries(url.searchParams); signins.push(ask); challenge = ask.code_challenge;
      return route.fulfill({status: 302, headers: {location: `${ask.redirect_uri}?code=the-code&state=${ask.state}`}});
    }
    if (url.pathname !== '/oauth/token' || request.method() !== 'POST' || request.headers()['trakt-api-key']) return json(route, 403, {});
    if (busy-- > 0) return json(route, 429, {});
    const body = request.postDataJSON(), proof = Buffer.from(createHash('sha256').update(body.code_verifier ?? '').digest()).toString('base64url');
    const right = body.code === 'the-code' && body.grant_type === 'authorization_code' && body.client_id === 'local-trakt-client' && body.redirect_uri === `${BASE}/api/trakt/callback` && proof === challenge && !body.client_secret;
    return right ? json(route, 200, {access_token: 'access', refresh_token: 'refresh', expires_in: 7 * 86400, created_at: Math.floor(Date.now() / 1000), token_type: 'bearer', scope: 'public'}) : json(route, 400, {error: 'invalid_grant'});
  });
  await context.route('https://api.trakt.tv/**', route => route.request().method() === 'OPTIONS' ? json(route, 204, {})
    : route.request().url().endsWith('/users/settings') && route.request().headers().authorization === 'Bearer access' && route.request().headers()['trakt-api-key'] === 'local-trakt-client' ? json(route, 200, {user: {username: 'adatrakt'}}) : json(route, 401, {}));
}

const owner = await open();
await owner.goto(BASE + '/'); await owner.getByRole('heading', {name: 'Sign in'}).waitFor(); await shot(owner, '1-signin');
// A quiet credit under every page, signed in or not.
const credit = async page => {const link = page.locator('footer.credit a'); assert.equal(await link.textContent(), 'miraclx'); assert.equal(await link.getAttribute('href'), 'https://github.com/miraclx/aiohub'); assert.equal(await link.getAttribute('target'), '_blank'); assert.equal(await link.getAttribute('rel'), 'noreferrer');};
await credit(owner);
await owner.getByRole('link', {name: 'Create a hub'}).click(); await owner.getByRole('heading', {name: 'Create your hub'}).waitFor();
const shownCode = await owner.getByLabel('Hub code').inputValue(); assert.match(shownCode, /^[a-z0-9]{6}$/);
await owner.getByLabel('Password').fill('correct horse'); await owner.getByLabel('Setup code').fill('wrong');
await owner.getByRole('button', {name: 'Continue'}).click(); await toast(owner).filter({hasText: 'setup code'}).waitFor();
await owner.goto(BASE + '/#/setup/local-claim'); assert.equal(await owner.getByLabel('Setup code').count(), 0); await owner.getByRole('button', {name: 'Continue'}).click();
await owner.getByRole('heading', {name: /Which account/}).waitFor(); const hubCode = await owner.locator('.notice strong').textContent(); assert.equal(hubCode, shownCode, 'the code shown before creating must be the one the hub gets'); await shot(owner, '2-setup');
await owner.getByLabel('TorBox API key').fill('tb-key-for-test'); await owner.getByRole('button', {name: 'Continue'}).click(); await owner.getByRole('heading', {name: 'What fills Home?'}).waitFor();
await owner.getByLabel('TMDB API key').fill('tmdb-key-for-test'); if (shots) await owner.screenshot({path: `${shots}/real-2b-home-keys.png`}); await owner.getByRole('button', {name: 'Continue'}).click(); await owner.getByRole('heading', {name: /How should it pick/}).waitFor();
await owner.getByRole('button', {name: 'Continue'}).click();
await owner.getByLabel('Name').fill('Ada'); await owner.getByRole('button', {name: 'Finish'}).click();
await owner.getByRole('heading', {name: 'Ada', exact: true}).waitFor();
const code = owner.locator('.share-text code'); await assert.doesNotReject(code.filter({hasText: '/#/join/i'}).waitFor());
const link = await code.textContent(); await shot(owner, '3-person-settings');
// A refresh shows the same thing: it was saved, not just drawn.
await owner.reload(); await owner.getByRole('heading', {name: 'Ada', exact: true}).waitFor(); assert.equal(await owner.locator('.share-text code').filter({hasText: '/#/join/i'}).textContent(), link);
// Playback is theirs to change from the start; the content limit stays the manager's until that is opened up too.
assert.equal(await owner.getByRole('switch', {name: 'Change playback'}).getAttribute('aria-checked'), 'true'); assert.equal(await owner.getByRole('switch', {name: 'Change their content limit'}).getAttribute('aria-checked'), 'false');
await owner.goto(BASE + '/#/person/ada/devices'); await owner.getByRole('button', {name: 'Show'}).click();
await owner.getByLabel('Password', {exact: true}).filter({hasText: /^[a-z]+-[a-z]+-[a-z]+-\d\d$/}).waitFor(); const password = await owner.getByLabel('Password', {exact: true}).textContent(); await shot(owner, '4-devices');
await owner.goto(BASE + '/#/hub/playback'); await owner.getByRole('radio', {name: 'Best'}).click().catch(() => owner.getByText('Best', {exact: true}).first().click()); await owner.waitForTimeout(900);
await owner.goto(BASE + '/#/hub/sources'); await owner.getByText('TorBox').first().waitFor(); await shot(owner, '5-sources');
// Background work on Hub, General: one cron run (before the daily check's hour), then when it ran, runs next, and how often it has.
await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}&time=${Date.UTC(2026, 0, 1, 3)}`);
await owner.goto(BASE + '/#/hub/general'); await owner.reload(); const work = owner.locator('section', {has: owner.getByRole('heading', {name: 'Background work'})});
const job = name => work.locator('.job', {has: owner.getByRole('heading', {name, exact: true})});
await job('Trakt sync').getByText('every 5 min').waitFor();
await job('Trakt sync').getByText(/^Ran today at \d/).waitFor(); await job('Trakt sync').getByText(/^next run in \d min$/).waitFor();
await job('Trakt and MDBList check').getByText(/^every day at \d/).waitFor(); await job('Trakt and MDBList check').getByText('Not run yet').waitFor(); await job('Trakt and MDBList check').getByText(/^next run (today|tomorrow)$/).waitFor();
await work.scrollIntoViewIfNeeded(); await shot(owner, '5b-background');
// Advanced: behind the password again, then one line a setup, grouped, its keys folded away until asked for.
const advanced = owner.locator('section', {has: owner.getByRole('heading', {name: 'Advanced'})});
await advanced.getByRole('button', {name: 'Show'}).click(); await advanced.getByLabel('Your password').fill('correct horse'); await advanced.getByRole('button', {name: 'Show'}).click();
await advanced.getByRole('heading', {name: 'Shared'}).waitFor(); assert.equal(await advanced.locator('.creds code').count(), 0, 'keys start folded');
if (await advanced.getByRole('button', {name: 'Keys'}).count()) {await advanced.getByRole('button', {name: 'Keys'}).first().click(); await advanced.locator('.creds code').first().waitFor();}
await advanced.scrollIntoViewIfNeeded(); await shot(owner, '5e-advanced');
// The hub's Home keeps a place for each of a person's own rows, each saying what fills it: Trakt, MDBList, or for Recently Watched
// whichever the person has. Both watchlists are on, so their names tell them apart.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later', {hasText: 'Watchlist · Trakt'}).getByText('Trakt · Appears once someone connects Trakt').waitFor();
await owner.locator('.rows .row.later', {hasText: 'Watchlist · MDBList'}).getByText('MDBList · Appears once someone connects MDBList. With Trakt too, it starts off').waitFor();
await owner.locator('.rows .row.later', {hasText: 'Recently Watched'}).getByText('Fills for each person from Trakt, MDBList or what they play here').waitFor();
// All seven, Recently Watched among those on Home (it is on by default); the Not on Home ones keep Show at the right edge.
assert.deepEqual(await owner.locator('.rows .row.later h3').allTextContents(), ['Watchlist · Trakt', 'Watchlist · MDBList', 'Recommended Movies', 'Recommended Shows', 'Recently Watched']);
assert.deepEqual(await owner.locator('.off li.later h3').allTextContents(), ['Up Next', 'Recently Aired for You']);
// Any row can be renamed from its Edit sheet: only the name changes, and it can be put back.
const rename = async (from, to) => {
  await owner.locator('.rows .row', {has: owner.locator('h3', {hasText: new RegExp(`^${from}$`)})}).getByRole('button', {name: 'Edit'}).click();
  const field = owner.getByRole('textbox', {name: 'Name of this row'}); await field.fill(to); await field.press('Enter');
  await toast(owner).filter({hasText: `Renamed to “${to}”`}).waitFor(); await owner.getByRole('button', {name: 'Close'}).click();
  await owner.locator('.rows .row h3', {hasText: new RegExp(`^${to}$`)}).waitFor();
};
await rename('Top Rated Movies', 'Best Films'); await rename('Best Films', 'Top Rated Movies');
// Not on Home is names only: no pictures beside any line, so places and plain rows start at the same edge.
await owner.locator('.off').evaluate(list => {list.open = true;}); await owner.locator('.off li').first().waitFor(); assert.equal(await owner.locator('.off .posters, .off .covers').count(), 0);
for (const width of [390, 1280]) {
  await owner.setViewportSize({width, height: 900}); await owner.locator('.off summary').scrollIntoViewIfNeeded();
  const edges = await owner.locator('.off li').evaluateAll(lines => lines.map(line => {const button = line.querySelector('button'); return Math.round(line.getBoundingClientRect().right - button.getBoundingClientRect().right);}));
  assert.equal(new Set(edges).size, 1, `every Show sits at the same edge (${width}): ${edges}`);
  const starts = await owner.locator('.off li h3').evaluateAll(names => names.map(name => Math.round(name.getBoundingClientRect().left)));
  assert.equal(new Set(starts).size, 1, `every name starts at the same edge (${width}): ${starts}`);
  if (shots) await owner.locator('.off').screenshot({path: `${shots}/real-5d-hub-not-on-home-${width}.png`});
}
await owner.setViewportSize({width: 390, height: 844}); await shot(owner, '5c-hub-home');
await owner.goto(BASE + '/#/'); await owner.getByText('Add someone to Family').waitFor(); await shot(owner, '6-people');
// The manager opening the invite link before Ada has joined is told to send it on, and stays signed in.
await owner.goto(link); await owner.getByText('Ada hasn’t joined yet. Send them this link', {exact: false}).waitFor();

const guest = await open();
await guest.goto(link); await guest.getByRole('heading', {name: 'Hi Ada'}).waitFor(); await shot(guest, '7-join');
await guest.getByLabel('Password').fill('my own password'); await guest.getByRole('button', {name: 'Continue'}).click();
await guest.getByRole('tab', {name: 'Playback'}).or(guest.getByRole('link', {name: 'Playback'})).first().waitFor(); await shot(guest, '8-own-page');
assert.equal(await guest.getByRole('link', {name: 'People'}).count(), 0);
await guest.goto(BASE + '/#/me/playback'); await guest.getByText('Set for you by whoever runs the hub.').waitFor();
await guest.goto(BASE + '/#/me/devices'); await guest.locator('.creds code').filter({hasText: /^Ada$/}).waitFor(); await guest.getByRole('button', {name: 'Show'}).click();
await guest.getByLabel('Password', {exact: true}).filter({hasText: password}).waitFor(); // the player password, not the one just chosen
await guest.goto(BASE + '/#/me/you'); await guest.getByRole('button', {name: 'Sign out'}).click(); await guest.getByRole('heading', {name: 'Sign in'}).waitFor();
// Coming back through the link now asks for the password.
await guest.goto(link); await guest.getByText('Type your password').waitFor();
await guest.getByLabel('Password').fill('my own password'); await guest.getByRole('button', {name: 'Continue'}).click(); await guest.getByRole('heading', {name: 'Ada', exact: true}).waitFor();

// Accounts, on her own page. Trakt is one card with one Connect; progress is kept here until she picks MDBList.
await guest.goto(BASE + '/#/me/accounts'); const trakt = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'Trakt', exact: true})});
await trakt.getByText('is added to your Trakt as it plays', {exact: false}).waitFor(); assert.equal(await guest.getByText('Trakt history').count(), 0);
// MDBList is an account like Trakt, optional; with none connected there is nothing to choose for progress.
const mdb = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'MDBList', exact: true})}).first();
await mdb.getByText('Keep your progress there and rows can leave out', {exact: false}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'Here'}).count(), 0);
await guest.getByText('Connect MDBList to keep it there instead.', {exact: false}).waitFor();
await shot(guest, '12-accounts');
// Connect asks for her key; Cancel before saving leaves nothing changed.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').waitFor();
await mdb.getByRole('button', {name: 'Cancel'}).click(); assert.equal(await guest.getByLabel('MDBList API key').count(), 0);
// Connecting Trakt: off to Trakt's sign-in and back to this page, which finishes it with Trakt (busy at first) and says so.
await traktIn(guest.context());
await trakt.getByRole('button', {name: 'Connect'}).click(); await trakt.getByText('Trakt is busy, trying again…').waitFor();
await toast(guest).filter({hasText: 'Trakt connected as adatrakt'}).waitFor(); await trakt.getByText('Connected as adatrakt').waitFor();
assert.equal(new URL(guest.url()).hash, '#/me/accounts', 'back where Connect was pressed, with nothing from Trakt left in the address');
const [asked] = signins; assert.equal(asked.response_type, 'code'); assert.equal(asked.code_challenge_method, 'S256'); assert.equal(asked.prompt, undefined);
assert.equal(asked.redirect_uri, `${BASE}/api/trakt/callback`); assert.equal(await guest.evaluate(() => sessionStorage.length), 0);
// An older Trakt link made through AIOMetadata shows as a quiet note she can remove (made here directly in the local database).
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO secrets (hub, owner, kind, value) SELECT id, 'ada', 'trakt', 'x' FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await guest.reload(); await trakt.getByText('Nothing uses it any more').waitFor(); await shot(guest, '13-accounts-connected');
await trakt.getByRole('button', {name: 'Disconnect it'}).click(); await toast(guest).filter({hasText: 'Older Trakt link removed'}).waitFor();
// Said as soon as the hub answers; the card follows a moment later.
await trakt.getByText('Nothing uses it any more').waitFor({state: 'detached'}); await trakt.getByText('Connected as adatrakt').waitFor();
await trakt.getByRole('button', {name: 'Disconnect', exact: true}).click(); await guest.getByRole('heading', {name: 'Disconnect Trakt?'}).waitFor(); await guest.getByRole('button', {name: 'Cancel'}).click(); await trakt.getByText('Connected as adatrakt').waitFor();
// With Trakt connected, Recently Watched is on Home right after Watchlist. Switching it off keeps her following her group's Home.
await guest.goto(BASE + '/#/me/home'); const onHome = guest.locator('.rows li h3');
assert.deepEqual((await onHome.allTextContents()).slice(0, 4), ['Watchlist', 'Recommended Movies', 'Recommended Shows', 'Recently Watched']);
await guest.getByRole('switch', {name: 'Show Recently Watched on Home'}).click(); await toast(guest).filter({hasText: '“Recently Watched” is off Home'}).waitFor();
const followed = await guest.evaluate(async () => {for (let i = 0; i < 40; i++) {const me = (await (await fetch('/api/state')).json()).hub.people[0]; if (me.picks) return me; await new Promise(done => setTimeout(done, 250));} return null;});
assert.equal(followed.rows, null, 'still following the group Home'); assert.deepEqual(followed.picks, {'recently-watched': false}); await shot(guest, '13d-recently-watched-off');
// Add row on her own Home: her own Trakt lists first (five, then the rest on asking), then the ready-made rows in labelled sections.
// Picking one makes it a row of her own.
const adding = async (page, name, phone = true) => {
  await page.getByRole('button', {name: '+ Add row'}).click(); const sheet = page.getByRole('dialog', {name: 'Add a row'}); await sheet.getByRole('heading', {name: 'Ready-made rows'}).waitFor();
  if (shots) {await page.waitForTimeout(300); await page.screenshot({path: `${shots}/real-${name}-phone.png`}); await page.setViewportSize({width: 1280, height: 900}); await page.waitForTimeout(300); await page.screenshot({path: `${shots}/real-${name}-wide.png`}); await page.setViewportSize({width: 390, height: 844});}
  return sheet;
};
let sheet = await adding(guest, '6a-add-row-own');
await sheet.getByRole('heading', {name: 'Your lists'}).waitFor(); await sheet.getByText('Heist nights').waitFor(); await sheet.getByText('Trakt · 12 titles').waitFor();
assert.equal(await sheet.getByText('Sunday westerns').count(), 0, 'past the first five');
await sheet.getByRole('button', {name: 'Show all 7'}).click(); await sheet.getByText('Sunday westerns').waitFor(); assert.equal(await sheet.getByRole('button', {name: /^Show all/}).count(), 0);
// Without an MDBList key only the TMDB picks are offered, and the rest are said to be waiting for one. Sections with nothing in them
// are left out: the lists for children are all MDBList.
assert.deepEqual(await sheet.locator('.pick-section h4, .pick-section summary').allTextContents(), ['Worlds and series', 'Studios and channels']);
assert.deepEqual(await sheet.locator('.pick-section').nth(0).locator('li strong').allTextContents(), ['Marvel Cinematic Universe', 'Wizarding World', 'Middle-earth', 'James Bond']);
assert.deepEqual(await sheet.locator('.pick-section').nth(1).locator('li strong').allTextContents(), ['Pixar', 'Studio Ghibli', 'Kids’ Channels', 'Animation Studios']);
await sheet.getByText(/more ready-made rows read MDBList lists/).waitFor();
await sheet.getByRole('button', {name: /^Heist nights/}).click(); await toast(guest).filter({hasText: 'Added “Heist nights”'}).waitFor();
assert.equal((await onHome.allTextContents())[0], 'Heist nightsYours');
const mine = await guest.evaluate(async () => {for (let i = 0; i < 40; i++) {const me = (await (await fetch('/api/state')).json()).hub.people[0]; if (me.rows) return me.rows[0]; await new Promise(done => setTimeout(done, 250));} return null;});
assert.deepEqual([mine.id, mine.origin], ['trakt-mine.501', 'own']);
// Already on Home, it stays in its place, dimmed and saying so; so does a ready-made row once added.
await guest.getByRole('button', {name: '+ Add row'}).click(); sheet = guest.getByRole('dialog', {name: 'Add a row'}); await sheet.getByRole('button', {name: /^Heist nights\s*On Home$/}).and(guest.locator(':disabled')).waitFor();
await sheet.getByRole('button', {name: /^Pixar/}).click(); await toast(guest).filter({hasText: 'Added “Pixar”'}).waitFor();
await guest.getByRole('button', {name: '+ Add row'}).click(); await sheet.getByRole('button', {name: /^Pixar\s*On Home$/}).and(guest.locator(':disabled')).waitFor();
assert.deepEqual(await sheet.locator('.pick-section').nth(1).locator('li strong').allTextContents(), ['Pixar', 'Studio Ghibli', 'Kids’ Channels', 'Animation Studios'], 'nothing shifts');
await sheet.getByRole('button', {name: 'Close'}).click();
// Hers alone: the hub's Home, her group's and the manager's view of her own Home never list her lists.
for (const where of ['/#/hub', '/#/group/family', '/#/person/ada/home']) {
  await owner.goto(BASE + where); await owner.reload();
  const theirs = await adding(owner, where === '/#/hub' ? '6b-add-row-hub' : where === '/#/group/family' ? '6c-add-row-group' : '6d-add-row-manager-view');
  assert.equal(await theirs.getByText('Heist nights').count(), 0, where); assert.equal(await theirs.getByText('Sunday westerns').count(), 0, where);
  // The manager's view of her Home says why her lists are not there: only she can add them.
  if (where === '/#/person/ada/home') await theirs.getByText('Their own Trakt and MDBList lists stay private', {exact: false}).waitFor(); else assert.equal(await theirs.getByRole('heading', {name: /lists$/}).count(), 0, where);
  if (where === '/#/hub') await theirs.getByText(/more ready-made rows? reads? MDBList lists/).waitFor();
  await theirs.getByRole('button', {name: 'Close'}).click();
} await guest.goto(BASE + '/#/me/accounts'); await trakt.getByText('Connected as adatrakt').waitFor();
// The Trakt and MDBList card: always two places side by side. What each pair holds is put in the hub's six-hour keep here (no
// player setups run in this test, so nothing could be looked at); copying across is tested in tests/aiom.test.mjs.
const sqlLocal = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', command], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
const iso = days => new Date(Date.now() - days * 86400e3).toISOString(), keep = {};
const play = (key, title, detail, days, cells, extra = {}) => ({key, title, detail, at: iso(days), here: 'none', trakt: 'none', lists: 'none', ...cells, ...extra});
const holds = (pair, lines) => {keep[pair] = {at: Math.floor(Date.now() / 1000), look: {lines, more: false, unmatched: 0, already: 0}}; sqlLocal(`INSERT INTO drift (hub, person, day, here, here_at) SELECT id, 'ada', '', '${JSON.stringify(keep)}', 0 FROM hubs WHERE true ON CONFLICT (hub, person) DO UPDATE SET here = excluded.here`);};
const card = guest.locator('.accounts li.trackers'), both = async (page, name) => {await card.scrollIntoViewIfNeeded(); await shot(page, `${name}-phone`); await page.setViewportSize({width: 1280, height: 900}); await card.scrollIntoViewIfNeeded(); await shot(page, `${name}-wide`); await page.setViewportSize({width: 390, height: 844});};
const columns = async () => (await card.locator('.trackers-cols span').allTextContents()).join(' | ');
// The hub's answer to a look at a pair, made to fail the first `times` asks as a busy service does, then passed on as it is.
const refuse = async (pair, times, message) => {
  let asked = 0; const at = new RegExp(`/api/people/ada/compare/${pair}(\\?|$)`), answer = route => ++asked <= times ? route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({message})}) : route.continue();
  await guest.route(at, answer); return {asked: () => asked, done: () => guest.unroute(at, answer)};
};
// Progress Here, Trakt connected (also what someone with Trakt only sees): out to Trakt what never reached it, in from Trakt what
// was watched elsewhere, a spot Trakt holds.
holds('here-trakt', [play('w:show/60574:5:2', 'Peaky Blinders', 'Season 5 · Episode 2', 0.5, {here: 'has', trakt: 'add'}), play('i:show/83867:2:4', 'Andor', 'Season 2 · Episode 4', 5, {here: 'add', trakt: 'has'}, {elsewhere: true}),
  play('ip:movie/693134', 'Dune: Part Two', 'Movie', 8, {here: 'add', trakt: 'has'}, {elsewhere: true, pct: 42})]);
await guest.reload(); await card.getByRole('heading', {name: 'Here and Trakt'}).waitFor(); await card.getByText('3 plays missing').waitFor();
assert.equal(await columns(), 'Here | Trakt'); await card.getByText('· watched elsewhere').first().waitFor(); await card.getByText('partway').waitFor();
const andor = card.getByRole('button', {name: 'Add Andor S2E4'}); await andor.click(); assert.equal(await andor.getAttribute('aria-pressed'), 'false'); await card.getByRole('button', {name: 'Add 2 plays'}).waitFor();
await both(guest, '13a-card-here-trakt'); await andor.click();
// A look that fails is asked once more by itself first: a busy moment passes unseen.
let refused = await refuse('here-trakt', 1, 'Trakt is busy right now.');
await guest.reload(); await card.getByText('3 plays missing').waitFor(); assert.equal(refused.asked(), 2); assert.equal(await card.getByText('Couldn’t').count(), 0); await refused.done();
// Failing twice, what was shown stays, saying it couldn't be checked again and why, and that plays are still being saved.
refused = await refuse('here-trakt', 2, 'Trakt is busy right now.'); await card.getByRole('button', {name: 'Check again'}).click();
await card.getByText('Couldn’t check again just now. Trakt is busy right now. Your watching is still being saved.').waitFor(); assert.equal(refused.asked(), 2);
await card.getByRole('button', {name: 'Add 3 plays'}).waitFor(); assert.equal(await card.getByRole('button', {name: 'Check again'}).count(), 0);
await both(guest, '13j-card-not-checked-again');
holds('here-trakt', keep['here-trakt'].look.lines); await card.getByRole('button', {name: 'Try again'}).click();
await card.getByText('Couldn’t check again').waitFor({state: 'detached'}); assert.equal(refused.asked(), 3); await refused.done();
holds('here-trakt', []); await guest.reload(); await guest.getByText('Here and Trakt · all in step', {exact: false}).waitFor(); await both(guest, '13h-card-here-trakt-in-step');
// Nothing kept and no player setup made for her (none is, in this test): the card says so, never "all in step", and not that
// nothing was watched. Asking again won't change that by itself, so it is asked once.
sqlLocal('UPDATE drift SET here = NULL'); refused = await refuse('here-trakt', 0, '');
await guest.reload(); await card.getByText('Here and Trakt · couldn’t compare just now. Your player setup isn’t made yet.').waitFor();
assert.equal(refused.asked(), 1); assert.equal(await card.getByText(/all in step|still being saved/).count(), 0); await card.getByRole('button', {name: 'Try again'}).waitFor();
await both(guest, '13l-card-no-setup'); await refused.done();
// Connecting MDBList only saves the key: progress stays Here, and the choice appears.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').fill('ada-mdblist-key');
await guest.getByRole('button', {name: 'Save'}).click(); await toast(guest).filter({hasText: 'MDBList connected'}).waitFor();
await mdb.getByText('Not keeping progress, so rows still show what’s been watched.', {exact: false}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true');
await both(guest, '12b-mdblist-connected');
// With Trakt and MDBList both connected, on the Home of her own: MDBList's watchlist comes in after Trakt's, off, and each is plainly
// "Watchlist" while only one is on. Turning MDBList's on names both; turning it off again keeps it there, off.
await guest.goto(BASE + '/#/me/home'); await guest.locator('.off').evaluate(list => {list.open = true;});
await guest.locator('.off li', {hasText: 'MDBList'}).getByRole('heading', {name: 'Watchlist', exact: true}).waitFor();
assert.ok((await onHome.allTextContents()).includes('Watchlist')); assert.ok(!(await onHome.allTextContents()).some(name => name.includes('·')));
await guest.locator('.off li', {hasText: 'MDBList'}).getByRole('button', {name: 'Show'}).click(); await toast(guest).filter({hasText: 'is on Home'}).waitFor();
await guest.locator('.rows li h3', {hasText: 'Watchlist · MDBList'}).waitFor(); assert.ok((await onHome.allTextContents()).includes('Watchlist · Trakt'));
await shot(guest, '12c-both-watchlists-phone'); await guest.setViewportSize({width: 1280, height: 900}); await shot(guest, '12c-both-watchlists-wide'); await guest.setViewportSize({width: 390, height: 844});
await guest.getByRole('switch', {name: 'Show Watchlist · MDBList on Home'}).click(); await toast(guest).filter({hasText: 'is off Home'}).waitFor();
await guest.locator('.rows li h3', {hasText: /^Watchlist$/}).waitFor();
const kept = await guest.evaluate(async () => {for (let i = 0; i < 40; i++) {const me = (await (await fetch('/api/state')).json()).hub.people[0]; const row = me.rows?.find(item => item.id === 'mdblist-watchlist'); if (row && !row.on) return me.rows.map(item => [item.id, item.on]); await new Promise(done => setTimeout(done, 250));} return null;});
assert.ok(kept, 'saved off'); assert.equal(kept.findIndex(([id]) => id === 'mdblist-watchlist'), kept.findIndex(([id]) => id === 'watchlist') + 1, 'right after Trakt’s watchlist');
await guest.goto(BASE + '/#/me/accounts');
// Choosing MDBList on her own page opens the move: nothing switches until her plays are across.
await guest.getByRole('radio', {name: 'MDBList'}).click(); await toast(guest).filter({hasText: 'Move your plays across to switch'}).waitFor();
holds('here-mdblist', [play('p:show/194764:1:6', 'The Penguin', 'Season 1 · Episode 6', 2, {here: 'has', lists: 'add'}, {pct: 42}), play('w:show/66276:6:6', 'Slow Horses', 'Season 6 · Episode 6', 15, {here: 'has', lists: 'add'}), play('w:show/1407:5:5', 'Homeland', 'Season 5 · Episode 5', 18, {here: 'has', lists: 'add'})]);
await guest.reload();
await card.getByRole('heading', {name: 'Moving to MDBList'}).waitFor(); await card.getByText('3 plays to move').waitFor(); assert.equal(await columns(), 'Here | MDBList');
await card.getByRole('button', {name: 'Move 3 plays and switch'}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'MDBList'}).getAttribute('aria-checked'), 'true');
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, false, 'not switched yet');
await both(guest, '13e-card-moving-to-mdblist');
// Staying on Here keeps MDBList connected, not keeping progress, with Disconnect beside it. Her card pairs Here and Trakt.
await card.getByRole('button', {name: 'Stay on Here'}).click(); await toast(guest).filter({hasText: 'Staying on Here'}).waitFor();
assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true'); await guest.locator('li.trackers', {hasText: 'Here and Trakt'}).waitFor();
await mdb.getByText('Not keeping progress, so rows still show what’s been watched.', {exact: false}).waitFor(); await mdb.getByRole('button', {name: 'Disconnect'}).waitFor();
await both(guest, '13i-kept-key');
// The manager connects it for her instead (from the manager's view it switches at once). Plays from before stay Here until she
// finishes moving them: the card shows that first.
// Her saved key is taken up again: nothing to paste.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload(); await owner.getByText('Their watchlist and lists show up on Home.', {exact: false}).waitFor();
await owner.getByRole('radio', {name: 'MDBList'}).click(); assert.equal(await owner.getByLabel('MDBList API key').count(), 0);
await toast(owner).filter({hasText: 'Back on MDBList as adalists'}).waitFor();
// With an MDBList key the lists for children are offered too: folded, at the end of the ready-made rows, without a content limit.
// The manager's view of her Home says why her own lists are not there.
await owner.goto(BASE + '/#/person/ada/home'); await owner.reload();
const keyed = await adding(owner, '6e-add-row-with-key'), young = keyed.locator('details.pick-section');
assert.equal(await young.locator('summary').textContent(), 'For children 4'); assert.equal(await young.evaluate(fold => fold.open), false);
assert.equal(await keyed.locator('.pick-section').last().locator('summary').count(), 1, 'for children comes last');
await keyed.getByRole('button', {name: /^Star Wars/}).waitFor(); await keyed.getByText('Their own Trakt and MDBList lists stay private', {exact: false}).waitFor();
await young.locator('summary').click(); assert.deepEqual(await young.locator('li strong').allTextContents(), ['Kids’ Movies, around 7', 'Kids’ Shows, around 7', 'Movies for 9 to 12', 'Kids’ Shows, up to 12']);
await keyed.getByRole('button', {name: 'Close'}).click();
holds('here-mdblist', [play('w:show/66276:6:6', 'Slow Horses', 'Season 6 · Episode 6', 15, {here: 'has', lists: 'add'}), play('w:movie/603', 'The Matrix', 'Movie', 20, {here: 'has', lists: 'add'})]);
await guest.reload(); await card.getByRole('heading', {name: 'Finish moving from Here'}).waitFor(); await card.getByRole('button', {name: 'Move 2 plays'}).waitFor(); assert.equal(await columns(), 'Here | MDBList');
await guest.getByText('Hiding what’s been watched needs MDBList').waitFor({state: 'detached'});
await both(guest, '13f-card-finish-moving');
// Progress in MDBList, Trakt connected: MDBList on the left, Trakt on the right, both ways (the daily look and paused points).
holds('here-mdblist', []); holds('mdblist-trakt', [play('pt:movie/550', 'Fight Club', 'Movie', 1, {trakt: 'has', lists: 'add'}, {pct: 35})]);
const drift = JSON.stringify({since: 0, trakt: 3, mdblist: 2, toMdblist: [{kind: 'show', tmdb: 1396, name: 'Breaking Bad', season: 1, episode: 2, at: 1763000000}], toTrakt: [{kind: 'movie', tmdb: 680, name: 'Pulp Fiction', at: 1762900000}]});
sqlLocal(`UPDATE drift SET result = '${drift}', at = ${Math.floor(Date.now() / 1000)}, day = '2026-06-01'`);
await guest.reload(); await card.getByRole('heading', {name: 'MDBList and Trakt'}).waitFor();
await card.getByText('3 plays missing').waitFor(); await card.getByText(/^Checked today at /).waitFor(); await card.getByRole('button', {name: 'Add 3 plays'}).waitFor(); assert.equal(await columns(), 'MDBList | Trakt');
const pulpLine = card.getByRole('button', {name: 'Add Pulp Fiction Movie'}); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'true');
assert.equal(await pulpLine.locator('.arrow').textContent(), '→', 'MDBList has it, Trakt gets it');
await pulpLine.click(); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'false'); await card.getByRole('button', {name: 'Add 2 plays'}).waitFor();
await both(guest, '13b-card-mdblist-trakt');
await pulpLine.press('Enter'); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'true');
// Nothing missing: the card folds to one line.
holds('mdblist-trakt', []); sqlLocal(`UPDATE drift SET result = '${JSON.stringify({since: 0, trakt: 3, mdblist: 3, toMdblist: [], toTrakt: []})}'`);
await guest.reload(); await guest.getByText('Trakt and MDBList · all in step · checked today at', {exact: false}).waitFor(); await both(guest, '13d-card-in-step');
// With both connected, a failed look at what is left from Here no longer goes unsaid.
refused = await refuse('here-mdblist', 2, 'MDBList didn’t answer. If this lasts a day, paste a new key.');
await guest.reload(); await card.getByText('Couldn’t check everything just now. MDBList didn’t answer. If this lasts a day, paste a new key. Your watching is still being saved.').waitFor();
await both(guest, '13m-card-both-part-failed'); await refused.done();
// With MDBList only (her Trakt link set aside a moment), the same failure once read "MDBList · all in step". Now it says why, and
// Try again asks again.
sqlLocal("UPDATE secrets SET kind = 'aside' WHERE owner = 'ada' AND kind = 'trakt-scrobble'");
refused = await refuse('here-mdblist', 2, 'MDBList didn’t answer. If this lasts a day, paste a new key.');
await guest.reload(); await card.getByText('MDBList · couldn’t compare just now. MDBList didn’t answer. If this lasts a day, paste a new key. Your watching is still being saved.').waitFor();
assert.equal(refused.asked(), 2); assert.equal(await card.getByText('all in step').count(), 0); await both(guest, '13k-card-mdblist-failed');
holds('here-mdblist', []); await card.getByRole('button', {name: 'Try again'}).click(); await card.getByText('MDBList · all in step', {exact: false}).waitFor(); assert.equal(refused.asked(), 3); await refused.done();
sqlLocal("UPDATE secrets SET kind = 'trakt-scrobble' WHERE owner = 'ada' AND kind = 'aside'"); await guest.reload(); await card.getByText('Trakt and MDBList · all in step', {exact: false}).waitFor();
// Pressing Here on her own page opens the move back, MDBList's plays coming Here; staying on MDBList changes nothing.
holds('mdblist-here', [play('i:show/83867:2:4', 'Andor', 'Season 2 · Episode 4', 5, {here: 'add', lists: 'has'}), play('i:show/95396:2:10', 'Severance', 'Season 2 · Episode 10', 11, {here: 'add', lists: 'has'})]);
await guest.getByRole('radio', {name: 'Here'}).click(); assert.equal(await guest.getByRole('button', {name: 'Keep it here'}).count(), 0);
await card.getByRole('heading', {name: 'Moving back to Here'}).waitFor(); await card.getByRole('button', {name: 'Move 2 plays and switch'}).waitFor(); assert.equal(await columns(), 'Here | MDBList');
assert.equal(await card.locator('.arrow').first().textContent(), '←');
await both(guest, '13g-card-moving-back');
await card.getByRole('button', {name: 'Stay on MDBList'}).click(); await toast(guest).filter({hasText: 'Staying on MDBList'}).waitFor();
assert.equal(await guest.getByRole('radio', {name: 'MDBList'}).getAttribute('aria-checked'), 'true');
sqlLocal('DELETE FROM drift');
// The manager sees none of it: what she watched is hers alone.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload(); await owner.getByText('Connected as adatrakt').waitFor();
await owner.getByText('It’s theirs, so it isn’t shown here.').waitFor(); assert.equal(await owner.locator('li.trackers').count(), 0); await shot(owner, '14-accounts-manager');
// The manager who is Ada too opens her link once she has joined: straight into her own view, as if she had signed in, with her
// own things there. "Back to manager" returns to the manager's view, which was kept aside meanwhile.
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor(); await owner.getByRole('button', {name: 'Back to manager'}).waitFor();
await owner.goto(BASE + '/#/me/accounts'); await owner.getByText('Where progress is kept').waitFor(); assert.equal(await owner.getByText('It’s theirs, so it isn’t shown here.').count(), 0); await shot(owner, '14b-accounts-as-ada');
// Side by side: another tab in the same browser is still the manager's, and stays so while Ada's tab is used and reloaded.
const beside = await owner.context().newPage(); await beside.goto(BASE + '/#/'); await beside.getByText('Add someone to Family').waitFor();
await owner.reload(); await owner.getByText('Where progress is kept').waitFor(); await beside.reload(); await beside.getByText('Add someone to Family').waitFor();
await beside.goto(BASE + '/#/person/ada/accounts'); await beside.getByText('It’s theirs, so it isn’t shown here.').waitFor(); await owner.reload(); await owner.getByText('Where progress is kept').waitFor();
// Signing out of Ada's view ends only hers; the manager's tab stays signed in.
await owner.goto(BASE + '/#/me/you'); await owner.getByRole('button', {name: 'Sign out'}).click(); await owner.getByText('Add someone to Family').waitFor();
await beside.reload(); await beside.getByText('It’s theirs, so it isn’t shown here.').waitFor(); await beside.close();
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor();
await owner.getByRole('button', {name: 'Back to manager'}).click(); await owner.getByText('Add someone to Family').waitFor();
// Her rows' posters stay on her page: the hub's Home shows only blanks where her Trakt rows would go.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later').first().waitFor(); assert.equal(await owner.locator('.rows .row.later .posters span:not(.blank)').count(), 0);
// From the manager's view, back to Here asks first, then MDBList is let go at once.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.getByRole('radio', {name: 'Here'}).click(); await owner.getByRole('button', {name: 'Keep it here'}).click();
await toast(owner).filter({hasText: 'Progress kept here'}).waitFor(); await guest.reload(); assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true');
await owner.goto(BASE + '/#/hub/playback'); await owner.getByText('for anyone whose progress is kept in MDBList', {exact: false}).waitFor();

// Activity keeps where each play was reported from behind a small pin: folded until pressed, and absent when unknown.
// (Plays made here directly in the local database, one sitting each: one with a made-up place, one without, one playing now with a
// skip after a jump back, and three episodes one after another, the first also watched halfway earlier: two sittings, two entries.)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art, place, net) SELECT id, 'ada', 'm-1', 'Paper Kites', 'Movie', 600, 6000, 'Strand · Mac', 0, CAST(strftime('%s', 'now') AS INTEGER), '', 'Lagos, NG', 'SpaceX Services, Inc.' FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'm-2', 'Small Engines', 'Movie', 300, 6000, 'Odin · Apple TV', 0, CAST(strftime('%s', 'now') AS INTEGER) - 60, '' FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art, parts, pauses) SELECT id, 'ada', 'm-3', 'Glass Garden', 'Movie', 2700, 3000, 'Strand · iPad', 1, CAST(strftime('%s', 'now') AS INTEGER), '', '1500-2700 1210-1215 0-1200', 2 FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'e-1', 'Harbor Lights', 'Season 1 · Episode 1', 1790, 1800, 'Strand · iPad', 0, CAST(strftime('%s', 'now') AS INTEGER) - 7200, '' FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'e-2', 'Harbor Lights', 'Season 1 · Episode 2', 1790, 1800, 'Strand · iPad', 0, CAST(strftime('%s', 'now') AS INTEGER) - 5400, '' FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'e-3', 'Harbor Lights', 'Season 1 · Episode 3', 1790, 1800, 'Strand · iPad', 0, CAST(strftime('%s', 'now') AS INTEGER) - 3600, '' FROM hubs; INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, place, net, parts, pauses, idle) SELECT hub, person, item, updated, device, position, playing, paused, since, updated, place, net, parts, pauses, idle FROM plays WHERE person = 'ada' AND item IN ('m-1', 'm-2', 'm-3', 'e-1', 'e-2', 'e-3'); INSERT INTO sittings (hub, person, item, started, device, position, playing, updated) SELECT id, 'ada', 'e-1', CAST(strftime('%s', 'now') AS INTEGER) - 30000, 'Strand · iPad', 900, 0, CAST(strftime('%s', 'now') AS INTEGER) - 29000 FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
/* The pin's centre against the device text's x-height centre, and the place's baseline against the device's (in px). A place too
   long for the rest of the line goes whole onto the next one, on its baseline: one line height lower. */
const lineUp = page => page.evaluate(() => {
  const line = document.querySelector('.where').closest('.on-device'), probe = () => {const mark = document.createElement('span'); mark.style.cssText = 'display:inline-block;width:0;height:1ex;vertical-align:baseline'; return mark;};
  const own = probe(), placed = probe(), lh = parseFloat(getComputedStyle(line).lineHeight); line.insertBefore(own, line.firstChild); document.querySelector('.where-text').prepend(placed);
  const pin = document.querySelector('.where-pin').getBoundingClientRect(), a = own.getBoundingClientRect(), b = placed.getBoundingClientRect(); own.remove(); placed.remove();
  const gap = b.bottom - a.bottom;
  return {pin: Math.abs(pin.top + pin.height / 2 - (a.top + a.height / 2)), text: Math.min(Math.abs(gap), Math.abs(gap - lh)), wrapped: gap > lh / 2};
});
const lined = async (page, label) => {const got = await lineUp(page); assert.ok(got.pin <= 1 && got.text <= 1, `${label}: pin and place line up with the device text (${JSON.stringify(got)})`);};
const where = async page => {
  await page.getByText('Paper Kites').waitFor(); await page.getByText('Small Engines').waitFor();
  // Only the parts played are filled in, with a mark where it is now; a skip or a pause gets one line.
  await page.getByText('Watched 40 of 50 min · skipped 5 min').waitFor(); assert.equal(await page.locator('.bar .part').count(), 2); assert.equal(await page.locator('.bar b').count(), 1);
  // Hovering a part says which was played first: here the later stretch, then a jump back to the start (with a moment ten
  // seconds on, as a skip-ahead tap leaves, shown as part of it).
  assert.deepEqual(await page.locator('.bar .part').evaluateAll(parts => parts.map(part => part.dataset.time)), ['1st · 25:00–45:00', '2nd · 0:00–20:15']);
  assert.equal(await page.getByText('skipped', {exact: false}).count(), 1, 'no line for a play with nothing to say');
  if (page === owner) {await page.getByText(/^3 episodes in a row (today|yesterday)$/).waitFor(); assert.match(await page.locator('.feed li', {hasText: 'Ada'}).first().textContent(), /6 titles · .* · pressed play 7 times/);}
  assert.equal(await page.locator('.feed li', {hasText: 'Season 1 · Episode 1'}).count(), 2, 'each sitting is its own entry');
  const pin = page.getByRole('button', {name: 'Where'}), text = page.locator('.where-text');
  assert.equal(await pin.count(), 1, 'a pin only for the play with a place'); assert.equal(await pin.getAttribute('aria-expanded'), 'false');
  assert.equal((await text.boundingBox())?.width ?? 0, 0, 'the place starts folded'); await lined(page, 'folded');
  await pin.click(); assert.equal(await pin.getAttribute('aria-expanded'), 'true'); assert.equal(await text.getAttribute('aria-hidden'), 'false');
  await text.filter({hasText: 'Lagos, NG · SpaceX'}).waitFor({state: 'visible'}); await page.waitForTimeout(400);
  assert.ok((await text.boundingBox()).width > 60, 'the place unfolds'); assert.ok(!(await text.textContent()).includes('Inc'), 'the network is said briefly'); await lined(page, 'unfolded');
  await pin.click(); assert.equal(await pin.getAttribute('aria-expanded'), 'false');
};
await guest.goto(BASE + '/#/me/activity'); await where(guest); await credit(guest); await shot(guest, '15-activity-own');
await owner.goto(BASE + '/#/activity'); await where(owner); await owner.getByRole('button', {name: 'Where'}).click(); await shot(owner, '16-activity-where');
// The same on a wide screen, folded and unfolded.
await owner.setViewportSize({width: 1280, height: 800}); await owner.reload(); await owner.mouse.move(0, 0); await where(owner);
assert.equal((await lineUp(owner)).wrapped, false, 'on a wide screen the place stays on the device line'); await owner.getByRole('button', {name: 'Where'}).click(); await owner.mouse.move(0, 0); await shot(owner, '16b-activity-where-wide');
await credit(owner); assert.equal(await owner.getByText('Test build').count(), 0, 'no test-build banner');
await owner.goto(BASE + '/#/hub/general'); await owner.getByRole('heading', {name: 'Background work'}).waitFor(); await shot(owner, '16c-general-wide'); await owner.setViewportSize({width: 390, height: 844});

// Back as the manager: Ada shows as joined, and the playback change stuck.
await owner.goto(BASE + '/#/person/ada/settings'); await owner.reload(); await owner.getByText(/Family · joined/).waitFor();
assert.equal(await owner.getByRole('switch', {name: 'Change playback'}).getAttribute('aria-checked'), 'true');
// Saving says so as soon as the hub has it. The apps catch up beside the page (held here until let go): a second change made
// meanwhile is saved at once and is still there when they are done, and a problem bringing them in step is said plainly.
const can = async () => owner.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people.find(person => person.id === 'ada').can);
// Whether her saved rows hold three For you places, all on.
const placesSaved = async () => owner.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people.find(person => person.id === 'ada').rows?.filter(row => /^for-you-/.test(row.id) && row.on).length === 3);
const was = await can(), apps = owner.locator('.toast .apps'), toggle = name => owner.getByRole('switch', {name}).click();
let letGo, answer = {state: 'ok'}, syncs = 0;
await owner.route('**/api/sync', async route => {syncs++; await new Promise(done => {letGo = done;}); await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(answer)});});
// Adding a row changes Home, so Add goes with Arrange: turning Arrange off holds Add off too.
assert.ok(was.arrange && was.add);
await toggle('Add their own rows'); await toast(owner).filter({hasText: 'Saved'}).waitFor(); await apps.filter({hasText: 'Apps catching up…'}).waitFor();
await toggle('Arrange their Home');
for (let i = 0; i < 40 && (await can()).arrange === was.arrange; i++) await owner.waitForTimeout(150);
assert.deepEqual(await can(), {...was, arrange: false, add: false}, 'both changes saved while the apps were still catching up');
assert.equal(syncs, 1, 'one run at a time'); letGo();
// The second change asked for one more run after the first.
for (let i = 0; i < 40 && syncs < 2; i++) await owner.waitForTimeout(100);
assert.equal(syncs, 2); letGo(); await apps.filter({hasText: 'Apps up to date'}).waitFor(); await shot(owner, '17-apps-up-to-date');
assert.equal(await owner.getByRole('switch', {name: 'Arrange their Home'}).getAttribute('aria-checked'), 'false', 'the page kept the second change');
assert.ok(await owner.getByRole('switch', {name: 'Add their own rows'}).isDisabled()); await owner.getByText('Turn on Arrange their Home first.').waitFor();
// Someone saved with Add on and Arrange off before the two went together (made here in the local database) gets no Add row: the
// hub would refuse what it adds.
sqlLocal(`UPDATE people SET data = json_set(data, '$.can.add', json('true')) WHERE id = 'ada'`);
await guest.goto(BASE + '/#/me/home'); await guest.reload(); await guest.locator('.rows li').first().waitFor();
assert.equal(await guest.getByRole('button', {name: '+ Add row'}).count(), 0, 'no Add row without Arrange');
answer = {state: 'error', message: 'AIOStreams did not answer. Your changes are saved here and will be sent on the next try.'};
await toggle('Arrange their Home'); await toast(owner).filter({hasText: 'Saved'}).waitFor();
for (let i = 0; i < 40 && syncs < 3; i++) await owner.waitForTimeout(100);
letGo(); await apps.filter({hasText: 'AIOStreams did not answer'}).waitFor(); await shot(owner, '17b-apps-note');
await owner.unroute('**/api/sync'); await apps.click(); assert.equal(await apps.count(), 0, 'a note goes when tapped');
await toggle('Add their own rows'); for (let i = 0; i < 40 && (await can()).add !== was.add; i++) await owner.waitForTimeout(150);
assert.deepEqual(await can(), was);
// For you rows come only where each person's apps use their own AIOMetadata setup, so here the page is told the hub has that. Add
// row offers another, saying how many are on Home. Someone who arranges but cannot add can remove one and bring it back from Not on
// Home.
await guest.route('**/api/state', async route => {const response = await route.fetch(), body = await response.json(); body.hub.front = true; await route.fulfill({response, json: body});});
await guest.reload(); const places = guest.locator('.rows .row', {has: guest.locator('h3', {hasText: /^For you$/})}); await places.first().waitFor(); assert.equal(await places.count(), 3);
const offered = await adding(guest, '6f-add-row-for-you');
await offered.getByRole('button', {name: /^Another For you row\s*Picked for you every day, from what you watch · 3 on Home$/}).waitFor(); await offered.getByRole('button', {name: 'Close'}).click();
await toggle('Add their own rows'); for (let i = 0; i < 40 && (await can()).add; i++) await owner.waitForTimeout(150);
await guest.reload(); await places.first().waitFor(); assert.equal(await guest.getByRole('button', {name: '+ Add row'}).count(), 0);
await places.first().getByRole('button', {name: 'Remove'}).click(); await toast(guest).filter({hasText: 'Removed a For you row'}).waitFor(); assert.equal(await places.count(), 2);
await guest.locator('.off').evaluate(list => {list.open = true;});
await guest.locator('.off li', {has: guest.locator('h3', {hasText: /^For you$/})}).getByRole('button', {name: 'Show'}).click(); await toast(guest).filter({hasText: '“For you” is on Home'}).waitFor();
assert.equal(await places.count(), 3); await guest.unroute('**/api/state');
// Saved with all three on. Her saves moved her version on, so the manager's page reads it again before the next change.
for (let i = 0; i < 40 && !(await placesSaved()); i++) await owner.waitForTimeout(150);
assert.ok(await placesSaved(), 'the place shown again is saved'); await owner.reload(); await owner.getByRole('switch', {name: 'Add their own rows'}).waitFor(); await toggle('Add their own rows'); for (let i = 0; i < 40 && !(await can()).add; i++) await owner.waitForTimeout(150);
assert.deepEqual(await can(), was);
// On her own Home the rows that change on their own say when (times made here, an hour ago, as this hub picks nothing): For you
// places when they change next, or that they are kept; My Trakt lists when it was checked; rows always current say nothing.
// Each one's Edit sheet asks the hub for something now, answered here too. Nothing is saved while these made-up rows are shown.
const hourAgo = Math.floor(Date.now() / 1000) - 3600, seen = Math.floor(Date.now() / 1000) - 2 * 86400, shelfRow = {id: 'trakt-lists', title: 'My Trakt lists', kind: 'Collection · 2 lists', source: 'Trakt · all your lists', origin: 'own', on: true};
// Her For you today, as the hub tells it: each place's pick and what it came from, six other options, two kinds with nothing.
const forYouDetail = {places: {'for-you-1': {key: 'because:m27205', kind: 'because', name: 'Because you watched Inception', why: {title: 'Inception', seen}, seed: 'm27205'},
    'for-you-2': {key: 'series:263', kind: 'series', name: 'Next in The Dark Knight', why: {title: 'The Dark Knight', seen, more: 2}, seed: 'm155', keep: true}, 'for-you-3': {key: 'popular:movie', kind: 'popular', name: 'Popular movies lately'}},
  options: [{key: 'crew:525', kind: 'crew', name: 'More from Christopher Nolan', why: {title: 'Inception', seen, who: 'Christopher Nolan'}, seed: 'm27205'}, {key: 'genres:18', kind: 'genres', name: 'Drama movies for you', why: {title: 'Drama'}},
    {key: 'different:37', kind: 'different', name: 'Something different: Western movies', why: {title: 'Western'}}, {key: 'top10:movie', kind: 'top10', name: 'Top 10 movies on Netflix in Nigeria', why: {title: 'Nigeria'}},
    {key: 'because:s1396', kind: 'because', name: 'Because you watched Breaking Bad', why: {title: 'Breaking Bad', seen: seen - 3 * 86400}, seed: 's1396'}, {key: 'because:m550', kind: 'because', name: 'Because you watched Fight Club', why: {title: 'Fight Club', seen: seen - 9 * 86400}, seed: 'm550'}],
  none: {pickup: 'none', seasonal: 'off'}, never: [{seed: 'm680', title: 'Pulp Fiction'}]};
const forYouState = shelf => async route => {const response = await route.fetch(), body = await response.json(), me = body.hub.people[0]; body.hub.front = true; body.hub.forYouHour = 5;
  Object.assign(me, {...(shelf ? {rows: [shelfRow, ...me.rows], shelfAt: hourAgo} : {}), pickedAt: hourAgo, forYouDetail, forYou: {'for-you-1': 'Because you watched Inception', 'for-you-2': 'Next in The Dark Knight', 'for-you-3': 'Popular movies lately'}, forYouKinds: {'for-you-1': 'because', 'for-you-2': 'series', 'for-you-3': 'popular'}});
  await route.fulfill({response, json: body}).catch(() => {});};
await guest.route('**/api/state', forYouState(true));
const askedNow = [];
for (const path of ['**/api/people/ada/foryou/*', '**/api/people/ada/shelf']) await guest.route(path, route => {askedNow.push([new URL(route.request().url()).pathname, route.request().postDataJSON()]); return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});});
await guest.reload(); const rowOf = title => guest.locator('.rows .row', {has: guest.locator('h3', {hasText: new RegExp(`^${title}`)})});
await rowOf('My Trakt lists').getByText(/^Trakt · Lists checked (yesterday )?at .+ · next check (today|tomorrow)$/).waitFor();
await rowOf('Because you watched Inception').getByText(/^For you · changes ((tomorrow )?at .+|soon)$/).waitFor();
await rowOf('Next in The Dark Knight').getByText('For you · kept', {exact: true}).waitFor();
await rowOf('Popular movies lately').getByText('For you · Popular, until there’s more to go on').waitFor();
assert.ok(!/picked|checked|changes/.test(await rowOf('Trending Movies').locator('p').first().textContent()), 'a row always current says nothing of times');
await rowOf('My Trakt lists').scrollIntoViewIfNeeded(); await shot(guest, '18-home-times');
// A For you row's sheet, top to bottom: what it is and why, the day's other options (five), the kinds with nothing today and why,
// keeping it, and less like it.
const placeSheet = guest.getByRole('dialog', {name: 'Because you watched Inception'});
await rowOf('Because you watched Inception').getByRole('button', {name: 'Edit'}).click();
await placeSheet.getByText(/^You watched it on [A-Z][a-z]+day\.$/).waitFor(); await placeSheet.getByText(/^Because you watched · changes ((tomorrow )?at .+|soon)$/).waitFor();
assert.equal(await placeSheet.locator('.options li').count(), 5, 'five other options');
await placeSheet.getByRole('button', {name: /^More from Christopher Nolan\s*More from a director · Christopher Nolan directed Inception, which you watched on [A-Z][a-z]+day\.$/}).waitFor();
await placeSheet.getByRole('button', {name: /^Something different: Western movies\s*Well liked, and not a genre you’ve been watching\.$/}).waitFor();
await placeSheet.getByText('Not available today').click(); await placeSheet.locator('.none li', {hasText: 'Pick back up'}).getByText('Nothing left partway in the last year').waitFor(); await placeSheet.locator('.none li', {hasText: 'Seasonal'}).getByText('Switched off').waitFor();
const sheetShots = async name => {if (!shots) return; for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await guest.waitForTimeout(300); const body = guest.locator('.sheet-body');
  await body.evaluate(element => {element.scrollTop = 0;}); await guest.screenshot({path: `${shots}/real-${name}-${width < 600 ? 'phone' : 'wide'}.png`});
  await body.evaluate(element => {element.scrollTop = element.scrollHeight;}); await guest.screenshot({path: `${shots}/real-${name}-${width < 600 ? 'phone' : 'wide'}-end.png`});} await guest.setViewportSize({width: 390, height: 844});};
await placeSheet.getByRole('button', {name: 'Keep this one'}).waitFor(); await placeSheet.getByRole('button', {name: 'Not from Inception again'}).waitFor(); await placeSheet.getByRole('button', {name: 'Less “Because you watched”'}).waitFor();
await sheetShots('18b-for-you-sheet');
await placeSheet.getByRole('button', {name: /^Drama movies for you/}).click(); await toast(guest).filter({hasText: '“Drama movies for you” is on this row now. Your apps have it in a few minutes.'}).waitFor();
await rowOf('Because you watched Inception').getByRole('button', {name: 'Edit'}).click(); await placeSheet.getByRole('button', {name: 'Keep this one'}).click(); await toast(guest).filter({hasText: 'Kept. It stays until you let it change.'}).waitFor();
// The kept row offers to let it change again; a title left out goes for good.
const keptSheet = guest.getByRole('dialog', {name: 'Next in The Dark Knight'});
await rowOf('Next in The Dark Knight').getByRole('button', {name: 'Edit'}).click(); await keptSheet.getByRole('button', {name: 'Let it change again'}).waitFor(); assert.match(await keptSheet.locator('.why').evaluate(element => element.firstChild.textContent), /^You watched The Dark Knight on [A-Z][a-z]+day\. 2 more films in the series are out\.$/);
if (shots) await guest.screenshot({path: `${shots}/real-18d-for-you-kept-phone.png`}); await keptSheet.getByRole('button', {name: 'Not from The Dark Knight again'}).click(); await toast(guest).filter({hasText: 'Nothing more from “The Dark Knight”. Your apps have it in a few minutes.'}).waitFor();
await rowOf('My Trakt lists').getByRole('button', {name: 'Edit'}).click(); await guest.getByRole('button', {name: 'Check my lists now'}).waitFor(); await shot(guest, '18c-check-lists');
await guest.getByRole('button', {name: 'Check my lists now'}).click(); await toast(guest).filter({hasText: 'Checking your lists. Your apps have them in a few minutes.'}).waitFor();
assert.deepEqual(askedNow, [['/api/people/ada/foryou/for-you-1', {use: 'genres:18'}], ['/api/people/ada/foryou/for-you-1', {keep: true}], ['/api/people/ada/foryou/for-you-2', {never: true}], ['/api/people/ada/shelf', {}]]);
await guest.unrouteAll({behavior: 'wait'}); await guest.reload(); await guest.locator('.rows li').first().waitFor(); assert.equal(await rowOf('My Trakt lists').count(), 0);
// Less of a kind moves it one step down her own order of kinds; under For you she drags the kinds into order, switches them, says
// how far back Because you watched looks, lets a title left out count again, and resets all of it to her group's.
await guest.route('**/api/state', forYouState(false)); askedNow.length = 0;
await guest.route('**/api/people/ada/foryou/*', route => {askedNow.push([new URL(route.request().url()).pathname, route.request().postDataJSON()]); return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});});
const adaSettings = () => owner.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people.find(person => person.id === 'ada').settings);
const saved = async (check, what) => {let got; for (let i = 0; i < 40 && !check(got = await adaSettings()); i++) await owner.waitForTimeout(150); assert.ok(check(got), `${what}: ${JSON.stringify(got)}`);};
await guest.reload(); await rowOf('Because you watched Inception').getByRole('button', {name: 'Edit'}).click(); await placeSheet.getByRole('button', {name: 'Less “Because you watched”'}).click();
await toast(guest).filter({hasText: 'Because you watched moves down. Picks change in a few minutes.'}).waitFor();
await saved(got => got.forYouOrder?.join() === 'series,pickup,crew,because,genres,seasonal,top10,different', 'one step down');
const kinds = guest.locator('ol.kinds'), kindNames = () => kinds.locator('li strong').allTextContents();
await kinds.scrollIntoViewIfNeeded(); assert.deepEqual(await kindNames(), ['Next in a movie series', 'Pick back up', 'More from a director', 'Because you watched', 'Your genres', 'Seasonal', 'Top 10', 'Something different']);
await guest.locator('.setting', {hasText: 'Not picked from'}).getByText('Pulp Fiction').waitFor();
// Dragged by its handle, Something different goes to the top.
const grip = kinds.getByRole('button', {name: 'Move Something different'}), top = kinds.locator('li').first();
const [from, to] = [await grip.boundingBox(), await top.boundingBox()];
await guest.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await guest.mouse.down();
for (let step = 1; step <= 12; step++) {await guest.mouse.move(from.x + from.width / 2, from.y + (to.y + 4 - from.y) * step / 12); await guest.waitForTimeout(30);}
await guest.mouse.up();
await saved(got => got.forYouOrder?.[0] === 'different', 'dragged to the top'); assert.equal((await kindNames())[0], 'Something different');
await kinds.getByRole('switch', {name: 'Top 10'}).click(); await saved(got => got.forYouOff?.includes('top10'), 'Top 10 off');
await kinds.getByRole('radio', {name: 'From any time'}).click(); await saved(got => got.forYouBecause === 'any', 'from any time');
const kindsCard = guest.locator('.setting', {hasText: 'Kinds of pick'});
if (shots) {const hidden = await guest.addStyleTag({content: '.toast { visibility: hidden !important; }'}); for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await kindsCard.scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await kindsCard.screenshot({path: `${shots}/real-19-kinds-of-pick-${width < 600 ? 'phone' : 'wide'}.png`});
  await guest.locator('.setting', {hasText: 'Not picked from'}).screenshot({path: `${shots}/real-19b-not-picked-from-${width < 600 ? 'phone' : 'wide'}.png`});} await hidden.evaluate(element => element.remove()); await guest.setViewportSize({width: 390, height: 844});}
await guest.locator('.setting', {hasText: 'Not picked from'}).getByRole('button', {name: 'Count again'}).click(); await toast(guest).filter({hasText: '“Pulp Fiction” counts again from the next pick'}).waitFor();
assert.deepEqual(askedNow, [['/api/people/ada/foryou/never', {seed: 'm680'}]]);
await kindsCard.getByRole('button', {name: /^Reset Kinds of pick/}).click(); await saved(got => !('forYouOrder' in got) && !('forYouOff' in got) && !('forYouBecause' in got), 'reset');
await guest.unrouteAll({behavior: 'wait'}); await guest.reload(); await guest.locator('.rows li').first().waitFor();
// The manager's Background work: a My Trakt lists row asked for again (0) is under way, never "next run 1 Jan 1970". (Going to the
// page and reloading cancels the first read, whose answer is then left unsent.)
await owner.route('**/api/state', async route => {const response = await route.fetch(), body = await response.json(); body.hub.front = true; Object.assign(body.hub.jobs, {shelfDue: 0, shelves: 1, shelved: hourAgo}); await route.fulfill({response, json: body}).catch(() => {});});
await owner.goto(BASE + '/#/hub/general'); await owner.reload(); const listsJob = owner.locator('.jobs li', {hasText: 'My Trakt lists rows'});
await listsJob.getByText('under way').waitFor(); await listsJob.getByText('every day, and when someone asks').waitFor(); await listsJob.scrollIntoViewIfNeeded(); await shot(owner, '16d-background-under-way');
await owner.unroute('**/api/state');
await owner.goto(BASE + '/#/account'); await owner.getByRole('button', {name: 'New codes'}).click(); await owner.locator('.codes li').nth(9).waitFor(); await shot(owner, '9-codes');
const state = await owner.evaluate(() => fetch('/api/state').then(answer => answer.text()));
assert.ok(!state.includes(password) && !state.includes('tb-key') && !state.includes('tmdb-key') && !state.includes(link.split('/join/')[1]) && JSON.parse(state).hub.defaults.quality === 'best', 'state leaks or did not save');
// Sign out, then back in with the hub code and password.
await owner.keyboard.press('Escape'); await owner.getByRole('button', {name: 'Sign out'}).click(); await owner.getByRole('heading', {name: 'Sign in'}).waitFor();
assert.equal(await owner.getByLabel('Hub code').inputValue(), hubCode, 'sign-in should remember the hub code on this browser');
await owner.getByLabel('Password').fill('correct horse'); await owner.getByRole('button', {name: 'Sign in'}).click(); await owner.getByText('Add someone to Family').waitFor();
// A message that appears while a sheet is open must sit above the sheet's dimmed, blurred backdrop, and the button must not fire twice.
await owner.goto(BASE + '/#/account'); await owner.getByRole('button', {name: 'Change', exact: true}).click();
await owner.getByLabel('Current password').fill('not the one'); await owner.getByLabel('New password').fill('long enough now');
await owner.getByRole('button', {name: 'Change password'}).click(); await toast(owner).filter({hasText: 'not your current password'}).waitFor();
// (The toast lets clicks through, so it cannot be hit-tested; being open in the browser's top layer after the sheet is what puts it above.)
assert.ok(await owner.evaluate(() => document.querySelector('.toast').matches(':popover-open') && !!document.querySelector('dialog[open]')), 'toast is not raised above the sheet');
if (shots) await owner.screenshot({path: `${shots}/real-10-toast-over-sheet.png`});
// A passkey, made by a stand-in authenticator inside the browser: add it on the account page, sign out, come back in with it alone.
const authenticator = await owner.context().newCDPSession(owner); await authenticator.send('WebAuthn.enable');
await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
await owner.keyboard.press('Escape'); await owner.goto(BASE + '/#/account'); await owner.locator('li', {hasText: 'Add a passkey'}).getByRole('button', {name: 'Add'}).click();
await toast(owner).filter({hasText: 'Passkey added'}).waitFor(); await owner.locator('.accounts li', {hasText: /^.*Added \d{4}-/}).first().waitFor(); if (shots) await owner.screenshot({path: `${shots}/real-11-passkey.png`});
await owner.getByRole('button', {name: 'Sign out'}).click(); await owner.getByRole('heading', {name: 'Sign in'}).waitFor();
await owner.getByRole('button', {name: 'Use a passkey'}).click(); await owner.getByText('Add someone to Family').waitFor();
// A copy of Ada is someone new: their page never shows Ada's invite link, not even for a moment while the copy is saved.
await owner.goto(BASE + '/#/person/ada/settings'); await owner.locator('.share-text code').first().waitFor();
await owner.locator('.setting', {hasText: 'Make a copy'}).getByRole('button', {name: 'Copy'}).click(); await owner.getByRole('dialog').getByRole('textbox').fill('Ada Two'); await owner.getByRole('dialog').getByRole('textbox').press('Enter');
// The address changes a moment before the page is drawn: the copy's page is the one headed with its name.
await owner.waitForURL(/#\/person\/ada-two/); await owner.getByRole('heading', {name: 'Ada Two', exact: true}).waitFor(); for (let i = 0; i < 20; i++) {const shown = await owner.locator('.share-text code').allTextContents(); assert.ok(!shown.includes(link), `the copy shows its own link, never Ada's (at ${owner.url().split('#')[1]}, try ${i}, shown ${JSON.stringify(shown.map(item => item.slice(-12)))}, Ada's ends ${link.slice(-12)})`); await owner.waitForTimeout(150);}
console.log('browser flow ok; page errors:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
