#!/usr/bin/env node
// Sets up your own copy of AIOHub on your Cloudflare account (the Free plan is enough): makes the database, applies its tables,
// makes the site's own keys, and deploys. Run it once from this folder, after `npx wrangler login`:
//   node setup.mjs [--aiostreams https://your.aiostreams.host] [--aiometadata https://your.aiometadata.host]
// It prints the one-time link that creates the first (your) hub. Run it again any time: it keeps what already exists.
// It stops, changing nothing, if the Worker already has a VAULT_KEY and this folder has no .instance.json to match it.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, chmodSync, rmSync} from 'node:fs';

const arg = name => {const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined;};
const stop = message => {console.error(`\n${message}`); process.exit(1);};
const wrangler = (args, quiet) => execFileSync('npx', ['wrangler', ...args], {encoding: 'utf8', env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit']});
const SIGNED_OUT = /not authenticated|not logged in|wrangler login|CLOUDFLARE_API_TOKEN|authentication error|code: 10000/i, LOGIN = 'Run `npx wrangler login` first, then run this again.';
// What a wrangler command that failed said (it never holds the site's keys), for showing as it is.
const said = error => [error.stderr, error.stdout].map(text => String(text ?? '').trim()).filter(Boolean).join('\n') || String(error.message ?? error);
// A wrangler command that fails stops the setup with what wrangler said and one plain line on what to do, not a Node error.
const run = (args, quiet) => {
  try {return wrangler(args, quiet);} catch (error) {
    const text = said(error); console.error(text);
    stop(error.code === 'ENOENT' ? 'npx was not found. Install Node.js 22 or later, then run this again.'
      : SIGNED_OUT.test(text) ? LOGIN
      : `\`npx wrangler ${args.join(' ')}\` did not work. What it said is above. Once that is fixed, run this again: it keeps what already exists.`);
  }
};
const file = 'wrangler.jsonc', KEEP = '.instance.json';
let config = readFileSync(file, 'utf8');
const name = /"database_name":\s*"([^"]+)"/.exec(config)[1];

// 0. The keys this folder keeps from an earlier run, if any, looked at before anything is changed.
const kept = existsSync(KEEP) ? JSON.parse(readFileSync(KEEP, 'utf8')) : {};
// No key kept here, yet the Worker may already have one (set up from another folder, or from the Cloudflare dashboard). A new
// key in its place would leave everything stored unreadable, so nothing is made or sent until that is known. A Worker that does
// not exist yet has none. `--new-keys` skips the look, for a site with nothing stored.
if (!kept.VAULT_KEY && !process.argv.includes('--new-keys')) {
  let has = false;
  try {has = /\bVAULT_KEY\b/.test(wrangler(['secret', 'list'], true));} catch (error) {
    const text = said(error);
    if (SIGNED_OUT.test(text) || !/10007|script_not_found|does not exist/i.test(text)) {console.error(text); stop(SIGNED_OUT.test(text) ? LOGIN : 'Could not check whether this Worker already has a VAULT_KEY, so no new one was made. What wrangler said is above. If this is a new site with nothing stored yet, run this again with --new-keys.');}
  }
  if (has) stop(`This Worker already has a VAULT_KEY, and ${KEEP} (the file that keeps a copy of it) is not in this folder.\nA new key would leave every key and password the site has stored unreadable, so nothing was changed.\nPut your copy of ${KEEP} back in this folder and run this again.`);
}

// 1. The database. If this account has none by that name, make one and point the config at it.
const listed = JSON.parse(run(['d1', 'list', '--json'], true)), found = listed.find(item => item.name === name);
const id = found?.uuid ?? /"uuid":\s*"([^"]+)"|database_id\s*=\s*"([^"]+)"|"database_id":\s*"([^"]+)"/.exec(run(['d1', 'create', name], true))?.slice(1).find(Boolean);
if (!id) stop('Could not make the database. Run `npx wrangler d1 create ' + name + '` and put its id in wrangler.jsonc.');
config = /"database_id"/.test(config) ? config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${id}"`) : config.replace(/("database_name":\s*"[^"]+")/, `$1, "database_id": "${id}"`);
// (A config still under the earlier names, UP_ORIGIN and AIOM_ORIGIN, is moved to the new ones.)
if (arg('aiostreams')) config = config.replace(/"(?:AIOSTREAMS_ORIGIN|UP_ORIGIN)":\s*"[^"]*"/, `"AIOSTREAMS_ORIGIN": "${arg('aiostreams').replace(/\/+$/, '')}"`);
if (arg('aiometadata')) config = config.replace(/"(?:AIOMETADATA_ORIGIN|AIOM_ORIGIN)":\s*"[^"]*"/, `"AIOMETADATA_ORIGIN": "${arg('aiometadata').replace(/\/+$/, '')}"`);
writeFileSync(file, config);
console.log(found ? `Using the existing database ${name}.` : `Made the database ${name}.`);
run(['d1', 'migrations', 'apply', name, '--remote'], true); console.log('Tables are in place.');

// 2. The site's own keys, made once and kept in a file only you can read. VAULT_KEY locks every stored key and password:
//    lose it and they cannot be read again, so keep a copy of .instance.json somewhere safe.
kept.VAULT_KEY ??= randomBytes(36).toString('base64url'); kept.CLAIM_CODE ??= randomBytes(9).toString('base64url');
writeFileSync(KEEP, JSON.stringify(kept)); chmodSync(KEEP, 0o600);
// (The copy handed to wrangler is removed however this ends.)
const push = '.instance-push.json'; process.on('exit', () => rmSync(push, {force: true}));
writeFileSync(push, JSON.stringify(kept)); chmodSync(push, 0o600);

// 3. Build and deploy, then hand the keys to the Worker.
try {execFileSync('npx', ['vite', 'build'], {stdio: 'inherit'});} catch {stop('The site did not build. What went wrong is above. Run `npm install` if you have not, then run this again.');}
const out = run(['deploy'], true), address = /https:\/\/[^\s]+\.workers\.dev/.exec(out)?.[0];
run(['secret', 'bulk', push], true);
console.log(`\nDeployed${address ? ` at ${address}` : ''}.\nCreate your hub with this one-time link:\n  ${address ?? 'https://<your site>'}/#/setup/${kept.CLAIM_CODE}\n`);
