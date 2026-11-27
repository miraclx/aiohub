/* Home change notice: an address a hub's manager may set (Hub, General), which the hub calls after a Home change has reached the
   apps. One empty POST: no body, nothing about the hub or anyone in it, never following a redirect, five seconds at most.

   - The address carries a token in its path, so it is kept in the vault (kind NOTICE, the hub's own) and never logged. Only the
     manager's own session is sent it back (api.ts, state), to read and change; its host name, kept beside it (notices.host),
     is what the Background work row shows.
   - When: a resend of the hub's setups (native.ts, syncPlayers) that wrote at least one setup and finished. Whoever resends says
     so here (changed, below): a page, the hub itself after an account change, the cron, a first play. A resend that wrote
     nothing calls nothing.
   - At most one call a hub every EVERY seconds. A change inside that time is marked (notices.wanted) and the cron makes the one
     call once the time is up (due, below), so a burst of changes is one call.
   - A call that failed is tried once more at the next turn, then left until the next change.
   Everything here is kept by hub. Nothing here names what the address is for. */
import type {Env} from './util';
import {getSecret, now} from './util';

export const NOTICE = 'key:notice', EVERY = 300;
/* A page the manager may set beside the address (Hub, General): one people can open to set the same thing up for themselves.
   Kept the same way (the vault, the hub's own), under the same rules for what address is taken. Unlike the address it is a link
   meant for the hub's people: every signed-in session of the hub is sent it (api.ts, state), nobody else. Nothing here calls it. */
export const NOTICE_PAGE = 'key:notice-page';
const HUB = '#hub', WAIT = 5000, AGENT = 'Mozilla/5.0 (compatible)';
// Names that only mean something inside a home or office network, or on the machine itself.
const INSIDE = new Set(['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'arpa', 'onion']);

/* The address as it will be kept, with its host name, or why it cannot be used. Never the typed text in what is said. */
export function cleanAddress(typed: string, own: string[]): {address: string; host: string} | {error: string} {
  let url: URL; try {url = new URL(typed);} catch {return {error: 'That is not a web address.'};}
  if (url.protocol !== 'https:') return {error: 'The address must start with https://.'};
  if (url.username || url.password) return {error: 'The address must not have a username or password in it.'};
  const host = url.hostname.toLowerCase();
  if (own.some(name => name && name.toLowerCase() === host)) return {error: 'That is this site’s own address.'};
  // By name only, and a name the public internet knows: never a number (the parser has already turned every way of writing one
  // into digits and dots, or brackets), a single word, or a name that ends inside a private network.
  if (!host.includes('.') || host.endsWith('.') || host.includes(':') || host.includes('[') || /^[\d.]+$/.test(host) || INSIDE.has(host.split('.').pop()!)) return {error: 'The address must be a public website name, not a number or a private network.'};
  if (url.href.length > 300) return {error: 'That address is too long.'};
  return {address: url.href, host};
}

/* After a resend of a hub's setups: what it wrote is marked, and once it has finished the call goes out, unless one went in the
   last EVERY seconds (the cron then makes it: due, below). `send` false only marks, for a resend made while an app waits.
   Never throws, and says nothing of the address. */
export async function changed(env: Env, hub: string, got: {state: string; more?: boolean; changed?: boolean} | null, send = true): Promise<void> {
  if (!got) return;
  const done = got.state === 'ok' && !got.more;
  if (!got.changed && !done) return;
  try {
    // A hub with no address has no row, and nothing happens. A change seen now starts afresh: any second try it replaces is let go.
    const row = got.changed ? await env.DB.prepare('UPDATE notices SET wanted = max(wanted, ?2), retry = 0 WHERE hub = ?1 RETURNING wanted').bind(hub, done ? 2 : 1).first<{wanted: number}>()
      : await env.DB.prepare('UPDATE notices SET wanted = 2 WHERE hub = ?1 AND wanted = 1 RETURNING wanted').bind(hub).first<{wanted: number}>();
    if (send && row?.wanted === 2) await call(env, hub);
  } catch {console.error('notice', 'not marked');}
}
/* The cron's step: the hub whose wanted call has waited longest, once its five minutes are up. One call a run. */
export async function due(env: Env): Promise<void> {
  try {
    const next = await env.DB.prepare('SELECT hub FROM notices WHERE wanted = 2 AND called <= ? ORDER BY called LIMIT 1').bind(now() - EVERY).first<{hub: string}>();
    if (next) await call(env, next.hub);
  } catch {console.error('notice', 'not looked at');}
}
/* The one call. Claimed first, in one write, so two resends ending together make one call and the time between calls holds. */
async function call(env: Env, hub: string): Promise<void> {
  const time = now(), claim = await env.DB.prepare('UPDATE notices SET wanted = 0, called = ?2 WHERE hub = ?1 AND wanted = 2 AND called <= ?2 - ?3 RETURNING retry').bind(hub, time, EVERY).first<{retry: number}>();
  if (!claim) return;
  const address = await getSecret<string>(env, hub, HUB, NOTICE);
  let result = 'none';
  if (address) try {
    // NOTICE_VIA: only the local test run sets it; the request then goes to that stand-in, with the address's own path.
    const answer = await fetch(env.NOTICE_VIA ? `${env.NOTICE_VIA}${new URL(address).pathname}` : address, {method: 'POST', redirect: 'manual', headers: {'user-agent': AGENT}, signal: AbortSignal.timeout(WAIT)});
    result = answer.status >= 200 && answer.status < 300 ? 'ok' : answer.status >= 300 && answer.status < 600 ? `${Math.floor(answer.status / 100)}xx` : 'none';
    await answer.body?.cancel().catch(() => null);
  } catch { /* no answer in time, or none at all: 'none'. The error can name the address, so it is never logged. */ }
  // A first failure is wanted once more, unless a newer change has asked meanwhile; a second is left at that.
  await env.DB.prepare(result !== 'ok' && !claim.retry ? 'UPDATE notices SET result = ?2, retry = CASE WHEN wanted = 0 THEN 1 ELSE retry END, wanted = CASE WHEN wanted = 0 THEN 2 ELSE wanted END WHERE hub = ?1'
    : 'UPDATE notices SET result = ?2, retry = CASE WHEN wanted = 0 THEN 0 ELSE retry END WHERE hub = ?1').bind(hub, result).run();
}
