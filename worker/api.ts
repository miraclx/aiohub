// The site's own API: managers' accounts, the hub they run, and what an invited person may change about themselves.
// What reaches the streaming server goes through ./native.
import {carry, plan} from './carry';
import {defaultAddons, defaultRows, defaultSettings, slug, traktRows} from '../src/data';
import type {Addon, Overrides, Row, Settings} from '../src/data';
import {challenge, created, signed} from './passkeys';
import {HUB_OWNER, MOST_PEOPLE, previews, removePlayers, syncPlayers} from './native';
import {forgetHub, forgetSeats} from './front';
import {LINK, disconnect, forgetTrakt, keepLink, links} from './trakt';
import {rows} from './rows';
import type {Env} from './util';
import {blocked, checkPassword, failed, getSecret, guesses, hashPassword, hosted, newCode, newId, newPassword, newPin, newRecoveryCode, newToken, now, putSecret, same, sha, stamp, unseal} from './util';

const TAKEN = 'Someone in this hub already has that name';
class Bad extends Error {constructor(public status: number, message: string) {super(message);}}
const bad = (status: number, message: string): never => {throw new Bad(status, message);};
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...headers}});
const COOKIE = 'hub_s', MONTH = 30 * 86400;
const cookie = (value: string, age: number) => ({'set-cookie': `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`});

/* ---------- what may be stored ---------- */
const text = (value: unknown, max: number, what: string): string => typeof value === 'string' && value.length <= max ? value : bad(400, `${what} is not valid`);
const flag = (value: unknown) => value === true;
const list = (value: unknown, max: number, each: number, what: string) => Array.isArray(value) && value.length <= max ? value.map(item => text(item, each, what)) : bad(400, `${what} is not valid`);
const oneOf = <T extends string>(value: unknown, options: readonly T[], what: string): T => options.includes(value as T) ? value as T : bad(400, `${what} is not valid`);
function cleanRows(value: unknown): Row[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 200) bad(400, 'Home rows are not valid');
  const seen = new Set<string>();
  return (value as Record<string, unknown>[]).map(item => {
    const id = text(item?.id, 120, 'Row'); if (seen.has(id)) bad(400, 'A row is listed twice'); seen.add(id);
    const row: Row = {id, title: text(item.title, 160, 'Row title'), kind: text(item.kind, 80, 'Row'), source: text(item.source, 400, 'Row'), origin: oneOf(item.origin, ['hub', 'group', 'own'] as const, 'Row'), on: flag(item.on)};
    if (item.core === true) row.core = true;
    if (item.watched !== undefined) row.watched = oneOf(item.watched, ['hide', 'show'] as const, 'Row');
    if (item.covers !== undefined) row.covers = Array.isArray(item.covers) && item.covers.length <= 80 ? (item.covers as Record<string, unknown>[]).map(cover => ({title: text(cover?.title, 120, 'Folder name'), image: text(cover.image, 400, 'Folder')})) : bad(400, 'Folders are not valid');
    return row;
  });
}
const CHECK: {[K in keyof Settings]: (value: unknown) => Settings[K]} = {
  quality: value => oneOf(value, ['saver', 'balanced', 'best'] as const, 'Quality'),
  maxSizeGb: value => typeof value === 'number' && value >= 1 && value <= 500 ? value : bad(400, 'File size is not valid'),
  languages: value => list(value, 30, 40, 'Languages'), cachedFirst: flag,
  search: value => oneOf(value, ['fast', 'balanced', 'thorough'] as const, 'Search'),
  subtitles: value => list(value, 30, 40, 'Subtitles'), skip: flag,
  limit: value => oneOf(value, ['all', 'teen', 'kids'] as const, 'Content limit'),
  hideWatched: flag, spoilers: flag, unreleased: flag,
  posters: value => oneOf(value, ['better', 'plain'] as const, 'Posters'),
  debrid: value => text(value, 40, 'Account'), sources: value => list(value, 60, 80, 'Sources'),
  formatter: value => ({name: text((value as Record<string, unknown>)?.name, 20_000, 'Stream label'), description: text((value as Record<string, unknown>).description, 20_000, 'Stream label')}),
};
function cleanSettings(value: unknown, whole: boolean): Overrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(400, 'Settings are not valid');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CHECK) as (keyof Settings)[]) {
    const given = (value as Record<string, unknown>)[key];
    if (given === undefined) {if (whole) bad(400, 'Settings are incomplete');} else out[key] = CHECK[key](given);
  }
  return out;
}
const cleanAddons = (value: unknown): Addon[] => Array.isArray(value) && value.length <= 60 ? (value as Record<string, unknown>[]).map(item => ({id: text(item?.id, 400, 'Source'), name: text(item.name, 80, 'Source'), note: text(item.note, 400, 'Source'), ...(item.locked === true ? {locked: true} : {}), ...(item.custom === true ? {custom: true} : {}), ...(item.url !== undefined ? {url: /^https:\/\/[^\s"\\]+\/manifest\.json(\?[^\s"\\]*)?$/.test(text(item.url, 600, 'Source link')) ? item.url as string : bad(400, 'A source link is the https address of its manifest.json')} : {})})) : bad(400, 'Sources are not valid');
const cleanName = (value: unknown) => {const name = text(value, 60, 'Name').trim(); return name || bad(400, 'A name is needed');};
const cleanId = (value: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : bad(400, 'That name cannot be used');
const cleanPassword = (value: unknown) => typeof value === 'string' && value.length >= 8 && value.length <= 200 ? value : bad(400, 'Use a password of at least 8 characters');

/* ---------- rows as stored ---------- */
interface HubData {host: string; hostUrl: string; serverName?: string; metaUrl?: string; missing?: string[]; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]; order?: string[]}
interface GroupData {rows: Row[] | null; settings: Overrides; paused?: boolean}
interface PersonData {rows: Row[] | null; settings: Overrides; can: {arrange: boolean; add: boolean; playback: boolean}; trakt: boolean; lists: boolean}
interface HubRow {id: string; code: string; owner: string; data: string; version: number}
interface GroupRow {id: string; name: string; data: string; version: number}
interface PersonRow {id: string; grp: string; name: string; data: string; joined: number; paused: number; version: number}
interface DeviceRow {ref: string; person: string; app: string; name: string; seen: number; place: string; net: string}
interface SignIn {password: string; pin: string | null}
const TRAKT_ROWS = ['watchlist', 'recommended-movies', 'recommended-series', 'up-next', 'recently-aired'];

function ago(seen: number) {
  const gap = now() - seen;
  return gap < 300 ? 'Now' : gap < 3600 ? `${Math.floor(gap / 60)} min ago` : gap < 86400 ? `${Math.floor(gap / 3600)} h ago` : gap < 172800 ? 'Yesterday' : `${Math.floor(gap / 86400)} days ago`;
}
const groupDto = (row: GroupRow) => ({id: row.id, name: row.name, ...(JSON.parse(row.data) as GroupData), v: row.version});
const personDto = (row: PersonRow, devices: DeviceRow[], ready: boolean, history: {username: string; again: boolean} | null, aiomTrakt: boolean, listsName = '') => ({
  ready, history, listsName,
  id: row.id, name: row.name, groupId: row.grp, joined: !!row.joined, paused: !!row.paused, ...(JSON.parse(row.data) as PersonData), v: row.version,
  // AIOMetadata's own Trakt connection (a Token ID). Once Trakt is connected to the hub it is no longer used and can go.
  aiomTrakt,
  // Sign-in details are never part of what a page loads; they are asked for one person at a time.
  pin: null, password: '', devices: devices.filter(device => device.person === row.id).map(device => ({id: device.ref, app: device.app || 'Player app', name: device.name || 'A device', seen: ago(device.seen), place: device.place, net: device.net})),
});

/* ---------- who is asking ---------- */
interface Who {session: string; account?: {id: string; username: string; name: string; theme: string}; hub: HubRow; person?: string}
async function whoIs(request: Request, env: Env): Promise<Who | null> {
  const token = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
  if (!token) return null;
  const session = await sha(token), row = await env.DB.prepare('SELECT account, hub, person FROM sessions WHERE id = ? AND expires > ?').bind(session, now()).first<{account: string | null; hub: string | null; person: string | null}>();
  if (!row) return null;
  if (row.account) {
    const [account, hub] = await env.DB.batch([env.DB.prepare('SELECT id, username, name, theme FROM accounts WHERE id = ?').bind(row.account), env.DB.prepare('SELECT id, code, owner, data, version FROM hubs WHERE owner = ?').bind(row.account)]);
    return account.results[0] && hub.results[0] ? {session, account: account.results[0] as Who['account'], hub: hub.results[0] as HubRow} : null;
  }
  const hub = await env.DB.prepare('SELECT id, code, owner, data, version FROM hubs WHERE id = ?').bind(row.hub).first<HubRow>();
  return hub && row.person ? {session, hub, person: row.person} : null;
}
async function startSession(env: Env, subject: {account: string} | {hub: string; person: string}) {
  const token = newToken('s');
  await env.DB.prepare('INSERT INTO sessions (id, account, hub, person, expires) VALUES (?, ?, ?, ?, ?)').bind(await sha(token), 'account' in subject ? subject.account : null, 'hub' in subject ? subject.hub : null, 'person' in subject ? subject.person : null, now() + MONTH).run();
  return cookie(token, MONTH);
}

/* ---------- what a page loads ---------- */
async function state(env: Env, who: Who) {
  const hub = who.hub, data = JSON.parse(hub.data) as HubData, mine = who.person;
  const [groups, people, devices, owner, ready, keys, passkeys, traktLinks, oldTrakt, listKeys] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, data, version FROM groups WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(hub.id, mine) : env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? ORDER BY created, id').bind(hub.id),
    mine ? env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? AND person = ? ORDER BY seen DESC').bind(hub.id, mine) : env.DB.prepare('SELECT ref, person, app, name, seen, place, net FROM devices WHERE hub = ? ORDER BY seen DESC').bind(hub.id),
    env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(hub.owner),
    env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind IN ('upstream', 'upstream-aiom')").bind(hub.id),
    env.DB.prepare("SELECT kind FROM secrets WHERE hub = ? AND owner = ? AND kind IN ('key:tmdb', 'key:mdblist', 'key:posters')").bind(hub.id, HUB_OWNER),
    env.DB.prepare('SELECT substr(id, 1, 16) AS id, name, created FROM passkeys WHERE account = ? ORDER BY created').bind(who.account?.id ?? ''),
    env.DB.prepare('SELECT owner, value FROM secrets WHERE hub = ? AND kind = ? AND owner = coalesce(?, owner)').bind(hub.id, LINK, mine ?? null),
    env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind = 'trakt'").bind(hub.id),
    env.DB.prepare("SELECT owner, value FROM secrets WHERE hub = ? AND kind = 'mdblist' AND owner = coalesce(?, owner)").bind(hub.id, mine ?? null),
  ]);
  // Which MDBList account each person's progress goes to (the name only; the key never leaves the vault).
  const listsName: Record<string, string> = {};
  for (const row of listKeys.results as {owner: string; value: string}[]) {const kept = await unseal<{username?: string}>(env, `${hub.id}/${row.owner}/mdblist`, row.value); if (kept?.username) listsName[row.owner] = kept.username;}
  const aiomTrakt = new Set((oldTrakt.results as {owner: string}[]).map(row => row.owner));
  const history = env.TRAKT_CLIENT_ID ? await links(env, hub.id, traktLinks.results as {owner: string; value: string}[]) : {};
  const linked = new Set((ready.results as {owner: string}[]).map(row => row.owner));
  const persons = people.results as unknown as PersonRow[];
  if (mine && !persons.length) return null;
  // An invited person gets themselves, their group and the defaults. Never the other people, the server choice or the manager's account.
  const rank = (id: string) => {const at = data.order?.indexOf(id) ?? -1; return at < 0 ? Infinity : at;};
  const shown = (groups.results as unknown as GroupRow[]).filter(group => !mine || group.id === persons[0].grp).map((group, at) => ({group, at})).sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.at - b.at).map(item => item.group);
  return {
    role: mine ? 'person' : 'owner', personId: mine ?? null,
    hub: {
      name: '', serverName: data.serverName ?? '', code: hub.code, host: mine ? '' : data.host, hostUrl: mine ? '' : data.hostUrl, metaUrl: mine ? '' : data.metaUrl ?? '', missing: data.missing ?? [], traktLink: env.AIOM_ORIGIN || data.metaUrl ? `${data.metaUrl || env.AIOM_ORIGIN}/api/auth/trakt/authorize` : '', services: data.services, addons: data.addons, defaults: data.defaults, rows: data.rows, v: hub.version, tmdb: keys.results.some(row => (row as {kind: string}).kind === 'key:tmdb'), mdblist: keys.results.some(row => (row as {kind: string}).kind === 'key:mdblist'), scrobble: !!env.TRAKT_CLIENT_ID, traktClient: env.TRAKT_CLIENT_ID ?? '',
      groups: shown.map(groupDto), people: persons.map(row => personDto(row, devices.results as unknown as DeviceRow[], linked.has(row.id), history[row.id] ?? null, aiomTrakt.has(row.id), listsName[row.id] ?? '')),
      me: who.account ? {name: who.account.name, theme: who.account.theme, passkeys: (passkeys.results as {id: string; name: string; created: number}[]).map(row => ({id: row.id, name: row.name, added: new Date(row.created * 1000).toISOString().slice(0, 10)}))} : {name: (owner.results[0] as {name: string} | undefined)?.name ?? '', theme: 'dark', passkeys: []},
    },
  };
}

/* ---------- writes ---------- */
type Body = Record<string, unknown>;
const versioned = (changes: number) => {if (!changes) bad(409, 'This changed somewhere else. The page has been refreshed.');};
async function saveHub(env: Env, who: Who, body: Body) {
  const was = JSON.parse(who.hub.data) as HubData, data: HubData = {
    // Which servers the hub uses is changed on its own, after they have been checked; never as part of a page save.
    host: was.host, hostUrl: was.hostUrl, metaUrl: was.metaUrl, missing: was.missing,
    // Accounts are added and removed with their key, one at a time, never as part of a page save.
    services: was.services,
    // What apps and Trakt call the hub. Empty means the usual name.
    serverName: typeof body.serverName === 'string' ? body.serverName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || undefined : was.serverName,
    addons: cleanAddons(body.addons), defaults: cleanSettings(body.defaults, true) as Settings, rows: cleanRows(body.rows) ?? bad(400, 'Home rows are needed'),
    // The order groups are shown in. Groups not named yet go after the rest, oldest first.
    order: Array.isArray(body.order) ? body.order.filter((id): id is string => typeof id === 'string').slice(0, 40).map(id => id.slice(0, 40)) : was.order,
  };
  const done = await env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(data), who.hub.id, Number(body.v)).run();
  versioned(done.meta.changes); forgetHub(who.hub.code); return {v: Number(body.v) + 1};
}
async function saveGroup(env: Env, who: Who, id: string, body: Body) {
  const data: GroupData = {rows: cleanRows(body.rows), settings: cleanSettings(body.settings ?? {}, false), ...(flag(body.paused) ? {paused: true} : {})}, name = cleanName(body.name);
  if (body.v === undefined) {
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM groups WHERE hub = ?').bind(who.hub.id).first<{n: number}>())!.n >= 40) bad(400, 'That is the most groups a hub can have');
    await env.DB.prepare('INSERT INTO groups (hub, id, name, data, created) VALUES (?, ?, ?, ?, ?)').bind(who.hub.id, cleanId(id), name, JSON.stringify(data), now()).run().catch(() => bad(409, 'A group with that name already exists'));
    return {v: 1};
  }
  const done = await env.DB.prepare('UPDATE groups SET name = ?, data = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, JSON.stringify(data), who.hub.id, id, Number(body.v)).run();
  versioned(done.meta.changes); return {v: Number(body.v) + 1};
}
async function removeGroup(env: Env, who: Who, id: string) {
  const counts = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM people WHERE hub = ?1 AND grp = ?2) AS members, (SELECT COUNT(*) FROM groups WHERE hub = ?1) AS groups').bind(who.hub.id, id).first<{members: number; groups: number}>();
  if (counts!.members) bad(400, 'Move or remove its people first');
  if (counts!.groups < 2) bad(400, 'A hub needs at least one group');
  await env.DB.prepare('DELETE FROM groups WHERE hub = ? AND id = ?').bind(who.hub.id, id).run(); return {};
}
const inviteLink = (origin: string, token: string) => `${origin}/#/join/${token}`;
async function savePerson(env: Env, who: Who, id: string, body: Body) {
  const hub = who.hub.id, current = await env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<PersonRow>();
  const name = cleanName(body.name), rows = cleanRows(body.rows), settings = cleanSettings(body.settings ?? {}, false);
  if (who.person) {
    // An invited person changes only themselves, and only what the manager allowed.
    if (who.person !== id || !current) bad(403, 'Not allowed');
    const before = JSON.parse(current!.data) as PersonData, next: PersonData = {...before};
    if (JSON.stringify(rows) !== JSON.stringify(before.rows)) {
      if (!before.can.arrange) bad(403, 'Arranging Home is turned off for you');
      if (rows && !before.can.add) {
        const group = await env.DB.prepare('SELECT data FROM groups WHERE hub = ? AND id = ?').bind(hub, current!.grp).first<{data: string}>();
        const known = new Set([...TRAKT_ROWS, ...(before.rows ?? []).map(row => row.id), ...((JSON.parse(group!.data) as GroupData).rows ?? (JSON.parse(who.hub.data) as HubData).rows).map(row => row.id)]);
        if (rows.some(row => !known.has(row.id))) bad(403, 'Adding rows is turned off for you');
      }
      next.rows = rows;
    }
    if (JSON.stringify(settings) !== JSON.stringify(before.settings)) {if (!before.can.playback) bad(403, 'Changing playback is turned off for you'); next.settings = settings;}
    const done = await env.DB.prepare('UPDATE people SET name = ?, login = ?, data = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, slug(name), JSON.stringify(next), hub, id, Number(body.v)).run().catch(() => bad(409, TAKEN));
    versioned(done.meta.changes); return {v: Number(body.v) + 1};
  }
  const can = body.can as Record<string, unknown> | undefined, grp = text(body.groupId, 40, 'Group');
  const data: PersonData = {rows, settings, can: {arrange: flag(can?.arrange), add: flag(can?.add), playback: flag(can?.playback)},
    // Connections are made and undone on their own, after a check; a page save never changes them.
    trakt: current ? (JSON.parse(current.data) as PersonData).trakt : false, lists: current ? (JSON.parse(current.data) as PersonData).lists : false};
  if (!await env.DB.prepare('SELECT 1 FROM groups WHERE hub = ? AND id = ?').bind(hub, grp).first()) bad(400, 'That group is gone');
  if (!current) {
    if (body.v !== undefined) bad(409, 'This person was removed somewhere else');
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM people WHERE hub = ?').bind(hub).first<{n: number}>())!.n >= MOST_PEOPLE) bad(403, `A hub carries up to ${MOST_PEOPLE} people for now.`);
    const invite = newToken('i');
    // The name is what they sign in with, so it has to be theirs alone in this hub.
    if (await env.DB.prepare('SELECT 1 FROM people WHERE hub = ? AND login = ?').bind(hub, slug(name)).first()) bad(409, TAKEN);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO people (hub, id, grp, name, login, data, jf, invite, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(hub, cleanId(id), grp, name, slug(name), JSON.stringify(data), newId(), await sha(invite), now()),
      await putSecret(env, hub, id, 'signin', {password: newPassword(), pin: newPin()} satisfies SignIn), await putSecret(env, hub, id, 'invite', invite),
    ]);
    return {v: 1};
  }
  const done = await env.DB.prepare('UPDATE people SET name = ?, login = ?, grp = ?, data = ?, paused = ?, version = version + 1 WHERE hub = ? AND id = ? AND version = ?').bind(name, slug(name), grp, JSON.stringify(data), flag(body.paused) ? 1 : 0, hub, id, Number(body.v)).run().catch(() => bad(409, TAKEN));
  versioned(done.meta.changes); return {v: Number(body.v) + 1};
}
const forget = (env: Env, hub: string, id: string) => [
  env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ?').bind(hub, id),
];
async function removePerson(env: Env, who: Who, id: string) {
  await env.DB.batch([...forget(env, who.hub.id, id), env.DB.prepare('DELETE FROM plays WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM starts WHERE hub = ? AND person = ?').bind(who.hub.id, id), env.DB.prepare('DELETE FROM rows_keys WHERE hub = ? AND person = ?').bind(who.hub.id, id), ...forgetTrakt(env, who.hub.id, id), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind NOT IN ('catalogs', 'catalogs-pending', 'aiom', 'aiom-pending')").bind(who.hub.id, id), env.DB.prepare('DELETE FROM people WHERE hub = ? AND id = ?').bind(who.hub.id, id)]);
  return {};
}
/* A person's stored choices, read fresh, and written back as a new version. */
const personData = async (env: Env, hub: string, id: string) => JSON.parse((await env.DB.prepare('SELECT data FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{data: string}>())!.data) as PersonData;
const savePersonData = (env: Env, hub: string, id: string, next: PersonData) => env.DB.prepare('UPDATE people SET data = ?, version = version + 1 WHERE hub = ? AND id = ?').bind(JSON.stringify(next), hub, id);
const hasSecret = async (env: Env, hub: string, id: string, kind: string) => !!await env.DB.prepare('SELECT 1 FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, id, kind).first();
/* Trakt rows on or off. Someone with a Home of their own gets the rows added at the top, or taken out again. */
function withTraktRows(data: PersonData, on: boolean): PersonData {
  const shipped = traktRows().map(item => item.id);
  return {...data, trakt: on, rows: data.rows ? on ? [...traktRows().filter(item => !data.rows!.some(row => row.id === item.id)), ...data.rows] : data.rows.filter(row => !shipped.includes(row.id)) : null};
}
/* Checks a person's own password. People who joined before the two passwords were split are checked against the old shared one. */
const ownPassword = (given: string, stored: string, signin: SignIn) => stored ? checkPassword(given, stored) : same(given, signin.password);
/* Sign-in details for one person: the manager's view of them, or their own. */
async function person(env: Env, who: Who, id: string) {
  if (who.person && who.person !== id) bad(403, 'Not allowed');
  return await env.DB.prepare('SELECT id, grp, name, data, joined, paused, version FROM people WHERE hub = ? AND id = ?').bind(who.hub.id, id).first<PersonRow>() ?? bad(404, 'This person is gone');
}
async function personAction(request: Request, env: Env, who: Who, id: string, action: string, rest: string | undefined, body: Body, origin: string) {
  const hub = who.hub.id, row = await person(env, who, id);
  const signin = await getSecret<SignIn>(env, hub, id, 'signin') ?? bad(500, 'Sign-in details are missing');
  if (action === 'signin' && request.method === 'GET') {
    const invite = await getSecret<string>(env, hub, id, 'invite');
    return {username: row.name, password: signin.password, pin: signin.pin, link: invite ? inviteLink(origin, invite) : ''};
  }
  if (action === 'trakt') {
    // Trakt is connected on AIOMetadata's own page, which hands the person a Token ID. Here it is checked and kept for their Home.
    // (The way it used to be done. Connecting Trakt to the hub, under 'scrobble', does all of it now.)
    const data = await personData(env, hub, id), save = (next: PersonData) => savePersonData(env, hub, id, next);
    if (request.method === 'POST') {
      const tokenId = /^[\w-]{16,80}$/.test(String(body.tokenId ?? '').trim()) ? String(body.tokenId).trim() : bad(400, 'Paste the Token ID from the “Trakt connected” page');
      const answer = await fetch(`${hosted(env, JSON.parse(who.hub.data) as HubData).AIOM_ORIGIN}/api/oauth/token/info`, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, body: JSON.stringify({tokenId})}).catch(() => null);
      const info = answer?.status === 200 ? await answer.json().catch(() => null) as {provider?: string; username?: string} | null : null;
      if (!answer || answer.status >= 500) bad(502, 'AIOMetadata did not answer. Try again in a moment.');
      if (!info || info.provider !== 'trakt') bad(400, 'That Token ID is not a Trakt connection on this hub’s AIOMetadata server. Copy it again from the “Trakt connected” page.');
      const username = String(info!.username ?? '').slice(0, 80);
      await env.DB.batch([await putSecret(env, hub, id, 'trakt', {tokenId, username}), save(withTraktRows(data, true))]);
      return {username};
    }
    if (request.method === 'DELETE') {
      // The Trakt rows stay while Trakt is still connected to the hub.
      const kept = await hasSecret(env, hub, id, LINK);
      await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'trakt'").bind(hub, id), save(withTraktRows(data, kept))]);
      return {};
    }
  }
  if (action === 'mdblist') {
    // A person's own MDBList key: it is what records their plays and knows what they have watched. Checked with MDBList, kept in the vault.
    const stored = await env.DB.prepare('SELECT data FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{data: string}>(), data = JSON.parse(stored!.data) as PersonData;
    const save = (lists: boolean) => env.DB.prepare('UPDATE people SET data = ?, version = version + 1 WHERE hub = ? AND id = ?').bind(JSON.stringify({...data, lists}), hub, id);
    if (request.method === 'POST') {
      const key = text(body.key, 200, 'Key').trim() || bad(400, 'Paste the key');
      const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}/user?apikey=${encodeURIComponent(key)}`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
      if (!answer || answer.status >= 500) bad(502, 'MDBList did not answer. Try again in a moment.');
      if (answer!.status !== 200) bad(400, 'MDBList did not accept that key. Copy it from Preferences, API Access.');
      const username = String(((await answer!.json().catch(() => null)) as {username?: string} | null)?.username ?? '').slice(0, 80);
      await env.DB.batch([await putSecret(env, hub, id, 'mdblist', {key, username}), save(true)]);
      return {username};
    }
    if (request.method === 'DELETE') {await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'mdblist'").bind(hub, id), save(false)]); return {};}
  }
  if (action === 'scrobble' && env.TRAKT_CLIENT_ID) {
    // Trakt, connected by the person or by the manager with them, on Trakt's own sign-in page. The page does the sign-in with
    // Trakt itself (Trakt turns away the shared addresses Workers call from for a while at times) and hands the login over to be
    // kept and renewed here. Once connected, the hub also serves their Trakt rows on Home (rows.ts), added to a Home of their own.
    if (request.method === 'POST' && rest === 'link') {
      const access = text(body.access, 4000, 'Login').trim(), refresh = text(body.refresh, 4000, 'Login').trim(), redirect = text(body.redirect ?? '', 300, 'Address');
      if (!access || !refresh || (redirect && !/^https?:\/\/[^/]+\/api\/trakt\/callback$/.test(redirect))) bad(400, 'Trakt did not finish connecting. Try again.');
      await keepLink(env, hub, id, {access, refresh, expires: Math.floor(Number(body.created) || now()) + Math.floor(Number(body.lasts) || 7 * 86400), username: text(body.username ?? '', 80, 'Name').trim(), ...(redirect ? {redirect} : {})});
      forgetSeats(id);
      const data = await personData(env, hub, id); if (!data.trakt) await savePersonData(env, hub, id, withTraktRows(data, true)).run();
      return {state: 'connected'};
    }
    if (request.method === 'DELETE') {
      await disconnect(env, hub, id); forgetSeats(id);
      // The Trakt rows stay only while AIOMetadata's own Trakt connection is still there to fill them.
      if (!await hasSecret(env, hub, id, 'trakt')) await savePersonData(env, hub, id, withTraktRows(await personData(env, hub, id), false)).run();
      return {};
    }
  }
  if (action === 'carry') {
    // Someone's own watching: only they can look at it or move it, from their own page.
    if (who.person !== id) bad(403, 'Only they can do this, from their own page');
    const got = request.method === 'POST' ? await carry(env, hub, id) : await plan(env, hub, id);
    if ('error' in got) bad(409, got.error);
    return got;
  }
  if (action === 'rotate' && request.method === 'POST') {
    // A fresh player-app password. Every app is signed out; the person's own page is untouched.
    const password = newPassword();
    await env.DB.batch([await putSecret(env, hub, id, 'signin', {...signin, password}), env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id)]);
    return {password};
  }
  if (action === 'password' && request.method === 'POST' && who.person) {
    // Their own password for this site. Only they can change it, and only knowing the current one.
    const key = guesses(request, `own:${hub}:${id}`), stored = (await env.DB.prepare('SELECT pass FROM people WHERE hub = ? AND id = ?').bind(hub, id).first<{pass: string}>())!.pass;
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await ownPassword(String(body.old ?? ''), stored, signin)) {await failed(env, key); bad(403, 'That is not your current password');}
    await env.DB.batch([env.DB.prepare('UPDATE people SET pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(cleanPassword(body.password)), hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ? AND id != ?').bind(hub, id, who.session)]);
    return {};
  }
  if (action === 'reset' && request.method === 'POST' && !who.person) {
    // They forgot it. Nobody can read it back, so the invite link lets them choose a new one. Their apps stay signed in.
    await env.DB.batch([env.DB.prepare("UPDATE people SET pass = '', joined = 0 WHERE hub = ? AND id = ?").bind(hub, id), env.DB.prepare('DELETE FROM sessions WHERE hub = ? AND person = ?').bind(hub, id)]);
    return {};
  }
  if (action === 'pin' && request.method === 'POST') {
    const pin = body.pin === null ? null : body.pin === '' ? newPin() : /^\d{6,8}$/.test(String(body.pin)) ? String(body.pin) : bad(400, 'A PIN is 6 to 8 digits');
    await env.DB.batch([await putSecret(env, hub, id, 'signin', {...signin, pin}), ...(pin && signin.pin && pin !== signin.pin ? [env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id)] : [])]);
    return {pin};
  }
  if (action === 'quick' && request.method === 'POST') {
    // Approving the code a TV shows: the TV becomes this person. Asked by the manager for them, or by the person themselves.
    const key = guesses(request, `quick:${hub}:${id}`), code = String(body.code ?? '').replace(/\D/g, '');
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    const done = await env.DB.prepare('UPDATE quick SET person = ? WHERE hub = ? AND code = ? AND person IS NULL AND expires > ?').bind(id, hub, code, now()).run();
    if (!done.meta.changes) {await failed(env, key); bad(404, 'No TV is showing that code right now. Check the code, or start again on the TV.');}
    return {};
  }
  if (action === 'signout' && request.method === 'POST') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ?').bind(hub, id).run(); return {};}
  // A device's name as the app sent it, or whatever is easier to recognise.
  if (action === 'devices' && rest && request.method === 'PUT') {const name = text(body.name, 60, 'Name').trim() || bad(400, 'Give it a name'); await env.DB.prepare('UPDATE devices SET name = ? WHERE hub = ? AND person = ? AND ref = ?').bind(name, hub, id, rest).run(); return {};}
  if (action === 'devices' && rest && request.method === 'DELETE') {await env.DB.prepare('DELETE FROM devices WHERE hub = ? AND person = ? AND ref = ?').bind(hub, id, rest).run(); return {};}
  return bad(404, 'Not found');
}

/* ---------- signing in ---------- */
const NOBODY = 'pbkdf2.50000.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const hubCount = async (env: Env) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM hubs').first<{n: number}>())!.n;
async function signUp(request: Request, env: Env, body: Body) {
  if (await hubCount(env) >= Number(env.MAX_HUBS ?? 1)) bad(403, 'This site is full. You can run your own copy instead.');
  const key = guesses(request, 'claim');
  if (env.CLAIM_CODE) {
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await same(String(body.code ?? ''), env.CLAIM_CODE)) {await failed(env, key); bad(403, 'That setup code is not right');}
  }
  // No username to invent: the hub gets a short code, and the code plus the password is the sign-in. The same code is in the player address.
  // The site hands out the hub code before the hub exists, so the page can show it and a password manager can save it with the password.
  // Only a code the site itself issued is accepted back; nobody gets to choose theirs.
  if (body.hub !== undefined && !await same(String(body.proof ?? ''), await stamp(env, `hub:${String(body.hub)}`))) bad(400, 'That did not work. Refresh the page and try again.');
  const password = cleanPassword(body.password), id = newId(), hub = newId(), code = body.hub === undefined ? newCode() : String(body.hub);
  const data: HubData = {host: 'ForTheWeak', hostUrl: '', services: [], addons: defaultAddons(), defaults: defaultSettings(), rows: defaultRows()};
  const pass = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, username, name, pass, created) VALUES (?, ?, ?, ?, ?)').bind(id, code, '', pass, now()),
    env.DB.prepare('INSERT INTO hubs (id, code, owner, data, created) VALUES (?, ?, ?, ?, ?)').bind(hub, code, id, JSON.stringify(data), now()),
  ]).catch(() => bad(409, 'That did not work. Try again.'));
  return reply({code}, 200, await startSession(env, {account: id}));
}
async function signIn(request: Request, env: Env, body: Body) {
  const username = String(body.username ?? '').trim().toLowerCase(), key = guesses(request, `site:${username}`);
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const account = await env.DB.prepare('SELECT id, pass, recovery FROM accounts WHERE username = ?').bind(username).first<{id: string; pass: string; recovery: string}>();
  // A recovery code signs in once and sets the new password in the same step.
  if (account && body.recovery !== undefined) {
    const codes = JSON.parse(account.recovery) as string[], used = await sha(String(body.recovery).trim().toLowerCase());
    if (!codes.includes(used)) {await failed(env, key); bad(403, 'That hub code or recovery code is not right');}
    await env.DB.batch([env.DB.prepare('UPDATE accounts SET pass = ?, recovery = ? WHERE id = ?').bind(await hashPassword(cleanPassword(body.password)), JSON.stringify(codes.filter(code => code !== used)), account.id), env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(account.id)]);
    return reply({}, 200, await startSession(env, {account: account.id}));
  }
  // An unknown username costs the same work as a known one, so the answer does not give away which names exist.
  if (!await checkPassword(String(body.password ?? ''), account?.pass ?? NOBODY) || !account) {await failed(env, key); bad(403, 'That hub code or password is not right');}
  return reply({}, 200, await startSession(env, {account: account!.id}));
}
/* An invite link. Opening it shows who it is for; choosing a password joins; after that the link asks for the password. */
async function join(request: Request, env: Env, body: Body, who: Who | null) {
  const token = String(body.token ?? ''), key = guesses(request, `join:${(await sha(token)).slice(0, 24)}`);
  const row = await env.DB.prepare('SELECT p.hub, p.id, p.name, p.joined, p.pass, a.name AS owner FROM people p JOIN hubs h ON h.id = p.hub JOIN accounts a ON a.id = h.owner WHERE p.invite = ?').bind(await sha(token)).first<{hub: string; id: string; name: string; joined: number; pass: string; owner: string}>();
  if (!row) return reply({gone: true});
  const about = {name: row.name, username: row.name, owner: row.owner, joined: !!row.joined};
  if (who?.person === row.id && who.hub.id === row.hub) return reply({ok: true});
  if (body.password === undefined) return reply({ask: about});
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  const signin = await getSecret<SignIn>(env, row.hub, row.id, 'signin') ?? bad(500, 'Sign-in details are missing');
  if (row.joined) {
    if (!await ownPassword(String(body.password), row.pass, signin)) {await failed(env, key); bad(403, 'That password is not right');}
    if (!row.pass) await env.DB.prepare('UPDATE people SET pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(String(body.password)), row.hub, row.id).run();
  } else await env.DB.prepare('UPDATE people SET joined = 1, pass = ? WHERE hub = ? AND id = ?').bind(await hashPassword(cleanPassword(body.password)), row.hub, row.id).run();
  return reply({ok: true}, 200, await startSession(env, {hub: row.hub, person: row.id}));
}
async function account(request: Request, env: Env, who: Who, action: string | undefined, extra: string | undefined, body: Body, origin: string) {
  const me = who.account!;
  if (!action && request.method === 'PUT') {
    await env.DB.prepare('UPDATE accounts SET name = ?, theme = ? WHERE id = ?').bind(text(body.name ?? '', 60, 'Name').trim(), oneOf(body.theme, ['dark', 'light', 'auto'] as const, 'Theme'), me.id).run(); return {};
  }
  if (action === 'password' && request.method === 'POST') {
    const key = guesses(request, `site:${me.username}`), stored = await env.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(me.id).first<{pass: string}>();
    if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
    if (!await checkPassword(String(body.old ?? ''), stored!.pass)) {await failed(env, key); bad(403, 'That is not your current password');}
    await env.DB.batch([env.DB.prepare('UPDATE accounts SET pass = ? WHERE id = ?').bind(await hashPassword(cleanPassword(body.password)), me.id), env.DB.prepare('DELETE FROM sessions WHERE account = ? AND id != ?').bind(me.id, who.session)]);
    return {};
  }
  if (action === 'recovery' && request.method === 'POST') {
    // Only the hashes are kept, so codes can be shown once: when they are made. Making new ones retires the old.
    const codes = Array.from({length: 10}, () => newRecoveryCode());
    await env.DB.prepare('UPDATE accounts SET recovery = ? WHERE id = ?').bind(JSON.stringify(await Promise.all(codes.map(code => sha(code)))), me.id).run();
    return {codes};
  }
  // Passkeys: the browser is given a challenge, makes a key pair on the device, and the site keeps the public half.
  if (action === 'passkeys' && request.method === 'POST' && extra === 'options') {
    const held = await env.DB.prepare('SELECT id FROM passkeys WHERE account = ?').bind(me.id).all<{id: string}>();
    return {...await challenge(env), user: me.id, name: me.username, exclude: held.results.map(row => row.id)};
  }
  if (action === 'passkeys' && request.method === 'POST' && !extra) {
    if (!await created(env, origin, body)) bad(400, 'That passkey could not be checked. Try again.');
    const id = text(body.id, 1400, 'Passkey'), key = text(body.key, 2000, 'Passkey'), alg = body.alg === -7 || body.alg === -257 ? body.alg : bad(400, 'This device makes a kind of passkey the site cannot check');
    if (((await env.DB.prepare('SELECT count(*) AS n FROM passkeys WHERE account = ?').bind(me.id).first<{n: number}>())?.n ?? 0) >= 10) bad(400, 'Ten passkeys is the most. Remove one first.');
    await env.DB.prepare('INSERT INTO passkeys (id, account, name, key, alg, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(id, me.id, text(body.name ?? '', 60, 'Name').trim() || 'A device', key, alg, now()).run();
    return {};
  }
  if (action === 'passkeys' && request.method === 'DELETE' && extra) {
    await env.DB.prepare('DELETE FROM passkeys WHERE account = ? AND substr(id, 1, 16) = ?').bind(me.id, extra).run(); return {};
  }
  if (action === 'recovery' && request.method === 'GET') return {left: (JSON.parse((await env.DB.prepare('SELECT recovery FROM accounts WHERE id = ?').bind(me.id).first<{recovery: string}>())!.recovery) as string[]).length};
  return bad(404, 'Not found');
}
/* A debrid account for the hub. The key goes into the vault and is never sent back. */
async function service(request: Request, env: Env, who: Who, name: string, body: Body) {
  const data = JSON.parse(who.hub.data) as HubData, id = text(name, 40, 'Account');
  if (request.method === 'PUT') {
    const key = text(body.key, 400, 'Key').trim() || bad(400, 'Paste the key');
    const next = {...data, services: [...new Set([...data.services, id])]};
    await env.DB.batch([await putSecret(env, who.hub.id, HUB_OWNER, `debrid:${id}`, key), env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id)]);
    return {v: who.hub.version + 1};
  }
  if (request.method === 'DELETE') {
    const next = {...data, services: data.services.filter(item => item !== id)};
    await env.DB.batch([env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, `debrid:${id}`), env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id)]);
    return {v: who.hub.version + 1};
  }
  return bad(404, 'Not found');
}
/* The hub's catalog keys: TMDB builds the plain Home rows, MDBList reads the lists behind the collection rows. Each is checked with
   its service once, kept in the vault, and never sent back. */
const KEYS: Record<string, {check?: (env: Env, key: string) => string; shape?: RegExp; refused: string}> = {
  tmdb: {check: (env, key) => `${env.TMDB_CHECK ?? 'https://api.themoviedb.org/3/configuration'}?api_key=${encodeURIComponent(key)}`, refused: 'TMDB did not accept that key. Copy the one labelled "API Key", not the long "Read Access Token".'},
  mdblist: {check: (env, key) => `${env.MDBLIST_API ?? 'https://api.mdblist.com'}/user?apikey=${encodeURIComponent(key)}`, refused: 'MDBList did not accept that key. Copy it from Preferences, API Access.'},
};
async function catalogKey(env: Env, who: Who, name: string, body: Body) {
  const key = text(body.key, 200, 'Key').trim() || bad(400, 'Paste the key');
  if (KEYS[name].shape && !KEYS[name].shape!.test(key)) bad(400, KEYS[name].refused);
  const check = KEYS[name].check ? await fetch(KEYS[name].check!(env, key), {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null) : null;
  if (check && [400, 401, 403, 404].includes(check.status)) bad(400, KEYS[name].refused);
  await (await putSecret(env, who.hub.id, HUB_OWNER, `key:${name}`, key)).run();
  return {};
}
/* A list someone pastes the link of, looked up with the hub's MDBList key, so it can be a Home row. */
async function findList(env: Env, who: Who, body: Body) {
  const at = /mdblist\.com\/lists\/([\w.-]+)\/([\w.-]+)/.exec(text(body.link, 400, 'Link')) ?? bad(400, 'Paste the link of an MDBList list, like mdblist.com/lists/someone/a-list');
  const key = await getSecret<string>(env, who.hub.id, HUB_OWNER, 'key:mdblist') ?? bad(400, 'Lists need the hub’s MDBList key first. It goes under Hub, Sources.');
  const answer = await fetch(`${env.MDBLIST_API ?? 'https://api.mdblist.com'}/lists/${at[1]}/${at[2]}?apikey=${encodeURIComponent(key)}`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
  const found = answer?.status === 200 ? await answer.json().catch(() => null) as {id?: number; name?: string; mediatype?: string | null}[] | {id?: number; name?: string; mediatype?: string | null} | null : null, list = Array.isArray(found) ? found[0] : found;
  if (!list || !Number.isInteger(list.id)) bad(404, 'MDBList has no public list at that link');
  const type = list!.mediatype === 'movie' ? 'movie' : list!.mediatype === 'show' ? 'series' : 'all';
  return {id: `mdblist.${list!.id}.${type}`, title: String(list!.name ?? 'A list').slice(0, 80), kind: type === 'movie' ? 'Movies' : type === 'series' ? 'Series' : 'Movies & shows', source: 'MDBList'};
}
/* Which AIOStreams and AIOMetadata servers the hub uses. Each address is asked what it is before it is kept, and the sources the
   AIOStreams server does not offer are noted so they are never asked of it. Blank means the site's own choice. */
const STREAM_TYPES: Record<string, string> = {library: 'stremthruStore', torrentio: 'torrentio', comet: 'comet', meteor: 'meteor', torz: 'stremthruTorz'};
function origin(value: unknown, what: string): string {
  const typed = text(value ?? '', 300, what).trim(); if (!typed) return '';
  let url: URL; try {url = new URL(typed);} catch {return bad(400, `${what} is not a web address`);}
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || url.username || url.port) bad(400, `${what} must be a public https address`);
  return url.origin;
}
async function setHost(env: Env, who: Who, body: Body) {
  const data = JSON.parse(who.hub.data) as HubData, up = origin(body.aiostreams, 'The AIOStreams address'), meta = origin(body.aiometadata, 'The AIOMetadata address');
  const ask = (address: string) => fetch(address, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, redirect: 'manual'}).then(answer => answer.status === 200 ? answer.json() : null, () => null) as Promise<Record<string, any> | null>;
  let missing: string[] = [];
  if (up) {
    const status = await ask(`${up}/api/v1/status`), presets = status?.data?.settings?.presets as {ID: string; DISABLED?: unknown}[] | undefined;
    if (!Array.isArray(presets)) bad(400, 'That address did not answer as an AIOStreams server');
    if (status!.data.settings.protected) bad(400, 'That AIOStreams server asks for a password to make new setups, which the hub cannot give.');
    const offered = new Set(presets!.filter(item => !item.DISABLED).map(item => item.ID));
    if (!offered.has('custom')) bad(400, 'That AIOStreams server does not allow addons by link, which Home rows need.');
    missing = Object.entries(STREAM_TYPES).filter(([, type]) => !offered.has(type)).map(([id]) => id);
  }
  if (meta && typeof (await ask(`${meta}/api/config`))?.addonVersion !== 'string') bad(400, 'That address did not answer as an AIOMetadata server');
  const next: HubData = {...data, hostUrl: up, metaUrl: meta, missing, host: up ? new URL(up).hostname : 'ForTheWeak'};
  await env.DB.prepare('UPDATE hubs SET data = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(next), who.hub.id).run();
  return {v: who.hub.version + 1, missing};
}
async function dropKey(env: Env, who: Who, name: string) {
  await env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(who.hub.id, HUB_OWNER, `key:${name}`).run();
  return {};
}
/* Deletes the hub and everything in it, here and on the streaming server. The password is asked for again: there is no undo. */
/* Advanced: the way into the hub's own setups on AIOStreams and AIOMetadata, for the manager only and only after their password
   again. These are the real keys to those setups, so they are handed over one deliberate time and never ride in page data. */
async function advanced(request: Request, site: Env, who: Who, body: Body) {
  const key = guesses(request, `site:${who.account!.username}`), stored = await site.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(who.account!.id).first<{pass: string}>();
  if (await blocked(site, key)) bad(429, 'Too many tries. Wait ten minutes.');
  if (!await checkPassword(String(body.password ?? ''), stored!.pass)) {await failed(site, key); bad(403, 'That is not your password');}
  const env = hosted(site, JSON.parse(who.hub.data) as HubData);
  const players = await getSecret<{uuid: string; password: string; at?: string}>(env, who.hub.id, HUB_OWNER, 'players'), home = await getSecret<{uuid: string; password: string; at?: string}>(env, who.hub.id, HUB_OWNER, 'catalogs');
  // AIOStreams opens a setup already signed in from the address Stremio's own Configure button uses; it needs the password in AIOStreams' sealed form.
  const up = players?.at ?? env.UP_ORIGIN, sealed = players ? await fetch(`${up}/api/v1/user`, {headers: {authorization: `Basic ${btoa(`${players.uuid}:${players.password}`)}`, accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).then(r => r.ok ? r.json() as Promise<{data?: {encryptedPassword?: string}}> : null, () => null).then(j => j?.data?.encryptedPassword) : undefined;
  return {
    aiostreams: players ? {open: sealed ? `${up}/stremio/${players.uuid}/${encodeURIComponent(sealed)}/configure` : `${up}/stremio/configure`, id: players.uuid, password: players.password} : null,
    aiometadata: home ? {open: `${home.at ?? env.AIOM_ORIGIN}/stremio/${home.uuid}/configure`, id: home.uuid, password: home.password} : null,
    // The separate AIOMetadata setups a group or a person has while their Home, looks or accounts differ from the shared one.
    own: await ownDoors(env, who.hub.id),
    front: env.FRONT === 'aiometadata',
  };
}
async function ownDoors(env: Env, hub: string) {
  const owners = (await env.DB.prepare("SELECT s.owner, s.kind, coalesce(p.name, g.name) AS name FROM secrets s LEFT JOIN people p ON p.hub = s.hub AND p.id = s.owner LEFT JOIN groups g ON g.hub = s.hub AND s.owner = '#g:' || g.id WHERE s.hub = ? AND s.kind IN ('catalogs', 'aiom') AND s.owner != ?").bind(hub, HUB_OWNER).all<{owner: string; name: string | null; kind: string}>()).results;
  const doors = [];
  for (const row of owners) {
    const made = await getSecret<{uuid: string; password: string; at?: string}>(env, hub, row.owner, row.kind);
    if (made) doors.push({name: row.name ?? 'Someone removed', group: row.owner.startsWith('#g:'), player: row.kind === 'aiom', open: `${made.at ?? env.AIOM_ORIGIN}/stremio/${made.uuid}/configure`, id: made.uuid, password: made.password});
  }
  return doors;
}
async function removeHub(request: Request, env: Env, who: Who, body: Body) {
  const key = guesses(request, `site:${who.account!.username}`), stored = await env.DB.prepare('SELECT pass FROM accounts WHERE id = ?').bind(who.account!.id).first<{pass: string}>();
  if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
  if (!await checkPassword(String(body.password ?? ''), stored!.pass)) {await failed(env, key); bad(403, 'That is not your password');}
  if (!await removePlayers(env, who.hub)) bad(502, 'The streaming server did not confirm the removal, so nothing was deleted. Try again in a moment.');
  const hub = who.hub.id;
  await env.DB.batch([...['devices', 'plays', 'starts', 'quick', 'secrets', 'rows_keys', 'trakt_outbox', 'rows_cache', 'people', 'groups', 'ops'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ?`).bind(hub)), env.DB.prepare('DELETE FROM sessions WHERE hub = ? OR account = ?').bind(hub, who.account!.id),
    env.DB.prepare('DELETE FROM hubs WHERE id = ?').bind(hub), env.DB.prepare('DELETE FROM passkeys WHERE account = ?').bind(who.account!.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(who.account!.id)]);
  return {};
}

export async function api(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const path = url.pathname.slice(5).split('/').map(decodeURIComponent), [first, second, third, fourth] = path, method = request.method;
    // Anything that changes something must come from this site's own pages.
    if (method !== 'GET' && request.headers.get('origin') !== url.origin) bad(403, 'Not allowed');
    const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => bad(400, 'Not valid')) as Body;
    if (!body || typeof body !== 'object') bad(400, 'Not valid');
    if (first === 'open' && method === 'GET') {
      const signup = await hubCount(env) < Number(env.MAX_HUBS ?? 1), hub = newCode();
      return reply({signup, code: !!env.CLAIM_CODE, ...(signup ? {hub, proof: await stamp(env, `hub:${hub}`)} : {})});
    }
    if (first === 'signup' && method === 'POST') return await signUp(request, env, body);
    if (first === 'signin' && method === 'POST') return await signIn(request, env, body);
    if (first === 'passkey' && method === 'GET') return reply(await challenge(env));
    if (first === 'passkey' && method === 'POST') {
      const key = guesses(request, 'passkey').slice(1);
      if (await blocked(env, key)) bad(429, 'Too many tries. Wait ten minutes.');
      const held = await env.DB.prepare('SELECT account, key, alg FROM passkeys WHERE id = ?').bind(String(body.id ?? '')).first<{account: string; key: string; alg: number}>();
      if (!held || !await signed(env, url.origin, body, held.key, held.alg)) {await failed(env, key); bad(403, 'That passkey is not one this site knows');}
      return reply({}, 200, await startSession(env, {account: held!.account}));
    }
    // Back from Trakt's sign-in: straight on to the page, which finishes it (see Trakt in pages.tsx). The code is single-use and
    // worthless without the proof the page kept, and it travels in the fragment, which browsers never send anywhere.
    if (first === 'trakt' && path[1] === 'callback' && method === 'GET') {
      const back = new URLSearchParams(); for (const name of ['code', 'state', 'error']) {const value = url.searchParams.get(name); if (value) back.set(name, value.slice(0, 4000));}
      return new Response(null, {status: 302, headers: {location: `/#/trakt?${back}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}});
    }
    // A person's Trakt rows, read by their AIOMetadata setup. The token in the address is the only key (see rows.ts).
    if (first === 'rows' && method === 'GET') return await rows(env, path.slice(1));
    const who = await whoIs(request, env);
    if (first === 'join' && method === 'POST') return await join(request, env, body, who);
    if (first === 'signout' && method === 'POST') {if (who) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(who.session).run(); return reply({}, 200, cookie('', 0));}
    if (!who) return reply({message: 'Sign in first'}, 401);
    // Anyone signed in may ask for the players to be brought in step; what is sent comes only from what the hub has stored.
    if (first === 'lists' && method === 'POST') return reply(await findList(env, who, body));
    if (first === 'sync' && method === 'POST') return reply(await syncPlayers(env, who.hub, url.origin));
    // An invited person gets their own rows; the manager can ask for anyone's.
    if (first === 'previews' && method === 'GET') return reply({rows: await previews(env, who.hub, who.person ?? (url.searchParams.get('person') || undefined))});
    if (first === 'activity' && method === 'GET') {
      // The manager sees everyone; an invited person sees only themselves.
      const rows = await env.DB.prepare(`SELECT person, item, title, detail, position, duration, device, playing, updated, art, place, net FROM plays WHERE hub = ?1 ${who.person ? 'AND person = ?2' : ''} ORDER BY updated DESC LIMIT 300`).bind(...(who.person ? [who.hub.id, who.person] : [who.hub.id])).all();
      const starts = await env.DB.prepare(`SELECT person, at FROM starts WHERE hub = ?1 AND at > ?2 ${who.person ? 'AND person = ?3' : ''} ORDER BY at DESC LIMIT 2000`).bind(...(who.person ? [who.hub.id, now() - 7 * 86400, who.person] : [who.hub.id, now() - 7 * 86400])).all();
      return reply({now: now(), plays: rows.results, starts: starts.results});
    }
    if (first === 'state' && method === 'GET') return reply(await state(env, who) ?? bad(401, 'Sign in first'));
    if (first === 'people' && second && third) return reply(await personAction(request, env, who, second, third, fourth, body, url.origin));
    if (first === 'people' && second && method === 'PUT') return reply(await savePerson(env, who, second, body));
    if (who.person) bad(403, 'Not allowed');
    if (first === 'hub' && method === 'PUT') return reply(await saveHub(env, who, body));
    if (first === 'hub' && method === 'POST' && second === 'advanced') return reply(await advanced(request, env, who, body));
    if (first === 'host' && method === 'PUT') return reply(await setHost(env, who, body));
    if (first === 'hub' && method === 'POST' && second === 'delete') return reply(await removeHub(request, env, who, body), 200, cookie('', 0));
    if (first === 'groups' && second && method === 'PUT') return reply(await saveGroup(env, who, second, body));
    if (first === 'groups' && second && method === 'DELETE') return reply(await removeGroup(env, who, second));
    if (first === 'people' && second && method === 'DELETE') return reply(await removePerson(env, who, second));
    if (first === 'services' && second) return reply(await service(request, env, who, second, body));
    if (first === 'keys' && second && KEYS[second] && method === 'PUT') return reply(await catalogKey(env, who, second, body));
    if (first === 'keys' && second === 'mdblist' && method === 'DELETE') return reply(await dropKey(env, who, second));
    if (first === 'account') return reply(await account(request, env, who, second, third, body, url.origin));
    return reply({message: 'Not found'}, 404);
  } catch (error) {
    if (error instanceof Bad) return reply({message: error.message}, error.status);
    console.error('api', url.pathname, (error as Error).message);
    return reply({message: 'Something went wrong on our side'}, 500);
  }
}
