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
const sqlLocal = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', command], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
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
  // What her MDBList holds when progress moves back here: nothing, unless it is made not to answer (`mdblistDown`).
  if (!mdblistDown && /^\/mdblist\/sync\/(watched|playback)/.test(request.url)) return send(200, request.url.includes('playback') ? [] : {movies: [], episodes: []});
  request.socket.destroy(); // as if nothing were there
}).listen(8798, '127.0.0.1').unref();

// Trakt's two hosts, as the page meets them: its sign-in page (signs in at once and goes back with a code), its token exchange
// (busy once, then the login, only for the proof that matches), and the API's account details. The real sign-in host refuses a
// page's Trakt API headers, so this one does too.
const signins = [];
let mdblistDown = false;
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
await job('Trakt sync').getByText('For everyone every 5 min; for one person as they play', {exact: true}).waitFor();
await job('Trakt sync').getByText(/^Ran today at \d/).waitFor(); await job('Trakt sync').getByText(/^next run in \d min$/).waitFor();
await job('Trakt matching').getByText('For everyone, each person every 20 min; for one person at once when they turn it on', {exact: true}).waitFor(); await job('Trakt matching').getByText('Nobody has it on yet').waitFor(); await job('Trakt matching').getByText('once someone turns it on').waitFor();
await job('Trakt and MDBList check').getByText(/^For everyone every day at \d.+; for one person when they press Check again$/).waitFor(); await job('Trakt and MDBList check').getByText('Not run yet').waitFor(); await job('Trakt and MDBList check').getByText(/^next run (today|tomorrow)$/).waitFor();
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

// Accounts, on her own page: Trakt and MDBList, each with one Connect, then where her progress is kept (here, until she has MDBList
// keep it).
await guest.goto(BASE + '/#/me/accounts'); const trakt = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'Trakt', exact: true})});
await trakt.getByText('is added to your Trakt as it plays', {exact: false}).waitFor(); assert.equal(await guest.getByText('Trakt history').count(), 0);
// MDBList is an account like Trakt, optional; with none connected there is nothing to choose for progress.
const mdb = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'MDBList', exact: true})}).first();
await mdb.getByText('Keep your progress there and rows can hide what you’ve watched.', {exact: false}).waitFor(); assert.equal(await guest.getByRole('switch', {name: 'Keep my progress in MDBList'}).count(), 0);
await guest.getByText('Your progress is kept on this hub. Connect MDBList to keep it there instead.').waitFor();
await shot(guest, '12-accounts');
// Connect asks for her key; Cancel before saving leaves nothing changed.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').waitFor();
await mdb.getByRole('button', {name: 'Cancel'}).click(); assert.equal(await guest.getByLabel('MDBList API key').count(), 0);
// Connecting Trakt: off to Trakt's sign-in and back to this page, which finishes it with Trakt (busy at first) and says so.
await traktIn(guest.context());
await trakt.getByRole('button', {name: 'Connect'}).click(); await trakt.getByText('Trakt is busy, trying again…').waitFor();
await toast(guest).filter({hasText: 'Trakt connected as adatrakt'}).waitFor(); await trakt.getByText('Connected as adatrakt').waitFor();
assert.equal(new URL(guest.url()).hash, '#/me/accounts', 'back where Connect was pressed, with nothing from Trakt left in the address');
// Signed in herself, she is asked at once, on the Trakt card, whether it is kept matching (on to start with). Nothing watched here
// yet, so there is no tick for earlier plays. The question stays until she answers, through a reload too.
const consent = trakt.locator('.consent');
await consent.getByText('Keep Trakt and this hub matching.').waitFor(); assert.equal(await consent.getByRole('checkbox').count(), 1); assert.equal(await consent.getByRole('checkbox').isChecked(), true);
assert.equal(await consent.getByRole('button', {name: 'Not now'}).count(), 0); await trakt.scrollIntoViewIfNeeded(); await shot(guest, '12d-trakt-consent-phone');
await guest.reload(); await consent.getByText('Keep Trakt and this hub matching.').waitFor();
// With earlier plays to offer (made here directly in the local database), the second tick says how many, and starts off.
sqlLocal("INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'old-1', 'Old Film', 'Movie', 6000, 6000, 'Strand · Mac', 0, 1000, '' FROM hubs");
await guest.reload(); await consent.getByText('Also add the 1 thing you watched here before connecting. Trakt can’t undo this in one go.').waitFor();
assert.equal(await consent.getByRole('checkbox').nth(1).isChecked(), false); await trakt.scrollIntoViewIfNeeded(); await shot(guest, '12e-trakt-consent-earlier-phone');
await guest.setViewportSize({width: 1280, height: 900}); await trakt.scrollIntoViewIfNeeded(); await shot(guest, '12e-trakt-consent-earlier-wide'); await guest.setViewportSize({width: 390, height: 844});
sqlLocal("DELETE FROM plays WHERE item = 'old-1'");
// She ticks both: catching up starts at once, a pass at a time, saying how far it has got (the first pass is answered here and the
// next held a moment, so the line can be seen).
let passGo; const held = new Promise(done => {passGo = done;}), passed = {n: 0}, passAt = /\/api\/people\/ada\/matching\/pass$/;
const passing = async route => {if (++passed.n === 1) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({trakt: 12, home: 0, left: 25, more: true})}); await held; return route.continue();};
await guest.route(passAt, passing); await consent.getByRole('checkbox').nth(1).check();
await consent.getByRole('button', {name: 'Done'}).click(); await toast(guest).filter({hasText: 'Trakt and your progress are kept matching'}).waitFor();
await trakt.getByText('Adding 12 of 37 to Trakt. You can keep watching.').waitFor(); await guest.waitForTimeout(600); assert.equal(passed.n, 2, 'one round of passes, not two');
await trakt.scrollIntoViewIfNeeded(); await shot(guest, '12h-trakt-adding-phone'); passGo();
await trakt.getByText(/^Matching\. (First check in a few minutes|Catching up now)\./).waitFor(); assert.equal(await trakt.locator('.consent').count(), 0); await guest.unroute(passAt, passing);
// Change opens the same question, as it stands, to turn it off or add earlier plays later; Cancel leaves it.
await trakt.getByRole('button', {name: 'Change'}).click(); await consent.getByText('Keep Trakt and this hub matching.').waitFor(); await consent.getByRole('button', {name: 'Cancel'}).click();
assert.equal(await trakt.locator('.consent').count(), 0); assert.equal(passed.n, 2);
// Once a good pass has run, when; three days without one, why, and Try again.
sqlLocal(`UPDATE sync SET good = ${Math.floor(Date.now() / 1000)}`); await guest.reload(); await trakt.getByText(/^Matching\. Last checked today at /).waitFor(); await trakt.scrollIntoViewIfNeeded(); await shot(guest, '12f-trakt-matching-phone');
sqlLocal(`UPDATE sync SET failing = ${Math.floor(Date.now() / 1000) - 4 * 86400}, why = 'Trakt is busy right now.'`); await guest.reload();
await trakt.getByText(/^Trakt hasn’t taken updates since \w+\. Your watching is still being saved here\./).waitFor(); await trakt.getByRole('button', {name: 'Try again'}).waitFor(); await shot(guest, '12g-trakt-stuck-phone');
// Turned off (as for someone connected before this, or by their manager): Turn on asks the same question, which can wait.
sqlLocal('UPDATE sync SET matching = 0, failing = NULL'); await guest.reload(); await trakt.getByText('Trakt can stay matched by itself.').waitFor();
await trakt.getByRole('button', {name: 'Turn on'}).click(); await consent.getByText('Keep Trakt and this hub matching.').waitFor(); await consent.getByRole('button', {name: 'Not now'}).click(); await trakt.getByText('Trakt can stay matched by itself.').waitFor();
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
// How her progress compares with Trakt, on her own page, while matching is off (with it on, nothing is looked at until she asks).
// What each pair holds is put in the hub's six-hour keep here (no player setups run in this test, so nothing could be looked at);
// copying across is tested in tests/aiom.test.mjs.
const iso = days => new Date(Date.now() - days * 86400e3).toISOString(), keep = {};
const play = (key, title, detail, days, cells, extra = {}) => ({key, title, detail, at: iso(days), here: 'none', trakt: 'none', lists: 'none', ...cells, ...extra});
const holds = (pair, lines) => {keep[pair] = {at: Math.floor(Date.now() / 1000), look: {lines, more: false, unmatched: 0, already: 0}}; sqlLocal(`INSERT INTO drift (hub, person, day, here, here_at) SELECT id, 'ada', '', '${JSON.stringify(keep)}', 0 FROM hubs WHERE true ON CONFLICT (hub, person) DO UPDATE SET here = excluded.here`);};
const progress = guest.locator('.accounts.progress'), both = async (page, name, part = progress) => {await part.scrollIntoViewIfNeeded(); await shot(page, `${name}-phone`); await page.setViewportSize({width: 1280, height: 900}); await part.scrollIntoViewIfNeeded(); await shot(page, `${name}-wide`); await page.setViewportSize({width: 390, height: 844});};
const columns = async () => (await progress.locator('.trackers-cols span').allTextContents()).join(' | '), show = () => progress.getByRole('button', {name: 'Show what’s different'}).click();
// The hub's answer to a look at a pair, made to fail the first `times` asks as a busy service does, then passed on as it is.
const refuse = async (pair, times, message) => {
  let asked = 0; const at = new RegExp(`/api/people/ada/compare/${pair}(\\?|$)`), answer = route => ++asked <= times ? route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({message})}) : route.continue();
  await guest.route(at, answer); return {asked: () => asked, done: () => guest.unroute(at, answer)};
};
// Progress here, Trakt connected: what never reached Trakt, what was watched elsewhere, a spot Trakt holds. One line and one button;
// each play only behind Show what's different.
holds('here-trakt', [play('w:show/60574:5:2', 'Peaky Blinders', 'Season 5 · Episode 2', 0.5, {here: 'has', trakt: 'add'}), play('i:show/83867:2:4', 'Andor', 'Season 2 · Episode 4', 5, {here: 'add', trakt: 'has'}, {elsewhere: true}),
  play('ip:movie/693134', 'Dune: Part Two', 'Movie', 8, {here: 'add', trakt: 'has'}, {elsewhere: true, pct: 42})]);
await guest.reload(); await progress.getByText('1 thing is missing from Trakt and 2 from this hub.').waitFor(); await progress.getByRole('button', {name: 'Add them'}).waitFor();
assert.equal(await progress.locator('.plays').count(), 0, 'each play only behind Show what’s different'); await both(guest, '13-progress-here-trakt');
await show(); assert.equal(await columns(), 'This hub | Trakt'); await progress.getByText('· watched elsewhere').first().waitFor(); await progress.getByText('partway').waitFor();
const andor = progress.getByRole('button', {name: 'Add Andor S2E4'}); await andor.click(); assert.equal(await andor.getAttribute('aria-pressed'), 'false');
await both(guest, '13a-progress-here-trakt-open'); await andor.click();
// A look that fails is asked once more by itself first: a busy moment passes unseen.
let refused = await refuse('here-trakt', 1, 'Trakt is busy right now.');
await guest.reload(); await progress.getByText('1 thing is missing from Trakt and 2 from this hub.').waitFor(); assert.equal(refused.asked(), 2); assert.equal(await progress.getByText('couldn’t', {exact: false}).count(), 0); await refused.done();
// Everything matching: one line, with when. Failing twice on Check again, it stays, says why, and that her watching is still being saved.
holds('here-trakt', []); await guest.reload(); await progress.getByText(/^Everything matches\. Checked today at /).waitFor(); await both(guest, '13h-progress-matches');
refused = await refuse('here-trakt', 2, 'Trakt is busy right now.'); await progress.getByRole('button', {name: 'Check again'}).click();
await progress.getByText('Couldn’t check everything just now. Trakt is busy, so we couldn’t compare just now. Your watching is still being saved.').waitFor(); assert.equal(refused.asked(), 2);
await both(guest, '13j-progress-not-checked-again');
await progress.getByRole('button', {name: 'Try again'}).click(); await progress.getByText('Couldn’t check').waitFor({state: 'detached'}); assert.equal(refused.asked(), 3); await refused.done();
// Nothing kept, and Trakt not answering the hub (nothing does, in this test): said as such, never "matches", with Try again.
sqlLocal('UPDATE drift SET here = NULL'); await guest.reload();
await progress.getByText('Trakt is busy, so we couldn’t compare just now. Your watching is still being saved.').waitFor(); assert.equal(await progress.getByText('Everything matches').count(), 0);
await progress.getByRole('button', {name: 'Try again'}).waitFor(); await both(guest, '13l-progress-failed');
// Connecting MDBList saves the key; keeping her progress there is its one switch, off to start with.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').fill('ada-mdblist-key');
await guest.getByRole('button', {name: 'Save'}).click(); await toast(guest).filter({hasText: 'MDBList connected'}).waitFor();
const keepIn = guest.getByRole('switch', {name: 'Keep my progress in MDBList'}); await keepIn.waitFor(); assert.equal(await keepIn.getAttribute('aria-checked'), 'false');
await mdb.getByText('Rows can then hide what you’ve watched.').waitFor(); await progress.getByText('Your progress is kept on this hub.', {exact: false}).waitFor();
await both(guest, '12b-mdblist-connected', mdb);
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
// Turning it on copies what was watched here that MDBList lacks, a pass at a time, saying how far it has got, then switches.
// (The first pass is answered here, and the next held a moment, so the line can be seen.)
let release; const hold = new Promise(done => {release = done;}), passes = {n: 0}, moveTo = /\/api\/people\/ada\/compare\/here-mdblist$/;
const copying = async route => {if (++passes.n === 1) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({added: 12, unmatched: 0, more: true, left: 28, switched: false})}); await hold; return route.continue();};
await guest.route(moveTo, copying);
await keepIn.click(); await mdb.getByText('Copying 12 of 40 to MDBList. You can keep watching.').waitFor(); assert.equal(await keepIn.getAttribute('aria-checked'), 'true');
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, false, 'not switched yet');
await both(guest, '13e-mdblist-copying', mdb); release();
await mdb.getByText('Done. Your progress is now kept in MDBList.').waitFor(); await toast(guest).filter({hasText: 'Progress kept in MDBList'}).waitFor(); await guest.unroute(moveTo, copying);
await progress.getByText('Your progress is kept in your MDBList.').waitFor(); await both(guest, '13f-mdblist-done', mdb);
// Turning it off copies back what only MDBList has, then switches back. MDBList not answering stops it and says why; Try again
// carries on from there.
mdblistDown = true; await keepIn.click();
await mdb.getByText('Copying back here stopped: MDBList isn’t taking requests from your key right now. If this lasts a day, paste a new key.', {exact: false}).waitFor(); await both(guest, '13g-mdblist-stopped', mdb);
mdblistDown = false; await mdb.getByRole('button', {name: 'Try again'}).click();
await mdb.getByText('Done. Your progress is now kept on this hub.').waitFor(); assert.equal(await keepIn.getAttribute('aria-checked'), 'false');
await progress.getByText('Your progress is kept on this hub.', {exact: false}).waitFor();
// The manager's switch goes the same way: copied first, then switched; nothing to paste, and her Trakt matching stays hers.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload();
await owner.getByText('Trakt can stay matched by itself. Only Ada can turn that on, from their own page.').waitFor(); assert.equal(await owner.getByRole('button', {name: 'Turn on'}).count(), 0);
await owner.getByRole('switch', {name: 'Keep Ada’s progress in MDBList'}).click(); await owner.getByText('Done. Their progress is now kept in MDBList.').waitFor();
assert.equal(await owner.getByLabel('MDBList API key').count(), 0);
await owner.getByText('It’s theirs, so it isn’t shown here.', {exact: false}).waitFor(); assert.equal(await owner.locator('div.trackers').count(), 0); await shot(owner, '14-accounts-manager');
// With an MDBList key the lists for children are offered too: folded, at the end of the ready-made rows, without a content limit.
// The manager's view of her Home says why her own lists are not there.
await owner.goto(BASE + '/#/person/ada/home'); await owner.reload();
const keyed = await adding(owner, '6e-add-row-with-key'), young = keyed.locator('details.pick-section');
assert.equal(await young.locator('summary').textContent(), 'For children 4'); assert.equal(await young.evaluate(fold => fold.open), false);
assert.equal(await keyed.locator('.pick-section').last().locator('summary').count(), 1, 'for children comes last');
await keyed.getByRole('button', {name: /^Star Wars/}).waitFor(); await keyed.getByText('Their own Trakt and MDBList lists stay private', {exact: false}).waitFor();
await young.locator('summary').click(); assert.deepEqual(await young.locator('li strong').allTextContents(), ['Kids’ Movies, around 7', 'Kids’ Shows, around 7', 'Movies for 9 to 12', 'Kids’ Shows, up to 12']);
await keyed.getByRole('button', {name: 'Close'}).click();
// Progress in MDBList, Trakt connected: what was watched here before MDBList kept it, the daily look, and paused spots, in one line.
holds('here-mdblist', [play('w:show/66276:6:6', 'Slow Horses', 'Season 6 · Episode 6', 15, {here: 'has', lists: 'add'}), play('w:movie/603', 'The Matrix', 'Movie', 20, {here: 'has', lists: 'add'})]);
holds('mdblist-trakt', [play('pt:movie/550', 'Fight Club', 'Movie', 1, {trakt: 'has', lists: 'add'}, {pct: 35})]);
const drift = JSON.stringify({since: 0, trakt: 3, mdblist: 2, toMdblist: [{kind: 'show', tmdb: 1396, name: 'Breaking Bad', season: 1, episode: 2, at: 1763000000}], toTrakt: [{kind: 'movie', tmdb: 680, name: 'Pulp Fiction', at: 1762900000}]});
sqlLocal(`UPDATE drift SET result = '${drift}', at = ${Math.floor(Date.now() / 1000)}, day = '2026-06-01'`);
await guest.reload(); await progress.getByText('1 thing is missing from Trakt and 4 from your MDBList.').waitFor(); await progress.getByRole('button', {name: 'Add them'}).waitFor();
await show(); assert.equal(await columns(), 'MDBList | Trakt'); await progress.getByText('· watched here').first().waitFor();
const pulpLine = progress.getByRole('button', {name: 'Add Pulp Fiction Movie'}); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'true');
assert.equal(await pulpLine.locator('.arrow').textContent(), '→', 'MDBList has it, Trakt gets it');
await pulpLine.click(); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'false');
await both(guest, '13b-progress-mdblist-trakt-open');
await pulpLine.press('Enter'); assert.equal(await pulpLine.getAttribute('aria-pressed'), 'true');
// Nothing missing: one line.
holds('here-mdblist', []); holds('mdblist-trakt', []); sqlLocal(`UPDATE drift SET result = '${JSON.stringify({since: 0, trakt: 3, mdblist: 3, toMdblist: [], toTrakt: []})}'`);
await guest.reload(); await progress.getByText(/^Everything matches\. Checked today at /).waitFor(); await both(guest, '13d-progress-mdblist-matches');
// A failed look at what is left from here no longer goes unsaid.
const listsBusy = 'MDBList isn’t taking requests from your key right now. If this lasts a day, paste a new key.';
refused = await refuse('here-mdblist', 2, listsBusy);
await guest.reload(); await progress.getByText(`Couldn’t check everything just now. ${listsBusy} Your watching is still being saved.`).waitFor();
await both(guest, '13m-progress-part-failed'); await refused.done();
// With MDBList only (her Trakt link set aside a moment), the same failure once read as all in step. Now it says why, and Try again
// asks again.
sqlLocal("UPDATE secrets SET kind = 'aside' WHERE owner = 'ada' AND kind = 'trakt-scrobble'");
refused = await refuse('here-mdblist', 2, listsBusy);
await guest.reload(); await progress.getByText(`${listsBusy} Your watching is still being saved.`).waitFor();
assert.equal(refused.asked(), 2); assert.equal(await progress.getByText('Everything matches').count(), 0); await both(guest, '13k-progress-mdblist-failed');
holds('here-mdblist', []); await progress.getByRole('button', {name: 'Try again'}).click(); await progress.getByText('Everything matches', {exact: false}).waitFor(); assert.equal(refused.asked(), 3); await refused.done();
sqlLocal("UPDATE secrets SET kind = 'trakt-scrobble' WHERE owner = 'ada' AND kind = 'aside'");
// With matching on, nothing is looked at until she asks; the Trakt card says how matching stands.
sqlLocal(`UPDATE sync SET matching = 1, good = ${Math.floor(Date.now() / 1000)}`); await guest.reload(); await progress.getByRole('button', {name: 'Show what’s different'}).waitFor();
assert.equal(await progress.getByText('Everything matches').count(), 0); await trakt.getByText(/^Matching\. Last checked today at /).waitFor();
await guest.setViewportSize({width: 390, height: 844}); await shot(guest, '13n-accounts-matching-phone'); await guest.setViewportSize({width: 1280, height: 900}); await shot(guest, '13n-accounts-matching-wide'); await guest.setViewportSize({width: 390, height: 844});
await show(); await progress.getByText('Everything matches', {exact: false}).waitFor(); sqlLocal('UPDATE sync SET matching = 0');
// Disconnecting while MDBList keeps her progress brings it back here first, the same way. When MDBList won't answer, she can
// disconnect anyway; then she connects it again.
mdblistDown = true; await guest.reload(); await mdb.getByRole('button', {name: 'Disconnect'}).click(); await guest.getByRole('heading', {name: 'Disconnect MDBList?'}).waitFor();
await guest.locator('dialog.sheet').getByRole('button', {name: 'Disconnect'}).click(); await guest.getByRole('heading', {name: 'Disconnect anyway?'}).waitFor(); await shot(guest, '13o-mdblist-disconnect-anyway');
await guest.locator('dialog.sheet').getByRole('button', {name: 'Disconnect anyway'}).click(); await toast(guest).filter({hasText: 'MDBList disconnected'}).waitFor(); mdblistDown = false;
await mdb.getByRole('button', {name: 'Connect'}).waitFor(); await progress.getByText('Your progress is kept on this hub.', {exact: false}).waitFor();
sqlLocal('DELETE FROM drift');
// The manager who is Ada too opens her link once she has joined: straight into her own view, as if she had signed in, with her
// own things there. "Back to manager" returns to the manager's view, which was kept aside meanwhile.
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor(); await owner.getByRole('button', {name: 'Back to manager'}).waitFor();
await owner.goto(BASE + '/#/me/accounts'); await owner.getByRole('heading', {name: 'Your progress'}).waitFor(); assert.equal(await owner.getByText('It’s theirs, so it isn’t shown here.', {exact: false}).count(), 0); await shot(owner, '14b-accounts-as-ada');
// Side by side: another tab in the same browser is still the manager's, and stays so while Ada's tab is used and reloaded.
const beside = await owner.context().newPage(); await beside.goto(BASE + '/#/'); await beside.getByText('Add someone to Family').waitFor();
await owner.reload(); await owner.getByRole('heading', {name: 'Your progress'}).waitFor(); await beside.reload(); await beside.getByText('Add someone to Family').waitFor();
await beside.goto(BASE + '/#/person/ada/accounts'); await beside.getByText('It’s theirs, so it isn’t shown here.', {exact: false}).waitFor(); await owner.reload(); await owner.getByRole('heading', {name: 'Your progress'}).waitFor();
// Signing out of Ada's view ends only hers; the manager's tab stays signed in.
await owner.goto(BASE + '/#/me/you'); await owner.getByRole('button', {name: 'Sign out'}).click(); await owner.getByText('Add someone to Family').waitFor();
await beside.reload(); await beside.getByText('It’s theirs, so it isn’t shown here.', {exact: false}).waitFor(); await beside.close();
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor();
await owner.getByRole('button', {name: 'Back to manager'}).click(); await owner.getByText('Add someone to Family').waitFor();
// Her rows' posters stay on her page: the hub's Home shows only blanks where her Trakt rows would go.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later').first().waitFor(); assert.equal(await owner.locator('.rows .row.later .posters span:not(.blank)').count(), 0);
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
  Object.assign(me, {...(shelf ? {rows: [shelfRow, ...me.rows], shelfAt: hourAgo} : {}), pickedAt: hourAgo, forYouDetail, forYou: Object.fromEntries(Object.entries(forYouDetail.places).map(([place, pick]) => [place, pick.name])), forYouKinds: Object.fromEntries(Object.entries(forYouDetail.places).map(([place, pick]) => [place, pick.kind]))});
  await route.fulfill({response, json: body}).catch(() => {});};
await guest.route('**/api/state', forYouState(true));
const askedNow = [];
for (const path of ['**/api/people/ada/foryou/*', '**/api/people/ada/shelf']) await guest.route(path, route => {askedNow.push([new URL(route.request().url()).pathname, route.request().postDataJSON()]); return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});});
// A row by its name, or a For you row by what it holds today.
await guest.reload(); const rowOf = title => guest.locator('.rows .row', {has: guest.locator('h3, p', {hasText: new RegExp(`^(Today: )?${title}`)})});
await rowOf('My Trakt lists').getByText(/^Trakt · Lists checked (yesterday )?at .+ · next check (today|tomorrow)$/).waitFor();
// A For you row is headed For you; its line says what it holds today and when it picks again, or that it is kept.
await rowOf('Because you watched Inception').getByText(/^Today: Because you watched Inception · picks again (today|tomorrow|soon)$/).waitFor();
await rowOf('Next in The Dark Knight').getByText('Today: Next in The Dark Knight · kept', {exact: true}).waitFor();
await rowOf('Popular movies lately').getByText('Today: Popular movies lately · until there’s more to go on', {exact: true}).waitFor();
assert.deepEqual(await guest.locator('.rows .row', {has: guest.locator('p', {hasText: /^Today: /})}).locator('h3').allTextContents(), ['For you', 'For you', 'For you']);
assert.ok(!/picked|checked|changes/.test(await rowOf('Trending Movies').locator('p').first().textContent()), 'a row always current says nothing of times');
await rowOf('My Trakt lists').scrollIntoViewIfNeeded(); await shot(guest, '18-home-times');
// A For you row's sheet tells the row's story: it picks something new each day, what it is today and why, when it picks again
// (keep it, and it stays), then the day's other options (five), the kinds with nothing today and why, and less like it. The kind's
// name is said once.
const placeSheet = guest.getByRole('dialog', {name: 'For you'}), story = placeSheet.locator('.story');
await rowOf('Because you watched Inception').getByRole('button', {name: 'Edit'}).click();
await story.getByText('This row picks something new each day from the kinds you have on. Today it’s “Because you watched Inception”.', {exact: true}).waitFor();
await story.getByText(/^You watched it on [A-Z][a-z]+day\.$/).waitFor(); await story.getByText(/^(Tomorrow at .+|At .+|Soon) it picks again, and it could be any kind\.$/).waitFor();
assert.equal((await story.locator('p').allTextContents()).join(' ').match(/Because you watched/g).length, 1, await story.textContent());
assert.equal(await placeSheet.locator('.options li').count(), 5, 'five other options');
await placeSheet.getByRole('button', {name: /^More from Christopher Nolan\s*More from a director · Christopher Nolan directed Inception, which you watched on [A-Z][a-z]+day\.$/}).waitFor();
await placeSheet.getByRole('button', {name: /^Something different: Western movies\s*Well liked, and not a genre you’ve been watching\.$/}).waitFor();
await placeSheet.getByText('Not available today').click(); await placeSheet.locator('.none li', {hasText: 'Pick back up'}).getByText('Nothing left partway in the last year').waitFor(); await placeSheet.locator('.none li', {hasText: 'Seasonal'}).getByText('Switched off').waitFor();
const sheetShots = async name => {if (!shots) return; for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await guest.waitForTimeout(300); const body = guest.locator('.sheet-body');
  await body.evaluate(element => {element.scrollTop = 0;}); await guest.screenshot({path: `${shots}/real-${name}-${width < 600 ? 'phone' : 'wide'}.png`});
  await body.evaluate(element => {element.scrollTop = element.scrollHeight;}); await guest.screenshot({path: `${shots}/real-${name}-${width < 600 ? 'phone' : 'wide'}-end.png`});} await guest.setViewportSize({width: 390, height: 844});};
await story.getByRole('button', {name: 'Keep “Because you watched Inception”'}).waitFor(); await placeSheet.getByRole('button', {name: 'Not from Inception again'}).waitFor(); await placeSheet.getByRole('button', {name: 'Less “Because you watched”'}).waitFor();
await sheetShots('18b-for-you-sheet');
await placeSheet.getByRole('button', {name: /^Drama movies for you/}).click(); await toast(guest).filter({hasText: '“Drama movies for you” is on this row now. Your apps have it in a few minutes.'}).waitFor();
await rowOf('Because you watched Inception').getByRole('button', {name: 'Edit'}).click(); await placeSheet.getByRole('button', {name: 'Keep “Because you watched Inception”'}).click(); await toast(guest).filter({hasText: 'Kept. It stays until you let it change.'}).waitFor();
// The kept row offers to let it change again; a title left out goes for good.
const keptSheet = guest.getByRole('dialog', {name: 'For you'});
await rowOf('Next in The Dark Knight').getByRole('button', {name: 'Edit'}).click(); await keptSheet.getByRole('button', {name: 'Let it change again'}).waitFor();
await story.getByText('Kept: it stays “Next in The Dark Knight” until you let it change.', {exact: true}).waitFor(); await story.getByText(/^You watched The Dark Knight on [A-Z][a-z]+day\. 2 more films in the series are out\.$/).waitFor();
if (shots) await guest.screenshot({path: `${shots}/real-18d-for-you-kept-phone.png`}); await keptSheet.getByRole('button', {name: 'Not from The Dark Knight again'}).click(); await toast(guest).filter({hasText: 'Nothing more from “The Dark Knight”. Your apps have it in a few minutes.'}).waitFor();
// A pick made before reasons were kept says only what it is and when it picks again, never its kind a second time.
const inception = forYouDetail.places['for-you-1']; forYouDetail.places['for-you-1'] = {key: 'because:s60574', kind: 'because', name: 'Because you watched Peaky Blinders', seed: 's60574'};
await guest.reload(); await rowOf('Because you watched Peaky Blinders').getByRole('button', {name: 'Edit'}).click();
await story.getByText('This row picks something new each day from the kinds you have on. Today it’s “Because you watched Peaky Blinders”.', {exact: true}).waitFor();
assert.equal(await story.locator('p').count(), 2, await story.textContent()); assert.equal((await story.locator('p').allTextContents()).join(' ').match(/Because you watched/g).length, 1, await story.textContent());
if (shots) {await guest.locator('.sheet-body').evaluate(element => {element.scrollTop = 0;}); await guest.screenshot({path: `${shots}/real-18e-for-you-no-reason-phone.png`});}
await placeSheet.getByRole('button', {name: 'Close'}).click(); forYouDetail.places['for-you-1'] = inception; await guest.reload();
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
const kinds = guest.locator('ol.kinds'), kindNames = () => kinds.locator('li strong').allTextContents(), kindsCard = guest.locator('.setting', {hasText: 'Kinds of pick'});
// Folded to a line until opened: which kind comes first, and how many are on.
await kindsCard.getByText('Next in a movie series first · 8 of 8 on', {exact: true}).waitFor(); assert.equal(await kinds.count(), 0);
if (shots) for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await kindsCard.scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await kindsCard.screenshot({path: `${shots}/real-19a-kinds-folded-${width < 600 ? 'phone' : 'wide'}.png`});}
await guest.setViewportSize({width: 390, height: 844}); await kindsCard.getByRole('button', {name: 'Change'}).click();
await kinds.scrollIntoViewIfNeeded(); assert.deepEqual(await kindNames(), ['Next in a movie series', 'Pick back up', 'More from a director', 'Because you watched', 'Your genres', 'Seasonal', 'Top 10', 'Something different']);
await guest.locator('.setting', {hasText: 'Not picked from'}).getByText('Pulp Fiction').waitFor();
// Each kind says what it picks, in her words.
await kinds.locator('li', {hasText: 'Pick back up'}).getByText('Shows you left partway, last watched between three weeks and a year ago.', {exact: true}).waitFor();
await kinds.locator('li', {hasText: 'Top 10'}).getByText('What’s most watched on Netflix where you last played, or worldwide. Not from your own watching.', {exact: true}).waitFor();
// If picked now, from today's options: each row from the next kind in her order with something (the kept row stays), redone at
// once as she drags or switches.
const ifNow = () => kindsCard.locator('.if-now li').evaluateAll(lines => lines.map(line => [line.querySelector('strong').textContent, line.querySelector('small').textContent]));
assert.deepEqual(await ifNow(), [['More from a director', 'More from Christopher Nolan'], ['Next in a movie series', 'Next in The Dark Knight · kept'], ['Because you watched', 'Inception']]);
// Dragged by its handle, Something different goes to the top.
// (A tall window, so the whole list, with each kind's line, is on screen at once.)
await guest.setViewportSize({width: 390, height: 2000}); await kinds.scrollIntoViewIfNeeded();
const grip = kinds.getByRole('button', {name: 'Move Something different'}), top = kinds.locator('li').first();
const [from, to] = [await grip.boundingBox(), await top.boundingBox()];
await guest.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await guest.mouse.down();
for (let step = 1; step <= 12; step++) {await guest.mouse.move(from.x + from.width / 2, from.y + (to.y + 4 - from.y) * step / 12); await guest.waitForTimeout(30);}
await guest.mouse.up(); await guest.setViewportSize({width: 390, height: 844});
await saved(got => got.forYouOrder?.[0] === 'different', 'dragged to the top'); assert.equal((await kindNames())[0], 'Something different');
assert.deepEqual(await ifNow(), [['Something different', 'Western movies'], ['Next in a movie series', 'Next in The Dark Knight · kept'], ['More from a director', 'More from Christopher Nolan']]);
await kinds.getByRole('switch', {name: 'More from a director'}).click(); await saved(got => got.forYouOff?.includes('crew'), 'crew off');
assert.deepEqual((await ifNow())[2], ['Because you watched', 'Inception']); await kinds.getByRole('switch', {name: 'More from a director'}).click(); await saved(got => !got.forYouOff?.includes('crew'), 'crew on');
await kinds.getByRole('switch', {name: 'Top 10'}).click(); await saved(got => got.forYouOff?.includes('top10'), 'Top 10 off');
await kinds.getByRole('radio', {name: 'From any time'}).click(); await saved(got => got.forYouBecause === 'any', 'from any time');
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
await listsJob.getByText('under way').waitFor(); await listsJob.getByText('For everyone every day; for one person when their lists change or they press Check now', {exact: true}).waitFor();
await owner.locator('.jobs li', {hasText: 'For you picks'}).getByText(/^For everyone every day at .+; for one person when they change their rows or kinds, or finish something$/).waitFor(); await listsJob.scrollIntoViewIfNeeded(); await shot(owner, '16d-background-under-way');
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
// A TV's Quick Connect link, as a player app shows it: Jellyfin's web page, with the TV's code after the #. It opens the site, which
// asks who the TV is for, names them on the button and approves nothing without a tap.
const tvAsks = async () => (await fetch(`${BASE}/h/${hubCode}/QuickConnect/Initiate`, {method: 'POST', headers: {authorization: 'MediaBrowser Client="Wholphin", Device="Living room TV", DeviceId="tv-quick"'}})).json();
const tvIn = async tv => (await (await fetch(`${BASE}/h/${hubCode}/QuickConnect/Connect?secret=${tv.Secret}`)).json()).Authenticated;
const tvLink = tv => `${BASE}/h/${hubCode}/web/#/quickconnect?code=${tv.Code}`;
const tvShots = async (page, name) => {if (!shots) return; for (const [width, height] of [[390, 844], [1280, 900]]) {await page.setViewportSize({width, height}); await page.waitForTimeout(250); await page.screenshot({path: `${shots}/real-20${name}-${width < 600 ? 'phone' : 'wide'}.png`, fullPage: true});} await page.setViewportSize({width: 390, height: 844});};
// The manager picks who it is for, from the hub's people: never themselves.
let tv = await tvAsks(); await owner.goto(tvLink(tv));
await owner.getByRole('heading', {name: 'Sign this TV in as…'}).waitFor(); assert.match(owner.url(), new RegExp(`/\\?tv=${hubCode}#/quickconnect\\?code=${tv.Code}$`));
await owner.getByText(`A TV is asking to sign in with the code ${tv.Code.slice(0, 3)} ${tv.Code.slice(3)}.`, {exact: true}).waitFor();
const tvPeople = owner.getByRole('radiogroup', {name: 'Who the TV is for'});
assert.deepEqual(await tvPeople.locator('label > span:last-child').allTextContents(), ['Ada', 'Ada Two']); assert.ok(await owner.getByRole('button', {name: 'Approve', exact: true}).isDisabled());
await tvPeople.getByRole('radio').first().check(); await tvShots(owner, 'a-tv-manager');
await owner.getByRole('button', {name: 'Approve as Ada'}).click(); await owner.getByText('It signs in as Ada in a few seconds.', {exact: true}).waitFor(); assert.equal(await tvIn(tv), true);
// A code that ran out (or that no TV shows) says so plainly.
tv = await tvAsks(); sqlLocal(`UPDATE quick SET expires = 0 WHERE code = '${tv.Code}'`); await owner.goto(tvLink(tv));
await tvPeople.getByRole('radio').first().check(); await owner.getByRole('button', {name: 'Approve as Ada'}).click();
await owner.getByText('No TV is showing that code right now. Check the code, or start again on the TV.', {exact: true}).waitFor(); await tvShots(owner, 'b-tv-expired'); assert.equal(await tvIn(tv), undefined);
// A person approves it as themselves.
tv = await tvAsks(); await guest.goto(tvLink(tv)); await guest.getByRole('heading', {name: 'Sign this TV in as Ada?'}).waitFor(); await tvShots(guest, 'c-tv-person');
await guest.getByRole('button', {name: 'Approve as Ada'}).click(); await guest.getByText('It signs in as Ada in a few seconds.', {exact: true}).waitFor(); assert.equal(await tvIn(tv), true);
// Or as someone else, with that person's password for this site (Ada Two joins first, choosing hers). No session is made for them.
let twoLink = ''; for (let i = 0; i < 40 && !twoLink; i++) {twoLink = await owner.evaluate(async () => (await (await fetch('/api/people/ada-two/signin')).json()).link ?? ''); if (!twoLink) await owner.waitForTimeout(150);}
assert.equal((await fetch(`${BASE}/api/join`, {method: 'POST', headers: {origin: BASE, 'content-type': 'application/json'}, body: JSON.stringify({token: twoLink.split('/join/')[1], password: 'second password'})})).status, 200);
tv = await tvAsks(); await guest.goto(tvLink(tv)); await guest.getByRole('button', {name: 'Someone else'}).click();
await guest.getByLabel('Name').fill('Ada Two'); await guest.getByLabel('Their password').fill('not hers');
await guest.getByRole('button', {name: 'Approve as Ada Two'}).click(); await guest.getByText('That name or password isn’t right.', {exact: true}).waitFor();
await guest.getByLabel('Their password').fill('second password'); await tvShots(guest, 'd-tv-someone-else');
await guest.getByRole('button', {name: 'Approve as Ada Two'}).click(); await guest.getByText('It signs in as Ada Two in a few seconds.', {exact: true}).waitFor(); assert.equal(await tvIn(tv), true);
await guest.goto(BASE + '/#/me'); await guest.getByRole('heading', {name: 'Ada', exact: true}).waitFor();
// Nobody signed in: whoever it is for, by name and password; or the manager signs in first, then picks. A link without a code asks
// for it.
const nobody = await open(); await nobody.goto(`${BASE}/h/${hubCode}/web/`); await nobody.getByRole('heading', {name: 'Sign in a TV'}).waitFor();
tv = await tvAsks(); await nobody.getByLabel('Code from the TV').fill(tv.Code); await nobody.getByRole('button', {name: 'Continue'}).click();
await nobody.getByRole('heading', {name: 'Sign this TV in', exact: true}).waitFor(); await nobody.getByLabel('Name').waitFor(); await tvShots(nobody, 'e-tv-signed-out');
await nobody.getByRole('button', {name: 'Run this hub? Sign in'}).click(); await nobody.getByLabel('Hub code').fill(hubCode); await nobody.getByLabel('Password').fill('correct horse');
await nobody.getByRole('button', {name: 'Sign in', exact: true}).click(); await nobody.getByRole('heading', {name: 'Sign this TV in as…'}).waitFor();
await nobody.getByRole('radiogroup', {name: 'Who the TV is for'}).getByRole('radio').nth(1).check(); await nobody.getByRole('button', {name: 'Approve as Ada Two'}).click();
await nobody.getByText('It signs in as Ada Two in a few seconds.', {exact: true}).waitFor(); await tvShots(nobody, 'f-tv-approved'); assert.equal(await tvIn(tv), true);
console.log('browser flow ok; page errors:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
