// Drives the real site in a browser against `wrangler dev` with a throwaway local database: create the account, set up, invite, join.
// Usage: node tests/browser.mjs <chromium path> [screenshot dir]
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://localhost:8799', shots = process.argv[3];
const browser = await chromium.launch({executablePath: process.argv[2]}), errors = [];
const open = async () => {const context = await browser.newContext({viewport: {width: 390, height: 844}}), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page;};
const shot = async (page, name) => {if (shots) await page.screenshot({path: `${shots}/real-${name}.png`, fullPage: true});};
const toast = page => page.locator('.toast span');

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
