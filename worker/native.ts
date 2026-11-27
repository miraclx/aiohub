// The hub's own setup on the streaming server (AIOStreams): created once per hub, then kept in step with what the site holds.
// The hub only ever talks to a setup it created itself, whose id and password it keeps in the vault. Nothing here names an id in an
// error or a log line. Each request shape was proven by script against a live server first.
import {CERTS, folderFits, isPlace, rowsOf, serviceOf, suggestionOf, withKids} from '../src/data';
import type {Addon, Limit, Part, Row, Settings} from '../src/data';
import type {Env} from './util';
import {gate, getSecret, hosted, inTurn, newToken, now, putSecret, sha, unseal} from './util';
import {CUSTOM, ROWS, addressOf, catalogFor, catalogOf, customId, fills, forYouRow, hubMade, servedOf} from './rows';
import {placePick} from './foryou';
import type {Pick} from './foryou';
import {LINK} from './trakt';
import {LIKED_ROW, SHELF, SHELF_ROW, mdbOf, shelfFrom, shelfOn} from './shelf';
import type {Shelf} from './shelf';
import shipped from './collections.json';

export const HUB_OWNER = '#hub', MOST_PEOPLE = 20; // AIOStreams carries 20 extra users per setup by default
const SERVICE: Record<string, string> = {'TorBox': 'torbox', 'Real-Debrid': 'realdebrid', 'AllDebrid': 'alldebrid', 'Premiumize': 'premiumize', 'Debrid-Link': 'debridlink', 'EasyDebrid': 'easydebrid'};
const SOURCE: Record<string, {type: string; name: string; options: Record<string, unknown>}> = {
  library: {type: 'stremthruStore', name: 'StremThru Store', options: {usenet: false}},
  torrentio: {type: 'torrentio', name: 'Torrentio', options: {providers: [], useMultipleInstances: false}},
  comet: {type: 'comet', name: 'Comet', options: {includeP2P: false, removeTrash: true}},
  meteor: {type: 'meteor', name: 'Meteor', options: {includeP2P: false, removeTrash: false, useMultipleInstances: false}},
  torz: {type: 'stremthruTorz', name: 'StremThru Torz', options: {includeP2P: false, useMultipleInstances: false}},
};
const HOME = 'h01';
interface Home {uuid: string; password: string; at?: string; enc?: string}
interface HubData {hostUrl?: string; metaUrl?: string; missing?: string[]; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]}
interface Persona {id: string; name: string; [key: string]: unknown}
interface Preset {type: string; instanceId: string; enabled: boolean; options: Record<string, unknown>}
interface Stored {services?: unknown; presets?: Preset[]; formatter?: unknown; jellyfin?: {primary?: unknown; personas?: Persona[]; segments?: boolean}; [key: string]: unknown}
export interface Synced {state: 'ok' | 'partial' | 'needs-key' | 'stuck' | 'error'; message?: string; more?: boolean}

const basic = (home: Home) => ({authorization: `Basic ${btoa(`${home.uuid}:${home.password}`)}`, accept: 'application/json', 'user-agent': 'AIOHub/1.0'});
const short = () => [...crypto.getRandomValues(new Uint8Array(2))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 3);
const STUCK: Synced = {state: 'stuck', message: 'Setting up the players did not finish last time, and it is not safe to simply try again. It needs a look.'};
/* Another request holds the claim to create this setup. Claimed in the last two minutes: that request is most likely still at it
   (the site syncs on opening and after each save, and two tabs or two people can overlap), so this pass says nothing and the site
   asks again. Older: it never finished, which is what STUCK is for. */
const BUSY = 120;
const claimedLately = async (env: Env, hub: string, kind: string, target: string) => !!await env.DB.prepare("SELECT 1 FROM ops WHERE hub = ? AND kind = ? AND target = ? AND state = 'requested' AND created > ?").bind(hub, kind, target, now() - BUSY).first();

/* Playback choices, as AIOStreams settings. The three "how long to look" conditions were checked on staging. */
const RESOLUTIONS = ['2160p', '1440p', '1080p', '720p', '576p', '480p', '360p', '240p', '144p', 'Unknown'];
// Each choice also keeps files inside a bitrate band (bits per second; movies, then episodes) and lists the largest file inside it
// first. A trial of 19 titles (2026-11-17) showed why: "largest first" alone put 20-48 Mbps remuxes on top, "smallest first" put
// 0.2-0.6 GB copies squeezed to under 1 Mbps on top. The 1 Mbps floor keeps those out. A file whose bitrate is not known passes.
// The data saver is a size target, not a resolution: any resolution may play if the file is small (a 4K film at 800 MB wins over
// a 1080p one). It caps bitrate per resolution and file size, and prefers HEVC and AV1, which keep a good picture at that size.
// Many files list no bitrate (working it out needs a TMDB key in AIOStreams), so each choice also caps the file size (bytes;
// movies, then episodes); the person's own size limit still applies when it is lower. Checked against AIOStreams on 2026-11-18.
type Band = [number, number];
const band = (movies: Band, series: Band) => ({movies, series});
const QUALITY: Record<Settings['quality'], {excluded: string[]; first: string[]; bitrate: Record<string, {movies: Band; series: Band}>; encodes?: string[]; most?: [number, number]}> = {
  saver: {excluded: [], first: ['2160p', '1440p', '1080p', '720p', '576p', '480p'], encodes: ['HEVC', 'AV1'], most: [3e9, 1.5e9],
    bitrate: {global: band([0.5e6, 4e6], [0.5e6, 4e6]), '2160p': band([0.8e6, 4e6], [0.8e6, 4e6]), '1440p': band([0.8e6, 3.5e6], [0.8e6, 3.5e6]), '1080p': band([0.8e6, 2.5e6], [0.6e6, 2.5e6]), '720p': band([0.5e6, 2e6], [0.5e6, 2e6])}},
  balanced: {excluded: ['2160p'], first: ['1080p', '1440p', '720p'], most: [15e9, 6e9],
    bitrate: {global: band([0.6e6, 12e6], [0.5e6, 10e6]), '1440p': band([1e6, 14e6], [1e6, 12e6]), '1080p': band([1e6, 10e6], [0.8e6, 8e6]), '720p': band([0.6e6, 6e6], [0.5e6, 5e6])}},
  best: {excluded: [], first: ['2160p', '1440p', '1080p', '720p'],
    bitrate: {global: band([0.6e6, 40e6], [0.5e6, 30e6]), '2160p': band([1e6, 40e6], [1e6, 30e6]), '1440p': band([1e6, 25e6], [1e6, 20e6]), '1080p': band([1e6, 20e6], [0.8e6, 15e6]), '720p': band([0.6e6, 8e6], [0.5e6, 6e6])}},
};
const SEARCH: Record<Settings['search'], {enabled: boolean; condition: string}> = {
  // Each waits for the library first: what is already in the debrid account must always be in the list, and it is listed first.
  fast: {enabled: true, condition: `"${SOURCE.library.name}" in queriedAddons and (count(cached(totalStreams)) >= 3 or totalTimeTaken > 3000)`},
  balanced: {enabled: true, condition: `"${SOURCE.library.name}" in queriedAddons and (count(cached(resolution(totalStreams,'2160p','1080p'))) >= 5 or (count(cached(totalStreams)) >= 1 and totalTimeTaken > 6000) or totalTimeTaken > 10000)`},
  thorough: {enabled: false, condition: 'false'},
};
// AIOStreams refuses a whole save over one language name it does not know, so only names it listed on staging are ever sent.
const LANGUAGES = new Set('English Japanese Chinese Russian Arabic Portuguese Spanish French German Italian Korean Hindi Bengali Punjabi Marathi Gujarati Tamil Telugu Kannada Malayalam Thai Vietnamese Indonesian Turkish Hebrew Persian Ukrainian Greek Lithuanian Latvian Estonian Polish Czech Slovak Hungarian Romanian Bulgarian Serbian Croatian Slovenian Dutch Danish Finnish Swedish'.split(' '));
// With the hub's TMDB key, AIOStreams works out every file's bitrate from its size and the title's running time; without it,
// only files that state their own length have one, and the size caps do the work.
export function playback(stored: Stored, settings: Settings, runtime = false) {
  const quality = QUALITY[settings.quality] ?? QUALITY.balanced, bytes = Math.round(settings.maxSizeGb * 1e9);
  stored.excludedResolutions = quality.excluded;
  stored.preferredResolutions = [...quality.first, ...RESOLUTIONS.filter(item => !quality.first.includes(item) && !quality.excluded.includes(item))];
  stored.excludedQualities = ['CAM', 'SCR', 'TS', 'TC'];
  const movies = Math.min(bytes, quality.most?.[0] ?? bytes), series = Math.min(bytes, quality.most?.[1] ?? bytes);
  stored.size = {...(stored.size as object ?? {}), global: {movies: [0, movies], series: [0, series], anime: [0, series]}};
  stored.preferredLanguages = [...settings.languages.filter(item => LANGUAGES.has(item)), 'Dual Audio', 'Multi'];
  const {global, ...resolution} = quality.bitrate;
  stored.bitrate = {useMetadataRuntime: runtime, global, resolution};
  stored.preferredEncodes = quality.encodes ?? [];
  const order = [...(settings.cachedFirst ? ['library', 'cached', 'resolution', 'language', 'quality'] : ['library', 'resolution', 'language', 'quality', 'cached']), ...(quality.encodes ? ['encode'] : []), 'size'];
  stored.sortCriteria = {...(stored.sortCriteria as object ?? {}), global: order.map(key => ({key, direction: 'desc'}))};
  stored.dynamicAddonFetching = SEARCH[settings.search] ?? SEARCH.balanced;
  // A tidy list: what is already owned is marked, the same file from two sources shows once, and each quality shows its best few.
  // Set once; if these are changed in AIOStreams itself (Advanced), the change is kept.
  stored.checkOwned ??= true;
  stored.deduplicator ??= {enabled: true, excludeAddons: [], multiGroupBehaviour: 'aggressive', keys: ['filename', 'infoHash'], cached: 'single_result', uncached: 'per_service', p2p: 'single_result'};
  stored.resultLimits ??= {resolution: 5};
}

/* Subtitles come from OpenSubtitles, asked for in the chosen languages. Sources added by their link ride as presets of their own. */
const SUBTITLES = 'opensubtitles-v3-plus';
const CODES: Record<string, string[]> = {English: ['en'], French: ['fr'], Spanish: ['es'], German: ['de'], Portuguese: ['pt-pt', 'pt-br'], Arabic: ['ar'], Hindi: ['hi'], Japanese: ['ja'], Korean: ['ko'], Chinese: ['zh-cn', 'zh-tw']};
const codes = (names: string[]) => names.flatMap(name => CODES[name] ?? []).slice(0, 10);
const extraId = (addon: Addon) => `x${addon.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()}`;
const extrasOf = (data: HubData) => data.addons.filter(addon => addon.custom && addon.url);
/* Changes only what the hub owns, in place. Everything else in the stored setup, and every user's other fields, is left exactly as found. */
interface Variant {id: string; name: string; enabled: boolean; script: string}
const OURS = 'hub-';
function patch(stored: Stored, data: HubData, key: string, people: {id: string; name: string; variants?: string[]; tracks?: boolean}[], home: string | null, variants: Variant[] = [], tmdb: string | null = null, front = false) {
  if (tmdb) stored[tmdb.length > 40 ? 'tmdbAccessToken' : 'tmdbApiKey'] = tmdb;
  stored.services = [{id: SERVICE[data.defaults.debrid], enabled: true, credentials: {apiKey: key}}];
  // Every source the hub knows is kept in the setup, on or off, so a group or a person can switch one on for themselves.
  const wanted = new Set(['library', ...data.defaults.sources]), presets = stored.presets ?? [];
  for (const [id, source] of Object.entries(SOURCE)) {
    if (data.missing?.includes(id)) continue; // this server does not offer it
    const found = presets.find(item => item.type === source.type);
    if (found) found.enabled = wanted.has(id);
    else presets.push({type: source.type, instanceId: short(), enabled: wanted.has(id), options: {name: source.name, timeout: 30000, resources: ['stream'], mediaTypes: [], ...source.options}});
  }
  // Home rows come from the hub's own AIOMetadata setup. The address carries a number that changes with every catalog change,
  // which is what makes AIOStreams look again instead of showing what it remembered.
  if (home) {
    const found = presets.find(item => item.type === 'custom' && item.instanceId === HOME);
    // `watch_state` lets a person's plays be recorded through their own Home setup, when that setup has tracking switched on.
    if (found) {found.enabled = true; found.options.manifestUrl = home; found.options.resources = ['catalog', 'meta', 'watch_state'];}
    else presets.push({type: 'custom', instanceId: HOME, enabled: true, options: {name: 'Home', manifestUrl: home, timeout: 30000, resources: ['catalog', 'meta', 'watch_state'], mediaTypes: [], libraryAddon: false, resultPassthrough: false, forceToTop: false}});
    stored.upstreamCatalogOrder = [ADDON];
    stored.catalogModifications = [...MODIFICATIONS, ...((stored.catalogModifications as {id?: string}[] | undefined) ?? []).filter(item => !item.id?.startsWith(`${ADDON}.`))];
  } else if (front) {
    // With AIOMetadata in front, nobody browses through AIOStreams: it only finds streams, so the hub's Home there is switched off.
    const found = presets.find(item => item.type === 'custom' && item.instanceId === HOME);
    if (found) found.enabled = false;
    stored.catalogModifications = ((stored.catalogModifications as {id?: string}[] | undefined) ?? []).filter(item => !item.id?.startsWith(`${ADDON}.`));
  }
  const subs = codes(data.defaults.subtitles), captions = presets.find(item => item.type === SUBTITLES);
  if (captions) {captions.enabled = !!subs.length; if (subs.length) captions.options.language = subs;}
  else presets.push({type: SUBTITLES, instanceId: 'os1', enabled: !!subs.length, options: {name: 'OpenSubtitles', timeout: 30000, resources: ['subtitles'], language: subs.length ? subs : ['en'], sources: 'all', includeAiTranslated: true, movieHashPlusAutoAdjustment: false}});
  const extras = extrasOf(data), ids = new Set(extras.map(extraId));
  for (const addon of extras) {
    const found = presets.find(item => item.type === 'custom' && item.instanceId === extraId(addon));
    if (found) {found.enabled = wanted.has(addon.id); found.options.manifestUrl = addon.url;}
    else presets.push({type: 'custom', instanceId: extraId(addon), enabled: wanted.has(addon.id), options: {name: addon.name, manifestUrl: addon.url, timeout: 30000, resources: ['stream'], mediaTypes: [], libraryAddon: false, resultPassthrough: false, forceToTop: false}});
  }
  stored.presets = presets.filter(item => !(item.type === 'custom' && /^x[a-z0-9]{1,6}$/.test(item.instanceId) && !ids.has(item.instanceId)));
  playback(stored, data.defaults, !!tmdb);
  stored.formatter = label(data.defaults);
  // What a group or a person has changed for themselves travels as a variant: a short list of changes applied only for them.
  stored.variants = [...variants, ...((stored.variants as Variant[] | undefined) ?? []).filter(item => !item.id?.startsWith(OURS))];
  // With AIOMetadata in front, people sign in to their own AIOMetadata setup, so AIOStreams keeps a user only for someone whose
  // own setup is not there yet (the caller passes just them): they keep signing in as before until it is.
  const users = stored.jellyfin?.personas ?? [], keep = new Set(people.map(person => person.id));
  for (const person of people) {
    let found = users.find(user => user.id === person.id);
    if (found) found.name = person.name; else users.push(found = {id: person.id, name: person.name, history: 'own', trackers: []});
    // AIOStreams records plays for a person with no tracker list of their own (it finds their Home setup); an empty list means never.
    if (person.tracks) delete found.trackers; else found.trackers = [];
    const theirs = [...((found.variants as string[] | undefined) ?? []).filter(item => !item.startsWith(OURS)), ...(person.variants ?? [])];
    if (theirs.length || found.variants) found.variants = theirs;
  }
  stored.jellyfin = {...(stored.jellyfin ?? {}), segments: data.defaults.skip, primary: stored.jellyfin?.primary ?? {name: 'Hub', trackers: []}, personas: users.filter(user => keep.has(user.id))};
}
const label = (settings: Settings) => ({id: 'custom', definitions: {custom: {name: settings.formatter.name, description: settings.formatter.description}}});
/* What one level changes compared with the level above it, as variant lines. Only real differences are written. */
function differences(above: Settings, own: Settings, keys: Map<string, string>, home: string | null, extras: Addon[], runtime = false): string[] {
  const a: Stored = {}, b: Stored = {}, lines: string[] = []; playback(a, above, runtime); playback(b, own, runtime);
  const say = (path: string, from: unknown, to: unknown) => {if (JSON.stringify(from) !== JSON.stringify(to)) lines.push(`set ${path} = ${JSON.stringify(to)}`);};
  say('excludedResolutions', a.excludedResolutions, b.excludedResolutions); say('preferredResolutions', a.preferredResolutions, b.preferredResolutions);
  say('size.global', (a.size as {global: unknown}).global, (b.size as {global: unknown}).global); say('preferredLanguages', a.preferredLanguages, b.preferredLanguages);
  say('sortCriteria.global', (a.sortCriteria as {global: unknown}).global, (b.sortCriteria as {global: unknown}).global); say('dynamicAddonFetching', a.dynamicAddonFetching, b.dynamicAddonFetching);
  say('bitrate', a.bitrate, b.bitrate); say('preferredEncodes', a.preferredEncodes, b.preferredEncodes);
  say('formatter', label(above), label(own));
  for (const [id, source] of Object.entries(SOURCE)) {
    const was = id === 'library' || above.sources.includes(id), is = id === 'library' || own.sources.includes(id);
    if (was !== is) lines.push(`${is ? 'enable' : 'disable'} presets[type="${source.type}"]`);
  }
  const account = keys.get(own.debrid);
  if (own.debrid !== above.debrid && account && SERVICE[own.debrid]) lines.push(`set services = ${JSON.stringify([{id: SERVICE[own.debrid], enabled: true, credentials: {apiKey: account}}])}`);
  const subs = codes(own.subtitles);
  if (JSON.stringify(subs) !== JSON.stringify(codes(above.subtitles))) lines.push(...(subs.length ? [`set presets[type="${SUBTITLES}"].options.language = ${JSON.stringify(subs)}`] : []), ...(!subs.length !== !codes(above.subtitles).length ? [`${subs.length ? 'enable' : 'disable'} presets[type="${SUBTITLES}"]`] : []));
  for (const addon of extras) {
    const was = above.sources.includes(addon.id), is = own.sources.includes(addon.id);
    if (was !== is) lines.push(`${is ? 'enable' : 'disable'} presets[instanceId="${extraId(addon)}"]`);
  }
  if (home) lines.push(`set presets[instanceId="${HOME}"].options.manifestUrl = ${JSON.stringify(home)}`);
  return lines;
}
const fresh = (): Stored => ({addonName: 'AIOHub', excludedStreamTypes: ['p2p'], presets: []});

async function create(env: Env, hub: string, config: Stored, service: string): Promise<Home | Synced> {
  // Claim the step first. Only the request that wins the claim creates; the password is in the vault before anything is sent.
  const claim = await env.DB.prepare("INSERT INTO ops (hub, kind, target, state, created, updated) VALUES (?, 'create-players', 'hub', 'requested', ?, ?) ON CONFLICT DO NOTHING").bind(hub, now(), now()).run();
  if (!claim.meta.changes) return await claimedLately(env, hub, 'create-players', 'hub') ? {state: 'partial', message: '', more: true} : STUCK;
  const password = newToken('p');
  await (await putSecret(env, hub, HUB_OWNER, 'players-pending', {password})).run();
  const release = () => env.DB.batch([env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'create-players'").bind(hub), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'players-pending'").bind(hub, HUB_OWNER)]);
  let answer: Response;
  try {answer = await fetch(`${env.UP_ORIGIN}/api/v1/user`, {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json', origin: env.UP_ORIGIN, 'user-agent': 'AIOHub/1.0'}, body: JSON.stringify({config, password})});}
  catch {return STUCK;} // sent, no answer: it may or may not exist. The claim stays so nobody creates a second one.
  if (answer.status === 201) {
    const uuid = ((await answer.json().catch(() => null)) as {data?: {uuid?: string}} | null)?.data?.uuid;
    if (!uuid) return STUCK;
    const home = {uuid, password, at: env.UP_ORIGIN};
    await env.DB.batch([await putSecret(env, hub, HUB_OWNER, 'players', home), env.DB.prepare("UPDATE ops SET state = 'done', updated = ? WHERE hub = ? AND kind = 'create-players'").bind(now(), hub), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'players-pending'").bind(hub, HUB_OWNER)]);
    return home;
  }
  if ([400, 401, 403, 409, 422, 429].includes(answer.status)) {
    // Refused outright, so nothing was created and it is safe to try again later.
    await release();
    // AIOStreams tries the debrid key while checking a new setup; a key it cannot use is by far the usual reason for a refusal.
    const why = answer.status === 429 ? '' : ((await answer.json().catch(() => null)) as {error?: {message?: string}} | null)?.error?.message ?? '';
    if (answer.status === 429) return {state: 'error', message: 'AIOStreams is not taking new setups right now. Try again in an hour.'};
    if (/401|403|unauthori[sz]ed|forbidden/i.test(why)) return {state: 'error', message: `${service} did not accept the key. Replace it under Hub, Sources.`};
    console.error('create refused', answer.status, why.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').slice(0, 200));
    return {state: 'error', message: 'AIOStreams refused the setup. Nothing was created; it will be tried again on your next change.'};
  }
  return STUCK;
}

/* ---------- Home rows: the hub's own AIOMetadata setup ---------- */
// Plain rows are TMDB catalogs. Collection rows (by Service, by Genre, Mixed) are folders over public lists that AIOMetadata can only
// read with an MDBList key, so they are sent only when the hub has one. Proven by script against a live server.
const TMDB_ROW: Record<string, {id: string; type: string}> = {
  'trending-movies': {id: 'tmdb.trending', type: 'movie'}, 'trending-series': {id: 'tmdb.trending', type: 'series'},
  'top-movies': {id: 'tmdb.top_rated', type: 'movie'}, 'top-series': {id: 'tmdb.top_rated', type: 'series'},
  'popular-movies': {id: 'tmdb.top', type: 'movie'}, 'popular-series': {id: 'tmdb.top', type: 'series'},
};
// A person's own Trakt rows. These are AIOMetadata's own, for someone whose Trakt is connected there (the older way, which the hub
// cannot read); someone whose Trakt is connected to the hub gets the rows from the hub instead (rows.ts). Up Next shows each show's
// poster, not a still of the episode. New for you has no like in AIOMetadata: its recently aired episodes of their shows is the
// nearest, so that is what such a person gets under the name.
const TRAKT_ROW: Record<string, Record<string, unknown> & {id: string; type: string}> = {
  'watchlist': {id: 'trakt.watchlist', type: 'all', sort: 'added', sortDirection: 'desc'},
  'recommended-movies': {id: 'trakt.recommendations.movies', type: 'movie'}, 'recommended-series': {id: 'trakt.recommendations.shows', type: 'series'},
  'up-next': {id: 'trakt.upnext', type: 'series', cacheTTL: 300, metadata: {useShowPosterForUpNext: true}}, 'new-for-you': {id: 'trakt.unwatched', type: 'series', cacheTTL: 300},
};
// `shape`: for each catalog sent, a short fingerprint of it and of the settings that change what it holds (see shapeOf).
// `charts`: the FlixPatrol charts (a For you Top 10) the hub put in this setup, as type/id, so it can take them out again.
interface Catalogs {uuid: string; password: string; v: number; sent: string; at?: string; client?: string; shape?: Record<string, string>; charts?: string[]}
/* With FRONT=aiometadata each person has one more AIOMetadata setup: their own Jellyfin server, which their player apps reach
   through the hub. It holds their Home, their Trakt and MDBList, and points at their own stream setup on AIOStreams. */
export const PLAYER = 'aiom', VIA = 'upstream-aiom';
interface Catalog {id: string; type: string; [key: string]: unknown}
interface Folder {id: string; title: string; image: string; cover: string; hideTitle: boolean; shape: string; source: Record<string, string>; catalog: Catalog}
interface Shipped {row: string; id: string; title: string; viewMode: string; folders: Folder[]}
const COLLECTIONS = new Map((shipped as Shipped[]).map(item => [item.row, item]));
const SOURCES = new Map([...COLLECTIONS.values()].flatMap(item => item.folders.map(folder => [`${folder.catalog.id}/${folder.catalog.type}`, folder.catalog] as const)));
// On the AIOStreams side every collection is shown as a row of folders, and the lists behind the folders are kept from showing up as
// rows of their own. The ids are the same in every hub, so this list never changes.
const ADDON = `${HOME}e3b0`;
const MODIFICATIONS = [...[...COLLECTIONS.values()].map(item => ({id: `${ADDON}.aiom.collection.${item.id}`, type: 'collection', showOnHome: true})), ...[...SOURCES.values()].map(item => ({id: `${ADDON}.${item.id}`, type: item.type, enabled: false}))];
const JSON_HEADERS = {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AIOHub/1.0'};
/* A collection's folders in the order and under the names the site holds; any the site does not name keep their usual place after. */
function foldersOf(item: Shipped, covers: Row['covers']) {
  const known = new Map(item.folders.map(folder => [folder.image, folder])), seen = new Set<string>(), picked: {folder: Folder; title: string}[] = [];
  for (const cover of covers ?? []) {const folder = known.get(cover.image); if (folder && !seen.has(folder.id)) {seen.add(folder.id); picked.push({folder, title: cover.title});}}
  return [...picked, ...item.folders.filter(folder => !seen.has(folder.id)).map(folder => ({folder, title: folder.title}))];
}
/* A part of a suggested row (SUGGESTED in data.ts) as the catalog AIOMetadata serves it. Shapes from AIOMetadata 4.1.0 (getCatalog.ts):
   a TMDB collection is read by its id and always comes in release order; a TMDB search by its params; an MDBList list by its id. */
const DISCOVER = (part: {discover: string; type: string}) => `tmdb.discover.${part.type}.${part.discover}.aiohub`;
function partOf(part: Part, name: string, limit: Limit = 'all'): Catalog {
  if ('mdblist' in part) return {id: `mdblist.${part.mdblist}`, type: part.type, name, source: 'mdblist', sort: 'default'};
  if ('collection' in part) return {id: `tmdb.collection.${part.collection}`, type: 'movie', name, source: 'tmdb', metadata: {listId: String(part.collection), sortDirection: 'asc', hideUnreleased: true}};
  return {id: DISCOVER(part), type: part.type, name, source: 'tmdb', metadata: {discover: {version: 2, source: 'tmdb', mediaType: part.type === 'movie' ? 'movie' : 'tv', params: {...part.params, ...rated(part.type, limit)}}}};
}
/* Under a content limit a TMDB search asks TMDB for rated titles only (US ratings, CERTS in data.ts), so a row comes full.
   AIOMetadata's own check runs after a page is fetched: on a row TMDB fills without it, such as Trending, a Kids page of twenty
   kept one or two. */
const rated = (type: string, limit: Limit) => CERTS[limit] ? {certification_country: 'US', certification: CERTS[limit][type === 'movie' ? 'movie' : 'series']} : {};
// Trending under a limit: what is popular on TMDB now among recent, rated titles (films out in the last year, shows with an episode
// in the last month).
// Without a limit, Trending is Trakt's: what people are watching right now, counted from what their players report. A public chart:
// AIOMetadata reads it with its own Trakt app, so it needs nobody's Trakt and no key of the hub's. Asked again every three hours.
const TRAKT_CHART: Record<string, Catalog> = {
  'trending-movies': {id: 'trakt.trending.movies', type: 'movie', source: 'trakt', cacheTTL: 10800, metadata: {traktEndpoint: 'trending/movies'}},
  'trending-series': {id: 'trakt.trending.shows', type: 'series', source: 'trakt', cacheTTL: 10800, metadata: {traktEndpoint: 'trending/shows'}},
};
// Popular: the most popular on TMDB among what is new (films out in the last six months with a hundred votes, shows with an episode
// in the last month). AIOMetadata's own "popular" is the newest films with fifty votes, latest first, so it is not used.
const POPULAR_NOW: Record<string, Extract<Part, {discover: string}>> = {
  'popular-movies': {discover: 'popular', type: 'movie', params: {sort_by: 'popularity.desc', 'vote_count.gte': '100', 'primary_release_date.gte': '__tmdb_date__:last_180_days:from', 'primary_release_date.lte': '__tmdb_date__:today:to'}},
  // Talk, news and soaps are left out: a new episode most weekdays keeps them high on TMDB, yet Trakt's Trending (what people's
  // players report) had none of them. They stay searchable.
  'popular-series': {discover: 'popular', type: 'series', params: {sort_by: 'popularity.desc', 'vote_count.gte': '50', 'air_date.gte': '__tmdb_date__:last_month:from', without_genres: '10767,10763,10766'}},
};
const TRENDING_RATED: Record<string, Extract<Part, {discover: string}>> = {
  'trending-movies': {discover: 'trending', type: 'movie', params: {sort_by: 'popularity.desc', 'primary_release_date.gte': '__tmdb_date__:last_year:from', 'primary_release_date.lte': '__tmdb_date__:today:to', 'vote_count.gte': '20'}},
  'trending-series': {discover: 'trending', type: 'series', params: {sort_by: 'popularity.desc', 'air_date.gte': '__tmdb_date__:last_month:from', 'vote_count.gte': '10'}},
};
/* A person's rows address on the hub, and whether the hub reads their Trakt and has their MDBList key (else it serves only the
   rows that need neither: fills in rows.ts). `own`: their setup carries their own MDBList key (never while only the hub's
   shared key reads lists for it), so it can open their own MDBList lists. */
interface Served {at: string; trakt: boolean; lists?: boolean; own?: boolean}
/* A Home row that is one catalog: its catalog, or null when it is not one (a collection, or a row this Home cannot fill). `lists`:
   MDBList can be read for this Home; `trakt`: AIOMetadata's own Trakt fills the Trakt rows; `served`: the hub serves its rows. */
function plainOf(row: Row, lists: boolean, trakt: boolean, served: Served | null, limit: Limit = 'all', picks?: Record<string, Pick>, off?: string[]): Catalog | null {
  // A For you place holds the person's pick for it, named by the pick (foryou.ts). Only a person's own setup has one; an off place
  // is not sent.
  if (isPlace(row.id)) return served && row.on ? forYouOf(row.id, placePick(row.id, picks, limit, off), served, limit) : null;
  const at = {name: row.title, enabled: row.on, showInHome: true};
  // Under a limit Trending and Popular are TMDB searches for rated titles; for Kids only what is made for children, as a mild
  // rating alone lets in talent shows and soaps.
  const search = (CERTS[limit] && TRENDING_RATED[row.id]) || POPULAR_NOW[row.id];
  if (search) {
    const young: Record<string, string> = limit === 'kids' ? {with_genres: search.type === 'movie' ? '16|10751' : '16|10751|10762'} : {};
    return {...partOf({...search, discover: CERTS[limit] ? `${search.discover}-${limit}` : search.discover, params: {...search.params, ...young}}, row.title, limit), ...at};
  }
  if (TRAKT_CHART[row.id]) return {...TRAKT_CHART[row.id], ...at};
  if (TMDB_ROW[row.id]) return {...TMDB_ROW[row.id], ...at, source: 'tmdb'};
  // Trakt connected on AIOMetadata only: its own Trakt rows, as before. Else whatever the hub fills for them.
  if (trakt && !served?.trakt && TRAKT_ROW[row.id]) return {...TRAKT_ROW[row.id], ...at, source: 'trakt'};
  // Up Next and New for you as the hub works them out for someone without Trakt (ahead.ts) are sent only while on, so a setup
  // gains nothing for a row nobody switched on. With Trakt connected to the hub they are sent as they always were.
  if (served && !served.trakt && hubMade(row.id) && !row.on) return null;
  if (served && servedOf(row.id) && fills(row.id, {trakt: served.trakt, lists: !!served.lists})) return catalogOf(served.at, row.id, row.title, row.on);
  const list = /^mdblist\.(\d+)\.(movie|series|all)$/.exec(row.id);
  if (list) return lists ? {id: `mdblist.${list[1]}`, type: list[2], ...at, source: 'mdblist', sort: 'default'} : null;
  // Pasted public lists (see findList in api.ts): TMDB and Trakt in list order, Letterboxd through AIOMetadata's own lookup.
  if (/^tmdb\.list\.\d{1,12}$/.test(row.id)) return {id: row.id, type: 'all', ...at, source: 'tmdb', metadata: {listId: row.id.slice(10)}};
  if (/^trakt\.list\.\d{1,12}$/.test(row.id)) return {id: row.id, type: 'all', ...at, source: 'trakt', sort: 'default', metadata: {privacy: 'public'}};
  const boxd = /^letterboxd\.([\w-]{1,60})$/.exec(row.id);
  if (boxd) return {id: row.id, type: 'all', ...at, source: 'letterboxd', enableRatingPosters: true, metadata: {isWatchlist: false, identifier: boxd[1]}};
  const picked = suggestionOf(row.id);
  if (picked?.parts.length === 1 && (lists || !('mdblist' in picked.parts[0].part))) return {...partOf(picked.parts[0].part, row.title, limit), ...at};
  return null;
}
/* A For you pick as the catalog that fills its place: a TMDB search or a FlixPatrol Top 10 chart that AIOMetadata runs, or a row
   the hub serves whose id carries what fills it. Under the Kids limit a search for shows only asks for what is made for children,
   as AIOMetadata sends no rating to TMDB for shows. */
function forYouOf(place: string, pick: Pick | null, served: Served, limit: Limit): Catalog | null {
  if (!pick) return null;
  const at = {name: pick.name, enabled: true, showInHome: true};
  if (pick.serve) {const row = forYouRow(pick.serve, pick.type); return row ? catalogFor(served.at, row, pick.name, true) : null;}
  if (pick.chart) return {id: `flixpatrol.${pick.chart.service}.${pick.chart.cc}.${pick.type}`, type: pick.type, source: 'flixpatrol', enableRatingPosters: true, metadata: {countrySlug: pick.chart.slug}, ...at};
  if (!pick.params) return null;
  const slug = `fy-${pick.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}${CERTS[limit] ? `-${limit}` : ''}`, young: Record<string, string> = limit === 'kids' && pick.type === 'series' ? {with_genres: '16|10751|10762'} : {};
  return {...partOf({discover: slug, type: pick.type, params: {...pick.params, ...young}}, pick.name, limit), ...at};
}
/* The collections the hub makes are known by this start, so they can be told from any made elsewhere. */
const MINE = 'aiohub-';
/* Home as AIOMetadata holds it. A collection sits right after the plain row above it, which is how AIOMetadata places one.
   `served`: the person's rows address on the hub, for the rows the hub serves them. */
export function homeOf(rows: Row[], lists: boolean, trakt = false, served: Served | null = null, limit: Limit = 'all', picks?: Record<string, Pick>, off?: string[], shelf: Shelf[] = []): {catalogs: Catalog[]; collections: {id: string; [key: string]: unknown}[]} {
  const catalogs: Catalog[] = [], collections: {id: string; [key: string]: unknown}[] = [], sources = new Map<string, Catalog>();
  let above: {id: string; type: string} | undefined;
  for (const row of rows) {
    const plain = plainOf(row, lists, trakt, served, limit, picks, off), item = COLLECTIONS.get(row.id), picked = !plain ? suggestionOf(row.id) : undefined;
    // Two places never hold the same catalog (a pick not allowed under a new limit falls back, and may meet a pick of the same).
    if (plain && isPlace(row.id) && catalogs.some(made => made.id === plain.id && made.type === plain.type)) continue;
    // A TMDB search, collection or list, or a Trakt chart, that is off is simply not sent: nothing reads it while it is off.
    if (plain && plain.enabled === false && /^(tmdb\.(discover|collection|list)|trakt\.(trending|popular))\./.test(plain.id)) continue;
    if (plain) {catalogs.push(plain); above = {id: plain.id, type: plain.type};}
    else if (item && lists && row.on) {
      const folders = foldersOf(item, row.covers).filter(({folder}) => folderFits(item.row, folder.image, limit));
      if (!folders.length) continue;
      // Under a limit a service's folder is TMDB's where-to-watch for it, rated (see serviceOf).
      const made = folders.map(({folder, title}) => {
        const on = serviceOf(item.row, folder.image, limit), type = folder.catalog.type === 'series' ? 'series' : 'movie';
        const catalog = on ? partOf({discover: `service-${on.provider}-${on.region.toLowerCase()}-${limit}`, type, params: {with_watch_providers: on.provider, watch_region: on.region, with_watch_monetization_types: 'flatrate', sort_by: 'popularity.desc', 'vote_count.gte': '10',
          ...(limit === 'kids' ? {with_genres: type === 'movie' ? '16|10751' : '16|10751|10762'} : {})}}, `${row.title}: ${title}`, limit) : folder.catalog;
        return {folder, title, catalog, source: on ? {name: catalog.name, type, genre: 'None', baseType: type, catalogId: catalog.id} : folder.source};
      });
      collections.push({kind: 'collection', id: item.id, title: row.title, hideTitle: false, backdropImageUrl: '', pinToTop: false, viewMode: item.viewMode, showAllTab: true, focusGlowEnabled: true, ...(above ? {after: above} : {}),
        folders: made.map(({folder, title, source}) => ({id: folder.id, title, shape: folder.shape, hideTitle: folder.hideTitle, coverImageUrl: folder.cover, coverEmoji: '', sources: [source]}))});
      for (const {catalog} of made) sources.set(`${catalog.id}/${catalog.type}`, {...catalog, enabled: true, showInHome: false});
    } else if ((row.id === SHELF_ROW || row.id === LIKED_ROW) && row.on && served && shelf.length) {
      // The lists they made, or the ones they liked (shelf.ts): a wide tile for each, pictured by its best-known title. A Trakt
      // list opens as the hub serves it; an MDBList list is read by this setup itself, only when it carries their own key.
      const id = `${MINE}${row.id}`, made = shelfOn(row.id, shelf).flatMap(list => {
        const theirs = mdbOf(list.id), of = theirs || !served.trakt ? undefined : servedOf(list.id);
        if (theirs) return served.own ? [{list, type: theirs.type, at: `mdblist.${theirs.list}`, catalog: {id: `mdblist.${theirs.list}`, type: theirs.type, name: list.title, enabled: true, showInHome: false, source: 'mdblist', sort: 'default'} as Catalog}] : [];
        return of ? [{list, type: of.type as string, at: customId(of), catalog: {...catalogFor(served.at, of, list.title, true), showInHome: false} as Catalog}] : [];
      });
      if (!made.length) continue;
      collections.push({kind: 'collection', id, title: row.title, hideTitle: false, backdropImageUrl: '', pinToTop: false, viewMode: 'TABBED_GRID', showAllTab: false, focusGlowEnabled: true, ...(above ? {after: above} : {}),
        folders: made.map(({list, type, at}) => ({id: `${id}-${list.id.replace(/[^a-z0-9-]/g, '-')}`, title: list.title, shape: 'LANDSCAPE', hideTitle: false, coverImageUrl: list.cover, coverEmoji: '', sources: [{name: list.title, type, genre: 'None', baseType: type, catalogId: at}]}))});
      for (const {catalog} of made) sources.set(`${catalog.id}/${catalog.type}`, catalog);
    } else if (picked && row.on) {
      // A suggested row with tabs: a collection, one tab per part. Without MDBList only its TMDB tabs come; with none left, nothing.
      const parts = picked.parts.filter(({part}) => lists || !('mdblist' in part)).map(({title, part, cover}) => ({title, cover, catalog: partOf(part, `${picked.title}: ${title}`, limit)}));
      if (!parts.length) continue;
      const id = `${MINE}${row.id.replace(/[^a-z0-9-]/g, '-')}`;
      collections.push({kind: 'collection', id, title: row.title, hideTitle: false, backdropImageUrl: '', pinToTop: false, viewMode: 'TABBED_GRID', showAllTab: false, focusGlowEnabled: true, ...(above ? {after: above} : {}),
        folders: parts.map(({title, catalog, cover}, n) => ({id: `${id}-${n + 1}`, title, shape: 'POSTER', hideTitle: !!cover, coverImageUrl: cover ?? '', coverEmoji: '', sources: [{name: catalog.name, type: catalog.type, genre: 'None', baseType: catalog.type, catalogId: catalog.id}]}))});
      for (const {catalog} of parts) sources.set(`${catalog.id}/${catalog.type}`, {...catalog, enabled: true, showInHome: false});
    }
  }
  return {catalogs: [...catalogs, ...[...sources.values()].filter(item => !catalogs.some(made => made.id === item.id && made.type === item.type))], collections};
}
const address = (env: Env, made: Catalogs) => `${env.AIOM_ORIGIN}/stremio/${made.uuid}/manifest.json?v=${made.v}`;
// `saves`: their Watchlist switch is on (a row in `favs`, by hub and person: api.ts, 'favorites').
interface Want {rows: Row[]; settings: Settings; saves?: boolean; trakt?: string | null; lists?: string | null; reads?: string | null; served?: Served | null; picks?: Record<string, Pick>; shelf?: Shelf[]}
interface Keys {tmdb: string; mdblist: string | null}
type Wanted = ReturnType<typeof homeOf> & Record<string, unknown>;
const groupOwner = (id: string) => `#g:${id}`;
/* The AIOMetadata settings a level's choices come to. */
const looks = (settings: Settings): Record<string, unknown> => ({blurThumbs: settings.spoilers, hideUnreleasedDigital: settings.unreleased, hideUnreleasedDigitalSearch: settings.unreleased, hideUnreleasedShows: settings.unreleased, hideUnreleasedShowsSearch: settings.unreleased});
// Search answers nothing unless the setup names a language and TMDB as the engine for shows too (seen on staging).
const SEARCH_SETUP = {language: 'en-US', search: {enabled: true, providers: {movie: 'tmdb.search', series: 'tmdb.search'}, engineEnabled: {'tmdb.search': true}}};
// The content limit rides on the address, so a group or a person with only a different limit needs no setup of their own.
const RATING: Record<string, string> = {kids: 'PG', teen: 'PG-13'};
const limited = (home: string | null, settings: Settings) => home && RATING[settings.limit] ? `${home}&contentrating=${RATING[settings.limit]}` : home;
// Better Posters (btttr.cc) draws the rating onto the poster. This is its standard style, the same address for everyone; Plain is the opt-out.
const BETTER = 'https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg';
// With the age badge on, Better Posters' /poster-a/ adds the age rating (PG-13, TV-MA) to the corner. The rating stays Average (no rs).
const art = (settings: Settings, pattern: string = settings.ageBadge ? BETTER.replace('/poster/', '/poster-a/') : BETTER) => settings.posters === 'better' ? {posterRatingProvider: 'custom', customPosterUrlPattern: pattern, usePosterProxy: true, enableRatingPostersForLibrary: true} : {posterRatingProvider: 'none', customPosterUrlPattern: '', usePosterProxy: false, enableRatingPostersForLibrary: false};
// `$trakt` is the person's Trakt connection on AIOMetadata; it travels with the keys, not as a setting. Hiding what's been watched
// reads from it. `served` is their rows address on the hub; when the hub reads their Trakt, AIOMetadata has no Trakt at all.
// `$lists` is the person's own MDBList key. With it, what they play is recorded to their MDBList and can be hidden from rows;
// without it nothing is recorded anywhere (the hub's shared key is one account, so it is never used for that).
// `$reads` is their MDBList key kept while progress is Here: it only reads their lists, and records and hides nothing.
const wantedOf = (want: Want, keys: Keys, limit: Limit = 'all'): Wanted => ({...homeOf(want.rows, !!(keys.mdblist || want.lists || want.reads), !!want.trakt, want.served ?? null, limit, want.picks, want.settings.forYouOff, want.shelf), ...looks(want.settings), ...art(want.settings), hideWatchedTrakt: !!want.trakt && want.settings.hideWatched, $trakt: want.trakt ?? null,
  // A save (a favourite, the heart in some apps) is, to AIOMetadata, a watchlist add on every account its setup holds a key for,
  // and its saved list is read from there. One rule for everyone, set by their Watchlist switch (`saves`):
  // - Off, the default: saves stay on their own server (['server']) and reach no account, whatever is connected.
  // - On: ['mdblist'] only with a key of their own and MDBList sync on (`lists`), so their server passes each save on to their
  //   own MDBList watchlist. That is the whole of it for someone with MDBList alone, and how MDBList follows for someone whose
  //   Trakt is connected to the hub (hearts.ts keeps their Trakt watchlist and their saves the same, on their server). On with
  //   MDBList sync off (`reads`), or with no key of theirs: ['server'], so nothing saved is written to an account that is not
  //   synced, and never to the hub's shared MDBList key.
  jellyfinWatchlistServices: want.saves && want.lists ? ['mdblist'] : ['server'],
  playbackReporting: !!want.lists, mdblistWatchTracking: !!want.lists, hideWatchedMdblist: !!want.lists && want.settings.hideWatched, $lists: want.lists ?? null, ...(want.reads ? {$reads: want.reads} : {})});
const LATER = 'AIOMetadata did not answer, so Home rows in the player apps were not updated. It will be tried again on your next change.';

/* Everything the hub keeps in the vault, read in one go: a sync touches many records, and a Worker may only ask the database so often. */
type Vault = Map<string, string>;
const vaultFrom = (rows: unknown[]): Vault => new Map((rows as {owner: string; kind: string; value: string}[]).map(row => [`${row.owner}/${row.kind}`, row.value]));
const held = <T>(env: Env, vault: Vault, hub: string, owner: string, kind: string) => unseal<T>(env, `${hub}/${owner}/${kind}`, vault.get(`${owner}/${kind}`));
/* What each catalog of a setup was sent as, together with the settings that change what any catalog holds (posters, limits, hiding
   what was watched). A preview of a row is reused while its fingerprint is the same. The player sign-in fields and the blurring of
   episode pictures change no row's posters, so they are left out. */
async function shapeOf(wanted: Wanted): Promise<Record<string, string>> {
  const {catalogs, collections: _, ...rest} = wanted, looks = JSON.stringify(Object.entries(rest).filter(([key]) => !key.startsWith('jellyfin') && key !== 'blurThumbs'));
  return Object.fromEntries(await Promise.all(catalogs.map(async item => [`${item.type}/${item.id}`, (await sha(`${looks}\n${JSON.stringify(item)}`)).slice(0, 16)] as const)));
}
// How many AIOMetadata setups one sync works on at once, all kinds together. Each is a read then a write; AIOMetadata is shared,
// so this stays small.
const AIOM_AT_ONCE = 2;
/* One Home setup on AIOMetadata: the hub's, or a group's or a person's own when theirs differs. Made once per owner, then kept in step. */
async function syncHome(env: Env, vault: Vault, hub: string, owner: string, wanted: Wanted, keys: Keys, budget: {left: number}, kind = 'catalogs', keep: Record<string, unknown> = {}): Promise<{address: string; made: Catalogs} | {message: string; more?: boolean}> {
  const {$trakt, $lists, $reads, ...rest} = wanted as Wanted & {$trakt?: string | null; $lists?: string | null; $reads?: string | null};
  const apiKeys = {tmdb: keys.tmdb, ...($lists || $reads || keys.mdblist ? {mdblist: ($lists || $reads || keys.mdblist) as string} : {}), ...($trakt ? {traktTokenId: $trakt} : {})}, sent = await sha(JSON.stringify([apiKeys, wanted]));
  let made = await held<Catalogs>(env, vault, hub, owner, kind);
  // The hub moved to another AIOMetadata server: the setup on the old one is removed, and a new one is made here.
  if (made?.at && made.at !== env.AIOM_ORIGIN) {if ((budget.left -= 1) < 0 || !await dropHome({...env, AIOM_ORIGIN: made.at}, hub, owner, kind)) return {message: LATER, more: budget.left < 0}; made = null;}
  if (made?.sent === sent) {
    // Kept from before previews were reused row by row: the fingerprints are added once, with no call to AIOMetadata.
    if (!made.shape) {made = {...made, shape: await shapeOf(wanted)}; await (await putSecret(env, hub, owner, kind, made)).run();}
    return {address: address(env, made), made};
  }
  // A Worker may only make so many calls for one request. What does not fit is done on the next pass, which the site asks for.
  if ((budget.left -= 2) < 0) return {message: 'Still bringing everyone’s Home in step.', more: true};
  if (!made) {
    const claim = await env.DB.prepare("INSERT INTO ops (hub, kind, target, state, created, updated) VALUES (?, ?, ?, 'requested', ?, ?) ON CONFLICT DO NOTHING").bind(hub, `create-${kind}`, owner, now(), now()).run();
    if (!claim.meta.changes) return await claimedLately(env, hub, `create-${kind}`, owner) ? {message: '', more: true} : {message: STUCK.message!};
    const password = newToken('c');
    await (await putSecret(env, hub, owner, `${kind}-pending`, {password})).run();
    const answer = await fetch(`${env.AIOM_ORIGIN}/api/config/save`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({config: {apiKeys, ...SEARCH_SETUP, ...rest}, password})}).catch(() => null);
    if (!answer) return {message: STUCK.message!};
    const body = await answer.json().catch(() => null) as {userUUID?: string} | null;
    if (answer.status !== 200 || !body?.userUUID) {
      if (answer.status < 400 || answer.status >= 500) return {message: STUCK.message!};
      // Refused outright: nothing was created, so the claim is released and it can be tried again.
      await env.DB.batch([env.DB.prepare('DELETE FROM ops WHERE hub = ? AND kind = ? AND target = ?').bind(hub, `create-${kind}`, owner), env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, owner, `${kind}-pending`)]);
      return {message: 'AIOMetadata refused the Home setup. Check the TMDB and MDBList keys under Hub, Sources.'};
    }
    made = {uuid: body.userUUID, password, v: now(), sent, at: env.AIOM_ORIGIN, shape: await shapeOf(wanted), charts: (rest.catalogs as Catalog[]).filter(item => item.id.startsWith('flixpatrol.')).map(item => `${item.id}/${item.type}`), ...keep};
    await env.DB.batch([await putSecret(env, hub, owner, kind, made), env.DB.prepare("UPDATE ops SET state = 'done', updated = ? WHERE hub = ? AND kind = ? AND target = ?").bind(now(), hub, `create-${kind}`, owner), env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = ?').bind(hub, owner, `${kind}-pending`)]);
    return {address: address(env, made), made};
  }
  // Read, change only what the hub owns (its rows, its collections, its settings, the keys), write back against the version that was read.
  const read = await fetch(`${env.AIOM_ORIGIN}/api/config/load/${made.uuid}`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({password: made.password})}).catch(() => null);
  const stored = read?.status === 200 ? ((await read.json().catch(() => null)) as {config?: {catalogs?: Catalog[]; collections?: {id: string}[]; apiKeys?: Record<string, string>; configVersion?: number; [key: string]: unknown}} | null)?.config : null;
  if (!stored) return {message: LATER};
  const ours = new Set([...Object.values(TMDB_ROW).map(item => `${item.id}/${item.type}`), ...(made.charts ?? [])]), folders = new Set([...COLLECTIONS.values()].map(item => item.id));
  const {catalogs, collections, ...settings} = rest, charts = (catalogs as Catalog[]).filter(item => item.id.startsWith('flixpatrol.')).map(item => `${item.id}/${item.type}`);
  // A chart the hub sends replaces one of the same made by hand, rather than sitting beside it.
  for (const chart of charts) ours.add(chart);
  Object.assign(stored, settings); stored.language ??= SEARCH_SETUP.language;
  // Titles without a rating are left out only for the Kids limit; any other limit lets them back in (AIOMetadata's default).
  if (!('allowUnratedContent' in settings) && stored.allowUnratedContent === false) delete stored.allowUnratedContent;
  if (!(stored.search as {providers?: unknown} | undefined)?.providers) stored.search = SEARCH_SETUP.search;
  // Every catalog and collection of the kinds the hub makes is the hub's: what the site no longer has goes.
  stored.catalogs = [...catalogs, ...(stored.catalogs ?? []).filter(item => !ours.has(`${item.id}/${item.type}`) && !/^(mdblist|letterboxd|trakt)\./.test(item.id) && !/^tmdb\.(collection|list)\./.test(item.id) && !/^tmdb\.discover\..*\.aiohub$/.test(item.id) && !CUSTOM.test(item.id))];
  stored.collections = [...collections, ...(stored.collections ?? []).filter(item => !folders.has(item.id) && !item.id.startsWith(MINE))];
  const others = {...(stored.apiKeys ?? {})}; delete others.mdblist; delete others.traktTokenId;
  stored.apiKeys = {...others, ...apiKeys};
  const write = await fetch(`${env.AIOM_ORIGIN}/api/config/update/${made.uuid}`, {method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({config: stored, password: made.password, baseVersion: stored.configVersion})}).catch(() => null);
  if (write?.status !== 200) return {message: LATER};
  made = {...made, v: now() <= made.v ? made.v + 1 : now(), sent, shape: await shapeOf(wanted), charts, ...keep};
  await (await putSecret(env, hub, owner, kind, made)).run();
  return {address: address(env, made), made};
}
/* Removes one owner's Home setup from AIOMetadata. What the hub remembers of it goes only once AIOMetadata confirms. */
async function dropHome(env: Env, hub: string, owner: string, kind = 'catalogs'): Promise<boolean> {
  const made = await getSecret<Catalogs>(env, hub, owner, kind);
  const status = made ? (await fetch(`${env.AIOM_ORIGIN}/api/config/delete-user/${made.uuid}`, {method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({password: made.password})}).catch(() => null))?.status : 200;
  if (status !== 200 && status !== 404) return false;
  // A person's own player setup also takes the sign-in the hub kept for it.
  await env.DB.batch([env.DB.prepare('DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind IN (?, ?, ?)').bind(hub, owner, kind, `${kind}-pending`, kind === PLAYER ? VIA : kind), env.DB.prepare('DELETE FROM ops WHERE hub = ? AND kind = ? AND target = ?').bind(hub, `create-${kind}`, owner)]);
  return true;
}

/* What each Home row actually holds right now, for the site's own preview: the first few posters, exactly as a player app would get
   them from the setup they are on (so with its poster settings applied). Kept per hub, per person (the hub's own page as the hub) and
   per row, with the fingerprint of what that row was last sent as: a save that changes one row asks AIOMetadata for that row only. */
const PREVIEW_KEEP = 3600, PREVIEW_WAIT = 8000, PREVIEWS_AT_ONCE = 4, PREVIEW = 'preview:';
export async function previews(site: Env, hub: {id: string; data: string}, person?: string, group?: string): Promise<Record<string, string[]>> {
  const data = JSON.parse(hub.data) as HubData, env = hosted(site, data);
  if (!env.AIOM_ORIGIN) return {};
  const who = person ?? (group ? groupOwner(group) : HUB_OWNER);
  // One trip to the database: whose rows, the setups they could be on, and what was kept from before.
  const [found, secrets, kept, plays, grouped, picked] = await env.DB.batch([
    env.DB.prepare('SELECT p.data AS mine, g.id AS grp, g.data AS theirs FROM people p JOIN groups g ON g.hub = p.hub AND g.id = p.grp WHERE p.hub = ? AND p.id = ?').bind(hub.id, person ?? ''),
    env.DB.prepare("SELECT owner, kind, value FROM secrets WHERE hub = ? AND (owner IN (?, ?) OR owner LIKE '#g:%') AND kind IN ('catalogs', 'mdblist', ?, ?, ?)").bind(hub.id, who, HUB_OWNER, PLAYER, LINK, ROWS),
    env.DB.prepare('SELECT kind, at, items FROM rows_cache WHERE hub = ? AND person = ? AND kind LIKE ?').bind(hub.id, who, `${PREVIEW}%`),
    env.DB.prepare('SELECT 1 AS played FROM plays WHERE hub = ? AND person = ? LIMIT 1').bind(hub.id, person ?? ''),
    env.DB.prepare('SELECT data FROM groups WHERE hub = ? AND id = ?').bind(hub.id, person ? '' : group ?? ''),
    env.DB.prepare('SELECT picks FROM foryou WHERE hub = ? AND person = ?').bind(hub.id, person ?? ''),
  ]);
  const picks = picked.results[0] ? JSON.parse((picked.results[0] as {picks: string}).picks) as Record<string, Pick> : undefined;
  let off: string[] = [];
  const vault: Vault = new Map((secrets.results as {owner: string; kind: string; value: string}[]).map(row => [`${row.owner}/${row.kind}`, row.value]));
  // A person's rows come from whichever Home setup they are on: their own, their group's, or the hub's.
  let rows = data.rows, owners = [HUB_OWNER], served: Served | null = null, trakt = false, limit: Limit = 'all';
  if (person) {
    const row = found.results[0] as {mine: string; grp: string; theirs: string} | undefined;
    if (!row) return {};
    const mine = JSON.parse(row.mine) as {rows: Row[] | null; trakt?: boolean; picks?: Record<string, boolean>; settings?: Partial<Settings>}, theirs = JSON.parse(row.theirs) as {rows: Row[] | null; settings?: Partial<Settings>}, shared = theirs.rows ?? data.rows;
    // Their own setup is made under their content limit (see plainOf): the rows are looked up as it holds them.
    if (env.FRONT === 'aiometadata') limit = {...data.defaults, ...theirs.settings, ...mine.settings}.limit ?? 'all';
    off = {...data.defaults, ...theirs.settings, ...mine.settings}.forYouOff ?? [];
    const viaHub = !!env.TRAKT_CLIENT_ID && !((await held<{again?: boolean}>(env, vault, hub.id, person, LINK)) ?? {again: true}).again;
    // Only where the row is (its catalog id) matters here, never the address itself.
    served = vault.has(`${person}/${ROWS}`) ? {at: 'https://hub.invalid', trakt: viaHub, lists: vault.has(`${person}/mdblist`)} : null; trakt = !!mine.trakt;
    rows = rowsOf(mine.rows, shared, {trakt: trakt || viaHub, lists: vault.has(`${person}/mdblist`), watched: viaHub || vault.has(`${person}/mdblist`) || plays.results.length > 0, kids: {...data.defaults, ...theirs.settings, ...mine.settings}.limit === 'kids', front: env.FRONT === 'aiometadata'}, mine.picks); owners = [person, groupOwner(row.grp), HUB_OWNER];
  }
  // A group's Home as someone in it starts with: from the group's own setup while it differs from the hub's (see homes in syncPlayers).
  const theirs = grouped.results[0] as {data: string} | undefined;
  if (!person && theirs) {
    const own = JSON.parse(theirs.data) as {rows: Row[] | null; settings?: Partial<Settings>};
    if (env.FRONT === 'aiometadata') limit = {...data.defaults, ...own.settings}.limit ?? 'all';
    rows = withKids(own.rows ?? data.rows, {...data.defaults, ...own.settings}.limit === 'kids'); owners = [groupOwner(group!), HUB_OWNER];
  }
  // With AIOMetadata in front, a person's rows are on their own setup there.
  let made: Catalogs | null = person && env.FRONT === 'aiometadata' ? await held<Catalogs>(env, vault, hub.id, person, PLAYER) : null;
  if (!made) for (const owner of owners) if ((made = await held<Catalogs>(env, vault, hub.id, owner, 'catalogs'))) break;
  if (!made) return {};
  const at = made.at ?? env.AIOM_ORIGIN, setup = made, out: Record<string, string[]> = {}, fresh: {row: string; sig: string; posters: string[]}[] = [];
  const before = new Map((kept.results as {kind: string; at: number; items: string}[]).map(row => [row.kind.slice(PREVIEW.length), {at: row.at, ...JSON.parse(row.items) as {sig: string; posters: string[]}}]));
  const where = (row: Row) => plainOf(row, true, trakt, served, limit, picks, off);
  // A hub or group Home keeps places for a person's own rows; only a person has anything in them.
  const wanted = rows.filter(row => row.on && where(row)).slice(0, 16), time = now();
  await inTurn(wanted.map(row => async () => {
    const from = where(row)!, sig = (await sha(`${setup.uuid}/${setup.shape?.[`${from.type}/${from.id}`] ?? `v${setup.v}`}`)).slice(0, 16), had = before.get(row.id);
    if (had?.sig === sig && time - had.at < PREVIEW_KEEP) {out[row.id] = had.posters; return;}
    const answer = await fetch(`${at}/stremio/${setup.uuid}/catalog/${from.type}/${from.id}.json`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}, signal: AbortSignal.timeout(PREVIEW_WAIT)}).catch(() => null);
    const metas = answer?.status === 200 ? ((await answer.json().catch(() => null)) as {metas?: {poster?: string}[]} | null)?.metas ?? [] : [];
    const posters = metas.map(meta => meta.poster).filter((poster): poster is string => typeof poster === 'string' && poster.startsWith('https://')).slice(0, 8);
    // Only a real answer is kept: an empty or failed one is asked for again next time.
    if (posters.length) {out[row.id] = posters; fresh.push({row: row.id, sig, posters});}
  }), PREVIEWS_AT_ONCE);
  if (fresh.length) await env.DB.batch([
    ...fresh.map(item => env.DB.prepare('INSERT INTO rows_cache (hub, person, kind, at, items) VALUES (?, ?, ?, ?, ?) ON CONFLICT (hub, person, kind) DO UPDATE SET at = excluded.at, items = excluded.items').bind(hub.id, who, `${PREVIEW}${item.row}`, time, JSON.stringify({sig: item.sig, posters: item.posters}))),
    // Rows no longer shown are let go after a day.
    env.DB.prepare('DELETE FROM rows_cache WHERE hub = ? AND person = ? AND kind LIKE ? AND at < ?').bind(hub.id, who, `${PREVIEW}%`, time - 86400),
  ]);
  return out;
}

/* Brings the hub's setups in step with the site: the debrid account, sources, stream label, who can sign in, everyone's Home, and
   what each group and person has changed for themselves. */
export async function syncPlayers(site: Env, hub: {id: string; data: string}, origin = '', most = 30): Promise<Synced> {
  const data = JSON.parse(hub.data) as HubData, service = data.defaults.debrid, env = hosted(site, data);
  // The vault, the groups and the people in one trip to the database: each trip costs as much as a call to AIOStreams.
  const [secretRows, groupRows, personRows, playRows, pickRows, shelfRows, saveRows] = await env.DB.batch([env.DB.prepare('SELECT owner, kind, value FROM secrets WHERE hub = ?').bind(hub.id), env.DB.prepare('SELECT id, name, data FROM groups WHERE hub = ?').bind(hub.id), env.DB.prepare('SELECT id, grp, name, data FROM people WHERE hub = ? ORDER BY created, id').bind(hub.id),
    env.DB.prepare('SELECT DISTINCT person FROM plays WHERE hub = ?').bind(hub.id), env.DB.prepare('SELECT person, picks FROM foryou WHERE hub = ?').bind(hub.id),
    env.DB.prepare('SELECT person, items FROM rows_cache WHERE hub = ? AND kind = ?').bind(hub.id, SHELF),
    // Whose Watchlist switch is on (wantedOf, jellyfinWatchlistServices).
    env.DB.prepare('SELECT person FROM favs WHERE hub = ?').bind(hub.id)]);
  const saving = new Set((saveRows.results as {person: string}[]).map(row => row.person));
  // Each person's Trakt lists as the cron last worked them out (shelf.ts), for their My lists row.
  const shelves = new Map((shelfRows.results as {person: string; items: string}[]).map(row => [row.person, shelfFrom(row.items)]));
  // What fills each person's For you places today (foryou.ts): only what was picked and kept, so every sync writes the same.
  const forYou = new Map((pickRows.results as {person: string; picks: string}[]).map(row => [row.person, JSON.parse(row.picks) as Record<string, Pick>]));
  const played = new Set((playRows.results as {person: string}[]).map(row => row.person));
  const vault = vaultFrom(secretRows.results), accounts = new Map<string, string>();
  for (const name of data.services) {const account = SERVICE[name] ? await held<string>(env, vault, hub.id, HUB_OWNER, `debrid:${name}`) : null; if (account) accounts.set(name, account);}
  const key = accounts.get(service);
  if (!key) return {state: 'needs-key', message: `Connect ${service} under Hub, Sources, so there is something to play from.`};
  const top: Want = {rows: data.rows, settings: data.defaults}, linked = new Map<string, string>(), watching = new Map<string, string>();
  // A key kept while its person moves where progress is kept (places.ts) records nothing and hides nothing: they are still on Here,
  // or on their way back to it, and ticks Here then never echo into MDBList.
  for (const name of vault.keys()) if (name.endsWith('/mdblist')) {const owner = name.slice(0, -8), own = await held<{key: string; moving?: string}>(env, vault, hub.id, owner, 'mdblist'); if (own?.key && !own.moving) watching.set(owner, own.key);}
  for (const name of vault.keys()) if (name.endsWith('/trakt')) {const owner = name.slice(0, -6), held_ = await held<{tokenId: string}>(env, vault, hub.id, owner, 'trakt'); if (held_?.tokenId) linked.set(owner, held_.tokenId);}
  // Each person gets their own rows from the hub (rows.ts), at an address of their own made once: Recently Watched and Recommended once there is
  // something watched, the Watchlist with their MDBList key or Trakt, and their other Trakt rows once Trakt is connected to the hub. If their Trakt is also
  // connected on AIOMetadata, the hub's wins and AIOMetadata's is no longer used. Without AIOMetadata in front a row of one's own
  // would give everyone a Home setup of their own, so there only those with Trakt or MDBList in use get the address.
  const viaHub = new Set<string>(), keyed = new Set<string>(), served = new Map<string, string>(), minted = [], rowsAt = (env.SITE_ORIGIN || origin).replace(/\/$/, '');
  for (const name of env.TRAKT_CLIENT_ID ? vault.keys() : []) if (name.endsWith(`/${LINK}`)) {
    const owner = name.slice(0, -LINK.length - 1), link = await held<{again?: boolean}>(env, vault, hub.id, owner, LINK);
    if (link && !link.again) viaHub.add(owner);
  }
  for (const name of vault.keys()) if (name.endsWith('/mdblist') && (await held<{key?: string}>(env, vault, hub.id, name.slice(0, -8), 'mdblist'))?.key) keyed.add(name.slice(0, -8));
  // Each person's own rows are read from this site's address. Without one (a sync started by no visit, and no SITE_ORIGIN) everyone's
  // own rows would be dropped from their Home, so nothing is changed.
  if (env.FRONT === 'aiometadata' && !rowsAt) return {state: 'error', message: 'The site’s own address is not known, so the apps were left as they are.'};
  for (const row of rowsAt ? personRows.results as {id: string; data: string}[] : []) {
    if (env.FRONT !== 'aiometadata' && !viaHub.has(row.id) && !((JSON.parse(row.data) as {lists?: boolean}).lists && watching.has(row.id))) continue;
    const got = await addressOf(env, hub.id, row.id, rowsAt, await held<string>(env, vault, hub.id, row.id, ROWS));
    served.set(row.id, got.address); minted.push(...got.writes);
  }
  if (minted.length) await env.DB.batch(minted);
  const groups = (groupRows.results as {id: string; name: string; data: string}[]).map(row => {const own = JSON.parse(row.data) as {rows: Row[] | null; settings: Partial<Settings>}; return {id: row.id, name: row.name, want: {rows: own.rows ?? top.rows, settings: {...top.settings, ...own.settings}} as Want, home: null as string | null, reach: null as string | null, sig: ''};});
  const people = (personRows.results as {id: string; grp: string; name: string; data: string}[]).map(row => {
    const own = JSON.parse(row.data) as {rows: Row[] | null; settings: Partial<Settings>; trakt?: boolean; picks?: Record<string, boolean>; lists?: boolean}, group = groups.find(item => item.id === row.grp), above = group?.want ?? top;
    // Their key records and hides only while progress is kept in MDBList; with progress Here it is kept just to read their lists, on
    // their own setup (AIOMetadata in front). Without that, a kept key would only make them a setup of their own for nothing.
    const at = served.get(row.id), hubTrakt = viaHub.has(row.id) && !!at, trakt = !hubTrakt && own.trakt ? linked.get(row.id) ?? null : null, lists = own.lists ? watching.get(row.id) ?? null : null, reads = own.lists || env.FRONT !== 'aiometadata' ? null : watching.get(row.id) ?? null;
    // Someone with Trakt or MDBList connected and no Home of their own gets those rows above the shared ones.
    return {id: row.id, name: row.name, group, above, want: {rows: rowsOf(own.rows, above.rows, {trakt: !!(trakt || hubTrakt), lists: keyed.has(row.id), watched: hubTrakt || keyed.has(row.id) || played.has(row.id), kids: {...above.settings, ...own.settings}.limit === 'kids', front: env.FRONT === 'aiometadata'}, own.picks), settings: {...above.settings, ...own.settings}, saves: saving.has(row.id), trakt, lists, reads, served: at ? {at, trakt: hubTrakt, lists: keyed.has(row.id), own: !!(lists || reads)} : null, picks: forYou.get(row.id), shelf: shelves.get(row.id)} as Want, tracks: !!lists, home: null as string | null, variants: [] as string[]};
  });

  // Home. The hub has one setup on AIOMetadata; a group or a person gets their own only while theirs differs from the one above.
  const known = await held<string>(env, vault, hub.id, HUB_OWNER, 'key:tmdb'), tmdb = env.AIOM_ORIGIN ? known : null, budget = {left: most};
  let note = !env.AIOM_ORIGIN ? 'Home rows are not set up on this site.' : !tmdb ? 'Add a TMDB key under Hub, Sources, so Home has rows in the player apps.' : '', more = false, base: string | null = null;
  const keys: Keys | null = tmdb ? {tmdb, mdblist: await held<string>(env, vault, hub.id, HUB_OWNER, 'key:mdblist')} : null, front = env.FRONT === 'aiometadata';
  // The hub's own Home setup (and, without AIOMetadata in front, each group's and person's that differ) is brought in step. With
  // AIOMetadata in front nothing below waits for it, so it runs beside the AIOStreams step; otherwise the variants need it first.
  const aiom = gate(AIOM_AT_ONCE);
  const homes = async () => {
    if (!keys) return;
    const needed = new Set([HUB_OWNER]), fold = (got: Awaited<ReturnType<typeof syncHome>>) => {if ('address' in got) return got.address; note ||= got.message; more ||= !!got.more; return null;};
    const wanted = wantedOf(top, keys), sig = JSON.stringify(wanted);
    if (!(base = fold(await aiom(() => syncHome(env, vault, hub.id, HUB_OWNER, wanted, keys, budget))))) return;
    const jobs: {owner: string; wanted: Wanted; done: (address: string | null) => void}[] = [];
    for (const group of groups) {
      const theirs = wantedOf(group.want, keys); group.sig = JSON.stringify(theirs);
      // With each person on their own player setup, AIOStreams' Home is not what apps show, so only the hub's is kept.
      if (!front && group.sig !== sig && people.some(person => person.group === group)) {needed.add(groupOwner(group.id)); jobs.push({owner: groupOwner(group.id), wanted: theirs, done: address => {group.home = address;}});}
      // With AIOMetadata in front a group that differs from the hub gets a setup of its own all the same, used by no app: it is the
      // Home someone in the group starts with (their limit, the rows for children), so the site can show it exactly, even with
      // nobody in the group yet. People's setups are still made from the settings, never copied from it.
      if (front) {
        const limit = group.want.settings.limit, shown: Wanted = {...wantedOf({...group.want, rows: withKids(group.want.rows, limit === 'kids')}, keys, limit), ageRating: RATING[limit] ?? 'None', ...(limit === 'kids' ? {allowUnratedContent: false} : {})};
        if (JSON.stringify(shown) !== JSON.stringify({...wanted, ageRating: 'None'})) {needed.add(groupOwner(group.id)); jobs.push({owner: groupOwner(group.id), wanted: shown, done: () => {}});}
      }
    }
    for (const person of people) {
      const theirs = wantedOf(person.want, keys);
      if (!front && JSON.stringify(theirs) !== (person.group?.sig ?? sig)) {needed.add(person.id); jobs.push({owner: person.id, wanted: theirs, done: address => {person.home = address;}});}
    }
    // A few at a time; what each says is taken in the same order as before, so the note shown never depends on which answered first.
    const got = await inTurn(jobs.map(job => () => aiom(() => syncHome(env, vault, hub.id, job.owner, job.wanted, keys, budget))), AIOM_AT_ONCE);
    got.forEach((answer, at) => jobs[at].done(fold(answer)));
    // A setup nobody needs any more (its owner follows the level above again, or is gone) is removed.
    for (const name of vault.keys()) {
      const owner = name.endsWith('/catalogs') ? name.slice(0, -9) : ''; if (!owner || needed.has(owner) || (budget.left -= 1) < 0) continue;
      await dropHome({...env, AIOM_ORIGIN: (await held<Catalogs>(env, vault, hub.id, owner, 'catalogs'))?.at ?? env.AIOM_ORIGIN}, hub.id, owner);
    }
  };
  const homesDone = homes();
  if (!front) await homesDone;
  const variants: Variant[] = [], hubReach = limited(base, top.settings), extras = extrasOf(data);
  for (const group of front ? [] : groups) {
    // A group with nobody in it has nobody to apply its changes to.
    const reach = limited(group.home ?? base, group.want.settings);
    group.reach = reach;
    const lines = people.some(person => person.group === group) ? differences(top.settings, group.want.settings, accounts, reach !== hubReach ? reach : null, extras, !!known) : [];
    if (lines.length) variants.push({id: `${OURS}g-${group.id}`, name: `Group: ${group.name}`, enabled: true, script: lines.join('\n')});
  }
  for (const person of people) {
    // With AIOMetadata in front, a person's streams come from one address, and an address names one variant: so each person has
    // at most one, everything they change compared with the hub (their group's changes and their own), and none if nothing differs.
    if (front) {
      const lines = differences(top.settings, person.want.settings, accounts, null, extras, !!known);
      if (lines.length) variants.push({id: `${OURS}c-${person.id}`, name: `Streams: ${person.name}`, enabled: true, script: lines.join('\n')});
      continue;
    }
    const over = person.group?.reach ?? hubReach, reach = limited(person.home ?? person.group?.home ?? base, person.want.settings);
    const lines = differences(person.above.settings, person.want.settings, accounts, reach !== over ? reach : null, extras, !!known);
    if (lines.length) variants.push({id: `${OURS}p-${person.id}`, name: `Person: ${person.name}`, enabled: true, script: lines.join('\n')});
    person.variants = [`${OURS}g-${person.group?.id}`, `${OURS}p-${person.id}`].filter(id => variants.some(item => item.id === id));
  }

  // Moving to AIOMetadata in front happens person by person: whoever has their own setup's sign-in is over; everyone else stays
  // on AIOStreams as before, so a setup AIOMetadata refused never leaves someone unable to sign in.
  const moved = new Set(front ? [...vault.keys()].filter(name => name.endsWith(`/${VIA}`)).map(name => name.slice(0, -VIA.length - 1)) : []);
  const staying = people.filter(person => !moved.has(person.id));
  const signedUp = new Set<string>();
  const streams = async (): Promise<Home | Synced> => {
    let players = await held<Home>(env, vault, hub.id, HUB_OWNER, 'players');
    // The hub moved to another AIOStreams server: its setup on the old one is removed first, then a new one is made here.
    if (players?.at && players.at !== env.UP_ORIGIN) {
      if (!await removeSetup({...env, UP_ORIGIN: players.at}, players)) return {state: 'error', message: 'The old AIOStreams server did not confirm removing the hub’s setup, so nothing was moved. It will be tried again on your next change.'};
      await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND (kind = 'upstream' OR (owner = ? AND kind IN ('players', 'players-pending')))").bind(hub.id, HUB_OWNER), env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'create-players'").bind(hub.id)]);
      for (const name of [...vault.keys()]) if (name.endsWith('/upstream')) vault.delete(name);
      players = null;
    }
    if (!players) {
      const first = fresh(); patch(first, data, key, staying, front ? null : hubReach, variants, known, front);
      const made = await create(env, hub.id, first, service);
      if ('state' in made) return made;
      players = made;
    } else {
      const read = await fetch(`${env.UP_ORIGIN}/api/v1/user?raw=true`, {headers: basic(players)}).catch(() => null);
      const stored = read?.status === 200 ? ((await read.json().catch(() => null)) as {data?: {userData?: Stored}} | null)?.data?.userData : null;
      if (!stored) return {state: 'error', message: 'AIOStreams did not answer. Your changes are saved here and will be sent on the next try.'};
      const before = JSON.stringify(stored); patch(stored, data, key, staying, front ? null : hubReach, variants, known, front);
      if (JSON.stringify(stored) !== before) {
        const write = await fetch(`${env.UP_ORIGIN}/api/v1/user`, {method: 'PUT', headers: {...basic(players), 'content-type': 'application/json'}, body: JSON.stringify({config: stored})}).catch(() => null);
        if (write?.status !== 200) {
          const why = (((await write?.json().catch(() => null)) as {error?: {message?: string}} | null)?.error?.message ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '').replace(/https?:\/\/\S+/g, 'a link').slice(0, 160);
          return {state: 'error', message: `AIOStreams did not accept the change${why ? `: ${why}` : '.'} Your changes are saved here and will be sent on the next try.`};
        }
      }
    }
    // Each person signs in upstream under this setup with their own name. The kept sign-in answer, if any, is left in place.
    // With AIOMetadata in front, only those not moved yet keep one; the rest sign in to their own AIOMetadata setup.
    const writes = [];
    for (const person of staying) {
      const user = `${players.uuid}/${person.name}`, had = await held<{user: string; pass: string; auth?: string}>(env, vault, hub.id, person.id, 'upstream');
      if (!had || had.user !== user || had.pass !== players.password) signedUp.add(person.id), writes.push(await putSecret(env, hub.id, person.id, 'upstream', {...(had?.user.split('/')[0] === players.uuid ? had : {}), user, pass: players.password}));
    }
    if (writes.length) await env.DB.batch(writes);
    return players;
  };
  // Everyone's own setup waits only for the AIOStreams step (their stream address names their variant there), never for the hub's
  // Home. Both are waited for before anything is answered, so nothing is left half-done when the request ends.
  const fronted = (async () => {
    const up = await streams();
    return {up, got: 'state' in up || !front || !keys ? null : await syncFronts(env, vault, hub.id, people, up, variants, keys, budget, aiom)};
  })();
  const [step, home] = await Promise.allSettled([fronted, homesDone]);
  if (step.status === 'rejected') throw step.reason;
  if (home.status === 'rejected') throw home.reason;
  const {up, got} = step.value;
  if ('state' in up) return up;
  if (got) {
    // The hub's Home speaks first, as it always has.
    note ||= got.note; more ||= got.more;
    // Whoever now has their own setup's sign-in no longer needs the AIOStreams one (their AIOStreams user goes on the next sync).
    // Asked only when someone has both, as the vault read at the start shows or as this sync just made.
    const both = (owner: string) => (vault.has(`${owner}/upstream`) || signedUp.has(owner)) && (vault.has(`${owner}/${VIA}`) || got.moved.has(owner));
    if (people.some(person => both(person.id)) || [...vault.keys()].some(name => name.endsWith('/upstream') && both(name.slice(0, -9))))
      await env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND kind = 'upstream' AND owner IN (SELECT owner FROM secrets WHERE hub = ? AND kind = ?)").bind(hub.id, hub.id, VIA).run();
  }
  return note || more ? {state: 'partial', message: note, ...(more ? {more: true} : {})} : {state: 'ok'};
}

/* Each person's own Jellyfin server on AIOMetadata. Worked out again on every sync from the hub, their group and themselves, and
   saved only when the result changed, so a change at the hub reaches everyone who has not changed that setting for themselves.
   Their streams come from the hub's one AIOStreams setup, through their own variant. */
async function syncFronts(env: Env, vault: Vault, hub: string, people: {id: string; name: string; want: Want}[], players: Home, variants: Variant[], keys: Keys, budget: {left: number}, aiom: ReturnType<typeof gate>): Promise<{note: string; more: boolean; moved: Set<string>}> {
  let note = '', more = false, streams = players.enc ? players : null;
  if (!streams) {
    // The stream address carries AIOStreams' own form of the setup's password, which only AIOStreams can make. Asked for once.
    const read = await fetch(`${env.UP_ORIGIN}/api/v1/user`, {headers: basic(players)}).catch(() => null);
    const enc = read?.status === 200 ? ((await read.json().catch(() => null)) as {data?: {encryptedPassword?: string}} | null)?.data?.encryptedPassword : null;
    if (!enc) return {note: 'AIOStreams did not answer, so the players were not brought in step. It will be tried again on your next change.', more: false, moved: new Set()};
    streams = {...players, enc}; await (await putSecret(env, hub, HUB_OWNER, 'players', streams)).run();
  }
  const base = `${env.UP_ORIGIN}/stremio/${players.uuid}/${encodeURIComponent(streams.enc!)}`, writes = [], moved = new Set<string>();
  // A few people at a time. What each says is taken in people order, so the note shown never depends on which answered first.
  const done = await inTurn(people.map(person => async () => {
    const kept = await held<Catalogs>(env, vault, hub, person.id, PLAYER), client = kept?.client ?? newToken('a');
    const variant = variants.some(item => item.id === `${OURS}c-${person.id}`) ? `/v/${OURS}c-${person.id}` : '';
    const wanted: Wanted = {...wantedOf(person.want, keys, person.want.settings.limit), jellyfinUserName: person.name, jellyfinAppPassword: client, jellyfinStreamUrl: `${base}${variant}/manifest.json`, jellyfinResumeSource: 'auto', jellyfinUsers: [],
      // What production carries on AIOStreams' Home address and in its personas, here set on the person's own server.
      ageRating: RATING[person.want.settings.limit] ?? 'None', jellyfinSkipSource: person.want.settings.skip ? 'auto' : 'off',
      // Kids: a title with no rating could be anything, so it is left out too. Only then is it set, so nobody else's setup changes.
      ...(person.want.settings.limit === 'kids' ? {allowUnratedContent: false} : {})};
    const got = await aiom(() => syncHome(env, vault, hub, person.id, wanted, keys, budget, PLAYER, {client}));
    if (!('made' in got)) return {person, got, write: null};
    const at = `${got.made.at ?? env.AIOM_ORIGIN}/jellyfin/${got.made.uuid}`, had = await held<{user: string; pass: string; base: string}>(env, vault, hub, person.id, VIA);
    return {person, got, write: !had || had.user !== person.name || had.pass !== client || had.base !== at ? await putSecret(env, hub, person.id, VIA, {user: person.name, pass: client, base: at}) : null};
  }), AIOM_AT_ONCE);
  for (const {person, got, write} of done) {
    if (!('made' in got)) {note ||= got.message; more ||= !!got.more;}
    if (write) {writes.push(write); moved.add(person.id);}
  }
  // A setup whose person is gone is removed.
  const here = new Set(people.map(person => person.id));
  for (const name of vault.keys()) {
    const owner = name.endsWith(`/${PLAYER}`) ? name.slice(0, -PLAYER.length - 1) : ''; if (!owner || here.has(owner) || (budget.left -= 1) < 0) continue;
    await dropHome({...env, AIOM_ORIGIN: (await held<Catalogs>(env, vault, hub, owner, PLAYER))?.at ?? env.AIOM_ORIGIN}, hub, owner, PLAYER);
  }
  if (writes.length) await env.DB.batch(writes);
  return {note, more: more || budget.left < 0, moved};
}

/* Removes one setup from AIOStreams. AIOStreams answers 400 "invalid details" for a setup that is already gone (seen on staging), so a
   second try after a half-done removal can finish. Any other refusal means the setup may still be there. */
async function removeSetup(env: Env, players: Home): Promise<boolean> {
  const answer = await fetch(`${env.UP_ORIGIN}/api/v1/user`, {method: 'DELETE', headers: basic(players)}).catch(() => null);
  if (answer?.status === 200 || answer?.status === 404) return true;
  return answer?.status === 400 && ((await answer.json().catch(() => null)) as {error?: {code?: string}} | null)?.error?.code === 'USER_INVALID_DETAILS';
}
/* Removes the hub's setups from AIOStreams and AIOMetadata, wherever each was made. True when all are gone (or were never made). */
export async function removePlayers(site: Env, hub: {id: string; data: string}): Promise<boolean> {
  const env = hosted(site, JSON.parse(hub.data) as HubData), players = await getSecret<Home>(env, hub.id, HUB_OWNER, 'players');
  if (players && !await removeSetup({...env, UP_ORIGIN: players.at ?? env.UP_ORIGIN}, players)) return false;
  const made = env.AIOM_ORIGIN ? (await env.DB.prepare("SELECT owner, kind FROM secrets WHERE hub = ? AND kind IN ('catalogs', ?)").bind(hub.id, PLAYER).all<{owner: string; kind: string}>()).results : [];
  for (const row of made) {
    const at = (await getSecret<Catalogs>(env, hub.id, row.owner, row.kind))?.at;
    if (!await dropHome({...env, AIOM_ORIGIN: at ?? env.AIOM_ORIGIN}, hub.id, row.owner, row.kind)) return false;
  }
  return true;
}
