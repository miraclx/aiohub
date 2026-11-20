// Talking to the hub's own API, and keeping what is on screen saved.
// Changes show at once; a moment later every changed thing is sent as one save each, in order.
import type {Group, Hub, Person} from './data';

export interface Live {
  call: <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<T>;
  /** Waits for anything unsaved, then loads the hub again. */
  reload: () => Promise<void>;
  /** Brings the player apps in step with what is saved, and waits for it. Quiet unless something got in the way. */
  sync: () => Promise<void>;
  /** The same in the background, after a save: shows that the apps are catching up, then that they are done or what went wrong. */
  apps: () => void;
  /** Waits until everything on screen has been saved. */
  settled: () => Promise<void>;
}
export class Refused extends Error {constructor(public status: number, message: string) {super(message);}}
/* A tab its manager opened a person's link in shows that person's view; other tabs stay the manager's. Kept per tab. */
const AS_TAB = 'aiohub-as';
export const asWho = () => {try {return sessionStorage.getItem(AS_TAB) ?? '';} catch {return '';}};
export const beAs = (person: string) => {try {sessionStorage.setItem(AS_TAB, person);} catch { /* private mode: the tab stays the manager's */ }};
export const leaveAs = () => {try {sessionStorage.removeItem(AS_TAB);} catch { /* nothing kept */ }};
export async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const as = asWho(), headers: Record<string, string> = {...(body === undefined ? {} : {'content-type': 'application/json'}), ...(as ? {'x-as': as} : {})};
  const answer = await fetch(path, {method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body)}).catch(() => {throw new Refused(0, 'Could not reach the hub. Check your connection.');});
  const data = await answer.json().catch(() => ({})) as T & {message?: string};
  // Their view was signed out (here or in another tab): this tab goes back to the manager's own.
  if (as && answer.status === 401) {leaveAs(); location.hash = '#/'; location.reload();}
  if (!answer.ok) throw new Refused(answer.status, data.message ?? 'That did not work');
  return data;
}

const hubBody = (hub: Hub) => ({host: hub.host, hostUrl: hub.hostUrl, serverName: hub.serverName ?? "", addons: hub.addons, defaults: hub.defaults, rows: hub.rows, order: hub.groups.map(group => group.id)});
const groupBody = (group: Group) => ({name: group.name, rows: group.rows, settings: group.settings, paused: !!group.paused});
const personBody = (person: Person) => ({name: person.name, groupId: person.groupId, rows: person.rows, picks: person.picks, settings: person.settings, can: person.can, paused: !!person.paused, trakt: person.trakt, lists: person.lists});
const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
export interface Job {method: string; path: string; body?: Record<string, unknown>; kind: 'hub' | 'group' | 'person' | 'me'; id: string; gone?: boolean}
/* What has to be sent to turn the saved hub into the one on screen. Groups are made before the people in them, and emptied before they go. */
export function changes(saved: Hub, shown: Hub, role: 'owner' | 'person'): Job[] {
  const jobs: Job[] = [], people = (hub: Hub) => new Map(hub.people.map(person => [person.id, person])), groups = (hub: Hub) => new Map(hub.groups.map(group => [group.id, group]));
  const was = {people: people(saved), groups: groups(saved)}, is = {people: people(shown), groups: groups(shown)};
  if (role === 'owner') {
    if (differs(hubBody(saved), hubBody(shown))) jobs.push({method: 'PUT', path: '/api/hub', body: {...hubBody(shown), v: saved.v}, kind: 'hub', id: ''});
    if (saved.me.name !== shown.me.name || saved.me.theme !== shown.me.theme) jobs.push({method: 'PUT', path: '/api/account', body: {name: shown.me.name, theme: shown.me.theme}, kind: 'me', id: ''});
    for (const [id, group] of is.groups) if (!was.groups.has(id) || differs(groupBody(was.groups.get(id)!), groupBody(group))) jobs.push({method: 'PUT', path: `/api/groups/${id}`, body: {...groupBody(group), v: was.groups.get(id)?.v}, kind: 'group', id});
  }
  for (const [id, person] of is.people) {
    const before = was.people.get(id);
    // Removed and added again under the same name before the removal was sent: a new person, never the old one's record.
    if (role === 'owner' && before?.v !== undefined && person.v === undefined) {
      jobs.push({method: 'DELETE', path: `/api/people/${id}`, kind: 'person', id, gone: true}, {method: 'PUT', path: `/api/people/${id}`, body: personBody(person), kind: 'person', id});
    } else if (!before || differs(personBody(before), personBody(person))) jobs.push({method: 'PUT', path: `/api/people/${id}`, body: {...personBody(person), v: before?.v}, kind: 'person', id});
  }
  if (role === 'owner') {
    for (const id of was.people.keys()) if (!is.people.has(id)) jobs.push({method: 'DELETE', path: `/api/people/${id}`, kind: 'person', id, gone: true});
    for (const id of was.groups.keys()) if (!is.groups.has(id)) jobs.push({method: 'DELETE', path: `/api/groups/${id}`, kind: 'group', id, gone: true});
  }
  return jobs;
}
/* Records one finished save in a hub: the new version number, and in the saved copy also what was sent. */
export function settle(hub: Hub, job: Job, v: number | undefined, shown?: Hub) {
  if (job.kind === 'hub') {
    hub.v = v;
    if (shown) {const {order, ...rest} = hubBody(shown), rank = (id: string) => {const at = order.indexOf(id); return at < 0 ? order.length : at;}; Object.assign(hub, structuredClone(rest)); hub.groups.sort((a, b) => rank(a.id) - rank(b.id));}
  }
  if (job.kind === 'me' && shown) hub.me = {...hub.me, name: shown.me.name, theme: shown.me.theme};
  for (const kind of ['group', 'person'] as const) if (job.kind === kind) {
    const key = kind === 'group' ? 'groups' : 'people', items = hub[key] as (Group | Person)[], at = items.findIndex(item => item.id === job.id);
    if (job.gone) {if (shown && at >= 0) items.splice(at, 1); continue;}
    const sent = shown?.[key].find(item => item.id === job.id);
    if (sent) {const copy = {...structuredClone(sent), v}; if (at >= 0) items[at] = copy; else items.push(copy);} else if (at >= 0) items[at].v = v;
  }
}

/* Passkeys. The browser makes and keeps the key; the site only ever sees the public half and signatures. */
const packed = (bytes: ArrayBuffer | null) => bytes ? btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
const unpacked = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const bytesOf = (text: string) => new TextEncoder().encode(text);
export const canPasskey = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
const device = () => {const agent = navigator.userAgent; const on = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Mac/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : 'A device'; const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : ''; return browser ? `${on} · ${browser}` : on;};
export async function addPasskey() {
  const start = await call<{challenge: string; proof: string; user: string; name: string; exclude: string[]}>('POST', '/api/account/passkeys/options', {});
  const made = await navigator.credentials.create({publicKey: {
    challenge: bytesOf(start.challenge), rp: {name: 'AIOHub', id: location.hostname}, user: {id: bytesOf(start.user), name: `AIOHub ${start.name}`, displayName: `AIOHub ${start.name}`},
    pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}], authenticatorSelection: {residentKey: 'required', userVerification: 'preferred'}, attestation: 'none',
    excludeCredentials: start.exclude.map(id => ({type: 'public-key' as const, id: unpacked(id)})),
  }}) as PublicKeyCredential | null;
  if (!made) throw new Error('No passkey was made');
  const answer = made.response as AuthenticatorAttestationResponse;
  await call('POST', '/api/account/passkeys', {id: made.id, key: packed(answer.getPublicKey()), alg: answer.getPublicKeyAlgorithm(), clientData: packed(answer.clientDataJSON), challenge: start.challenge, proof: start.proof, name: device()});
}
export async function usePasskey() {
  const start = await call<{challenge: string; proof: string}>('GET', '/api/passkey');
  const got = await navigator.credentials.get({publicKey: {challenge: bytesOf(start.challenge), rpId: location.hostname, userVerification: 'preferred'}}) as PublicKeyCredential | null;
  if (!got) throw new Error('No passkey was chosen');
  const answer = got.response as AuthenticatorAssertionResponse;
  await call('POST', '/api/passkey', {id: got.id, clientData: packed(answer.clientDataJSON), authData: packed(answer.authenticatorData), signature: packed(answer.signature), challenge: start.challenge, proof: start.proof});
}
