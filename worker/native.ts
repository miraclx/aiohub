// The hub's own setup on the streaming server (AIOStreams): created once per hub, then kept in step with what the site holds.
// The hub only ever talks to a setup it created itself, whose id and password it keeps in the vault. Nothing here names an id in an
// error or a log line. Each request shape was proven by script against a live server first.
import {traktRows} from '../src/data';
import type {Addon, Row, Settings} from '../src/data';
import type {Env} from './util';
import {getSecret, hosted, newToken, now, putSecret, sha, unseal} from './util';
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
interface Home {uuid: string; password: string; at?: string}
interface HubData {hostUrl?: string; metaUrl?: string; missing?: string[]; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]}
interface Persona {id: string; name: string; [key: string]: unknown}
interface Preset {type: string; instanceId: string; enabled: boolean; options: Record<string, unknown>}
interface Stored {services?: unknown; presets?: Preset[]; formatter?: unknown; jellyfin?: {primary?: unknown; personas?: Persona[]; segments?: boolean}; [key: string]: unknown}
export interface Synced {state: 'ok' | 'partial' | 'needs-key' | 'stuck' | 'error'; message?: string; more?: boolean}

const basic = (home: Home) => ({authorization: `Basic ${btoa(`${home.uuid}:${home.password}`)}`, accept: 'application/json', 'user-agent': 'AIOHub/1.0'});
const short = () => [...crypto.getRandomValues(new Uint8Array(2))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 3);
const STUCK: Synced = {state: 'stuck', message: 'Setting up the players did not finish last time, and it is not safe to simply try again. It needs a look.'};

/* Playback choices, as AIOStreams settings. The three "how long to look" conditions were checked on staging. */
const RESOLUTIONS = ['2160p', '1440p', '1080p', '720p', '576p', '480p', '360p', '240p', '144p', 'Unknown'];
const QUALITY: Record<Settings['quality'], {excluded: string[]; first: string[]}> = {
  saver: {excluded: ['2160p', '1440p'], first: ['720p', '1080p', '576p', '480p']},
  balanced: {excluded: ['2160p'], first: ['1080p', '1440p', '720p']},
  best: {excluded: [], first: ['2160p', '1440p', '1080p', '720p']},
};
const SEARCH: Record<Settings['search'], {enabled: boolean; condition: string}> = {
  // Each waits for the library first: what is already in the debrid account must always be in the list, and it is listed first.
  fast: {enabled: true, condition: `"${SOURCE.library.name}" in queriedAddons and (count(cached(totalStreams)) >= 3 or totalTimeTaken > 3000)`},
  balanced: {enabled: true, condition: `"${SOURCE.library.name}" in queriedAddons and (count(cached(resolution(totalStreams,'2160p','1080p'))) >= 5 or (count(cached(totalStreams)) >= 1 and totalTimeTaken > 6000) or totalTimeTaken > 10000)`},
  thorough: {enabled: false, condition: 'false'},
};
// AIOStreams refuses a whole save over one language name it does not know, so only names it listed on staging are ever sent.
const LANGUAGES = new Set('English Japanese Chinese Russian Arabic Portuguese Spanish French German Italian Korean Hindi Bengali Punjabi Marathi Gujarati Tamil Telugu Kannada Malayalam Thai Vietnamese Indonesian Turkish Hebrew Persian Ukrainian Greek Lithuanian Latvian Estonian Polish Czech Slovak Hungarian Romanian Bulgarian Serbian Croatian Slovenian Dutch Danish Finnish Swedish'.split(' '));
export function playback(stored: Stored, settings: Settings) {
  const quality = QUALITY[settings.quality] ?? QUALITY.balanced, bytes = Math.round(settings.maxSizeGb * 1e9);
  stored.excludedResolutions = quality.excluded;
  stored.preferredResolutions = [...quality.first, ...RESOLUTIONS.filter(item => !quality.first.includes(item) && !quality.excluded.includes(item))];
  stored.excludedQualities = ['CAM', 'SCR', 'TS', 'TC'];
  stored.size = {...(stored.size as object ?? {}), global: {movies: [0, bytes], series: [0, bytes], anime: [0, bytes]}};
  stored.preferredLanguages = [...settings.languages.filter(item => LANGUAGES.has(item)), 'Dual Audio', 'Multi'];
  const order = settings.cachedFirst ? ['library', 'cached', 'resolution', 'language', 'quality', 'size'] : ['library', 'resolution', 'language', 'quality', 'cached', 'size'];
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
function patch(stored: Stored, data: HubData, key: string, people: {id: string; name: string; variants?: string[]; tracks?: boolean}[], home: string | null, variants: Variant[] = []) {
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
  playback(stored, data.defaults);
  stored.formatter = label(data.defaults);
  // What a group or a person has changed for themselves travels as a variant: a short list of changes applied only for them.
  stored.variants = [...variants, ...((stored.variants as Variant[] | undefined) ?? []).filter(item => !item.id?.startsWith(OURS))];
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
function differences(above: Settings, own: Settings, keys: Map<string, string>, home: string | null, extras: Addon[]): string[] {
  const a: Stored = {}, b: Stored = {}, lines: string[] = []; playback(a, above); playback(b, own);
  const say = (path: string, from: unknown, to: unknown) => {if (JSON.stringify(from) !== JSON.stringify(to)) lines.push(`set ${path} = ${JSON.stringify(to)}`);};
  say('excludedResolutions', a.excludedResolutions, b.excludedResolutions); say('preferredResolutions', a.preferredResolutions, b.preferredResolutions);
  say('size.global', (a.size as {global: unknown}).global, (b.size as {global: unknown}).global); say('preferredLanguages', a.preferredLanguages, b.preferredLanguages);
  say('sortCriteria.global', (a.sortCriteria as {global: unknown}).global, (b.sortCriteria as {global: unknown}).global); say('dynamicAddonFetching', a.dynamicAddonFetching, b.dynamicAddonFetching);
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
  if (!claim.meta.changes) return STUCK;
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
    if (/401|403|unauthori[sz]ed|forbidden/i.test(why)) return {state: 'error', message: `${service} did not accept the key. Replace it under Defaults, Sources.`};
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
// A person's own Trakt rows. They exist only in the Home of someone who has connected Trakt.
const TRAKT_ROW: Record<string, Record<string, unknown> & {id: string; type: string}> = {
  'watchlist': {id: 'trakt.watchlist', type: 'all', sort: 'added', sortDirection: 'desc'},
  'recommended-movies': {id: 'trakt.recommendations.movies', type: 'movie'}, 'recommended-series': {id: 'trakt.recommendations.shows', type: 'series'},
  'up-next': {id: 'trakt.upnext', type: 'series', cacheTTL: 300}, 'recently-aired': {id: 'trakt.unwatched', type: 'series', cacheTTL: 300},
};
interface Catalogs {uuid: string; password: string; v: number; sent: string; at?: string}
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
/* Home as AIOMetadata holds it. A collection sits right after the plain row above it, which is how AIOMetadata places one. */
export function homeOf(rows: Row[], lists: boolean, trakt = false): {catalogs: Catalog[]; collections: {id: string; [key: string]: unknown}[]} {
  const catalogs: Catalog[] = [], collections: {id: string; [key: string]: unknown}[] = [], sources = new Map<string, Catalog>();
  let above: {id: string; type: string} | undefined;
  for (const row of rows) {
    const plain = TMDB_ROW[row.id], item = COLLECTIONS.get(row.id);
    const list = lists ? /^mdblist\.(\d+)\.(movie|series|all)$/.exec(row.id) : null;
    const own = trakt ? TRAKT_ROW[row.id] : undefined;
    if (plain) {catalogs.push({...plain, name: row.title, source: 'tmdb', enabled: row.on, showInHome: true}); above = plain;}
    else if (own) {above = {id: own.id, type: own.type}; catalogs.push({...own, name: row.title, source: 'trakt', enabled: row.on, showInHome: true});}
    else if (list) {above = {id: `mdblist.${list[1]}`, type: list[2]}; catalogs.push({...above, name: row.title, source: 'mdblist', sort: 'default', enabled: row.on, showInHome: true});}
    else if (item && lists && row.on) {
      const folders = foldersOf(item, row.covers);
      collections.push({kind: 'collection', id: item.id, title: row.title, hideTitle: false, backdropImageUrl: '', pinToTop: false, viewMode: item.viewMode, showAllTab: true, focusGlowEnabled: true, ...(above ? {after: above} : {}),
        folders: folders.map(({folder, title}) => ({id: folder.id, title, shape: folder.shape, hideTitle: folder.hideTitle, coverImageUrl: folder.cover, coverEmoji: '', sources: [folder.source]}))});
      for (const {folder} of folders) sources.set(`${folder.catalog.id}/${folder.catalog.type}`, {...folder.catalog, enabled: true, showInHome: false});
    }
  }
  return {catalogs: [...catalogs, ...sources.values()], collections};
}
const address = (env: Env, made: Catalogs) => `${env.AIOM_ORIGIN}/stremio/${made.uuid}/manifest.json?v=${made.v}`;
interface Want {rows: Row[]; settings: Settings; trakt?: string | null; lists?: string | null}
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
const art = (settings: Settings, pattern: string = BETTER) => settings.posters === 'better' ? {posterRatingProvider: 'custom', customPosterUrlPattern: pattern, usePosterProxy: true, enableRatingPostersForLibrary: true} : {posterRatingProvider: 'none', customPosterUrlPattern: '', usePosterProxy: false, enableRatingPostersForLibrary: false};
// `$trakt` is the person's Trakt connection; it travels with the keys, not as a setting. Hiding what's been watched reads from it.
// `$lists` is the person's own MDBList key. With it, what they play is recorded to their MDBList and can be hidden from rows;
// without it nothing is recorded anywhere (the hub's shared key is one account, so it is never used for that).
const wantedOf = (want: Want, keys: Keys): Wanted => ({...homeOf(want.rows, !!(keys.mdblist || want.lists), !!want.trakt), ...looks(want.settings), ...art(want.settings), hideWatchedTrakt: !!want.trakt && want.settings.hideWatched, $trakt: want.trakt ?? null,
  playbackReporting: !!want.lists, mdblistWatchTracking: !!want.lists, hideWatchedMdblist: !!want.lists && want.settings.hideWatched, $lists: want.lists ?? null});
const LATER = 'AIOMetadata did not answer, so Home rows in the player apps were not updated. It will be tried again on your next change.';

/* Everything the hub keeps in the vault, read in one go: a sync touches many records, and a Worker may only ask the database so often. */
type Vault = Map<string, string>;
const vaultOf = async (env: Env, hub: string): Promise<Vault> => new Map((await env.DB.prepare('SELECT owner, kind, value FROM secrets WHERE hub = ?').bind(hub).all<{owner: string; kind: string; value: string}>()).results.map(row => [`${row.owner}/${row.kind}`, row.value]));
const held = <T>(env: Env, vault: Vault, hub: string, owner: string, kind: string) => unseal<T>(env, `${hub}/${owner}/${kind}`, vault.get(`${owner}/${kind}`));
/* One Home setup on AIOMetadata: the hub's, or a group's or a person's own when theirs differs. Made once per owner, then kept in step. */
async function syncHome(env: Env, vault: Vault, hub: string, owner: string, wanted: Wanted, keys: Keys, budget: {left: number}): Promise<{address: string} | {message: string; more?: boolean}> {
  const {$trakt, $lists, ...rest} = wanted as Wanted & {$trakt?: string | null; $lists?: string | null};
  const apiKeys = {tmdb: keys.tmdb, ...($lists || keys.mdblist ? {mdblist: ($lists || keys.mdblist) as string} : {}), ...($trakt ? {traktTokenId: $trakt} : {})}, sent = await sha(JSON.stringify([apiKeys, wanted]));
  let made = await held<Catalogs>(env, vault, hub, owner, 'catalogs');
  // The hub moved to another AIOMetadata server: the setup on the old one is removed, and a new one is made here.
  if (made?.at && made.at !== env.AIOM_ORIGIN) {if ((budget.left -= 1) < 0 || !await dropHome({...env, AIOM_ORIGIN: made.at}, hub, owner)) return {message: LATER, more: budget.left < 0}; made = null;}
  if (made?.sent === sent) return {address: address(env, made)};
  // A Worker may only make so many calls for one request. What does not fit is done on the next pass, which the site asks for.
  if ((budget.left -= 2) < 0) return {message: 'Still bringing everyone’s Home in step.', more: true};
  if (!made) {
    const claim = await env.DB.prepare("INSERT INTO ops (hub, kind, target, state, created, updated) VALUES (?, 'create-catalogs', ?, 'requested', ?, ?) ON CONFLICT DO NOTHING").bind(hub, owner, now(), now()).run();
    if (!claim.meta.changes) return {message: STUCK.message!};
    const password = newToken('c');
    await (await putSecret(env, hub, owner, 'catalogs-pending', {password})).run();
    const answer = await fetch(`${env.AIOM_ORIGIN}/api/config/save`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({config: {apiKeys, ...SEARCH_SETUP, ...rest}, password})}).catch(() => null);
    if (!answer) return {message: STUCK.message!};
    const body = await answer.json().catch(() => null) as {userUUID?: string} | null;
    if (answer.status !== 200 || !body?.userUUID) {
      if (answer.status < 400 || answer.status >= 500) return {message: STUCK.message!};
      // Refused outright: nothing was created, so the claim is released and it can be tried again.
      await env.DB.batch([env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'create-catalogs' AND target = ?").bind(hub, owner), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'catalogs-pending'").bind(hub, owner)]);
      return {message: 'AIOMetadata refused the Home setup. Check the TMDB and MDBList keys under Defaults, Sources.'};
    }
    made = {uuid: body.userUUID, password, v: now(), sent, at: env.AIOM_ORIGIN};
    await env.DB.batch([await putSecret(env, hub, owner, 'catalogs', made), env.DB.prepare("UPDATE ops SET state = 'done', updated = ? WHERE hub = ? AND kind = 'create-catalogs' AND target = ?").bind(now(), hub, owner), env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind = 'catalogs-pending'").bind(hub, owner)]);
    return {address: address(env, made)};
  }
  // Read, change only what the hub owns (its rows, its collections, its settings, the keys), write back against the version that was read.
  const read = await fetch(`${env.AIOM_ORIGIN}/api/config/load/${made.uuid}`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({password: made.password})}).catch(() => null);
  const stored = read?.status === 200 ? ((await read.json().catch(() => null)) as {config?: {catalogs?: Catalog[]; collections?: {id: string}[]; apiKeys?: Record<string, string>; configVersion?: number; [key: string]: unknown}} | null)?.config : null;
  if (!stored) return {message: LATER};
  const ours = new Set(Object.values(TMDB_ROW).map(item => `${item.id}/${item.type}`)), folders = new Set([...COLLECTIONS.values()].map(item => item.id));
  const {catalogs, collections, ...settings} = rest;
  Object.assign(stored, settings); stored.language ??= SEARCH_SETUP.language;
  if (!(stored.search as {providers?: unknown} | undefined)?.providers) stored.search = SEARCH_SETUP.search;
  stored.catalogs = [...catalogs, ...(stored.catalogs ?? []).filter(item => !ours.has(`${item.id}/${item.type}`) && !/^(mdblist|letterboxd|trakt)\./.test(item.id))];
  stored.collections = [...collections, ...(stored.collections ?? []).filter(item => !folders.has(item.id))];
  const others = {...(stored.apiKeys ?? {})}; delete others.mdblist; delete others.traktTokenId;
  stored.apiKeys = {...others, ...apiKeys};
  const write = await fetch(`${env.AIOM_ORIGIN}/api/config/update/${made.uuid}`, {method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({config: stored, password: made.password, baseVersion: stored.configVersion})}).catch(() => null);
  if (write?.status !== 200) return {message: LATER};
  made = {...made, v: now() <= made.v ? made.v + 1 : now(), sent};
  await (await putSecret(env, hub, owner, 'catalogs', made)).run();
  return {address: address(env, made)};
}
/* Removes one owner's Home setup from AIOMetadata. What the hub remembers of it goes only once AIOMetadata confirms. */
async function dropHome(env: Env, hub: string, owner: string): Promise<boolean> {
  const made = await getSecret<Catalogs>(env, hub, owner, 'catalogs');
  const status = made ? (await fetch(`${env.AIOM_ORIGIN}/api/config/delete-user/${made.uuid}`, {method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({password: made.password})}).catch(() => null))?.status : 200;
  if (status !== 200 && status !== 404) return false;
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND owner = ? AND kind IN ('catalogs', 'catalogs-pending')").bind(hub, owner), env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'create-catalogs' AND target = ?").bind(hub, owner)]);
  return true;
}

/* What each Home row actually holds right now, for the site's own preview: the first few posters, exactly as a player app would get
   them from the hub's AIOMetadata setup (so with its poster settings applied). Remembered for ten minutes per running copy. */
const shown = new Map<string, {at: number; rows: Record<string, string[]>}>();
export async function previews(site: Env, hub: {id: string; data: string}, person?: string): Promise<Record<string, string[]>> {
  const data = JSON.parse(hub.data) as HubData, env = hosted(site, data);
  if (!env.AIOM_ORIGIN) return {};
  // A person's rows come from whichever Home setup they are on: their own, their group's, or the hub's.
  let rows = data.rows, owners = [HUB_OWNER];
  if (person) {
    const found = await env.DB.prepare('SELECT p.data AS mine, g.id AS grp, g.data AS theirs FROM people p JOIN groups g ON g.hub = p.hub AND g.id = p.grp WHERE p.hub = ? AND p.id = ?').bind(hub.id, person).first<{mine: string; grp: string; theirs: string}>();
    if (!found) return {};
    const mine = JSON.parse(found.mine) as {rows: Row[] | null; trakt?: boolean}, shared = (JSON.parse(found.theirs) as {rows: Row[] | null}).rows ?? data.rows;
    rows = mine.rows ?? [...(mine.trakt ? traktRows() : []), ...shared]; owners = [person, groupOwner(found.grp), HUB_OWNER];
  }
  let made: Catalogs | null = null;
  for (const owner of owners) if ((made = await getSecret<Catalogs>(env, hub.id, owner, 'catalogs'))) break;
  if (!made) return {};
  const key = `${hub.id}/${made.uuid}/${made.v}`, known = shown.get(key);
  if (known && Date.now() - known.at < 600_000) return known.rows;
  const at = made.at ?? env.AIOM_ORIGIN, out: Record<string, string[]> = {};
  const where = (row: Row) => {const list = /^mdblist\.(\d+)\.(movie|series|all)$/.exec(row.id); return TMDB_ROW[row.id] ?? TRAKT_ROW[row.id] ?? (list ? {id: `mdblist.${list[1]}`, type: list[2]} : null);};
  await Promise.all(rows.filter(row => row.on && where(row)).slice(0, 16).map(async row => {
    const from = where(row)!, answer = await fetch(`${at}/stremio/${made!.uuid}/catalog/${from.type}/${from.id}.json`, {headers: {accept: 'application/json', 'user-agent': 'AIOHub/1.0'}}).catch(() => null);
    const metas = answer?.status === 200 ? ((await answer.json().catch(() => null)) as {metas?: {poster?: string}[]} | null)?.metas ?? [] : [];
    const posters = metas.map(meta => meta.poster).filter((poster): poster is string => typeof poster === 'string' && poster.startsWith('https://')).slice(0, 8);
    if (posters.length) out[row.id] = posters;
  }));
  if (shown.size > 500) shown.clear(); shown.set(key, {at: Date.now(), rows: out});
  return out;
}

/* Brings the hub's setups in step with the site: the debrid account, sources, stream label, who can sign in, everyone's Home, and
   what each group and person has changed for themselves. */
export async function syncPlayers(site: Env, hub: {id: string; data: string}): Promise<Synced> {
  const data = JSON.parse(hub.data) as HubData, service = data.defaults.debrid, env = hosted(site, data);
  const vault = await vaultOf(env, hub.id), accounts = new Map<string, string>();
  for (const name of data.services) {const account = SERVICE[name] ? await held<string>(env, vault, hub.id, HUB_OWNER, `debrid:${name}`) : null; if (account) accounts.set(name, account);}
  const key = accounts.get(service);
  if (!key) return {state: 'needs-key', message: `Connect ${service} under Defaults, Sources, so there is something to play from.`};
  const [groupRows, personRows] = await env.DB.batch([env.DB.prepare('SELECT id, name, data FROM groups WHERE hub = ?').bind(hub.id), env.DB.prepare('SELECT id, grp, name, data FROM people WHERE hub = ? ORDER BY created, id').bind(hub.id)]);
  const top: Want = {rows: data.rows, settings: data.defaults}, linked = new Map<string, string>(), watching = new Map<string, string>();
  for (const name of vault.keys()) if (name.endsWith('/mdblist')) {const owner = name.slice(0, -8), own = await held<{key: string}>(env, vault, hub.id, owner, 'mdblist'); if (own?.key) watching.set(owner, own.key);}
  for (const name of vault.keys()) if (name.endsWith('/trakt')) {const owner = name.slice(0, -6), held_ = await held<{tokenId: string}>(env, vault, hub.id, owner, 'trakt'); if (held_?.tokenId) linked.set(owner, held_.tokenId);}
  const groups = (groupRows.results as {id: string; name: string; data: string}[]).map(row => {const own = JSON.parse(row.data) as {rows: Row[] | null; settings: Partial<Settings>}; return {id: row.id, name: row.name, want: {rows: own.rows ?? top.rows, settings: {...top.settings, ...own.settings}} as Want, home: null as string | null, reach: null as string | null, sig: ''};});
  const people = (personRows.results as {id: string; grp: string; name: string; data: string}[]).map(row => {
    const own = JSON.parse(row.data) as {rows: Row[] | null; settings: Partial<Settings>; trakt?: boolean}, group = groups.find(item => item.id === row.grp), above = group?.want ?? top;
    const trakt = own.trakt ? linked.get(row.id) ?? null : null, lists = watching.get(row.id) ?? null;
    // Someone with Trakt connected and no Home of their own gets their Trakt rows above the shared ones.
    return {id: row.id, name: row.name, group, above, want: {rows: own.rows ?? [...(trakt ? traktRows() : []), ...above.rows], settings: {...above.settings, ...own.settings}, trakt, lists} as Want, tracks: !!lists, home: null as string | null, variants: [] as string[]};
  });

  // Home. The hub has one setup on AIOMetadata; a group or a person gets their own only while theirs differs from the one above.
  const tmdb = env.AIOM_ORIGIN ? await held<string>(env, vault, hub.id, HUB_OWNER, 'key:tmdb') : null, budget = {left: 30};
  let note = !env.AIOM_ORIGIN ? 'Home rows are not set up on this site.' : !tmdb ? 'Add a TMDB key under Defaults, Sources, so Home has rows in the player apps.' : '', more = false, base: string | null = null;
  if (tmdb) {
    const keys: Keys = {tmdb, mdblist: await held<string>(env, vault, hub.id, HUB_OWNER, 'key:mdblist')}, needed = new Set([HUB_OWNER]);
    const make = async (owner: string, wanted: Wanted) => {const got = await syncHome(env, vault, hub.id, owner, wanted, keys, budget); if ('address' in got) return got.address; note ||= got.message; more ||= !!got.more; return null;};
    const wanted = wantedOf(top, keys), sig = JSON.stringify(wanted);
    if ((base = await make(HUB_OWNER, wanted))) {
      for (const group of groups) {
        const theirs = wantedOf(group.want, keys); group.sig = JSON.stringify(theirs);
        if (group.sig !== sig && people.some(person => person.group === group)) {needed.add(groupOwner(group.id)); group.home = await make(groupOwner(group.id), theirs);}
      }
      for (const person of people) {
        const theirs = wantedOf(person.want, keys);
        if (JSON.stringify(theirs) !== (person.group?.sig ?? sig)) {needed.add(person.id); person.home = await make(person.id, theirs);}
      }
      // A setup nobody needs any more (its owner follows the level above again, or is gone) is removed.
      for (const name of vault.keys()) {
        const owner = name.endsWith('/catalogs') ? name.slice(0, -9) : ''; if (!owner || needed.has(owner) || (budget.left -= 1) < 0) continue;
        await dropHome({...env, AIOM_ORIGIN: (await held<Catalogs>(env, vault, hub.id, owner, 'catalogs'))?.at ?? env.AIOM_ORIGIN}, hub.id, owner);
      }
    }
  }
  const variants: Variant[] = [], hubReach = limited(base, top.settings), extras = extrasOf(data);
  for (const group of groups) {
    // A group with nobody in it has nobody to apply its changes to.
    const reach = limited(group.home ?? base, group.want.settings);
    group.reach = reach;
    const lines = people.some(person => person.group === group) ? differences(top.settings, group.want.settings, accounts, reach !== hubReach ? reach : null, extras) : [];
    if (lines.length) variants.push({id: `${OURS}g-${group.id}`, name: `Group: ${group.name}`, enabled: true, script: lines.join('\n')});
  }
  for (const person of people) {
    const over = person.group?.reach ?? hubReach, reach = limited(person.home ?? person.group?.home ?? base, person.want.settings);
    const lines = differences(person.above.settings, person.want.settings, accounts, reach !== over ? reach : null, extras);
    if (lines.length) variants.push({id: `${OURS}p-${person.id}`, name: `Person: ${person.name}`, enabled: true, script: lines.join('\n')});
    person.variants = [`${OURS}g-${person.group?.id}`, `${OURS}p-${person.id}`].filter(id => variants.some(item => item.id === id));
  }

  let players = await held<Home>(env, vault, hub.id, HUB_OWNER, 'players');
  // The hub moved to another AIOStreams server: its setup on the old one is removed first, then a new one is made here.
  if (players?.at && players.at !== env.UP_ORIGIN) {
    if (!await removeSetup({...env, UP_ORIGIN: players.at}, players)) return {state: 'error', message: 'The old AIOStreams server did not confirm removing the hub’s setup, so nothing was moved. It will be tried again on your next change.'};
    await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE hub = ? AND (kind = 'upstream' OR (owner = ? AND kind IN ('players', 'players-pending')))").bind(hub.id, HUB_OWNER), env.DB.prepare("DELETE FROM ops WHERE hub = ? AND kind = 'create-players'").bind(hub.id)]);
    for (const name of [...vault.keys()]) if (name.endsWith('/upstream')) vault.delete(name);
    players = null;
  }
  if (!players) {
    const first = fresh(); patch(first, data, key, people, hubReach, variants);
    const made = await create(env, hub.id, first, service);
    if ('state' in made) return made;
    players = made;
  } else {
    const read = await fetch(`${env.UP_ORIGIN}/api/v1/user?raw=true`, {headers: basic(players)}).catch(() => null);
    const stored = read?.status === 200 ? ((await read.json().catch(() => null)) as {data?: {userData?: Stored}} | null)?.data?.userData : null;
    if (!stored) return {state: 'error', message: 'AIOStreams did not answer. Your changes are saved here and will be sent on the next try.'};
    const before = JSON.stringify(stored); patch(stored, data, key, people, hubReach, variants);
    if (JSON.stringify(stored) !== before) {
      const write = await fetch(`${env.UP_ORIGIN}/api/v1/user`, {method: 'PUT', headers: {...basic(players), 'content-type': 'application/json'}, body: JSON.stringify({config: stored})}).catch(() => null);
      if (write?.status !== 200) {
        const why = (((await write?.json().catch(() => null)) as {error?: {message?: string}} | null)?.error?.message ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '').replace(/https?:\/\/\S+/g, 'a link').slice(0, 160);
        return {state: 'error', message: `AIOStreams did not accept the change${why ? `: ${why}` : '.'} Your changes are saved here and will be sent on the next try.`};
      }
    }
  }
  // Each person signs in upstream under this setup with their own name. The kept sign-in answer, if any, is left in place.
  const writes = [];
  for (const person of people) {
    const user = `${players.uuid}/${person.name}`, had = await held<{user: string; pass: string; auth?: string}>(env, vault, hub.id, person.id, 'upstream');
    if (!had || had.user !== user || had.pass !== players.password) writes.push(await putSecret(env, hub.id, person.id, 'upstream', {...(had?.user.split('/')[0] === players.uuid ? had : {}), user, pass: players.password}));
  }
  if (writes.length) await env.DB.batch(writes);
  return note ? {state: 'partial', message: note, ...(more ? {more: true} : {})} : {state: 'ok'};
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
  const made = env.AIOM_ORIGIN ? (await env.DB.prepare("SELECT owner FROM secrets WHERE hub = ? AND kind = 'catalogs'").bind(hub.id).all<{owner: string}>()).results : [];
  for (const row of made) {
    const at = (await getSecret<Catalogs>(env, hub.id, row.owner, 'catalogs'))?.at;
    if (!await dropHome({...env, AIOM_ORIGIN: at ?? env.AIOM_ORIGIN}, hub.id, row.owner)) return false;
  }
  return true;
}
