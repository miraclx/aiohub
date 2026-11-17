// Passkeys for the manager's account (WebAuthn), checked with the Worker's own crypto. No attestation: a passkey is added from a
// signed-in session, so the browser's word for the public key is enough. The password always keeps working.
import type {Env} from './util';
import {b64, dec, enc, now, random, same, stamp, unb64} from './util';

/* A challenge the site can recognise later without storing it: random, dated, and stamped. Good for five minutes. */
export async function challenge(env: Env) {
  const text = `${b64(random(18))}.${now() + 300}`;
  return {challenge: text, proof: await stamp(env, `passkey:${text}`)};
}
async function known(env: Env, text: unknown, proof: unknown) {
  return typeof text === 'string' && typeof proof === 'string' && Number(text.split('.')[1]) > now() && await same(proof, await stamp(env, `passkey:${text}`));
}
/* What the browser says it signed: the right kind of request, our challenge, and this site. */
async function client(env: Env, origin: string, kind: string, body: Record<string, unknown>): Promise<Uint8Array | null> {
  if (!await known(env, body.challenge, body.proof) || typeof body.clientData !== 'string') return null;
  try {
    const bytes = unb64(body.clientData), said = JSON.parse(dec.decode(bytes)) as {type?: string; challenge?: string; origin?: string};
    return said.type === kind && said.challenge === b64(enc.encode(body.challenge as string)) && said.origin === origin ? bytes : null;
  } catch {return null;}
}
export const created = async (env: Env, origin: string, body: Record<string, unknown>) => !!await client(env, origin, 'webauthn.create', body);

/* An ECDSA signature arrives wrapped (DER); the Worker's crypto wants the two numbers side by side. */
function plain(signature: Uint8Array) {
  const part = (at: number) => {const length = signature[at + 1], bytes = signature.slice(at + 2, at + 2 + length), trimmed = bytes.slice(Math.max(0, bytes.length - 32)), out = new Uint8Array(32); out.set(trimmed, 32 - trimmed.length); return {out, next: at + 2 + length};};
  const start = signature[1] & 0x80 ? 2 + (signature[1] & 0x7f) : 2, r = part(start), s = part(r.next), both = new Uint8Array(64);
  both.set(r.out); both.set(s.out, 32); return both;
}
/* True when the passkey holding `key` signed this sign-in for this site. */
export async function signed(env: Env, origin: string, body: Record<string, unknown>, key: string, alg: number): Promise<boolean> {
  const said = await client(env, origin, 'webauthn.get', body);
  if (!said || typeof body.authData !== 'string' || typeof body.signature !== 'string') return false;
  try {
    const auth = unb64(body.authData), signature = unb64(body.signature), site = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(new URL(origin).hostname)));
    if (auth.length < 37 || !auth.slice(0, 32).every((byte, index) => byte === site[index]) || !(auth[32] & 1)) return false;
    const data = new Uint8Array(auth.length + 32); data.set(auth); data.set(new Uint8Array(await crypto.subtle.digest('SHA-256', said)), auth.length);
    if (alg === -7) return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, await crypto.subtle.importKey('spki', unb64(key), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']), plain(signature), data);
    if (alg === -257) return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await crypto.subtle.importKey('spki', unb64(key), {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']), signature, data);
  } catch {/* not a signature we can read */}
  return false;
}
