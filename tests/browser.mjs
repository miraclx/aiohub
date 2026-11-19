// Drives the real site in a browser against `wrangler dev` with a throwaway local database: create the account, set up, invite, join.
// Usage: node tests/browser.mjs <chromium path> [screenshot dir]
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
const BASE = process.env.BASE ?? 'http://localhost:8799', shots = process.argv[3];
const browser = await chromium.launch({executablePath: process.argv[2]}), errors = [];
const open = async () => {const context = await browser.newContext({viewport: {width: 390, height: 844}}), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page;};
const shot = async (page, name) => {if (shots) await page.screenshot({path: `${shots}/real-${name}.png`, fullPage: true});};
const toast = page => page.locator('.toast span');
// Stand-ins for the accounts a person connects: Trakt's code flow (typed on the second ask), AIOMetadata's description of its own
// Trakt Token ID, and MDBList's check of a key. Nothing else answers, so the players never get set up here; that is not tested here.
let polls = 0;
http.createServer(async (request, answer) => {
  const send = (status, body) => {answer.writeHead(status, {'content-type': 'application/json'}); answer.end(JSON.stringify(body));};
  let raw = ''; for await (const chunk of request) raw += chunk;
  if (request.url === '/trakt/oauth/device/code') {polls = 0; return send(200, {device_code: 'device', user_code: 'ABCD1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1});}
  if (request.url === '/trakt/oauth/device/token') return ++polls < 2 ? send(400, {}) : send(200, {access_token: 'access', refresh_token: 'refresh', expires_in: 7 * 86400, created_at: Math.floor(Date.now() / 1000)});
  if (request.url === '/trakt/users/settings') return send(200, {user: {username: 'adatrakt'}});
  if (request.url === '/trakt/oauth/revoke') return send(200, {});
  if (request.url.startsWith('/mdblist/user')) return send(request.url.includes('apikey=ada-mdblist-key') ? 200 : 403, {username: 'adalists'});
  request.socket.destroy(); // as if nothing were there
}).listen(8798, '127.0.0.1').unref();

const owner = await open();
await owner.goto(BASE + '/'); await owner.getByRole('heading', {name: 'Sign in'}).waitFor(); await shot(owner, '1-signin');
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
// Connecting Trakt: Trakt's code is shown, and the page carries on by itself once it has been typed.
await trakt.getByRole('button', {name: 'Connect'}).click(); await trakt.getByText('ABCD1234').waitFor();
await toast(guest).filter({hasText: 'Trakt connected as adatrakt'}).waitFor(); await trakt.getByText('Connected as adatrakt.').waitFor();
// An older Trakt link made through AIOMetadata shows as a quiet note she can remove (made here directly in the local database).
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', "INSERT INTO secrets (hub, owner, kind, value) SELECT id, 'ada', 'trakt', 'x' FROM hubs"], {cwd: new URL('..', import.meta.url), env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: 'ignore'});
await guest.reload(); await trakt.getByText('Nothing uses it any more').waitFor(); await shot(guest, '13-accounts-connected');
await trakt.getByRole('button', {name: 'Disconnect it'}).click(); await toast(guest).filter({hasText: 'Older Trakt link removed'}).waitFor();
assert.equal(await trakt.getByText('Nothing uses it any more').count(), 0); await trakt.getByText('Connected as adatrakt.').waitFor();
// MDBList: with her key saved, progress is kept there, and copying what she watched here is offered on her own page.
await guest.getByRole('radio', {name: 'MDBList'}).click(); await guest.getByLabel('MDBList API key').fill('ada-mdblist-key'); await guest.getByRole('button', {name: 'Save'}).click();
await toast(guest).filter({hasText: 'MDBList connected as adalists'}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'MDBList'}).getAttribute('aria-checked'), 'true');
await guest.getByText('What you watched here').waitFor(); assert.equal(await guest.getByText('Hiding what’s been watched needs MDBList').count(), 0);
// The manager sees the same states, without the copy step: that is hers alone.
await owner.goto(BASE + '/#/person/ada/accounts'); await owner.reload(); await owner.getByText('Connected as adatrakt.').waitFor();
await owner.getByText('can copy it to MDBList from their own page').waitFor(); assert.equal(await owner.getByText('What you watched here').count(), 0); await shot(owner, '14-accounts-manager');
// Back to Here asks first, then MDBList is let go.
await guest.getByRole('radio', {name: 'Here'}).click(); await guest.getByRole('button', {name: 'Keep it here'}).click();
await toast(guest).filter({hasText: 'Progress kept here'}).waitFor(); assert.equal(await guest.getByRole('radio', {name: 'Here'}).getAttribute('aria-checked'), 'true');
await owner.goto(BASE + '/#/hub/playback'); await owner.getByText('It needs progress kept in MDBList').waitFor();

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
