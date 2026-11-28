// The preview's pretend hub (an address ending in ?sample). The site asks it instead of the network (src/live.ts), so every page is
// the real one. It is small on purpose: the answers were recorded from the local test Worker (scripts/record-sample.mjs, kept
// in recorded.json), and each change a page saves is a few lines that edit that recorded hub. Nothing is sent anywhere.
// One hub for the whole browser, kept in localStorage: a change made in one view shows in the others, until Reset.
import recorded from './recorded.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const fixture = recorded as Any as {stamp: string; at: number; answers: Record<string, Record<string, Any>>};
const KEY = 'aiohub-sample', copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const hash = (text: string) => {let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h;};
const site = () => `${location.origin}/?sample`, people = () => Object.keys(fixture.answers).filter(id => id !== 'owner' && id !== 'fresh');

/* ---------- the one hub, as it stands in this browser ---------- */
interface State {stamp: string; out: boolean; n: number; hub: Any; answers: Record<string, Record<string, Any>>}
const fresh = (): State => {const {'GET /api/state': whole, ...owner} = fixture.answers.owner, {fresh: _, ...rest} = fixture.answers; return {stamp: fixture.stamp, out: false, n: 0, hub: copy(whole.hub), answers: copy({...rest, owner})};};
let state: State | undefined;
function load(): State {
  try {const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null; if (kept?.stamp === fixture.stamp) return kept;} catch { /* nothing usable kept */ }
  return fresh();
}
const now = () => state ??= load();
const save = () => {try {localStorage.setItem(KEY, JSON.stringify(state));} catch { /* private mode: kept for this page only */ }};
/* Back to the hub as recorded. */
export function reset() {state = fresh(); try {localStorage.removeItem(KEY);} catch { /* nothing kept */ }}
// Another tab changed the hub: this one reads it again before its next answer.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {if (event.key === KEY) state = undefined;});

/* ---------- time ---------- */
/* The recorded hub stands still: whoever was watching when it was recorded is watching now. Every time in an answer is moved on
   by how long ago the recording was made, as it is given; what is kept stays in the recording's own time. */
const YEAR = 400 * 86400, ahead = () => Math.floor(Date.now() / 1000) - fixture.at, then = () => fixture.at, DAY = /^\d{4}-\d\d-\d\d$/;
function moved(value: Any): Any {
  const by = ahead(), days = Math.floor(Date.now() / 86400e3) - Math.floor(fixture.at / 86400);
  const walk = (item: Any): Any => typeof item === 'number' ? (Math.abs(item - fixture.at) < YEAR ? item + by : Math.abs(item - fixture.at * 1000) < YEAR * 1000 ? item + by * 1000 : item)
    : typeof item === 'string' ? (DAY.test(item) ? new Date(Date.parse(item) + days * 86400e3).toISOString().slice(0, 10) : item.startsWith('{site}') ? site() + item.slice(6) : item)
    : Array.isArray(item) ? item.map(walk) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)])) : item;
  return walk(value);
}

/* ---------- pictures ---------- */
/* The recording names pictures on the test run's stand-in servers, which no browser can reach. Each becomes one of the
   pictures shipped with the site (public/posters), the same one every time. */
const poster = (n: number) => `/posters/${String(n % 56).padStart(2, '0')}.webp`;
const drawn = (url: string) => {const [, row = url, n = '0'] = /^https:\/\/img\.test\/(.+)\/(\d+)\.jpg$/.exec(url) ?? []; return poster(hash(row) + Number(n) * 5);};
export const picture = (art: string) => poster(hash(art));
function posters(rows: Record<string, string[]> | undefined, home: Any[]): Record<string, string[]> {
  const out = Object.fromEntries(Object.entries(rows ?? {}).map(([id, list]) => [id, list.map(drawn)]));
  // A row added in the preview gets pictures too, unless it is a row of folders (drawn from its own covers) or one that waits on someone's account.
  for (const row of home) if (!out[row.id] && !row.covers && !row.core && !/^(for-you-|trakt-l)/.test(row.id)) out[row.id] = Array.from({length: 7}, (_, n) => poster(hash(row.id) + n * 5));
  return out;
}

/* ---------- answers ---------- */
class Bad extends Error {constructor(public status: number, message: string) {super(message);}}
const bad = (status: number, message: string): never => {throw new Bad(status, message);};
const WORDS = ['maple', 'river', 'copper', 'lantern', 'meadow', 'harbor', 'ember', 'willow', 'pebble', 'comet'];
const password = (seed: string) => {const h = hash(seed); return `${WORDS[h % 10]}-${WORDS[(h >>> 4) % 10]}-${WORDS[(h >>> 8) % 10]}-${10 + (h >>> 12) % 90}`;};
const signin = (id: string, name: string) => now().answers.owner[`GET /api/people/${id}/signin`] ??= {username: name, password: password(`${id}${now().n++}`), pin: String(100000 + hash(id) % 900000), link: `{site}#/join/sample-${id}`};
/* What a person's own view of the hub is: their manager's, less what only a manager is given (worked out from the recording). */
function mine(id: string) {
  const {hub, answers} = now(), person = hub.people.find((item: Any) => item.id === id) ?? bad(401, 'Sign in first');
  const view = (answers[id] ?? answers[people()[0]])['GET /api/state'], shown = Object.fromEntries(Object.entries(hub).filter(([key]) => !view.absent.includes(key)));
  return {role: 'person', personId: id, hub: {...shown, ...view.differs, ...('me' in view.differs ? {me: {...view.differs.me, name: hub.me.name}} : {}), groups: hub.groups.filter((group: Any) => group.id === person.groupId), people: [{...person, ...(answers[id] ? view.self : {})}]}};
}
const pretty = (text: string) => {const words = decodeURIComponent(text).replace(/[-_.]+/g, ' ').trim(); return words ? words[0].toUpperCase() + words.slice(1) : 'A list';};
/* A list found by its link: the same answer the hub gives, named after the link. */
function found(link: string) {
  const PASTE = 'Paste a link to a list on Trakt, Letterboxd, MDBList or TMDB.', n = hash(link) % 90000 + 1000, last = (pattern: RegExp) => pretty(pattern.exec(link)?.[1] ?? '');
  if (/mdblist\.com\/lists\/[\w.-]+\/[\w.-]+/.test(link)) return {...now().answers.owner['POST /api/lists'], id: `mdblist.${n}.movie`, title: last(/lists\/[\w.-]+\/([\w.-]+)/)};
  if (/trakt\.tv\/(users\/[\w.-]+\/lists\/[\w.-]+|lists\/\d+)/.test(link)) return {id: `trakt.list.${n}`, title: last(/lists\/([\w.-]+)/), kind: 'Movies & shows', source: 'Trakt'};
  if (/letterboxd\.com\/[\w.-]+\/list\/[\w.-]+/.test(link)) return {id: `letterboxd.s${n}`, title: last(/list\/([\w.-]+)/), kind: 'Movies', source: 'Letterboxd'};
  if (/themoviedb\.org\/list\/\d+/.test(link)) return {id: `tmdb.list.${n}`, title: 'A TMDB list', kind: 'Movies & shows', source: 'TMDB'};
  return bad(400, /trakt\.tv|letterboxd\.com|themoviedb\.org|mdblist\.com/.test(link) ? `That’s not a list link. ${PASTE}` : PASTE);
}
function address(body: Any) {
  const typed = String(body.address ?? '').trim() || bad(400, 'Paste the address');
  try {const url = new URL(typed); if (url.protocol !== 'https:') throw new Error(); return {address: url.href, host: url.hostname};} catch {return bad(400, 'That must be an https address.');}
}

/* One request, answered from the hub kept here. `as`: the person whose view asked (their manager opened their link), or ''. */
function reply(method: string, path: string, body: Any, as: string): Any {
  const s = now(), hub = s.hub, [route, query = ''] = path.split('?'), parts = route.slice(5).split('/').map(decodeURIComponent), [first, second, third, fourth] = parts, at = `${method} ${[first, third && ':id', third, fourth].filter(Boolean).join('/')}`;
  const person = () => hub.people.find((item: Any) => item.id === second) ?? bad(404, 'This person is gone');
  // Signed out (Sign out, or the hub deleted): only signing in again or making a hub is answered.
  if (first === 'open') return {...s.answers.owner['GET /api/open'], signup: true, code: false};
  if (first === 'signin' || first === 'passkey') {if (method === 'POST') s.out = false; return s.answers.owner['GET /api/passkey'] ?? {challenge: 'sample', proof: 'sample'};}
  if (first === 'signup') {s.out = false; s.hub = copy(fixture.answers.fresh['GET /api/state'].hub); return {};}
  if (first === 'quick') return {name: String(body.name ?? '')};
  if (s.out) bad(401, 'Sign in first');
  if (as && !hub.people.some((item: Any) => item.id === as && item.joined)) bad(401, 'Sign in first');
  if (first === 'join') {
    const who = hub.people.find((item: Any) => signin(item.id, item.name).link.endsWith(`/join/${body.token}`));
    return !who ? {gone: true} : who.joined ? {ok: true, as: who.id} : {waiting: {name: who.name, username: who.name, owner: hub.me.name, joined: false}};
  }
  if (first === 'signout') {if (!as) s.out = true; return {};}
  if (first === 'back') return {};
  if (first === 'state') return as ? mine(as) : {role: 'owner', personId: null, hub};
  if (first === 'activity') {const all = s.answers.owner['GET /api/activity']; return as ? {...all, sittings: all.sittings.filter((row: Any) => row.person === as), downloads: all.downloads.filter((row: Any) => row.person === as)} : all;}
  if (first === 'previews') {
    const ask = new URLSearchParams(query), id = as || ask.get('person'), group = ask.get('group'), who = hub.people.find((item: Any) => item.id === id), set = hub.groups.find((item: Any) => item.id === (group ?? who?.groupId));
    const kept = s.answers.owner[id ? `GET /api/previews?person=${id}` : group ? `GET /api/previews?group=${group}` : 'GET /api/previews'] ?? s.answers.owner['GET /api/previews'];
    return {rows: posters(kept.rows, [...hub.rows, ...(set?.rows ?? []), ...(who?.rows ?? [])])};
  }
  if (first === 'sync') return s.answers.owner['POST /api/sync'];
  if (first === 'lists') return found(String(body.link ?? ''));
  if (first === 'people' && third) {
    const who = person(), key = `${method} /api/people/${second}/${[third, fourth].filter(Boolean).join('/')}`, kept = s.answers[second]?.[key] ?? s.answers.owner[key];
    switch (at) {
      case 'GET people/:id/signin': return signin(who.id, who.name);
      case 'GET people/:id/because': return kept ?? {because: {}};
      case 'GET people/:id/lists': return who.history || who.lists || who.listsKept ? kept ?? {lists: []} : {lists: []};
      case 'GET people/:id/matching': return kept ?? {earlier: 0, plays: []};
      case 'GET people/:id/matching/synced': return kept ?? {synced: []};
      // Trakt, connected through Trakt's own sign-in (pretended in `outside`, below): its rows come to Home, and sync waits to be turned on.
      case 'POST people/:id/scrobble/link': who.history = {username: String(body.username ?? ''), again: false}; who.trakt = true; who.matching = {on: false, earlier: false, passed: false, ask: as === who.id, good: 0, failing: null, why: null, waiting: null}; if (hub.front) who.hearts ??= {on: false}; return {state: 'connected'};
      case 'DELETE people/:id/scrobble': who.history = null; who.matching = null; who.trakt = false; if (!who.listsKept) who.hearts = null; return {};
      case 'DELETE people/:id/trakt': who.aiomTrakt = false; return {};
      case 'POST people/:id/matching': who.matching = {...who.matching, on: !!body.on, earlier: !!body.on && !!body.earlier, ask: false, good: body.on ? then() : who.matching?.good ?? 0}; if (body.earlier) s.answers[second] = {...s.answers[second], [`GET /api/people/${second}/matching`]: {earlier: 0, plays: []}}; return {};
      case 'POST people/:id/matching/later': who.matching = {...who.matching, passed: true}; return {};
      case 'POST people/:id/matching/pass': who.matching = {...who.matching, good: then()}; return {trakt: 0, home: 0, left: 0, more: false};
      // MDBList: a key saved (any text is taken), then sync as its own switch: the copying has nothing to copy here, so it switches at once.
      case 'POST people/:id/mdblist': if (body.moving) who.moving = 'mdblist'; else {who.listsKept = true; who.listsName ||= `${who.id}_lists`; who.lists = !body.keep; if (hub.front) who.hearts ??= {on: false};} return {username: who.listsName};
      case 'DELETE people/:id/mdblist': who.moving = null; who.lists = false; return {};
      case 'DELETE people/:id/mdblist/key': who.moving = null; who.lists = false; who.listsKept = false; who.listsName = ''; if (!who.history) who.hearts = null; return {};
      case 'POST people/:id/moving': who.moving = body.to ?? null; return {};
      // (The recorded answer of a switch that went through, whoever asks and whichever way.)
      case 'POST people/:id/compare/here-mdblist': case 'POST people/:id/compare/mdblist-here': who.lists = fourth === 'here-mdblist'; who.moving = null; return {...s.answers.dev?.['POST /api/people/dev/compare/here-mdblist'], added: 0, left: 0, more: false, switched: true};
      case 'POST people/:id/favorites': who.hearts = {...who.hearts, on: !!body.on}; return {};
      case 'POST people/:id/favorites/later': case 'POST people/:id/favorites/add': {const added = who.hearts?.extra ?? 0; who.hearts = {on: !!who.hearts?.on}; return {added, more: false};}
      // For you: today's pick in a place swapped for another of the day's options, kept, or its title left out for good.
      case 'POST people/:id/foryou/never': who.forYouDetail.never = who.forYouDetail.never.filter((item: Any) => item.seed !== body.seed); return {};
      // Work the hub does on its next run (their lists looked at again): taken, with nothing to show for it here.
      case 'POST people/:id/shelf': return {};
      // A TV approved by its code: it shows under Signed in, as a TV app would.
      case 'POST people/:id/quick': who.devices.unshift({id: `tv${s.n++}`, app: 'Wholphin', name: 'TV', seen: 'Now', place: who.devices[0]?.place ?? null, net: who.devices[0]?.net ?? null}); return {};
      case 'POST people/:id/rotate': who.devices = []; signin(who.id, who.name).password = password(`${who.id}${s.n++}`); return {};
      // Their manager lets them choose a new password: until they do, they count as not joined, as on the hub.
      case 'POST people/:id/reset': who.joined = false; return {};
      case 'POST people/:id/password': return {};
    }
    if (third === 'foryou' && method === 'POST' && fourth) {
      const detail = who.forYouDetail ?? bad(409, 'Nothing is picked for this row yet.'), held = detail.places[fourth] ?? bad(400, 'That row is not valid');
      const put = (pick: Any) => {detail.options = [...detail.options.filter((item: Any) => item.key !== pick.key), held]; detail.places[fourth] = pick; who.forYou[fourth] = pick.name; who.forYouKinds[fourth] = pick.kind;};
      if (body.keep !== undefined) held.keep = !!body.keep;
      else if (body.use !== undefined) put(detail.options.find((item: Any) => item.key === body.use) ?? bad(409, 'That option is no longer there.'));
      else if (body.never) {if (held.seed) detail.never.push({seed: held.seed, title: held.why?.title ?? held.name}); const next = detail.options.find((item: Any) => item.seed !== held.seed); if (next) {put(next); detail.options = detail.options.filter((item: Any) => item.key !== held.key);}}
      return {};
    }
    if (third === 'devices' && fourth) {
      if (method === 'PUT') {who.devices.find((item: Any) => item.id === fourth).name = String(body.name ?? '').trim() || bad(400, 'Give it a name'); return {};}
      if (method === 'DELETE') {who.devices = who.devices.filter((item: Any) => item.id !== fourth); return {};}
    }
  }
  // The saves the site sends after any change on screen (src/live.ts, changes): one each for the hub, a group, a person, the account.
  if (first === 'people' && second && method === 'PUT') {
    const {v: _, ...sent} = body, at = hub.people.findIndex((item: Any) => item.id === second);
    if (at >= 0) {Object.assign(hub.people[at], sent, {v: (hub.people[at].v ?? 0) + 1}); return {v: hub.people[at].v};}
    // Someone new: as the hub makes them, not joined yet and with sign-in details of their own.
    hub.people.push({ready: true, history: null, listsName: '', moving: null, listsKept: false, played: false, matching: null, hearts: null, id: second, joined: false, paused: false, aiomTrakt: false, pin: null, password: '', devices: [], ...sent, v: 1});
    signin(second, String(sent.name)); return {v: 1};
  }
  if (first === 'people' && second && method === 'DELETE') {hub.people = hub.people.filter((item: Any) => item.id !== second); delete s.answers.owner[`GET /api/people/${second}/signin`]; return {};}
  if (first === 'groups' && second && method === 'PUT') {
    const {v: _, ...sent} = body, group = hub.groups.find((item: Any) => item.id === second);
    if (group) {Object.assign(group, sent, {v: (group.v ?? 0) + 1}); return {v: group.v};}
    hub.groups.push({id: second, ...sent, v: 1}); return {v: 1};
  }
  if (first === 'groups' && second && method === 'DELETE') {hub.groups = hub.groups.filter((item: Any) => item.id !== second); return {};}
  const bump = () => ({v: hub.v = (hub.v ?? 0) + 1});
  switch (`${method} ${parts.join('/')}`) {
    case 'PUT hub': {const {order = [], v: _, ...sent} = body, rank = (id: string) => {const n = order.indexOf(id); return n < 0 ? order.length : n;}; Object.assign(hub, sent); hub.groups.sort((a: Any, b: Any) => rank(a.id) - rank(b.id)); return bump();}
    case 'PUT account': hub.me = {...hub.me, name: String(body.name ?? hub.me.name), theme: body.theme ?? hub.me.theme}; return {};
    case 'PUT host': hub.hostUrl = String(body.aiostreams ?? '').trim(); hub.metaUrl = String(body.aiometadata ?? '').trim(); return {...bump(), missing: []};
    case 'PUT keys/tmdb': hub.tmdb = true; return bump();
    case 'PUT keys/mdblist': hub.mdblist = true; return bump();
    case 'DELETE keys/mdblist': hub.mdblist = false; return bump();
    case 'PUT notice': hub.jobs.notice = {...address(body), at: 0, result: null, waiting: false, again: false}; return {};
    case 'DELETE notice': hub.jobs.notice = null; return {};
    case 'PUT notice/page': hub.setupPage = address(body).address; return {};
    case 'DELETE notice/page': hub.setupPage = ''; return {};
    // The keys to the hub's setups: the recorded ones, for whoever is still in the hub. Any password opens them here.
    case 'POST hub/advanced': {const doors = s.answers.owner['POST /api/hub/advanced']; return {...doors, own: (doors.own ?? []).filter((door: Any) => (door.group ? hub.groups : hub.people).some((item: Any) => item.name === door.name))};}
    // Deleting the hub leaves this browser signed out, with a new hub to make. Reset brings the sample one back.
    case 'POST hub/delete': s.out = true; s.hub = copy(fixture.answers.fresh['GET /api/state'].hub); return {};
    case 'POST account/password': return {};
    case 'POST account/recovery': return s.answers.owner['POST /api/account/recovery'];
    case 'POST account/passkeys/options': return {challenge: 'sample', proof: 'sample', user: 'sample', name: hub.me.name, exclude: []};
    // A passkey needs a real device to make one: the preview lists one as if this device had (src/live.ts, addPasskey).
    case 'POST account/passkeys': hub.me.passkeys.push({id: `sample${s.n++}`, name: String(body.name ?? 'This device'), added: new Date(then() * 1000).toISOString().slice(0, 10)}); return {};
  }
  if (first === 'account' && second === 'passkeys' && third && method === 'DELETE') {hub.me.passkeys = hub.me.passkeys.filter((key: Any) => key.id !== third); return {};}
  if (first === 'services' && second) {hub.services = method === 'PUT' ? [...new Set([...hub.services, second])] : hub.services.filter((item: string) => item !== second); return bump();}
  console.warn(`sample: no answer for ${method} ${path}`);
  return bad(404, 'The preview has nothing for that yet.');
}

/* What src/live.ts hands a request to, in place of the network: the same kind of answer the hub's own API gives. */
export async function answer(path: string, init: {method?: string; headers?: Record<string, string>; body?: string} = {}): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  // A beat, as any answer takes: pages show their waiting states for a moment, as they do on a real hub.
  await new Promise(done => setTimeout(done, 30));
  try {
    const method = init.method ?? 'GET', got = reply(method, path, init.body ? JSON.parse(init.body) : {}, init.headers?.['x-as'] ?? '');
    if (method !== 'GET') save();
    return json(200, moved(got));
  } catch (error) {
    if (error instanceof Bad) return json(error.status, {message: error.message});
    console.warn(`sample: ${init.method ?? 'GET'} ${path} failed`, error);
    return json(500, {message: 'Something went wrong in the preview'});
  }
}
/* Trakt's own sign-in, which the real page leaves the site for and then finishes with Trakt directly (pages.tsx, Trakt). Here
   Trakt says yes at once: the page comes back as it would from Trakt, with a code, and is given a made-up login for it. */
export function leave(url: string) {
  const ask = new URL(url), signing = JSON.parse(sessionStorage.getItem('trakt-signing') ?? '{}') as {person?: string};
  if (ask.hostname !== 'auth.trakt.tv') return void window.open(url, '_blank', 'noreferrer');
  // (The code says who it is for, so the made-up Trakt account can be named after them.)
  location.hash = `#/trakt?code=sample-${encodeURIComponent(signing.person ?? 'someone')}&state=${encodeURIComponent(ask.searchParams.get('state') ?? '')}`; location.reload();
}
let trakt = 'someone';
export async function outside(url: string, init?: RequestInit): Promise<Response> {
  const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
  if (url.endsWith('/oauth/token')) {trakt = String((JSON.parse(String(init?.body ?? '{}')) as {code?: string}).code ?? '').replace(/^sample-/, '') || trakt; return json({access_token: 'sample-access', refresh_token: 'sample-refresh', expires_in: 7 * 86400, created_at: Math.floor(Date.now() / 1000), token_type: 'bearer', scope: 'public'});}
  if (url.endsWith('/users/settings')) return json({user: {username: `${trakt}_watches`, ids: {slug: `${trakt}-watches`}}});
  return new Response('{}', {status: 404});
}
/* The links the preview's bar offers: each joined person's own link, which opens their view the way it does for their manager. */
export const links = () => now().out ? [] : (now().hub.people as Any[]).filter(person => person.joined).map(person => ({id: person.id as string, name: person.name as string, link: moved(signin(person.id, person.name).link) as string}));
