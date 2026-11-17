#!/usr/bin/env node
// Sets up your own copy of AIOHub on your Cloudflare account (the Free plan is enough): makes the database, applies its tables,
// makes the site's own keys, and deploys. Run it once from this folder, after `npx wrangler login`:
//   node setup.mjs [--aiostreams https://your.aiostreams.host] [--aiometadata https://your.aiometadata.host]
// It prints the one-time link that creates the first (your) hub. Run it again any time: it keeps what already exists.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, chmodSync, rmSync} from 'node:fs';

const arg = name => {const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined;};
const run = (args, quiet) => execFileSync('npx', ['wrangler', ...args], {encoding: 'utf8', env: {...process.env, WRANGLER_WRITE_LOGS: 'false'}, stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit']});
const file = 'wrangler.jsonc', KEEP = '.instance.json';
let config = readFileSync(file, 'utf8');
const name = /"database_name":\s*"([^"]+)"/.exec(config)[1];

// 1. The database. If this account has none by that name, make one and point the config at it.
const listed = JSON.parse(run(['d1', 'list', '--json'], true)), found = listed.find(item => item.name === name);
const id = found?.uuid ?? /"uuid":\s*"([^"]+)"|database_id\s*=\s*"([^"]+)"|"database_id":\s*"([^"]+)"/.exec(run(['d1', 'create', name], true))?.slice(1).find(Boolean);
if (!id) throw new Error('Could not make the database. Run `npx wrangler d1 create ' + name + '` and put its id in wrangler.jsonc.');
config = /"database_id"/.test(config) ? config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${id}"`) : config.replace(/("database_name":\s*"[^"]+")/, `$1, "database_id": "${id}"`);
if (arg('aiostreams')) config = config.replace(/"UP_ORIGIN":\s*"[^"]*"/, `"UP_ORIGIN": "${arg('aiostreams').replace(/\/+$/, '')}"`);
if (arg('aiometadata')) config = config.replace(/"AIOM_ORIGIN":\s*"[^"]*"/, `"AIOM_ORIGIN": "${arg('aiometadata').replace(/\/+$/, '')}"`);
writeFileSync(file, config);
console.log(found ? 'Database found.' : 'Database made.');
run(['d1', 'migrations', 'apply', name, '--remote'], true); console.log('Tables are in place.');

// 2. The site's own keys, made once and kept in a file only you can read. VAULT_KEY locks every stored key and password:
//    lose it and they cannot be read again, so keep a copy of .instance.json somewhere safe.
const kept = existsSync(KEEP) ? JSON.parse(readFileSync(KEEP, 'utf8')) : {};
kept.VAULT_KEY ??= randomBytes(36).toString('base64url'); kept.CLAIM_CODE ??= randomBytes(9).toString('base64url');
writeFileSync(KEEP, JSON.stringify(kept)); chmodSync(KEEP, 0o600);
const push = '.instance-push.json'; writeFileSync(push, JSON.stringify(kept)); chmodSync(push, 0o600);

// 3. Build and deploy, then hand the keys to the Worker.
try {
  execFileSync('npx', ['vite', 'build'], {stdio: 'inherit'});
  const out = run(['deploy'], true), address = /https:\/\/[^\s]+\.workers\.dev/.exec(out)?.[0];
  run(['secret', 'bulk', push], true);
  console.log(`\nDeployed${address ? ` at ${address}` : ''}.\nCreate your hub with this one-time link:\n  ${address ?? 'https://<your site>'}/#/setup/${kept.CLAIM_CODE}\n`);
} finally {rmSync(push, {force: true});}
