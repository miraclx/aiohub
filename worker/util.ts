/// <reference types="@cloudflare/workers-types" />
export interface Env {
  ASSETS: Fetcher; DB: D1Database;
  // The AIOStreams server hubs use unless they choose their own. No default: it must be set. Set in wrangler.jsonc (setup.mjs --aiostreams).
  AIOSTREAMS_ORIGIN?: string;
  // The AIOMetadata server hubs use unless they choose their own. Unset: Home rows are off. Set in wrangler.jsonc (setup.mjs --aiometadata).
  AIOMETADATA_ORIGIN?: string;
  // The earlier names of those two, still read when the new ones are unset (see `named`). The rest of the code reads these.
  UP_ORIGIN: string; AIOM_ORIGIN?: string;
  // How many hubs this copy of the site carries. Unset: 1. Set in wrangler.jsonc.
  MAX_HUBS?: string;
  // A code asked for when a hub is created, so a stranger cannot claim the site. Unset: none is asked. A secret, made by setup.mjs.
  CLAIM_CODE?: string;
  // Locks every key and password the site stores. No default: it must be set, and never changed. A secret, made by setup.mjs.
  VAULT_KEY: string;
  // Where a TMDB key is checked. Unset: https://api.themoviedb.org/3/configuration. Only the local test run sets it.
  TMDB_CHECK?: string;
  // Where TMDB is read. Unset: https://api.themoviedb.org/3. Only the local test run sets it.
  TMDB_API?: string;
  // Where the streaming charts are read. Unset: the public catalogs FLIX names in foryou.ts. Only the local test run sets it.
  FLIXPATROL_API?: string;
  // Where MDBList is read. Unset: https://api.mdblist.com. Only the local test run sets it.
  MDBLIST_API?: string;
  // 'aiometadata': every person's player apps are served by their own AIOMetadata config (streams still come from AIOStreams).
  // Unset or anything else: the apps talk to AIOStreams alone. Set in wrangler.jsonc.
  FRONT?: string;
  // The client id of the site's own Trakt app, for Trakt history (see trakt.ts). Unset: it stays off, nothing offered, nothing
  // sent. Set by whoever runs the site, as a secret or a var.
  TRAKT_CLIENT_ID?: string;
  // Where Trakt is read. Unset: https://api.trakt.tv. Only the local test run sets it.
  TRAKT_API?: string;
  // Where Trakt sign-ins are exchanged. Unset: TRAKT_API if that is set, else https://auth.trakt.tv. Only the local test run sets it.
  TRAKT_AUTH?: string;
  // This site's own public address. AIOMetadata reads each person's Trakt rows from it (see rows.ts). Unset: the address the sync
  // was asked on. Set by whoever runs the site, if it has an address of its own.
  SITE_ORIGIN?: string;
  // The hour (UTC) the daily For you picking starts (foryou.ts). Unset: 5. Set by whoever runs the site, if they want another.
  FORYOU_HOUR?: string;
  // The UTC hour from which the day's Recommended rows are worked out (recs.ts). Unset: 4. Set by whoever runs the site, if they want another.
  RECS_HOUR?: string;
  // The web player the Devices page links to. Unset: https://web.aiostreams.org. Empty or 'off': no link. Set by whoever runs
  // the site, if they host a player of their own.
  WEB_PLAYER?: string;
  // '1': where a request came from, and when a playback report was made, are read from x-test-* headers (whereOf and whenOf in
  // front.ts), and the routes and stand-ins only the tests use are open (TESTING, below). Unset: none of that. Only the local
  // test run sets it (tests/run.sh); never set it on a real site.
  TEST_WHERE?: string;
  // A stand-in address the Home change notice (notice.ts) goes to instead of the one kept. Unset: the one kept. Read only while
  // TEST_WHERE is '1'. Only the local test run sets it.
  NOTICE_VIA?: string;
}
/* The settings as the rest of the code reads them: the two servers under their earlier names, from the new names when those are
   set. Called once where the settings arrive (index.ts), so a site set up under either name keeps working; the new name wins. */
export const named = (env: Env): Env => ({...env, UP_ORIGIN: env.AIOSTREAMS_ORIGIN || env.UP_ORIGIN, AIOM_ORIGIN: env.AIOMETADATA_ORIGIN || env.AIOM_ORIGIN});
/* Whether this is the local test run. What only the tests use (routes in api.ts, the notice stand-in) is closed without it. */
export const TESTING = (env: Env) => env.TEST_WHERE === '1';
/* The web player's address, '' for none: only an http(s) address is ever handed to a page. */
export const WEB_PLAYER = 'https://web.aiostreams.org';
export const webPlayer = (env: Env) => {const at = (env.WEB_PLAYER ?? WEB_PLAYER).trim().replace(/\/+$/, ''); return /^https?:\/\/\S+$/i.test(at) ? at : '';};
export const enc = new TextEncoder(), dec = new TextDecoder();
/* The same settings, pointed at the servers this hub uses. A hub that has not chosen its own uses the site's. */
export const hosted = (env: Env, data: {hostUrl?: string; metaUrl?: string}): Env => ({...env, UP_ORIGIN: data.hostUrl || env.UP_ORIGIN, AIOM_ORIGIN: data.metaUrl || env.AIOM_ORIGIN});
export const now = () => Math.floor(Date.now() / 1000);
/* A title whose file runs longer than its listing (a cartoon episode listed at 11 minutes whose file holds two segments). The
   listed length comes from the server once (front.ts, note); a report whose position passes it by more than 30 seconds, or 5% of
   it for anything longer than ten minutes, says the listing is wrong for this title: plays.over then keeps the furthest second
   any report reached (per hub, person and title), and parts are no longer cut off at the listed length.
   Such a title is finished by where earlier sittings got to, never by its share of the listed length: a sitting counts as
   finished from 95% of the furthest point reached before it began (sittings.reached), or when an app ticked it as watched.
   The limits, plainly: the hub only learns a file is longer once someone plays past the listed end, so before that a stop between
   90% and 100% of the listed length still reads as finished; the first sitting to pass the listed length cannot know where the
   end is, so it reads as stopped; and the furthest point reached is not always the end, so a sitting that gets as far as an
   earlier one that was given up partway reads as finished too. */
export const pastListed = (length: number, at: number) => length > 0 && at > length + Math.max(30, length * 0.05);
export const NEAR_END = 0.95;
/* Whether a title (a row of `plays`, by that name) was finished, in SQL: played to 90% or more of its listed length, or, for one
   that runs longer than listed, a sitting of it that got to within 5% of where earlier ones had. Never one marked unwatched in an
   app since (plays.unwatched, front.ts). */
export const FINISHED = `(plays.unwatched = 0 AND ((plays.over = 0 AND plays.duration > 0 AND plays.position >= plays.duration * 0.9) OR (plays.over > 0 AND EXISTS (SELECT 1 FROM sittings z WHERE z.hub = plays.hub AND z.person = plays.person AND z.item = plays.item AND z.reached > 0 AND z.position >= z.reached * ${NEAR_END}))))`;
export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const hex = (bytes: Uint8Array) => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
export const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes));
export const sha = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
/* Runs jobs at most `most` at a time and answers in the jobs' own order. After a job throws, no new one starts; the ones already
   running finish, then the first error is thrown, so nothing is left half-done in the background. */
export async function inTurn<T>(jobs: (() => Promise<T>)[], most: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length); let next = 0, failed: {error: unknown} | null = null;
  await Promise.all(Array.from({length: Math.min(most, jobs.length)}, async () => {
    while (next < jobs.length && !failed) {const at = next++; try {out[at] = await jobs[at]();} catch (error) {failed ??= {error};}}
  }));
  if (failed) throw (failed as {error: unknown}).error;
  return out;
}
/* Lets at most `most` pieces of work handed to it run at once; the rest wait their turn, first come first served. */
export function gate(most: number) {
  let busy = 0; const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy >= most) await new Promise<void>(go => waiting.push(go)); else busy++;
    try {return await work();} finally {const next = waiting.shift(); if (next) next(); else busy--;}
  };
}
/* Compares without leaking where two strings differ. */
export async function same(a: string, b: string) {
  const [x, y] = await Promise.all([sha(a), sha(b)]); let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i); return diff === 0;
}

/* Manager passwords: salted and stretched. The cost is stored with each hash so it can be raised later. */
const ITERATIONS = 50_000; // measured on the live Worker: 100,000 costs 15-20 ms of processing, over the free plan's 10 ms
async function stretch(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, material, 256)));
}
export async function hashPassword(password: string) {const salt = random(16); return `pbkdf2.${ITERATIONS}.${b64(salt)}.${await stretch(password, salt, ITERATIONS)}`;}
export async function checkPassword(password: string, stored: string) {
  const [kind, iterations, salt, hash] = stored.split('.');
  if (kind !== 'pbkdf2' || !hash) return false;
  return same(await stretch(password, unb64(salt), Number(iterations)), hash);
}

/* The vault: every stored secret is encrypted, and tied to the place it was stored for so it cannot be moved to another record. */
let vault: Promise<CryptoKey> | undefined, vaultFor = '';
function vaultKey(env: Env) {
  if (!env.VAULT_KEY) throw new Error('VAULT_KEY is not set');
  if (!vault || vaultFor !== env.VAULT_KEY) {vaultFor = env.VAULT_KEY; vault = crypto.subtle.digest('SHA-256', enc.encode(env.VAULT_KEY)).then(raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));}
  return vault;
}
export async function seal(env: Env, where: string, value: unknown) {
  const iv = random(12), data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: enc.encode(where)}, await vaultKey(env), enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(12 + data.length); out.set(iv); out.set(data, 12); return 'v1.' + b64(out);
}
export async function unseal<T>(env: Env, where: string, text: string | null | undefined): Promise<T | null> {
  if (!text?.startsWith('v1.')) return null;
  try {const raw = unb64(text.slice(3)); return JSON.parse(dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(where)}, await vaultKey(env), raw.slice(12))));} catch {return null;}
}
export const getSecret = async <T>(env: Env, hub: string, owner: string, kind: string) =>
  unseal<T>(env, `${hub}/${owner}/${kind}`, (await env.DB.prepare('SELECT value FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, owner, kind).first<{value: string}>())?.value);
export const putSecret = async (env: Env, hub: string, owner: string, kind: string, value: unknown) =>
  env.DB.prepare('INSERT INTO secrets (hub, owner, kind, value) VALUES (?, ?, ?, ?) ON CONFLICT (hub, owner, kind) DO UPDATE SET value = excluded.value').bind(hub, owner, kind, await seal(env, `${hub}/${owner}/${kind}`, value));

/* A stamp only this site can make. Used to prove a hub code was issued by the site and not made up by whoever is asking. */
export async function stamp(env: Env, text: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`stamp:${env.VAULT_KEY}`), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}
/* Wrong guesses: a handful per name and a larger number per address, then a wait. Only failures are written. */
const WINDOW = 600;
export async function blocked(env: Env, keys: [string, number][]) {
  const rows = await env.DB.prepare(`SELECT key, count FROM attempts WHERE reset > ? AND key IN (${keys.map(() => '?').join(',')})`).bind(now(), ...keys.map(([key]) => key)).all<{key: string; count: number}>();
  return rows.results.some(row => row.count >= (keys.find(([key]) => key === row.key)?.[1] ?? 0));
}
export const failed = (env: Env, keys: [string, number][]) => env.DB.batch(keys.map(([key]) => env.DB.prepare(
  'INSERT INTO attempts (key, count, reset) VALUES (?1, 1, ?2 + ?3) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN reset <= ?2 THEN 1 ELSE count + 1 END, reset = CASE WHEN reset <= ?2 THEN ?2 + ?3 ELSE reset END').bind(key, now(), WINDOW)));
export const guesses = (request: Request, name: string): [string, number][] => [[name, 8], [`ip:${request.headers.get('cf-connecting-ip') ?? 'local'}`, 40]];

/* Sign-in details people can type on a TV remote. */
const WORDS = 'amber anchor apple arrow aspen badge bamboo basil beacon birch breeze bridge butter cactus candle canyon cedar cherry cider cliff clover cobalt comet copper coral cotton crane daisy delta ember falcon fern field flint forest garnet ginger glade harbor hazel heron island ivory jasper juniper kettle lagoon lantern lemon linen maple marble meadow mellow mint nectar olive orchid otter pebble pepper pine plum quartz raven reef river saffron sage shell silver spruce summit thistle timber tulip velvet walnut willow winter'.split(' ');
const pick = (count: number) => {const span = Math.floor(0x100000000 / count) * count, box = new Uint32Array(1); do crypto.getRandomValues(box); while (box[0] >= span); return box[0] % count;};
export const newPassword = () => `${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}-${10 + pick(90)}`;
/* Recovery codes are words only, so they do not look like (or get mixed up with) a player password. */
export const newRecoveryCode = () => Array.from({length: 4}, () => WORDS[pick(WORDS.length)]).join('-');
export const newPin = () => String(pick(1_000_000)).padStart(6, '0');
export const newToken = (prefix: string) => prefix + b64(random(24));
export const newId = () => hex(random(16));
export const newCode = () => {const letters = 'abcdefghjkmnpqrstuvwxyz23456789'; return Array.from({length: 6}, () => letters[pick(letters.length)]).join('');};
