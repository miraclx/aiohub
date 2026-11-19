/// <reference types="@cloudflare/workers-types" />
export interface Env {
  ASSETS: Fetcher; DB: D1Database;
  UP_ORIGIN: string; VAULT_KEY: string; CLAIM_CODE?: string; TMDB_CHECK?: string; MDBLIST_API?: string; AIOM_ORIGIN?: string; MAX_HUBS?: string;
  // 'aiometadata': every person's player apps are served by their own AIOMetadata config (streams still come from AIOStreams).
  FRONT?: string;
  // Trakt history (see trakt.ts). Without a client id it stays off: nothing offered, nothing sent.
  TRAKT_CLIENT_ID?: string; TRAKT_API?: string;
}
export const enc = new TextEncoder(), dec = new TextDecoder();
/* The same settings, pointed at the servers this hub uses. A hub that has not chosen its own uses the site's. */
export const hosted = (env: Env, data: {hostUrl?: string; metaUrl?: string}): Env => ({...env, UP_ORIGIN: data.hostUrl || env.UP_ORIGIN, AIOM_ORIGIN: data.metaUrl || env.AIOM_ORIGIN});
export const now = () => Math.floor(Date.now() / 1000);
export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const hex = (bytes: Uint8Array) => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
export const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes));
export const sha = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
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
