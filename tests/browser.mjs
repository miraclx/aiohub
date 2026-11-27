// Drives the real site in a browser against `wrangler dev` with a throwaway local database: create the account, set up, invite, join.
// Usage: node tests/browser.mjs <chromium path> [screenshot dir]
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
// A stand-in answer for a request the page gave up on (a reload, or the stand-in taken away mid-request) has nowhere to go: not a failure.
process.on('unhandledRejection', error => {if (!/Route is already handled/.test(String(error?.message))) throw error;});
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
await work.getByText('The hub does these by itself for everyone, one person at a time. Buttons on a person’s own page act for that person only, right away.').waitFor();
// Trakt sync has two rows, one for each direction, and each says it is only for people with sync on.
const SENDING = 'Trakt sync: here to Trakt', BRINGING = 'Trakt sync: Trakt to here';
await job(SENDING).getByText('For everyone with Trakt sync on, every 5 min; for one person as they play', {exact: true}).waitFor();
await job(SENDING).getByText(/^Ran today at \d/).waitFor(); await job(SENDING).getByText(/^next run in \d min$/).waitFor();
// Trakt sync takes one person each run: about every 20 minutes each, and longer once more than four people sync (tests/aiom.test.mjs).
await job(BRINGING).getByText('For everyone with Trakt sync on, one person each run, so each person about every 20 min; for one person at once when they turn it on', {exact: true}).waitFor(); await job(BRINGING).getByText('Nobody has it on yet').waitFor(); await job(BRINGING).getByText('once someone turns it on').waitFor();
await job('Plays missing from MDBList').getByText(/^For everyone with MDBList sync on, every day from \d[^;]+$/).waitFor(); await job('Plays missing from MDBList').getByText('Nobody has MDBList sync on yet').waitFor(); await job('Plays missing from MDBList').getByText('once someone does').waitFor();
assert.equal(await work.getByText(/matching|scrobbl|progress/i).count(), 0);
await job('Trakt and MDBList check').getByText(/^For everyone with both Trakt and MDBList sync on, every day at \d[^;]+$/).waitFor(); await job('Trakt and MDBList check').getByText('Not run yet').waitFor(); await job('Trakt and MDBList check').getByText(/^next run (today|tomorrow)$/).waitFor();
// Recommended rows the hub works out itself: from four (UTC), so this run before then left it be.
await job('Recommended rows').getByText(/^For everyone with a Recommended row on Home, every day from \d[^;]+$/).waitFor(); await job('Recommended rows').getByText('Not run yet').waitFor(); await job('Recommended rows').getByText(/^next run in \d min$/).waitFor();
await work.scrollIntoViewIfNeeded(); await shot(owner, '5b-background');
// Advanced: behind the password again, then one line a setup, grouped, its keys folded away until asked for.
const advanced = owner.locator('section', {has: owner.getByRole('heading', {name: 'Advanced'})});
await advanced.getByRole('button', {name: 'Show'}).click(); await advanced.getByLabel('Your password').fill('correct horse'); await advanced.getByRole('button', {name: 'Show'}).click();
await advanced.getByRole('heading', {name: 'Shared'}).waitFor(); assert.equal(await advanced.locator('.creds code').count(), 0, 'keys start folded');
if (await advanced.getByRole('button', {name: 'Keys'}).count()) {await advanced.getByRole('button', {name: 'Keys'}).first().click(); await advanced.locator('.creds code').first().waitFor();}
await advanced.scrollIntoViewIfNeeded(); await shot(owner, '5e-advanced');
// The hub's Home keeps a place for each of a person's own rows, each saying what fills it: one Watchlist from Trakt, MDBList or
// both, Recommended from Trakt or their watching, and Recently Watched from whichever the person has.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later', {hasText: 'Watchlist'}).getByText('Appears once someone connects Trakt or MDBList. With both, it is one list').waitFor();
await owner.locator('.rows .row.later', {hasText: 'Recommended Movies'}).getByText('Fills for each person from Trakt, or from what they watch').waitFor();
await owner.locator('.rows .row.later', {hasText: 'Recently Watched'}).getByText('Fills for each person from Trakt, MDBList or what they play here').waitFor();
// All six, Recently Watched among those on Home (it is on by default); the Not on Home ones keep Show at the right edge.
assert.deepEqual(await owner.locator('.rows .row.later h3').allTextContents(), ['Watchlist', 'Recommended Movies', 'Recommended Shows', 'Recently Watched']);
assert.deepEqual(await owner.locator('.off li.later h3').allTextContents(), ['Up Next', 'New for you']);
await owner.locator('.off li.later', {hasText: 'New for you'}).getByText('Fills for each person from Trakt, or from what they watch here and their watchlist').waitFor();
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
// Add row on her own Home, with no account connected yet: the rows an account would add are there greyed, each saying in one line
// what it is and how it is put together, then what it needs, with a Connect that goes to her Accounts tab. They are not buttons:
// nothing is added by them.
await guest.goto(BASE + '/#/me/home'); await guest.getByRole('button', {name: '+ Add row'}).click();
const wanting = guest.getByRole('dialog', {name: 'Add a row'}); await wanting.getByRole('heading', {name: 'With an account'}).waitFor();
assert.deepEqual(await wanting.locator('li.needs').evaluateAll(lines => lines.map(line => [line.querySelector('strong').textContent, line.querySelector('small').textContent, line.querySelector('a').textContent, line.querySelector('a').getAttribute('href')])),
  // Only the Watchlist waits for an account: Up Next and New for you work from what she watches here, so they are not among them.
  [['Watchlist', 'Your Trakt or MDBList watchlist, newest added first. Needs Trakt or MDBList.', 'Connect', '#/me/accounts']]);
assert.equal(await wanting.locator('li.needs button').count(), 0); assert.ok(Number(await wanting.locator('li.needs > span').first().evaluate(node => getComputedStyle(node).opacity)) < 1, 'greyed');
if (shots) {await wanting.locator('li.needs').first().scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-sync-8-add-row-about-phone.png`}); await guest.setViewportSize({width: 1280, height: 900}); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-sync-8-add-row-about-wide.png`}); await guest.setViewportSize({width: 390, height: 844});}
await wanting.locator('li.needs', {hasText: 'Watchlist'}).getByRole('link', {name: 'Connect Trakt or MDBList, for Watchlist'}).click(); await guest.getByRole('heading', {name: 'Trakt Free', exact: true}).waitFor();
await guest.goto(BASE + '/#/me/playback'); await guest.getByText('Set for you by whoever runs the hub.').waitFor();
await guest.goto(BASE + '/#/me/devices'); await guest.locator('.creds code').filter({hasText: /^Ada$/}).waitFor(); await guest.getByRole('button', {name: 'Show'}).click();
await guest.getByLabel('Password', {exact: true}).filter({hasText: password}).waitFor(); // the player password, not the one just chosen
await guest.goto(BASE + '/#/me/you'); await guest.getByRole('button', {name: 'Sign out'}).click(); await guest.getByRole('heading', {name: 'Sign in'}).waitFor();
// Coming back through the link now asks for the password.
await guest.goto(link); await guest.getByText('Type your password').waitFor();
await guest.getByLabel('Password').fill('my own password'); await guest.getByRole('button', {name: 'Continue'}).click(); await guest.getByRole('heading', {name: 'Ada', exact: true}).waitFor();

// Accounts, on her own page: Trakt and MDBList, each saying what connecting gives in short lines, each with one Connect, and
// that connecting only reads. With nothing connected there is no Sync card, and nothing on the page says where her progress is kept.
// (Toasts are kept out of these pictures: they sit over the card.)
const both = async (page, name, part) => {const calm = await page.addStyleTag({content: '.toast { visibility: hidden !important; }'}); await part.scrollIntoViewIfNeeded(); await shot(page, `${name}-phone`); await page.setViewportSize({width: 1280, height: 900}); await part.scrollIntoViewIfNeeded(); await shot(page, `${name}-wide`); await page.setViewportSize({width: 390, height: 844}); await calm.evaluate(node => node.remove());};
await guest.goto(BASE + '/#/me/accounts'); const trakt = guest.locator('.accounts > li', {has: guest.getByRole('heading', {name: 'Trakt Free', exact: true})});
await guest.getByText('Connect your own accounts. Connecting only reads from them. Sync, below, is what writes.', {exact: true}).waitFor();
// What Connect gives, and nothing about sync: that is the Sync card's, once something is connected.
assert.deepEqual(await trakt.locator('.gains p').allTextContents(), ['Up Next and New for you follow your Trakt, so they count what you watch anywhere.', 'Adds your Trakt lists to Home.']); assert.equal(await guest.getByText('Trakt history').count(), 0);
assert.equal(await guest.getByText('as it plays', {exact: false}).count(), 0);
// MDBList is an account like Trakt, optional, and says what it is for before anything else; with none connected there is no switch.
const mdb = guest.locator('.accounts > li', {has: guest.getByRole('heading', {name: 'MDBList Free', exact: true})}).first();
assert.deepEqual(await mdb.locator('.gains p').allTextContents(), ['Adds your MDBList watchlist to Watchlist, and your MDBList lists to Add row.', 'Rows can hide what you’ve watched, once MDBList sync is on.']);
const MDB_SYNC = 'MDBList sync', TRAKT_SYNC = 'Trakt sync', LIST_SYNC = 'Watchlist sync'; assert.equal(await guest.getByRole('switch', {name: MDB_SYNC}).count(), 0);
// The Sync card, the row of each switch, and the card as it reads: every line of it, top to bottom (`said`), and its rows by name.
// Never on it: the words the card used to need explaining, or a long dash.
const BANNED = /favou?rites|hearts|lockstep|\bleads\b|in step|scrobbl|ledger|mirror|—/i;
const sync = guest.locator('.sync-card'), syncRow = (page, name) => page.locator('.sync-card .sync-row', {has: page.getByRole('switch', {name})}), traktRow = syncRow(guest, TRAKT_SYNC), mdbRow = syncRow(guest, MDB_SYNC), listRow = syncRow(guest, LIST_SYNC);
const saidOn = async page => {const text = await page.locator('.sync-card').innerText(); assert.ok(!BANNED.test(text), text); return text.split('\n').map(part => part.trim()).filter(Boolean);}, said = () => saidOn(guest), rows = (page = guest) => page.locator('.sync-card .switch-row h3').allTextContents();
const SENTENCE = {trakt: 'Keep what I watch the same here and on Trakt.', mdblist: 'Keep what I watch the same here and on MDBList.', list: 'Saved titles and my watchlist are one list.', heart: 'Save a title in an app (the heart, in some apps) and it’s on my watchlist. Add one to my watchlist and it shows as saved in the apps.'};
// The line at the foot, only while a sync is on: what unwatching does. Its second sentence only with Trakt sync on.
const FOOT = {one: 'Unwatch something in an app and it’s unwatched everywhere.', trakt: 'Unwatch something in an app and it’s unwatched everywhere. If you only marked it watched here, just that one play leaves Trakt. Unwatching on Trakt’s own site or apps doesn’t reach here.', never: 'Sync never marks anything as unwatched.'};
const traktSwitch = sync.getByRole('switch', {name: TRAKT_SYNC});
assert.equal(await guest.getByRole('heading', {name: 'Your progress'}).count(), 0); assert.equal(await sync.count(), 0, 'no Sync card until something is connected'); assert.equal(await guest.locator('ul.accounts').count(), 1);
await both(guest, 'simple-01-nothing-connected', guest.locator('ul.accounts'));
// Connect asks for her key; Cancel before saving leaves nothing changed.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').waitFor();
await mdb.getByRole('button', {name: 'Cancel'}).click(); assert.equal(await guest.getByLabel('MDBList API key').count(), 0);
// Connecting Trakt: off to Trakt's sign-in and back to this page, which finishes it with Trakt (busy at first) and says so.
await traktIn(guest.context());
await trakt.getByRole('button', {name: 'Connect'}).click(); await trakt.getByText('Trakt asked us to wait a moment. Still connecting…').waitFor();
await toast(guest).filter({hasText: 'Trakt connected as adatrakt'}).waitFor(); await trakt.getByText('Connected as adatrakt').waitFor();
assert.equal(new URL(guest.url()).hash, '#/me/accounts', 'back where Connect was pressed, with nothing from Trakt left in the address');
// Signed in herself, she is asked at once, on the Sync card that is now there, whether to turn sync on: both directions in one
// short question, with Turn on as the suggested answer (the filled button) and Not now beside it, and nothing else in it.
// Earlier plays are never part of the question. Until she answers sync is off, and the question stays, through a reload too.
const consent = sync.locator('.consent'), ASK = 'Sync what you watch with Trakt? What you watch here goes to Trakt, and what you watch in other Trakt apps comes back.';
await consent.getByText(ASK, {exact: true}).waitFor(); assert.equal(await consent.getByRole('checkbox').count(), 0);
assert.equal(await consent.locator('p').count(), 1, 'the question and nothing under it');
assert.deepEqual(await consent.locator('.consent-actions button').evaluateAll(buttons => buttons.map(button => [button.textContent, button.classList.contains('primary')])), [['Turn on', true], ['Not now', false]]);
assert.equal(await sync.getByRole('heading', {name: 'Sync', exact: true}).count(), 1); assert.deepEqual(await rows(), ['Trakt']);
// The whole card: its name, the question, then one row. No line on top, no headings, no explaining, and with no sync on no line at the foot.
assert.deepEqual(await said(), ['Sync', ASK, 'Turn on', 'Not now', 'Trakt', SENTENCE.trakt]); assert.equal(await sync.locator('.sync-foot').count(), 0); assert.equal(await guest.getByText(FOOT.never).count(), 0); assert.equal(await sync.locator('h4').count(), 0);
assert.equal(await sync.locator('.status-line').count(), 0); assert.equal(await traktSwitch.getAttribute('aria-checked'), 'false'); assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).matching.on, false, 'off until she says');
assert.equal(await sync.getByRole('button', {name: /^(Done|Turn off|Change)$/}).count(), 0);
await both(guest, 'simple-02-question-at-connect', sync);
await guest.reload(); await consent.getByText(ASK, {exact: true}).waitFor();
// What she watched here before (made here directly in the local database) is no part of the question, and with sync off nothing
// of it is offered or asked about. Not now answers the question for good: off, said plainly, and never asked again.
sqlLocal(`INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'old-1', 'Old Film', 'Movie', 6000, 6000, 'Strand · Mac', 0, unixepoch() - 40 * 86400, '' FROM hubs;
  INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'old-2', 'Old Show', 'Season 1 · Episode 2', 1200, 2400, 'Strand · Mac', 0, unixepoch() - 30 * 86400, '' FROM hubs;
  INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, updated, art) SELECT id, 'ada', 'old-3', 'Barely Begun', 'Movie', 10, 6000, 'Strand · Mac', 0, unixepoch() - 20 * 86400, '' FROM hubs`);
const asks = []; guest.on('request', request => {const path = new URL(request.url()).pathname; if (/\/api\/people\/ada\/matching(\/|$)/.test(path)) asks.push(`${request.method()} ${path.split('/ada/')[1]}`);});
await guest.reload(); await consent.getByText(ASK, {exact: true}).waitFor(); assert.equal(await consent.getByRole('checkbox').count(), 0); assert.equal(await sync.locator('.offer').count(), 0);
const isOff = () => sync.getByRole('switch', {name: TRAKT_SYNC, checked: false}).waitFor(), isOn = () => sync.getByRole('switch', {name: TRAKT_SYNC, checked: true}).waitFor(), dot = kind => traktRow.locator(`.status-line .dot.${kind}`).count(), under = () => traktRow.locator('.status-line, .quiet').allTextContents();
await consent.getByRole('button', {name: 'Not now'}).click(); await toast(guest).filter({hasText: 'Trakt sync is off. You can turn it on here any time.'}).waitFor();
// Off: the switch says so, and nothing under it does.
await isOff(); await consent.waitFor({state: 'detached'}); assert.deepEqual(await under(), []);
await guest.reload(); await isOff(); await guest.waitForTimeout(400); assert.equal(await sync.locator('.consent').count(), 0, 'asked once');
assert.equal(await sync.locator('.offer').count(), 0); assert.deepEqual(asks.filter(ask => ask !== 'POST matching'), [], 'with sync off nothing is asked about earlier plays');
assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt]); await both(guest, 'simple-03-trakt-only-off', sync);
// The switch turns it on, with no other step: catching up starts at once, a pass at a time, with one calm line meanwhile (the passes
// are answered here, the second held a moment, so the line can be seen).
let passGo; const held = new Promise(done => {passGo = done;}), passed = {n: 0}, passAt = /\/api\/people\/ada\/matching\/pass$/, turned = [];
const passing = async route => {if (++passed.n === 1) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({trakt: 12, home: 0, left: 25, more: true})}); await held; return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({trakt: 0, home: 0, left: 0, more: false})});};
guest.on('request', request => {if (request.method() === 'POST' && /\/api\/people\/ada\/matching$/.test(new URL(request.url()).pathname)) turned.push(request.postDataJSON());});
await guest.route(passAt, passing); await traktSwitch.click(); await toast(guest).filter({hasText: 'Trakt sync is on'}).waitFor();
assert.deepEqual(turned.at(-1), {on: true, earlier: false}, 'turning sync on never sends earlier plays');
await traktRow.locator('.status-line').getByText('Catching up. You can keep watching.', {exact: true}).waitFor(); await guest.waitForTimeout(600); assert.equal(passed.n, 2, 'one round of passes, not two');
assert.equal(await traktSwitch.getAttribute('aria-checked'), 'true'); assert.deepEqual(await under(), ['Catching up. You can keep watching.']);
await both(guest, 'simple-09a-status-catching-up', sync); passGo();
// Just on: nothing under the switch repeats what sync does, and nothing is said of a check before one has run. The question does not come back.
const syncIs = sets => {sqlLocal(`UPDATE sync SET ${sets}`); return guest.reload();}, time = () => Math.floor(Date.now() / 1000);
await traktRow.locator('.status-line').waitFor({state: 'detached'}); await isOn(); assert.equal(await sync.locator('.consent').count(), 0); assert.equal(await traktRow.locator('.quiet').count(), 0);
// Under the switch, once: what she watched here before turning sync on. How many, then Show them (each with its date, newest
// first; one barely started is not among them: it would not be sent), Add them and Not now. What adding means is said only when asked.
const offer = traktRow.locator('.offer');
const EARLIER = '2 things you watched here earlier aren’t on Trakt.'; await offer.getByText(EARLIER, {exact: true}).waitFor(); assert.equal(await guest.getByText('Trakt can’t undo this in one go.').count(), 0, 'only in the confirm');
assert.deepEqual(await offer.locator('.offer-actions button').allTextContents(), ['Show them', 'Add them', 'Not now']); assert.equal(await offer.locator('.listed').count(), 0);
await offer.getByRole('button', {name: 'Show them'}).click(); const listed = await offer.locator('.listed p').allTextContents();
assert.equal(listed.length, 2, 'as many as the line says'); assert.match(listed[0], /^Old Show · Season 1 · Episode 2 · \S/); assert.match(listed[1], /^Old Film · Movie · \S/);
assert.deepEqual(turned.at(-1), {on: true, earlier: false}, 'looking sends nothing'); await offer.getByRole('button', {name: 'Hide them'}).click();
assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt, EARLIER, 'Show them', 'Add them', 'Not now', FOOT.trakt, 'What was synced']); await both(guest, 'simple-05-offer-earlier-plays', sync);
// Not now hides the line for good for those plays: through a reload, and the hub remembers it.
await offer.getByRole('button', {name: 'Not now'}).click(); await offer.waitFor({state: 'detached'}); assert.ok(asks.includes('POST matching/later'));
await guest.reload(); await isOn(); await guest.waitForTimeout(400); assert.equal(await offer.count(), 0, 'stays hidden');
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).matching.passed, true);
// Turned off and on again later, the plays from before this turning on are offered once more, and Add them sends them: the one
// write that says earlier plays too, then a round of catching up.
await traktSwitch.click(); await toast(guest).filter({hasText: 'Trakt sync is off. Nothing is sent to Trakt and nothing comes back.'}).waitFor(); await isOff();
assert.deepEqual(await under(), []); assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).matching.on, false); assert.equal(await offer.count(), 0);
assert.equal(await sync.getByText('still reaches', {exact: false}).count(), 0);
await guest.waitForTimeout(1100); passed.n = 1; await traktSwitch.click(); await toast(guest).filter({hasText: 'Trakt sync is on'}).waitFor();
await offer.getByText(EARLIER, {exact: true}).waitFor(); const rounds = passed.n;
// Add them asks first, in a small confirm that says the one thing worth knowing; Cancel sends nothing.
const sure = guest.locator('dialog.sheet'); await offer.getByRole('button', {name: 'Add them'}).click(); await sure.getByRole('heading', {name: 'Add 2 things to Trakt?'}).waitFor();
await sure.getByText('Trakt can’t undo this in one go.', {exact: true}).waitFor(); await both(guest, 'simple-05b-offer-earlier-plays-confirm', sure);
await sure.getByRole('button', {name: 'Cancel'}).click(); await sure.waitFor({state: 'detached'}); assert.deepEqual(turned.at(-1), {on: true, earlier: false}, 'nothing sent'); await offer.getByText(EARLIER, {exact: true}).waitFor();
await offer.getByRole('button', {name: 'Add them'}).click(); await sure.getByRole('button', {name: 'Add them'}).click(); await toast(guest).filter({hasText: 'Adding 2 things to Trakt'}).waitFor(); assert.deepEqual(turned.at(-1), {on: true, earlier: true});
await offer.waitFor({state: 'detached'}); await guest.waitForTimeout(400); assert.equal(passed.n, rounds + 1, 'one more round, for them'); await guest.unroute(passAt, passing);
sqlLocal("DELETE FROM plays WHERE item LIKE 'old-%'");
await guest.reload(); await isOn(); assert.equal(await sync.locator('.consent').count(), 0, 'not asked again'); assert.equal(await offer.count(), 0);
assert.equal(await sync.getByRole('button', {name: /^(Done|Turn off|Change|Turn on)$/}).count(), 0, 'on is on and off is off: the switch is the only control');
// Once a good check has run: when, quietly, and nothing else under the switch. The card, whole.
await syncIs(`good = ${time()}`); const CHECKED = /^Last checked \d[^.]*$/; await traktRow.locator('.quiet').getByText(CHECKED).waitFor(); assert.equal(await traktRow.locator('.status-line').count(), 0);
{const all = await said(); assert.match(all[3], CHECKED); assert.deepEqual([...all.slice(0, 3), ...all.slice(4)], ['Sync', 'Trakt', SENTENCE.trakt, FOOT.trakt, 'What was synced']);} await both(guest, 'simple-04-trakt-only-on', sync);
// What was synced: one short list, newest first, of what the hub did (made here directly in the local database). A play only noted
// as never to be sent again has no title and is not listed.
sqlLocal(`INSERT INTO sent (hub, person, place, play, at, title, detail) SELECT id, 'ada', 'trakt', 'w:movie/438631', unixepoch() - 86400, 'Dune', 'Movie' FROM hubs;
  INSERT INTO sent (hub, person, place, play, at, title, detail) SELECT id, 'ada', 'here', 'ip:show/83867:2:4@2026-01-01T00:00:00.000Z', unixepoch() - 3600, 'Andor', 'Season 2 · Episode 4' FROM hubs;
  INSERT INTO sent (hub, person, place, play, at, title, detail) SELECT id, 'ada', 'here', 'ir:movie/949@2026-01-02T00:00:00.000Z', unixepoch() - 90000, 'Heat', 'Movie' FROM hubs;
  INSERT INTO sent (hub, person, place, play, at, title, detail) SELECT id, 'ada', 'trakt', 'r:movie/603@1', unixepoch() - 100000, 'The Matrix', 'Movie' FROM hubs;
  INSERT INTO sent (hub, person, place, play, at) SELECT id, 'ada', 'here', 'u:movie/603', unixepoch() FROM hubs;
  INSERT INTO sent (hub, person, place, play, at) SELECT id, 'ada', 'here', 'i:movie/1', unixepoch() FROM hubs`);
await sync.getByRole('button', {name: 'What was synced'}).click(); await sync.locator('.synced .listed p').first().waitFor(); const synced = await sync.locator('.synced .listed p').allTextContents();
assert.equal(synced.length, 4); assert.match(synced[0], /^Andor · Season 2 · Episode 4 · paused spot added here · \S/); assert.match(synced[1], /^Dune · Movie · added to Trakt · \S/);
// A spot that took the place of an earlier one says so.
assert.match(synced[2], /^Heat · Movie · paused spot updated here · \S/);
// A title she marked unwatched in an app says so in plain words; the note that keeps it unwatched is not listed.
assert.match(synced[3], /^The Matrix · Movie · removed from Trakt · \S/);
await both(guest, '12i-trakt-what-was-synced', sync); await sync.getByRole('button', {name: 'Hide what was synced'}).click(); sqlLocal('DELETE FROM sent');
// Trakt asked the hub to wait: said with the time in one short sentence, in place of the quiet line, and no button until then.
sqlLocal(`INSERT INTO rows_cache (hub, person, kind, at, items) SELECT id, 'ada', 'trakt-wait', unixepoch() + 1800, '' FROM hubs`); await guest.reload();
await traktRow.locator('.status-line').getByText(/^Trakt asked us to wait until \d[^.]*\.$/).waitFor(); assert.equal((await under()).length, 1, 'one line, and not Last checked beside it'); assert.equal(await dot('wait'), 1);
assert.equal(await traktRow.locator('.status-line button').count(), 0, 'no button until then'); await both(guest, 'simple-09b-status-told-to-wait', sync); sqlLocal("DELETE FROM rows_cache WHERE kind = 'trakt-wait'");
// The same for a wait Trakt asked for on a write (kept apart, trakt.ts).
sqlLocal(`INSERT INTO rows_cache (hub, person, kind, at, items) SELECT id, 'ada', 'trakt-wait-send', unixepoch() + 1800, '' FROM hubs`); await guest.reload();
await traktRow.locator('.status-line').getByText(/^Trakt asked us to wait until \d[^.]*\.$/).waitFor(); assert.equal((await under()).length, 1); sqlLocal("DELETE FROM rows_cache WHERE kind = 'trakt-wait-send'");
// Not answering, with no time given: said at once, in one short sentence.
await syncIs(`failing = ${time() - 3600}, why = 'Trakt didn’t answer just now.'`);
await traktRow.locator('.status-line').getByText('Trakt isn’t answering. We’ll try again within the hour.', {exact: true}).waitFor(); assert.equal((await under()).length, 1); await both(guest, 'simple-09c-status-not-answering', sync);
// Plays of hers waiting for Trakt a while (it keeps turning them away), though no look has failed: the same, not green.
await syncIs('failing = NULL, why = NULL'); sqlLocal(`INSERT INTO trakt_outbox (hub, person, item, kind, path, body, made, tries, next, doubt) SELECT id, 'ada', 'x', 'mark', '/sync/history', '{}', unixepoch() - 1200, 3, unixepoch() + 9000, 0 FROM hubs`); await guest.reload();
await traktRow.locator('.status-line').getByText('Trakt isn’t answering. We’ll try again within the hour.', {exact: true}).waitFor(); assert.equal((await under()).length, 1); sqlLocal('DELETE FROM trakt_outbox');
// Three days of it: since when, and Try again.
await syncIs(`failing = ${time() - 4 * 86400}, why = 'Trakt didn’t answer just now.'`);
await traktRow.locator('.status-line').getByText(/^Trakt hasn’t answered since \w+\. Try again$/).waitFor(); await traktRow.getByRole('button', {name: 'Try again'}).waitFor(); assert.equal((await under()).length, 1); await both(guest, 'simple-09d-status-stopped-try-again', sync);
// MDBList refusing her key: said, with what to do about it.
await syncIs(`failing = ${time() - 3600}, why = 'MDBList isn’t taking requests from your key right now. If this lasts a day, paste a new key.'`);
await traktRow.locator('.status-line').getByText('MDBList isn’t accepting your key. If that lasts a day, connect MDBList again.', {exact: true}).waitFor(); assert.equal((await under()).length, 1); await both(guest, 'simple-09e-status-mdblist-key', sync);
// Her Trakt sign-in lapsed (as the hub would say it; the login itself is sealed, so the answer is changed on its way to the page):
// the Trakt card says to sign in again and offers Connect; the Sync card says it is paused and where to sign in, its switch not to be used.
const lapsed = async route => {const response = await route.fetch(), body = await response.json(); body.hub.people[0].history.again = true; return route.fulfill({response, json: body});};
await syncIs('failing = NULL, why = NULL'); await guest.route('**/api/state', lapsed); await guest.reload();
await trakt.getByText('Trakt needs you to sign in again.', {exact: true}).waitFor(); await trakt.getByRole('button', {name: 'Connect'}).waitFor();
await traktRow.locator('.status-line').getByText('Paused. Sign in to Trakt again, above.', {exact: true}).waitFor(); assert.equal((await under()).length, 1); assert.ok(await traktSwitch.isDisabled());
await both(guest, 'simple-09f-status-sign-in-again', sync); await guest.unroute('**/api/state', lapsed);
// She turns it off with the switch: the toast says so, and nothing is left under the switch.
await guest.reload(); await isOn(); await traktSwitch.click();
await toast(guest).filter({hasText: 'Trakt sync is off. Nothing is sent to Trakt and nothing comes back.'}).waitFor();
await isOff(); assert.deepEqual(await under(), []); assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).matching.on, false);
const [asked] = signins; assert.equal(asked.response_type, 'code'); assert.equal(asked.code_challenge_method, 'S256'); assert.equal(asked.prompt, undefined);
assert.equal(asked.redirect_uri, `${BASE}/api/trakt/callback`); assert.equal(await guest.evaluate(() => sessionStorage.length), 0);
// The Watchlist switch (worker/hearts.ts, worker/native.ts): not offered here, where nobody has a setup of their own. As the hub
// offers it to someone who may have it (the answer is changed on its way to the page, as above): one row, off, with its one
// sentence and the line about the heart; turning it on asks the hub, which says so, and the apps are asked to follow.
const favs = sync.getByRole('switch', {name: LIST_SYNC}), part = listRow;
assert.equal(await favs.count(), 0); assert.deepEqual(await rows(), ['Trakt']);
let favsOn = false, favExtra = 0; const favAsked = [];
const favOffered = async route => {const response = await route.fetch(), body = await response.json(); body.hub.front = true; body.hub.people[0].hearts = {on: favsOn, ...(favsOn && favExtra ? {extra: favExtra, more: false} : {})}; return route.fulfill({response, json: body});};
const favTurning = route => {const path = new URL(route.request().url()).pathname.split('/favorites')[1]; favAsked.push(path ? path : route.request().postDataJSON()); if (!path) favsOn = favAsked.at(-1).on; const added = path === '/add' ? favExtra : 0; if (path) favExtra = 0; return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(path ? {added} : {})});};
const synced_ = []; guest.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sync') synced_.push(1);});
await guest.route('**/api/state', favOffered); await guest.route('**/api/people/ada/favorites', favTurning); await guest.route('**/api/people/ada/favorites/*', favTurning); await guest.reload();
await favs.waitFor(); assert.equal(await favs.getAttribute('aria-checked'), 'false'); assert.deepEqual(await rows(), ['Trakt', 'Watchlist']);
// Only Trakt is connected: "my watchlist", plainly, and nothing is said of MDBList. The card, whole.
assert.deepEqual(await part.locator('p').allTextContents(), [SENTENCE.list, SENTENCE.heart]); assert.ok(!/MDBList/.test(await sync.textContent())); assert.equal(await part.locator('.offer').count(), 0);
assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt, 'Watchlist', SENTENCE.list, SENTENCE.heart]);
await both(guest, 'simple-03b-trakt-only-watchlist-off', sync);
// On, with titles she had saved that Trakt lacks (as the cron counted them): offered once under the switch, in one line, to add or leave.
favExtra = 3; const before_ = synced_.length; await favs.click(); await toast(guest).filter({hasText: 'Watchlist is on'}).waitFor(); assert.deepEqual(favAsked, [{on: true}]);
await sync.getByRole('switch', {name: LIST_SYNC, checked: true}).waitFor(); for (let n = 0; n < 40 && synced_.length === before_; n++) await guest.waitForTimeout(100); assert.ok(synced_.length > before_, 'the apps are asked to follow at once');
await part.locator('.offer').getByText('3 titles you saved in the apps aren’t on your watchlist.', {exact: true}).waitFor(); assert.deepEqual(await part.locator('.offer-actions button').allTextContents(), ['Add them', 'Not now']);
assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt, 'Watchlist', SENTENCE.list, SENTENCE.heart, '3 titles you saved in the apps aren’t on your watchlist.', 'Add them', 'Not now']);
await both(guest, 'simple-06-offer-saved-titles', sync);
// Add them asks first, in a small confirm; Cancel sends nothing.
await part.getByRole('button', {name: 'Add them'}).click(); await sure.getByRole('heading', {name: 'Add 3 titles to your watchlist?'}).waitFor(); await sure.getByText('They go on your Trakt watchlist. You can take any of them off later.', {exact: true}).waitFor();
await both(guest, 'simple-06b-offer-saved-titles-confirm', sure); await sure.getByRole('button', {name: 'Cancel'}).click(); await sure.waitFor({state: 'detached'}); assert.deepEqual(favAsked, [{on: true}], 'nothing sent');
await part.getByRole('button', {name: 'Add them'}).click(); await sure.getByRole('button', {name: 'Add them'}).click(); await toast(guest).filter({hasText: 'Adding 3 to your watchlist'}).waitFor(); assert.equal(favAsked.at(-1), '/add'); await part.locator('.offer').waitFor({state: 'detached'});
favExtra = 1; await guest.reload(); await part.locator('.offer').getByText('1 title you saved in the apps isn’t on your watchlist.', {exact: true}).waitFor();
await part.getByRole('button', {name: 'Not now'}).click(); await toast(guest).filter({hasText: 'Left as they are'}).waitFor(); assert.equal(favAsked.at(-1), '/later'); await part.locator('.offer').waitFor({state: 'detached'});
await favs.click(); await toast(guest).filter({hasText: 'Watchlist is off. Nothing was removed.'}).waitFor(); assert.deepEqual(favAsked.at(-1), {on: false});
await guest.unroute('**/api/state', favOffered); await guest.unroute('**/api/people/ada/favorites', favTurning); await guest.unroute('**/api/people/ada/favorites/*', favTurning); await guest.reload(); await isOff(); assert.equal(await favs.count(), 0);
// An older Trakt link made through AIOMetadata shows as a quiet note she can remove (made here directly in the local database).
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO secrets (hub, owner, kind, value) SELECT id, 'ada', 'trakt', 'x' FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await guest.reload(); await trakt.getByText('Nothing uses it any more').waitFor(); await shot(guest, '13-accounts-connected');
await trakt.getByRole('button', {name: 'Disconnect it'}).click(); await toast(guest).filter({hasText: 'Older Trakt link removed'}).waitFor();
// Said as soon as the hub answers; the card follows a moment later.
await trakt.getByText('Nothing uses it any more').waitFor({state: 'detached'}); await trakt.getByText('Connected as adatrakt').waitFor();
await trakt.getByRole('button', {name: 'Disconnect', exact: true}).click(); await guest.getByRole('heading', {name: 'Disconnect Trakt?'}).waitFor(); await guest.getByRole('button', {name: 'Cancel'}).click(); await trakt.getByText('Connected as adatrakt').waitFor();
// With Trakt connected, Recently Watched is on Home right after Watchlist. Switching it off keeps her following her group's Home.
await guest.goto(BASE + '/#/me/home'); const onHome = guest.locator('.rows li h3');
// One rule for where a row comes from. A row from her own account or watching says so in a pill, and its line says only what
// it holds; a row from a public source names it in plain text after its kind, and has no pill. Never both.
assert.deepEqual((await onHome.allTextContents()).slice(0, 4), ['WatchlistYour Trakt', 'Recommended MoviesYour Trakt', 'Recommended ShowsYour Trakt', 'Recently WatchedYour Trakt and watched here']);
assert.equal(await guest.locator('.rows li', {hasText: 'Recommended Movies'}).locator('.row-head p').textContent(), 'Movies');
assert.equal(await guest.locator('.rows li', {hasText: 'Watchlist'}).locator('.row-head p').textContent(), 'Movies & shows, newest first');
{const lines = await guest.locator('.rows li').evaluateAll(rows => rows.map(row => [row.querySelector('h3 .tag')?.textContent ?? '', row.querySelector('.row-head p')?.textContent ?? '']));
  for (const [pill, line] of lines) assert.ok(pill ? !/ · (Trakt|MDBList|TMDB)$/.test(line) : true, `a pill and a source on one row: ${pill} / ${line}`);
  assert.ok(lines.some(([pill, line]) => !pill && / · (Trakt|TMDB)$/.test(line)), 'public rows still name their source in the line'); assert.ok(!lines.some(([pill]) => /^From /.test(pill)));}
await both(guest, '13e-home-own-rows', guest.locator('.rows'));
// Each account-driven row says in one line, where it is edited, what it is and how it is put together.
const aboutOf = async name => {await guest.locator('.rows li', {hasText: name}).first().getByRole('button', {name: 'Edit'}).click(); const about = await guest.locator('dialog.sheet .about-row').textContent(); return about;};
const closeSheet = () => guest.locator('dialog.sheet').getByRole('button', {name: 'Close'}).click();
assert.equal(await aboutOf('Watchlist'), 'Your Trakt watchlist, newest added first.');
if (shots) for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-sync-7-row-edit-about-${width < 600 ? 'phone' : 'wide'}.png`});} await guest.setViewportSize({width: 390, height: 844});
await closeSheet(); assert.equal(await aboutOf('Recommended Movies'), 'Movies Trakt recommends for you, from your whole Trakt history. What is on your watchlist is left out.');
await closeSheet(); // Her Trakt sync is off, so Trakt does not hear of what she watches here: the row says it takes both.
assert.equal(await aboutOf('Recently Watched'), 'What you watched lately, newest first, each show once. From your Trakt history and what you finished here.'); await closeSheet();
// The rows that start off (Up Next, New for you) have no Edit until they are on Home: under Not on Home each says the same line.
await guest.locator('.off').evaluate(list => {list.open = true;});
assert.equal(await guest.locator('.off li', {hasText: 'New for you'}).locator('.about-row').textContent(), 'From your Trakt: new episodes of shows you watch and watchlist movies now out to stream, newest first. A title leaves once you start it.');
assert.equal(await guest.locator('.off li', {hasText: 'Up Next'}).locator('.about-row').textContent(), 'From your Trakt: shows with an episode you haven’t watched yet, the ones you watched most lately first.');
if (shots) for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await guest.locator('.off').scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await guest.locator('.off').screenshot({path: `${shots}/real-sync-7b-not-on-home-about-${width < 600 ? 'phone' : 'wide'}.png`});} await guest.setViewportSize({width: 390, height: 844});
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
// With Trakt connected nothing waits for an account any more (MDBList alone adds no row of its own now).
assert.equal(await sheet.getByRole('heading', {name: 'With an account'}).count(), 0);
await sheet.getByRole('heading', {name: 'Your lists'}).waitFor(); await sheet.getByText('Heist nights').waitFor(); await sheet.getByRole('button', {name: /^Heist nights\s*Your Trakt\s*12 titles$/}).waitFor();
assert.equal(await sheet.getByText('Sunday westerns').count(), 0, 'past the first five');
await sheet.getByRole('button', {name: 'Show all 7'}).click(); await sheet.getByText('Sunday westerns').waitFor(); assert.equal(await sheet.getByRole('button', {name: /^Show all/}).count(), 0);
// Without an MDBList key only the TMDB picks are offered, and the rest are said to be waiting for one. Sections with nothing in them
// are left out: the lists for children are all MDBList.
assert.deepEqual(await sheet.locator('.pick-section h4, .pick-section summary').allTextContents(), ['Worlds and series', 'Studios and channels']);
assert.deepEqual(await sheet.locator('.pick-section').nth(0).locator('li strong').allTextContents(), ['Marvel Cinematic Universe', 'Wizarding World', 'Middle-earth', 'James Bond']);
assert.deepEqual(await sheet.locator('.pick-section').nth(1).locator('li strong').allTextContents(), ['Pixar', 'Studio Ghibli', 'Kids’ Channels', 'Animation Studios']);
await sheet.getByText(/more ready-made rows read MDBList lists/).waitFor();
await sheet.getByRole('button', {name: /^Heist nights/}).click(); await toast(guest).filter({hasText: 'Added “Heist nights”'}).waitFor();
// Her own Trakt list: the account pill, which wins over "Yours" (a row she added that is not from an account keeps that).
assert.equal((await onHome.allTextContents())[0], 'Heist nightsYour Trakt'); assert.equal(await guest.locator('.rows li').first().locator('.row-head p').textContent(), 'List · 12 titles');
const mine = await guest.evaluate(async () => {for (let i = 0; i < 40; i++) {const me = (await (await fetch('/api/state')).json()).hub.people[0]; if (me.rows) return me.rows[0]; await new Promise(done => setTimeout(done, 250));} return null;});
assert.deepEqual([mine.id, mine.origin], ['trakt-mine.501', 'own']);
// Already on Home, it stays in its place, dimmed and saying so; so does a ready-made row once added.
await guest.getByRole('button', {name: '+ Add row'}).click(); sheet = guest.getByRole('dialog', {name: 'Add a row'}); await sheet.getByRole('button', {name: /^Heist nights\s*Your Trakt\s*On Home$/}).and(guest.locator(':disabled')).waitFor();
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
// With sync off nothing is compared with Trakt or offered to add by hand: the switch is off, and the page asks the hub nothing more.
const looks = []; guest.on('request', request => {if (/\/(compare\/[a-z]+-trakt|drift|carry|matching\/pass)(\?|$)/.test(new URL(request.url()).pathname)) looks.push(new URL(request.url()).pathname.split('/').pop());});
await guest.reload(); await isOff(); await guest.waitForTimeout(500);
assert.equal(await guest.locator('.differ').count(), 0); assert.equal(await guest.getByRole('button', {name: /Add them|Show them|Check again/}).count(), 0); assert.deepEqual(looks, []);
// Connecting MDBList saves the key and gives its rows; its switch is a row on the Sync card, off to start with, with its one sentence.
await mdb.getByRole('button', {name: 'Connect'}).click(); await guest.getByLabel('MDBList API key').fill('ada-mdblist-key');
await guest.getByRole('button', {name: 'Save'}).click(); await toast(guest).filter({hasText: 'MDBList connected'}).waitFor();
const keepIn = guest.getByRole('switch', {name: MDB_SYNC}); await keepIn.waitFor(); assert.equal(await keepIn.getAttribute('aria-checked'), 'false');
assert.equal(await mdbRow.locator('.switch-row h3').textContent(), 'MDBList'); const HINT = 'Want watched titles left out of your rows? Turn it on under Playback.', mdbOff = () => guest.getByRole('switch', {name: MDB_SYNC, checked: false}).waitFor();
await mdbOff(); assert.deepEqual(await mdbRow.locator('p').allTextContents(), [SENTENCE.mdblist], 'the sentence, and nothing under it'); assert.equal(await mdb.getByRole('switch').count(), 0, 'the MDBList card holds no switch');
assert.ok(!/progress|kept|this hub/i.test(await mdb.textContent() + await sync.textContent()), 'where progress lives is not named');
assert.equal((await mdb.locator('.gains p').allTextContents()).length, 2, 'the same two lines once connected'); assert.equal(await guest.locator('ul.accounts').count(), 1); assert.equal(await sync.count(), 1, 'the accounts, and the Sync card under them');
// Both connected, nothing synced yet: a row each. (Watchlist is not offered here: nobody has a setup of their own.) The card, whole.
assert.deepEqual(await rows(), ['Trakt', 'MDBList']); assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt, 'MDBList', SENTENCE.mdblist]);
await both(guest, 'simple-08a-both-connected-all-off', sync);
// With Trakt and MDBList both connected there is still one Watchlist, and it says it comes from both.
await guest.goto(BASE + '/#/me/home'); await guest.locator('.rows li', {hasText: 'Watchlist'}).getByText('Your Trakt and MDBList', {exact: true}).waitFor();
assert.equal((await onHome.allTextContents()).filter(name => name.startsWith('Watchlist')).length, 1); assert.equal(await guest.locator('.off li', {has: guest.locator('h3', {hasText: /^Watchlist/})}).count(), 0);
await both(guest, '12c-one-watchlist', guest.locator('.rows li', {hasText: 'Watchlist'}));
await guest.goto(BASE + '/#/me/accounts');
// Turning it on copies what was watched here that MDBList lacks, a pass at a time, then switches; meanwhile one calm line.
// (The first pass is answered here, and the next held a moment, so the line can be seen.)
let release; const hold = new Promise(done => {release = done;}), passes = {n: 0}, moveTo = /\/api\/people\/ada\/compare\/here-mdblist$/;
const copying = async route => {if (++passes.n === 1) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({added: 12, unmatched: 0, more: true, left: 28, switched: false})}); await hold; return route.continue();};
await guest.route(moveTo, copying);
await keepIn.click(); await mdbRow.locator('.status-line').getByText('Catching up. You can keep watching.', {exact: true}).waitFor(); assert.equal(await keepIn.getAttribute('aria-checked'), 'true');
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, false, 'not switched yet');
await both(guest, 'simple-09g-status-mdblist-catching-up', sync); release();
await toast(guest).filter({hasText: 'MDBList sync is on'}).waitFor(); await guest.unroute(moveTo, copying);
// On now (underneath, her progress is kept there: the hub says so, the page does not). Leaving watched titles out of rows takes a second
// switch, under Playback: one quiet hint says so, only while MDBList sync is on and that setting is off.
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, true, 'switched underneath, as before');
await mdbRow.locator('.quiet').getByText(HINT, {exact: true}).waitFor(); assert.equal(await mdbRow.locator('.status-line').count(), 0); assert.equal(await mdbRow.getByRole('link', {name: 'Playback'}).getAttribute('href'), '#/me/playback');
// With only MDBList sync on the foot says what unwatching in an app does, and nothing of Trakt's side.
assert.deepEqual(await said(), ['Sync', 'Trakt', SENTENCE.trakt, 'MDBList', SENTENCE.mdblist, HINT, FOOT.one]); await both(guest, 'simple-08b-both-connected-mdblist-on', sync);
const hides = async route => {const response = await route.fetch(), body = await response.json(); body.hub.people[0].settings = {...body.hub.people[0].settings, hideWatched: true}; return route.fulfill({response, json: body});};
await guest.route('**/api/state', hides); await guest.reload(); await guest.getByRole('switch', {name: MDB_SYNC, checked: true}).waitFor(); await guest.waitForTimeout(300); assert.deepEqual(await mdbRow.locator('p').allTextContents(), [SENTENCE.mdblist], 'no hint once it is on');
await both(guest, '13q-mdblist-kept-hiding-on', sync); await guest.unroute('**/api/state', hides); await guest.reload(); await mdbRow.locator('.quiet').getByText(HINT, {exact: true}).waitFor();
// Trakt's row reads the same whichever account keeps her progress: it never says where. Both synced, and (as the hub offers
// Watchlist to someone with a setup of their own: the answer is changed on its way to the page) Watchlist on: its sentence names
// neither account: saved titles and her watchlist are one list, said in two short lines. The card, whole.
await isOff(); await syncIs(`matching = 1, good = ${time()}`); await traktRow.locator('.quiet').getByText(CHECKED).waitFor(); assert.ok(!/MDBList|this hub/.test((await under()).join(' ')));
const NEEDS = 'This works once MDBList sync is on.';
const as = change => async route => {const response = await route.fetch(), body = await response.json(); body.hub.front = true; change(body.hub.people[0]); return route.fulfill({response, json: body});};
const shownAs = async (change, check) => {const route = as(change); await guest.route('**/api/state', route); await guest.reload(); await favs.waitFor(); await check(); await guest.unroute('**/api/state', route);};
await shownAs(me => {me.hearts = {on: true};}, async () => {
  await listRow.getByText(SENTENCE.heart, {exact: true}).waitFor(); assert.ok(!/Trakt|MDBList/.test(await listRow.innerText()), 'no account is named in the Watchlist row'); assert.equal(await favs.getAttribute('aria-checked'), 'true');
  const all = await said(); assert.match(all[3], CHECKED); assert.deepEqual([...all.slice(0, 3), ...all.slice(4)], ['Sync', 'Trakt', SENTENCE.trakt, 'MDBList', SENTENCE.mdblist, HINT, 'Watchlist', SENTENCE.list, SENTENCE.heart, FOOT.trakt, 'What was synced']);
  assert.deepEqual(await rows(), ['Trakt', 'MDBList', 'Watchlist']); await both(guest, 'simple-08-both-connected-watchlist-on', sync);
});
// Both connected with MDBList sync off: the same two lines.
await shownAs(me => {Object.assign(me, {hearts: {on: true}, lists: false, listsKept: true});}, async () => {assert.deepEqual(await listRow.locator('p').allTextContents(), [SENTENCE.list, SENTENCE.heart]);});
// MDBList alone (as the hub would say it for someone without Trakt, on a setup of their own): its row and Watchlist's, "my
// watchlist" plainly, and Trakt is not named anywhere on the card. The card, whole, with the switch off and on.
const alone = me => Object.assign(me, {history: null, matching: null});
await shownAs(me => {alone(me); me.hearts = {on: false};}, async () => {
  assert.deepEqual(await rows(), ['MDBList', 'Watchlist']); assert.deepEqual(await said(), ['Sync', 'MDBList', SENTENCE.mdblist, HINT, 'Watchlist', SENTENCE.list, SENTENCE.heart, FOOT.one]);
  assert.equal(await sync.getByText('Trakt', {exact: false}).count(), 0); assert.equal(await favs.getAttribute('aria-checked'), 'false'); assert.ok(await favs.isEnabled()); await both(guest, 'simple-07-mdblist-only', sync);
});
await shownAs(me => {alone(me); me.hearts = {on: true};}, async () => {assert.deepEqual(await listRow.locator('p').allTextContents(), [SENTENCE.list, SENTENCE.heart], 'on, with MDBList sync on: nothing more to say'); await both(guest, 'simple-07a-mdblist-only-watchlist-on', sync);});
// MDBList alone with MDBList sync off: Watchlist needs it, and says so in one short line: quietly while it is off, as a
// status line (it is on and doing nothing) while it is on.
await shownAs(me => {alone(me); Object.assign(me, {hearts: {on: false}, lists: false, listsKept: true});}, async () => {assert.deepEqual(await listRow.locator('p').allTextContents(), [SENTENCE.list, SENTENCE.heart, NEEDS]); assert.equal(await listRow.locator('.quiet').textContent(), NEEDS); assert.equal(await listRow.locator('.status-line').count(), 0);});
await shownAs(me => {alone(me); Object.assign(me, {hearts: {on: true}, lists: false, listsKept: true});}, async () => {
  assert.equal(await listRow.locator('.status-line').textContent(), NEEDS); assert.deepEqual(await said(), ['Sync', 'MDBList', SENTENCE.mdblist, 'Watchlist', SENTENCE.list, SENTENCE.heart, NEEDS]); await both(guest, 'simple-07b-mdblist-only-needs-mdblist-sync', sync);
});
await guest.reload(); await isOn();
await syncIs('matching = 0');
// Turning it off copies back what only MDBList has, then switches back. MDBList not answering stops it and says why, briefly; Try again
// carries on from there, saying how far it has got (the first pass is answered here and the next held a moment).
mdblistDown = true; await keepIn.click();
await mdbRow.locator('.status-line').getByText(/^Catching up stopped\. MDBList isn’t taking requests from your key right now\. Try again$/).waitFor(); await both(guest, 'simple-09h-status-mdblist-stopped', sync);
let goBack; const waitBack = new Promise(done => {goBack = done;}), backs = {n: 0}, moveBack = /\/api\/people\/ada\/compare\/mdblist-here$/;
const copyingBack = async route => {if (++backs.n === 1) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({added: 12, unmatched: 0, more: true, left: 28, switched: false})}); await waitBack; return route.continue();};
await guest.route(moveBack, copyingBack);
mdblistDown = false; await mdbRow.getByRole('button', {name: 'Try again'}).click();
await mdbRow.locator('.status-line').getByText('Catching up. You can keep watching.', {exact: true}).waitFor(); await both(guest, '13r-mdblist-copying-back', sync); goBack();
await toast(guest).filter({hasText: 'MDBList sync is off. Nothing was lost.'}).waitFor(); await guest.unroute(moveBack, copyingBack); assert.equal(await keepIn.getAttribute('aria-checked'), 'false');
await mdbOff(); assert.deepEqual(await mdbRow.locator('p').allTextContents(), [SENTENCE.mdblist]); assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, false, 'switched back underneath, as before');
// The manager's view of someone who has joined (Ada): her accounts and her sync are hers alone. One line at the top says so; each
// account card says only who it is connected as, with no button; every sync switch of hers is shown as it stands and cannot be
// used (Watchlist as the hub offers it: the answer is changed on its way to the page); no comparison and nothing of what she
// watched; and the hub refuses the manager whatever they send.
const they = {trakt: 'Keep what they watch the same here and on Trakt.', mdblist: 'Keep what they watch the same here and on MDBList.', list: 'Saved titles and their watchlist are one list.', heart: 'A title they save in an app (the heart, in some apps) goes on their watchlist. One added to their watchlist shows as saved in the apps.', foot: 'When they unwatch something in an app, it’s unwatched everywhere.', hint: 'Want watched titles left out of their rows? Turn it on under Playback.'};
const syncOffered = id => async route => {const response = await route.fetch(), body = await response.json(), one = body.hub.people.find(person => person.id === id); body.hub.front = true; if (id === 'ada') one.hearts = {on: true}; else Object.assign(one, {hearts: {on: chiOn}, history: {username: 'chitrakt', again: false}, matching: {on: false, earlier: false, passed: false, ask: false, good: 0, failing: null, why: null, waiting: null}}); return route.fulfill({response, json: body});};
let chiOn = false; const forAda = syncOffered('ada'), theirs = owner.locator('.sync-card'), switchOf = name => theirs.getByRole('switch', {name});
await owner.route('**/api/state', forAda); await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload();
await owner.locator('.section-head p').getByText('Ada manages their own accounts and sync.', {exact: true}).waitFor(); assert.equal(await owner.getByRole('button', {name: 'Turn on'}).count(), 0);
assert.equal(await owner.getByText('or you can do it here with them', {exact: false}).count(), 0); assert.equal(await owner.getByText('manages their own', {exact: false}).count(), 1, 'said once');
const cardOf = name => owner.locator('.accounts > li', {has: owner.getByRole('heading', {name: `${name} Free`, exact: true})});
await cardOf('Trakt').getByText('Connected as adatrakt').waitFor(); await cardOf('MDBList').getByText('Connected as adalists').waitFor();
assert.equal(await owner.locator('ul.accounts button').count(), 0, 'no Connect, Disconnect or anything else to press on her accounts'); assert.equal(await owner.locator('ul.accounts .gains').count(), 0); assert.equal(await owner.getByLabel('MDBList API key').count(), 0);
await both(owner, 'unwatch-manager-joined-accounts', owner.locator('ul.accounts'));
assert.deepEqual(await rows(owner), ['Trakt', 'MDBList', 'Watchlist']);
for (const [name, on] of [[TRAKT_SYNC, 'false'], [MDB_SYNC, 'false'], [LIST_SYNC, 'true']]) {assert.ok(await switchOf(name).isDisabled(), `${name} cannot be used`); assert.equal(await switchOf(name).getAttribute('aria-checked'), on, `${name} as it stands`);}
assert.deepEqual(await saidOn(owner), ['Sync', 'Trakt', they.trakt, 'MDBList', they.mdblist, 'Watchlist', they.list, they.heart]);
assert.equal(await owner.getByRole('button', {name: 'What was synced'}).count(), 0); assert.equal(await owner.locator('.consent, .offer').count(), 0);
const sends = (who, id, calls) => who.evaluate(async ([id, calls]) => {const out = []; for (const [method, path, body] of calls) {const got = await fetch(`/api/people/${id}/${path}`, {method, headers: {'content-type': 'application/json'}, body: method === 'GET' ? undefined : JSON.stringify(body ?? {})}); out.push([got.status, got.ok ? '' : (await got.json().catch(() => ({}))).message ?? '']);} return out;}, [id, calls]);
// Trakt sync: never a manager's.
assert.deepEqual((await sends(owner, 'ada', [['POST', 'matching', {on: true, earlier: true}], ['GET', 'matching'], ['GET', 'matching/synced'], ['POST', 'matching/pass']])).map(([status]) => status), [403, 403, 403, 403]);
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).matching.on, false, 'still off');
// MDBList sync and Watchlist: not a manager's once she has joined, by any of the routes the page uses.
const MANAGES = [403, 'Ada manages their own sync.'], ACCOUNTS = [403, 'Ada manages their own accounts.'];
assert.deepEqual(await sends(owner, 'ada', [['POST', 'compare/here-mdblist', {switch: true}], ['POST', 'moving', {to: null}], ['POST', 'favorites', {on: true}]]), [MANAGES, MANAGES, MANAGES]);
// Nor her accounts: connecting, disconnecting or reconnecting Trakt (either way of connecting it), saving or removing her MDBList key.
assert.deepEqual(await sends(owner, 'ada', [['POST', 'scrobble/link', {access: 'a', refresh: 'r'}], ['DELETE', 'scrobble'], ['POST', 'trakt', {tokenId: 'trakt-token-id-0001'}], ['DELETE', 'trakt'], ['POST', 'mdblist', {key: 'ada-mdblist-key', keep: true}], ['POST', 'mdblist', {key: 'ada-mdblist-key'}], ['POST', 'mdblist', {reuse: true, moving: true}], ['DELETE', 'mdblist/key']]), Array(8).fill(ACCOUNTS));
await owner.reload(); await cardOf('Trakt').getByText('Connected as adatrakt').waitFor(); await cardOf('MDBList').getByText('Connected as adalists').waitFor();
assert.equal((await guest.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people[0])).lists, false, 'still off'); await both(owner, 'simple-10-manager-joined-person', theirs);
// She turns her MDBList sync on herself; her manager then sees it on, still not theirs to use, and is not offered Disconnect
// on the MDBList card while it is (disconnecting would turn her sync off). Turning it off or removing her key is refused too.
await guest.reload(); await mdbOff(); await keepIn.click(); await toast(guest).filter({hasText: 'MDBList sync is on'}).waitFor();
await owner.reload(); await theirs.getByText(they.hint, {exact: true}).waitFor(); assert.ok(await switchOf(MDB_SYNC).isDisabled()); assert.equal(await switchOf(MDB_SYNC).getAttribute('aria-checked'), 'true');
await theirs.getByText(they.heart, {exact: true}).waitFor(); await theirs.locator('.sync-foot').getByText(they.foot, {exact: true}).waitFor(); assert.equal(await theirs.getByRole('link', {name: 'Playback'}).getAttribute('href'), '#/person/ada/playback');
assert.equal(await owner.locator('.accounts > li', {has: owner.getByRole('heading', {name: 'MDBList Free', exact: true})}).getByRole('button', {name: 'Disconnect'}).count(), 0); assert.equal(await owner.getByLabel('MDBList API key').count(), 0);
assert.deepEqual(await sends(owner, 'ada', [['DELETE', 'mdblist'], ['DELETE', 'mdblist/key'], ['POST', 'moving', {to: 'here'}], ['POST', 'compare/mdblist-here', {switch: true}]]), [MANAGES, ACCOUNTS, MANAGES, MANAGES]);
assert.equal(await owner.locator('ul.accounts').count(), 1); await both(owner, 'simple-10b-manager-joined-person-mdblist-on', theirs); await owner.unroute('**/api/state', forAda);
// The manager's view of someone who has not joined (Chi, made here through the API with an MDBList key, and removed after;
// Trakt and Watchlist as the hub would say them): MDBList sync and Watchlist are the manager's to set, and Trakt sync waits for
// Chi, in one line. The manager connects accounts with them, as before. Nothing says anyone manages their own accounts or sync.
assert.deepEqual(await owner.evaluate(async () => {const send = (method, path, body) => fetch(path, {method, headers: {'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined}); const hub = (await (await send('GET', '/api/state')).json()).hub;
  return [(await send('PUT', '/api/people/chi', {name: 'Chi', groupId: hub.groups[0].id, rows: null, settings: {}, can: {arrange: true, add: true, playback: true}, trakt: false, lists: false})).status, (await send('POST', '/api/people/chi/mdblist', {key: 'ada-mdblist-key', keep: true})).status];}), [200, 200]);
const forChi = syncOffered('chi'), chiAsked = [], chiTurning = route => {chiAsked.push(route.request().postDataJSON()); chiOn = chiAsked.at(-1).on; return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});};
await owner.route('**/api/state', forChi); await owner.route('**/api/people/chi/favorites', chiTurning); await owner.goto(BASE + '/#/person/chi/accounts'); await owner.reload(); await switchOf(LIST_SYNC).waitFor();
const WAITS = 'Only Chi can turn this on, after they join.';
assert.deepEqual(await saidOn(owner), ['Sync', 'Trakt', they.trakt, WAITS, 'MDBList', they.mdblist, 'Watchlist', they.list, they.heart]); assert.equal(await owner.getByText('manages their own', {exact: false}).count(), 0);
await owner.getByText('Chi can connect their own accounts, or you can do it here with them. Connecting only reads from them. Sync, below, is what writes.', {exact: true}).waitFor();
await owner.getByText('Up Next and New for you follow their Trakt, so they count what they watch anywhere.', {exact: true}).waitFor(); await owner.getByText('Adds their Trakt lists to Home.', {exact: true}).waitFor(); await owner.getByText('For you also learns from what they’ve watched on Trakt.', {exact: true}).waitFor();
await owner.getByText('Adds their MDBList watchlist to Watchlist, and their MDBList lists to My lists and Add row.', {exact: true}).waitFor(); await owner.getByText('Rows can hide what they’ve watched, once MDBList sync is on.').waitFor();
assert.equal(await cardOf('Trakt').getByRole('button', {name: 'Disconnect', exact: true}).count(), 1); assert.equal(await cardOf('MDBList').getByRole('button', {name: 'Disconnect'}).count(), 1);
assert.ok(await switchOf(TRAKT_SYNC).isDisabled()); assert.ok(await switchOf(MDB_SYNC).isEnabled()); assert.ok(await switchOf(LIST_SYNC).isEnabled());
// The manager's MDBList switch goes the same way as theirs would: copied first, then switched; nothing to paste. Then Watchlist.
await switchOf(MDB_SYNC).click(); await toast(owner).filter({hasText: 'MDBList sync is on'}).waitFor(); await theirs.getByText(they.hint, {exact: true}).waitFor(); assert.equal(await owner.getByLabel('MDBList API key').count(), 0);
assert.equal((await owner.evaluate(async () => (await (await fetch('/api/state')).json()).hub.people.find(person => person.id === 'chi'))).lists, true, 'switched by the manager, for someone who has not joined');
await switchOf(LIST_SYNC).click(); await toast(owner).filter({hasText: 'Watchlist is on'}).waitFor(); assert.deepEqual(chiAsked, [{on: true}]); await theirs.getByRole('switch', {name: LIST_SYNC, checked: true}).waitFor();
assert.deepEqual(await saidOn(owner), ['Sync', 'Trakt', they.trakt, WAITS, 'MDBList', they.mdblist, they.hint, 'Watchlist', they.list, they.heart, they.foot]);
await both(owner, 'simple-11-manager-not-joined-person', theirs);
// Trakt sync is still not the manager's, for someone who has not joined either.
assert.deepEqual((await sends(owner, 'chi', [['POST', 'matching', {on: true}]])).map(([status]) => status), [403]);
await owner.unroute('**/api/state', forChi); await owner.unroute('**/api/people/chi/favorites', chiTurning); assert.equal(await owner.evaluate(async () => (await fetch('/api/people/chi', {method: 'DELETE'})).status), 200);
// With an MDBList key the lists for children are offered too: folded, at the end of the ready-made rows, without a content limit.
// The manager's view of her Home says why her own lists are not there.
await owner.goto(BASE + '/#/person/ada/home'); await owner.reload();
// Her manager's view of her rows says whose account each comes from in their words ("Their Trakt"), never "Your".
await owner.locator('.rows h3 .tag').filter({hasText: /^Their Trakt/}).first().waitFor(); assert.equal(await owner.locator('.rows h3 .tag, .off h3 .tag').filter({hasText: /^(Your |What you)/}).count(), 0);
const keyed = await adding(owner, '6e-add-row-with-key'), young = keyed.locator('details.pick-section');
assert.equal(await young.locator('summary').textContent(), 'For children 4'); assert.equal(await young.evaluate(fold => fold.open), false);
assert.equal(await keyed.locator('.pick-section').last().locator('summary').count(), 1, 'for children comes last');
await keyed.getByRole('button', {name: /^Star Wars/}).waitFor(); await keyed.getByText('Their own Trakt and MDBList lists stay private', {exact: false}).waitFor();
await young.locator('summary').click(); assert.deepEqual(await young.locator('li strong').allTextContents(), ['Kids’ Movies, around 7', 'Kids’ Shows, around 7', 'Movies for 9 to 12', 'Kids’ Shows, up to 12']);
await keyed.getByRole('button', {name: 'Close'}).click();
// MDBList sync on, Trakt connected, Trakt sync off: still nothing compared or offered.
looks.length = 0; await guest.reload(); await isOff(); await guest.waitForTimeout(500); assert.deepEqual(looks.filter(look => look !== 'pass'), []);
// With sync on, nothing is compared or offered: when it last checked, and What was synced.
looks.length = 0; await syncIs(`matching = 1, good = ${time()}`); await traktRow.locator('.quiet').getByText(CHECKED).waitFor(); await sync.getByRole('button', {name: 'What was synced'}).waitFor();
assert.equal(await guest.locator('.differ').count(), 0); assert.equal(await guest.getByText('Nothing differs').count(), 0); await guest.waitForTimeout(500); assert.deepEqual(looks, []);
await guest.setViewportSize({width: 390, height: 844}); await shot(guest, '13n-accounts-syncing-phone'); await guest.setViewportSize({width: 1280, height: 900}); await shot(guest, '13n-accounts-syncing-wide'); await guest.setViewportSize({width: 390, height: 844});
await sync.getByRole('button', {name: 'What was synced'}).click(); await sync.getByText('Nothing has needed syncing yet.').waitFor(); await syncIs('matching = 0'); await isOff();
// Disconnecting while MDBList sync is on turns it off first, the same way (what only MDBList has is copied back). When MDBList won't answer, she can
// disconnect anyway; then she connects it again.
mdblistDown = true; await guest.reload(); await mdb.getByRole('button', {name: 'Disconnect'}).click(); await guest.getByRole('heading', {name: 'Disconnect MDBList?'}).waitFor();
await guest.locator('dialog.sheet').getByRole('button', {name: 'Disconnect'}).click(); await guest.getByRole('heading', {name: 'Disconnect anyway?'}).waitFor(); await shot(guest, '13o-mdblist-disconnect-anyway');
await guest.locator('dialog.sheet').getByRole('button', {name: 'Disconnect anyway'}).click(); await toast(guest).filter({hasText: 'MDBList disconnected'}).waitFor(); mdblistDown = false;
await mdb.getByRole('button', {name: 'Connect', exact: true}).waitFor(); assert.equal(await guest.getByRole('switch', {name: MDB_SYNC}).count(), 0);
sqlLocal('DELETE FROM drift');
// The manager who is Ada too opens her link once she has joined: straight into her own view, as if she had signed in, with her
// own things there. "Back to manager" returns to the manager's view, which was kept aside meanwhile.
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor(); await owner.getByRole('button', {name: 'Back to manager'}).waitFor();
await owner.goto(BASE + '/#/me/accounts'); await owner.getByText('Connect your own accounts.', {exact: false}).waitFor(); assert.equal(await owner.getByText('can connect their own accounts, or you can do it here', {exact: false}).count(), 0); await shot(owner, '14b-accounts-as-ada');
// Side by side: another tab in the same browser is still the manager's, and stays so while Ada's tab is used and reloaded.
const beside = await owner.context().newPage(); await beside.goto(BASE + '/#/'); await beside.getByText('Add someone to Family').waitFor();
await owner.reload(); await owner.getByText('Connect your own accounts.', {exact: false}).waitFor(); await beside.reload(); await beside.getByText('Add someone to Family').waitFor();
await beside.goto(BASE + '/#/person/ada/accounts'); await beside.getByText('Ada manages their own accounts and sync.', {exact: true}).waitFor(); await owner.reload(); await owner.getByText('Connect your own accounts.', {exact: false}).waitFor();
// Signing out of Ada's view ends only hers; the manager's tab stays signed in.
await owner.goto(BASE + '/#/me/you'); await owner.getByRole('button', {name: 'Sign out'}).click(); await owner.getByText('Add someone to Family').waitFor();
await beside.reload(); await beside.getByText('Ada manages their own accounts and sync.', {exact: true}).waitFor(); await beside.close();
await owner.goto(link); await owner.waitForURL(/#\/me/); await owner.getByText('Shared with you').waitFor();
await owner.getByRole('button', {name: 'Back to manager'}).click(); await owner.getByText('Add someone to Family').waitFor();
// Her rows' posters stay on her page: the hub's Home shows only blanks where her Trakt rows would go.
await owner.goto(BASE + '/#/hub'); await owner.locator('.rows .row.later').first().waitFor(); assert.equal(await owner.locator('.rows .row.later .posters span:not(.blank)').count(), 0);
await owner.goto(BASE + '/#/hub/playback'); await owner.getByText('for anyone with MDBList sync on', {exact: false}).waitFor();

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
// A title whose file runs longer than its listing (11 minutes listed, reports up to 17:21): four sittings, made in the local database
// as above. The first got past the listed end, so nothing said where the end was: stopped. Of the later ones (which began knowing
// the furthest point reached), one got near it (finished), one stopped halfway (stopped), and one sits paused now. Each bar is
// drawn against the furthest point reached, where it is is a time, and one quiet line says the listing is short.
const weekOf = async page => {const line = await page.locator('.feed li', {hasText: 'Ada'}).first().textContent(); return {titles: Number(/(\d+) titles?/.exec(line)?.[1] ?? 0), finished: Number(/(\d+) finished/.exec(line)?.[1] ?? 0)};};
const weekBefore = await weekOf(owner), T = "CAST(strftime('%s', 'now') AS INTEGER)";
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', `INSERT INTO plays (hub, person, item, title, detail, position, duration, device, playing, paused, since, updated, art, parts, over) SELECT id, 'ada', 'long-1', 'Tiny Tales', 'Season 1 · Episode 2', 755, 660, 'Strand · iPad', 1, 1, ${T} - 120, ${T}, '', '0-1041', 1041 FROM hubs;
  INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, parts, reached) SELECT id, 'ada', 'long-1', ${T} - 13000, 'Strand · iPad', 1041, 0, 0, ${T} - 11900, ${T} - 11900, '0-1041', 0 FROM hubs;
  INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, parts, reached) SELECT id, 'ada', 'long-1', ${T} - 9000, 'Strand · iPad', 1030, 0, 0, ${T} - 8200, ${T} - 8200, '300-1030', 1041 FROM hubs;
  INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, parts, reached) SELECT id, 'ada', 'long-1', ${T} - 5000, 'Strand · iPad', 520, 0, 0, ${T} - 4400, ${T} - 4400, '0-520', 1041 FROM hubs;
  INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, parts, reached) SELECT id, 'ada', 'long-1', ${T} - 900, 'Strand · iPad', 755, 1, 1, ${T} - 120, ${T}, '0-755', 1041 FROM hubs`], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await owner.reload(); await owner.mouse.move(0, 0); await owner.getByText('Tiny Tales').first().waitFor();
const long = owner.locator('li', {hasText: 'Tiny Tales'}), pausedLong = owner.locator('ul.now li', {hasText: 'Tiny Tales'});
assert.equal(await long.count(), 4, 'each sitting is its own entry'); assert.equal(await long.getByText('Runs longer than listed (11 min)').count(), 4);
assert.match(await pausedLong.textContent(), /Season 1 · Episode 2 · paused at 12:35 for \d+ min/); assert.doesNotMatch(await pausedLong.textContent(), /%|finished/);
// Paused at 12:35 of the 17:21 reached so far: the bar is filled to there and no further, with its mark at the same place.
const drawn = await pausedLong.locator('.bar').evaluate(bar => {const all = bar.getBoundingClientRect(), part = bar.querySelector('.part').getBoundingClientRect(), mark = bar.querySelector('b').getBoundingClientRect(); return {filled: part.width / all.width, mark: (mark.left + mark.width / 2 - all.left) / all.width, label: bar.getAttribute('aria-label')};});
assert.ok(Math.abs(drawn.filled - 755 / 1041) < 0.01 && Math.abs(drawn.mark - 755 / 1041) < 0.01, JSON.stringify(drawn)); assert.equal(drawn.label, 'Now at 12:35');
const past = await owner.locator('ul.plays li', {hasText: 'Tiny Tales'}).evaluateAll(items => items.map(item => item.querySelector('small').textContent.replace(/^.*Episode 2/, '')));
assert.deepEqual(past, [' · stopped at 8:40', ' · finished', ' · stopped at 17:21'], 'newest first: halfway, near the furthest point an earlier sitting reached, and the first to pass the listed end');
// This week counts it once as a title, and as finished once (by the sitting that got near the end, not by 90% of the listed length).
assert.deepEqual(await weekOf(owner), {titles: weekBefore.titles + 1, finished: weekBefore.finished + 1});
if (shots) {
  await pausedLong.scrollIntoViewIfNeeded(); await pausedLong.screenshot({path: `${shots}/real-16d-activity-longer-paused-wide.png`}); await shot(owner, '16d-activity-longer-page-wide');
  await owner.setViewportSize({width: 390, height: 844}); await owner.waitForTimeout(300); await pausedLong.scrollIntoViewIfNeeded(); await pausedLong.screenshot({path: `${shots}/real-16d-activity-longer-paused-phone.png`}); await shot(owner, '16d-activity-longer-page-phone');
  await owner.setViewportSize({width: 1280, height: 800});
}
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
// On her own page, without the permission to add rows: a quiet line where the button would be, instead of nothing.
await guest.goto(BASE + '/#/me/home'); await guest.reload(); await guest.locator('.rows li').first().waitFor();
assert.equal(await guest.getByRole('button', {name: '+ Add row'}).count(), 0); assert.equal(await guest.locator('.section-head .add-hint').textContent(), 'Adding rows is turned off for you. Your manager can turn it on.');
if (shots) for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-sync-9-add-row-hint-${width < 600 ? 'phone' : 'wide'}.png`});} await guest.setViewportSize({width: 390, height: 844});
// Someone saved with Add on and Arrange off before the two went together (made here in the local database) gets no Add row: the
// hub would refuse what it adds. The line says it is changing Home that is off.
sqlLocal(`UPDATE people SET data = json_set(data, '$.can.add', json('true')) WHERE id = 'ada'`);
await guest.goto(BASE + '/#/me/home'); await guest.reload(); await guest.locator('.rows li').first().waitFor();
assert.equal(await guest.getByRole('button', {name: '+ Add row'}).count(), 0, 'no Add row without Arrange'); assert.equal(await guest.locator('.section-head .add-hint').textContent(), 'Changing Home is turned off for you. Your manager can turn it on.');
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
// Someone with no account at all who has watched something here (the page is told so): Up Next and New for you are theirs too,
// under Not on Home as they start, each saying it comes from what they watched here and how it is put together. With an MDBList
// key, New for you says the watchlist counts too. The rows by service and by genre say what order their titles are in: the
// public list's own, or under a content limit the most popular on TMDB.
const plainly = (extra = {}) => async route => {const response = await route.fetch(), body = await response.json(), me = body.hub.people[0];
  Object.assign(me, {history: null, trakt: false, lists: false, listsKept: false, played: true, matching: null, hearts: null, rows: null, picks: {}, ...extra}); await route.fulfill({response, json: body}).catch(() => {});};
const offRow = name => guest.locator('.off li', {hasText: name}), saidOff = async name => [await offRow(name).locator('h3 .tag').textContent(), await offRow(name).locator('.about-row').textContent()];
const saidIn = async name => {await guest.locator('.rows li', {hasText: name}).first().getByRole('button', {name: 'Edit'}).click(); const text = await guest.locator('dialog.sheet .about-row').textContent(); await closeSheet(); return text;};
await guest.route('**/api/state', plainly()); await guest.goto(BASE + '/#/me/home'); await guest.reload(); await guest.locator('.rows li').first().waitFor(); await guest.locator('.off').evaluate(list => {list.open = true;});
assert.deepEqual(await saidOff('Up Next'), ['What you’ve watched here', 'Shows you watch here that have a next episode out, the ones you watched most lately first.']);
assert.deepEqual(await saidOff('New for you'), ['What you’ve watched here', 'New episodes of shows you watch here, newest first, checked once a day. A show leaves once you start the new episode.']);
if (shots) {await guest.locator('.off').scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-21-no-account-rows-phone.png`});}
assert.equal(await saidIn('Movies by Service'), 'A tile for each streaming service. Each opens a public list of movies on that service, in that list’s own order.');
assert.equal(await saidIn('Shows by Service'), 'A tile for each streaming service. Each opens a public list of shows on that service, in that list’s own order.');
assert.equal(await saidIn('Movies by Genre'), 'A tile for each genre. Each opens a public list of movies in that genre, in that list’s own order.');
assert.equal(await saidIn('Shows by Genre'), 'A tile for each genre. Each opens a public list of shows in that genre, in that list’s own order.');
if (shots) {await guest.locator('.rows li', {hasText: 'Movies by Service'}).first().getByRole('button', {name: 'Edit'}).click(); await guest.waitForTimeout(300); await guest.screenshot({path: `${shots}/real-21b-by-service-about-phone.png`}); await closeSheet();}
await guest.unroute('**/api/state'); await guest.route('**/api/state', plainly({listsKept: true, settings: {limit: 'teen'}})); await guest.reload(); await guest.locator('.rows li').first().waitFor(); await guest.locator('.off').evaluate(list => {list.open = true;});
assert.deepEqual(await saidOff('New for you'), ['Your MDBList and watched here', 'New episodes of shows you watch here or have on your MDBList watchlist, and watchlist movies now out to stream. Newest first, checked once a day. A title leaves once you start it.']);
assert.deepEqual(await saidOff('Up Next'), ['What you’ve watched here', 'Shows you watch here that have a next episode out, the ones you watched most lately first.']);
assert.equal(await saidIn('Movies by Service'), 'A tile for each streaming service. Each opens the movies on that service that fit the content limit, the most popular on TMDB first.');
assert.equal(await saidIn('Movies by Genre'), 'A tile for each genre. Each opens a public list of movies in that genre, in that list’s own order.');
await guest.unroute('**/api/state'); await guest.reload(); await guest.locator('.rows li').first().waitFor();
// On her own Home the rows that change on their own say when (times made here, an hour ago, as this hub picks nothing): For you
// places when they change next, or that they are kept; My Trakt lists when it was checked; rows always current say nothing.
// Each one's Edit sheet asks the hub for something now, answered here too. Nothing is saved while these made-up rows are shown.
const hourAgo = Math.floor(Date.now() / 1000) - 3600, seen = Math.floor(Date.now() / 1000) - 2 * 86400, shelfRow = {id: 'trakt-lists', title: 'My Trakt lists', kind: 'Collection · 2 lists', source: 'Trakt · your lists', origin: 'own', on: true};
// The lists she liked have a row of their own; each row shows its own lists' pictures. New for you is switched on here too.
const likedRow = {id: 'trakt-liked-lists', title: 'Trakt lists I liked', kind: 'Collection · 1 list', source: 'Trakt · lists you liked', origin: 'own', on: true}, shelfTiles = [{title: 'Heist nights', image: '/covers/00.jpg'}, {title: 'Rainy days', image: '/covers/01.jpg'}, {title: 'Sunday westerns', image: '/covers/02.jpg', liked: true}];
// Her For you today, as the hub tells it: each place's pick and what it came from, six other options, two kinds with nothing.
const forYouDetail = {places: {'for-you-1': {key: 'because:m27205', kind: 'because', name: 'Because you watched Inception', why: {title: 'Inception', seen}, seed: 'm27205'},
    'for-you-2': {key: 'series:263', kind: 'series', name: 'More from The Dark Knight', why: {title: 'The Dark Knight', seen, more: 2}, seed: 'm155', keep: true}, 'for-you-3': {key: 'popular:movie', kind: 'popular', name: 'Popular movies lately'}},
  options: [{key: 'crew:525', kind: 'crew', name: 'More from Christopher Nolan', why: {title: 'Inception', seen, who: 'Christopher Nolan'}, seed: 'm27205'}, {key: 'genres:18', kind: 'genres', name: 'Drama movies for you', why: {title: 'Drama'}},
    {key: 'different:37', kind: 'different', name: 'Something different: Western movies', why: {title: 'Western'}}, {key: 'top10:movie', kind: 'top10', name: 'Top 10 movies on Netflix in Nigeria', why: {title: 'Nigeria'}},
    {key: 'because:s1396', kind: 'because', name: 'Because you watched Breaking Bad', why: {title: 'Breaking Bad', seen: seen - 3 * 86400}, seed: 's1396'}, {key: 'because:m550', kind: 'because', name: 'Because you watched Fight Club', why: {title: 'Fight Club', seen: seen - 9 * 86400}, seed: 'm550'}],
  none: {pickup: 'none', seasonal: 'off'}, never: [{seed: 'm680', title: 'Pulp Fiction'}]};
const forYouState = shelf => async route => {const response = await route.fetch(), body = await response.json(), me = body.hub.people[0]; body.hub.front = true; body.hub.forYouHour = 5;
  Object.assign(me, {...(shelf ? {rows: [shelfRow, likedRow, ...me.rows.map(row => row.id === 'new-for-you' ? {...row, on: true} : row)], shelfAt: hourAgo, shelfTiles} : {}), pickedAt: hourAgo, forYouDetail, forYou: Object.fromEntries(Object.entries(forYouDetail.places).map(([place, pick]) => [place, pick.name])), forYouKinds: Object.fromEntries(Object.entries(forYouDetail.places).map(([place, pick]) => [place, pick.kind]))});
  await route.fulfill({response, json: body}).catch(() => {});};
await guest.route('**/api/state', forYouState(true));
const askedNow = [];
for (const path of ['**/api/people/ada/foryou/*', '**/api/people/ada/shelf']) await guest.route(path, route => {askedNow.push([new URL(route.request().url()).pathname, route.request().postDataJSON()]); return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});});
// A row by its name, or a For you row by what it holds today.
await guest.reload(); const rowOf = title => guest.locator('.rows .row', {has: guest.locator('h3, p', {hasText: new RegExp(`^(Today: )?${title}`)})});
// The two rows of her Trakt lists, saved under the names they had before ("My Trakt lists", "Trakt lists I liked"), show the
// names they have now: the pill says they are from her Trakt, so the name need not. Their line says when they were checked.
assert.equal(await guest.locator('.rows h3', {hasText: /Trakt lists/}).count(), 0);
await rowOf('My lists').getByText(/^Lists checked (yesterday )?at .+ · next check (today|tomorrow)$/).waitFor(); await rowOf('My lists').locator('h3 .tag').getByText('Your Trakt', {exact: true}).waitFor();
await rowOf('Lists I liked').getByText(/^Lists checked /).waitFor(); await rowOf('Lists I liked').locator('h3 .tag').getByText('Your Trakt', {exact: true}).waitFor();
assert.deepEqual([await rowOf('My lists').locator('.covers span').count(), await rowOf('Lists I liked').locator('.covers span').count()], [2, 1], 'each row shows its own lists');
await rowOf('New for you').getByText('Movies & shows, newest first', {exact: true}).waitFor(); await rowOf('New for you').locator('h3 .tag').getByText('Your Trakt', {exact: true}).waitFor();
assert.equal(await rowOf('Up Next').count() ? await rowOf('Up Next').locator('h3 .tag').textContent() : 'Your Trakt', 'Your Trakt');
await rowOf('Trending Movies').getByText(/^Movies · (Trakt|TMDB)$/).waitFor(); assert.equal(await rowOf('Trending Movies').locator('h3 .tag').count(), 0, 'a public row has no pill');
await guest.locator('.rows').scrollIntoViewIfNeeded(); await both(guest, 'unwatch-home-pills', guest.locator('.rows'));
await both(guest, '18f-home-new-rows', rowOf('New for you'));
// A For you row is headed For you; its line says what it holds today and when it picks again, or that it is kept.
await rowOf('Because you watched Inception').getByText(/^Today: Because you watched Inception · picks again (at \d.+|tomorrow at \d.+|soon)$/).waitFor();
await rowOf('More from The Dark Knight').getByText('Today: More from The Dark Knight · kept', {exact: true}).waitFor();
await rowOf('Popular movies lately').getByText('Today: Popular movies lately · until there’s more to go on', {exact: true}).waitFor();
assert.deepEqual(await guest.locator('.rows .row', {has: guest.locator('p', {hasText: /^Today: /})}).locator('h3').allTextContents(), ['For you', 'For you', 'For you']);
assert.ok(!/picked|checked|changes/.test(await rowOf('Trending Movies').locator('p').first().textContent()), 'a row always current says nothing of times');
await rowOf('My lists').scrollIntoViewIfNeeded(); await shot(guest, '18-home-times');
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
await rowOf('More from The Dark Knight').getByRole('button', {name: 'Edit'}).click(); await keptSheet.getByRole('button', {name: 'Let it change again'}).waitFor();
await story.getByText('Kept: it stays “More from The Dark Knight” until you let it change.', {exact: true}).waitFor(); await story.getByText(/^You watched The Dark Knight on [A-Z][a-z]+day\. 2 more films in the series are out\.$/).waitFor();
if (shots) await guest.screenshot({path: `${shots}/real-18d-for-you-kept-phone.png`}); await keptSheet.getByRole('button', {name: 'Not from The Dark Knight again'}).click(); await toast(guest).filter({hasText: 'Nothing more from “The Dark Knight”. Your apps have it in a few minutes.'}).waitFor();
// A pick made before reasons were kept says only what it is and when it picks again, never its kind a second time.
const inception = forYouDetail.places['for-you-1']; forYouDetail.places['for-you-1'] = {key: 'because:s60574', kind: 'because', name: 'Because you watched Peaky Blinders', seed: 's60574'};
await guest.reload(); await rowOf('Because you watched Peaky Blinders').getByRole('button', {name: 'Edit'}).click();
await story.getByText('This row picks something new each day from the kinds you have on. Today it’s “Because you watched Peaky Blinders”.', {exact: true}).waitFor();
assert.equal(await story.locator('p').count(), 2, await story.textContent()); assert.equal((await story.locator('p').allTextContents()).join(' ').match(/Because you watched/g).length, 1, await story.textContent());
if (shots) {await guest.locator('.sheet-body').evaluate(element => {element.scrollTop = 0;}); await guest.screenshot({path: `${shots}/real-18e-for-you-no-reason-phone.png`});}
await placeSheet.getByRole('button', {name: 'Close'}).click(); forYouDetail.places['for-you-1'] = inception; await guest.reload();
await rowOf('My lists').getByRole('button', {name: 'Edit'}).click(); await guest.getByRole('button', {name: 'Check my lists now'}).waitFor(); await shot(guest, '18c-check-lists');
assert.equal(await guest.locator('dialog.sheet .about-row').textContent(), 'Your own Trakt lists, a tile for each. Opening a tile shows that list. Checked once a day.');
await guest.getByRole('button', {name: 'Check my lists now'}).click(); await toast(guest).filter({hasText: 'Checking your lists. Your apps have them in a few minutes.'}).waitFor();
assert.deepEqual(askedNow, [['/api/people/ada/foryou/for-you-1', {use: 'genres:18'}], ['/api/people/ada/foryou/for-you-1', {keep: true}], ['/api/people/ada/foryou/for-you-2', {never: true}], ['/api/people/ada/shelf', {}]]);
await guest.unrouteAll({behavior: 'wait'}); await guest.reload(); await guest.locator('.rows li').first().waitFor(); assert.equal(await rowOf('My lists').count(), 0);
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
await kindsCard.getByText('More from a movie series first · 8 of 8 on', {exact: true}).waitFor(); assert.equal(await kinds.count(), 0);
if (shots) for (const [width, height] of [[390, 844], [1280, 900]]) {await guest.setViewportSize({width, height}); await kindsCard.scrollIntoViewIfNeeded(); await guest.waitForTimeout(300); await kindsCard.screenshot({path: `${shots}/real-19a-kinds-folded-${width < 600 ? 'phone' : 'wide'}.png`});}
await guest.setViewportSize({width: 390, height: 844}); await kindsCard.getByRole('button', {name: 'Change'}).click();
await kinds.scrollIntoViewIfNeeded(); assert.deepEqual(await kindNames(), ['More from a movie series', 'Pick back up', 'More from a director', 'Because you watched', 'Your genres', 'Seasonal', 'Top 10', 'Something different']);
await guest.locator('.setting', {hasText: 'Not picked from'}).getByText('Pulp Fiction').waitFor();
// Each kind says what it picks, in her words.
await kinds.locator('li', {hasText: 'Pick back up'}).getByText('Shows you left partway, last watched between three weeks and a year ago.', {exact: true}).waitFor();
await kinds.locator('li', {hasText: 'Top 10'}).getByText('What’s most watched on Netflix where you last played, or worldwide. Not from your own watching.', {exact: true}).waitFor();
// If picked now, from today's options: each row from the next kind in her order with something (the kept row stays), redone at
// once as she drags or switches.
const ifNow = () => kindsCard.locator('.if-now li').evaluateAll(lines => lines.map(line => [line.querySelector('strong').textContent, line.querySelector('small').textContent]));
assert.deepEqual(await ifNow(), [['More from a director', 'More from Christopher Nolan'], ['More from a movie series', 'More from The Dark Knight · kept'], ['Because you watched', 'Inception']]);
// Dragged by its handle, Something different goes to the top.
// (A tall window, so the whole list, with each kind's line, is on screen at once.)
await guest.setViewportSize({width: 390, height: 2000}); await kinds.scrollIntoViewIfNeeded();
const grip = kinds.getByRole('button', {name: 'Move Something different'}), top = kinds.locator('li').first();
const [from, to] = [await grip.boundingBox(), await top.boundingBox()];
await guest.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await guest.mouse.down();
for (let step = 1; step <= 12; step++) {await guest.mouse.move(from.x + from.width / 2, from.y + (to.y + 4 - from.y) * step / 12); await guest.waitForTimeout(30);}
await guest.mouse.up(); await guest.setViewportSize({width: 390, height: 844});
await saved(got => got.forYouOrder?.[0] === 'different', 'dragged to the top'); assert.equal((await kindNames())[0], 'Something different');
assert.deepEqual(await ifNow(), [['Something different', 'Western movies'], ['More from a movie series', 'More from The Dark Knight · kept'], ['More from a director', 'More from Christopher Nolan']]);
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
// The manager's Background work: a Trakt lists row asked for again (0) is under way, never "next run 1 Jan 1970". (Going to the
// page and reloading cancels the first read, whose answer is then left unsent.)
await owner.route('**/api/state', async route => {const response = await route.fetch(), body = await response.json(); body.hub.front = true; Object.assign(body.hub.jobs, {shelfDue: 0, shelves: 1, shelved: hourAgo}); await route.fulfill({response, json: body}).catch(() => {});});
await owner.goto(BASE + '/#/hub/general'); await owner.reload(); const listsJob = owner.locator('.jobs li', {hasText: 'My lists rows'});
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
