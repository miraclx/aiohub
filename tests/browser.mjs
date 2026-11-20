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
await owner.getByRole('switch', {name: 'Change playback'}).click(); await toast(owner).filter({hasText: 'Saved'}).waitFor();
await owner.goto(BASE + '/#/person/ada/devices'); await owner.getByRole('button', {name: 'Show'}).click();
await owner.getByLabel('Password', {exact: true}).filter({hasText: /^[a-z]+-[a-z]+-[a-z]+-\d\d$/}).waitFor(); const password = await owner.getByLabel('Password', {exact: true}).textContent(); await shot(owner, '4-devices');
await owner.goto(BASE + '/#/hub/playback'); await owner.getByRole('radio', {name: 'Best'}).click().catch(() => owner.getByText('Best', {exact: true}).first().click()); await owner.waitForTimeout(900);
await owner.goto(BASE + '/#/hub/sources'); await owner.getByText('TorBox').first().waitFor(); await shot(owner, '5-sources');
// Background work on Hub, General: one cron run (before the daily check's hour), then when it ran, runs next, and how often it has.
await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('*/5 * * * *')}&time=${Date.UTC(2026, 0, 1, 3)}`);
await owner.goto(BASE + '/#/hub/general'); await owner.reload(); const work = owner.locator('section', {has: owner.getByRole('heading', {name: 'Background work'})});
const job = name => work.locator('.job', {has: owner.getByRole('heading', {name, exact: true})});
await job('Trakt sync').getByText(/^1 run since \d/).waitFor();
await job('Trakt sync').getByText(/^Ran today at /).waitFor(); await job('Trakt sync').getByText(/^next in \d min$/).waitFor();
await job('Trakt and MDBList check').getByText('once a day').waitFor(); await job('Trakt and MDBList check').getByText('Not run yet').waitFor(); await job('Trakt and MDBList check').getByText(/^next (today|tomorrow) at /).waitFor();
await work.scrollIntoViewIfNeeded(); await shot(owner, '5b-background');
// The hub's Home keeps a place for each Trakt row, marked as one that appears once someone connects Trakt.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later', {hasText: 'Watchlist'}).getByText('Appears once someone connects Trakt').waitFor(); await shot(owner, '5c-hub-home');
await owner.goto(BASE + '/#/'); await owner.getByText('Add someone to Family').waitFor(); await shot(owner, '6-people');
// The manager opening the invite link is told to send it on, and stays signed in.
await owner.goto(link); await owner.getByText(/signed in as the manager/).waitFor();

const guest = await open();
await guest.goto(link); await guest.getByRole('heading', {name: 'Hi Ada'}).waitFor(); await shot(guest, '7-join');
await guest.getByLabel('Password').fill('my own password'); await guest.getByRole('button', {name: 'Continue'}).click();
await guest.getByRole('tab', {name: 'Playback'}).or(guest.getByRole('link', {name: 'Playback'})).first().waitFor(); await shot(guest, '8-own-page');
assert.equal(await guest.getByRole('link', {name: 'People'}).count(), 0);
await guest.goto(BASE + '/#/me/devices'); await guest.locator('.creds code').filter({hasText: /^Ada$/}).waitFor(); await guest.getByRole('button', {name: 'Show'}).click();
await guest.getByLabel('Password', {exact: true}).filter({hasText: password}).waitFor(); // the player password, not the one just chosen
await guest.goto(BASE + '/#/me/you'); await guest.getByRole('button', {name: 'Sign out'}).click(); await guest.getByRole('heading', {name: 'Sign in'}).waitFor();
// Coming back through the link now asks for the password.
await guest.goto(link); await guest.getByText('Type your password').waitFor();
await guest.getByLabel('Password').fill('my own password'); await guest.getByRole('button', {name: 'Continue'}).click(); await guest.getByRole('heading', {name: 'Ada', exact: true}).waitFor();

// Accounts, on her own page. Trakt is one card with one Connect; progress is kept here until she picks MDBList.
await guest.goto(BASE + '/#/me/accounts'); const trakt = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'Trakt', exact: true})});
await trakt.getByText('Trakt follows along as things are watched here').waitFor(); assert.equal(await guest.getByText('Trakt history').count(), 0);
assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true');
await guest.getByText('Hiding what’s been watched needs MDBList').waitFor(); await shot(guest, '12-accounts');
// Picking MDBList asks for her key; going back to Here before saving leaves nothing changed.
await guest.getByRole('radio', {name: 'MDBList'}).click(); await guest.getByLabel('MDBList API key').waitFor();
await guest.getByRole('radio', {name: 'Here'}).click(); assert.equal(await guest.getByLabel('MDBList API key').count(), 0);
// Connecting Trakt: off to Trakt's sign-in and back to this page, which finishes it with Trakt (busy at first) and says so.
await traktIn(guest.context());
await trakt.getByRole('button', {name: 'Connect'}).click(); await trakt.getByText('Trakt is busy, trying again…').waitFor();
await toast(guest).filter({hasText: 'Trakt connected as adatrakt'}).waitFor(); await trakt.getByText('Connected as adatrakt.').waitFor();
assert.equal(new URL(guest.url()).hash, '#/me/accounts', 'back where Connect was pressed, with nothing from Trakt left in the address');
const [asked] = signins; assert.equal(asked.response_type, 'code'); assert.equal(asked.code_challenge_method, 'S256'); assert.equal(asked.prompt, undefined);
assert.equal(asked.redirect_uri, `${BASE}/api/trakt/callback`); assert.equal(await guest.evaluate(() => sessionStorage.length), 0);
// An older Trakt link made through AIOMetadata shows as a quiet note she can remove (made here directly in the local database).
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO secrets (hub, owner, kind, value) SELECT id, 'ada', 'trakt', 'x' FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await guest.reload(); await trakt.getByText('Nothing uses it any more').waitFor(); await shot(guest, '13-accounts-connected');
await trakt.getByRole('button', {name: 'Disconnect it'}).click(); await toast(guest).filter({hasText: 'Older Trakt link removed'}).waitFor();
assert.equal(await trakt.getByText('Nothing uses it any more').count(), 0); await trakt.getByText('Connected as adatrakt.').waitFor();
// Where her Trakt and MDBList disagree (as the daily look would note it): a quiet note, and nothing copied until she confirms.
const drift = JSON.stringify({since: 0, trakt: 3, mdblist: 2, toMdblist: [{kind: 'show', tmdb: 1396, name: 'Breaking Bad', season: 1, episode: 2, at: 1763000000}], toTrakt: [{kind: 'movie', tmdb: 680, name: 'Pulp Fiction', at: 1762900000}]});
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', `INSERT INTO drift (hub, person, day, result, at) SELECT id, 'ada', '2026-06-01', '${drift}', 1 FROM hubs`], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await guest.reload(); const note = guest.locator('.accounts li', {has: guest.getByRole('heading', {name: 'Trakt and MDBList'})});
await note.getByText('2 plays from the last two weeks are in one but not the other.').waitFor(); await note.getByText('Season 1 · Episode 2', {exact: false}).waitFor(); await note.getByText('Pulp Fiction').waitFor();
await note.getByRole('button', {name: 'Fix'}).click(); await guest.getByText('1 play to MDBList and 1 play to Trakt, each with the date it was watched.', {exact: false}).waitFor(); await shot(guest, '13b-drift-confirm');
await guest.getByRole('button', {name: 'Cancel'}).click(); await shot(guest, '13c-drift-note');
await note.getByRole('button', {name: 'Skip Pulp Fiction'}).click(); await toast(guest).filter({hasText: 'Skipped.'}).waitFor();
await note.getByText('1 play from the last two weeks is in one but not the other.').waitFor(); assert.equal(await note.getByText('Pulp Fiction').count(), 0);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', 'DELETE FROM drift'], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
// With Trakt connected, Recently Watched is on Home right after Watchlist. Switching it off keeps her following her group's Home.
await guest.goto(BASE + '/#/me/home'); const onHome = guest.locator('.rows li h3');
assert.deepEqual((await onHome.allTextContents()).slice(0, 4), ['Watchlist', 'Recommended Movies', 'Recommended Shows', 'Recently Watched']);
await guest.getByRole('switch', {name: 'Show Recently Watched on Home'}).click(); await toast(guest).filter({hasText: '“Recently Watched” is off Home'}).waitFor();
const followed = await guest.evaluate(async () => {for (let i = 0; i < 40; i++) {const me = (await (await fetch('/api/state')).json()).hub.people[0]; if (me.picks) return me; await new Promise(done => setTimeout(done, 250));} return null;});
assert.equal(followed.rows, null, 'still following the group Home'); assert.deepEqual(followed.picks, {'recently-watched': false}); await shot(guest, '13d-recently-watched-off'); await guest.goto(BASE + '/#/me/accounts'); await trakt.getByText('Connected as adatrakt.').waitFor();
// MDBList: with her key saved, progress is kept there, and copying what she watched here is offered on her own page.
await guest.getByRole('radio', {name: 'MDBList'}).click(); await guest.getByLabel('MDBList API key').fill('ada-mdblist-key'); await guest.getByRole('button', {name: 'Save'}).click();
await toast(guest).filter({hasText: 'MDBList connected as adalists'}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'MDBList'}).getAttribute('aria-checked'), 'true');
await guest.getByText('What you watched here').waitFor(); assert.equal(await guest.getByText('Hiding what’s been watched needs MDBList').count(), 0);
// The manager sees the same states, without the copy step: that is hers alone.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload(); await owner.getByText('Connected as adatrakt.').waitFor();
await owner.getByText('can copy it to MDBList from their own page').waitFor(); assert.equal(await owner.getByText('What you watched here').count(), 0); await shot(owner, '14-accounts-manager');
// The manager who is Ada too: her own password, given here, shows her own things beside the manager's view; signing out hides them again.
await owner.getByRole('button', {name: 'Sign in as Ada'}).click(); await owner.getByLabel('Ada’s password').fill('not her password'); await owner.getByRole('button', {name: 'Sign in', exact: true}).click();
await toast(owner).filter({hasText: 'That isn’t Ada’s password'}).waitFor();
await owner.getByLabel('Ada’s password').fill('my own password'); await owner.getByRole('button', {name: 'Sign in', exact: true}).click();
await toast(owner).filter({hasText: 'Signed in as Ada here too'}).waitFor(); await owner.getByText('What you watched here').waitFor(); await shot(owner, '14b-accounts-as-ada');
await owner.getByRole('button', {name: 'Sign out as Ada'}).click(); await owner.getByRole('button', {name: 'Sign in as Ada'}).waitFor(); assert.equal(await owner.getByText('What you watched here').count(), 0);
// Back to Here asks first, then MDBList is let go.
await guest.getByRole('radio', {name: 'Here'}).click(); await guest.getByRole('button', {name: 'Keep it here'}).click();
await toast(guest).filter({hasText: 'Progress kept here'}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true');
await owner.goto(BASE + '/#/hub/playback'); await owner.getByText('It needs progress kept in MDBList').waitFor();

// Activity keeps where each play was reported from behind a small pin: folded until pressed, and absent when unknown.
// (Two plays made here directly in the local database, one with a made-up place and one without.)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art, place, net) SELECT id, 'ada', 'm-1', 'Paper Kites', 'Movie', 600, 6000, 'Strand · Mac', 0, CAST(strftime('%s', 'now') AS INTEGER), '', 'Lagos, NG', 'SpaceX Services, Inc.' FROM hubs; INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'm-2', 'Small Engines', 'Movie', 300, 6000, 'Odin · Apple TV', 0, CAST(strftime('%s', 'now') AS INTEGER) - 60, '' FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
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
await credit(owner); assert.equal(await owner.getByText('Test build').count(), 0, 'no test-build banner'); await owner.setViewportSize({width: 390, height: 844});

// Back as the manager: Ada shows as joined, and the playback change stuck.
await owner.goto(BASE + '/#/person/ada/settings'); await owner.reload(); await owner.getByText(/Family · joined/).waitFor();
assert.equal(await owner.getByRole('switch', {name: 'Change playback'}).getAttribute('aria-checked'), 'true');
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
console.log('browser flow ok; page errors:', JSON.stringify(errors)); await browser.close(); process.exit(errors.length ? 1 : 0);
