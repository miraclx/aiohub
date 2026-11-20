// Shapes shared by the site and the Worker, the defaults a new hub starts with, and the sample data behind the preview.
// The sample data holds no real accounts, keys or viewing history.
import formatter from './formatter.json';
import shipped from './collections.json';
/* The preview (address ends in ?sample) runs entirely on made-up data and saves nothing. */
export const SAMPLE = new URLSearchParams((globalThis as {location?: {search: string}}).location?.search ?? '').has('sample');
export type Level = 'hub' | 'group' | 'own';
export interface Cover {title: string; image: string}
export interface Row {id: string; title: string; kind: string; source: string; origin: Level; on: boolean; core?: boolean; watched?: 'hide' | 'show'; covers?: Cover[]}
export interface Template {name: string; description: string}
export interface Settings {
  quality: 'saver' | 'balanced' | 'best'; maxSizeGb: number; languages: string[]; cachedFirst: boolean; search: 'fast' | 'balanced' | 'thorough';
  subtitles: string[]; skip: boolean;
  limit: 'all' | 'teen' | 'kids'; hideWatched: boolean; spoilers: boolean; unreleased: boolean; posters: 'better' | 'plain'; ageBadge?: boolean;
  debrid: string; sources: string[]; formatter: Template;
}
export type Overrides = Partial<Settings>;
export interface Device {id: string; app: string; name: string; seen: string; place?: string; net?: string}
// Plays one of Trakt and MDBList has and the other lacks, from the daily look (drift.ts on the Worker).
export interface Miss {kind: 'movie' | 'show'; tmdb: number; name: string; season?: number; episode?: number; at: number; key: string}
export interface Drift {checked: number; since: number; toMdblist: Miss[]; toTrakt: Miss[]}
export interface Person {moving?: 'mdblist' | 'here' | null; listsKept?: boolean; drift?: Drift | null; v?: number; ready?: boolean; history?: {username: string; again: boolean} | null; aiomTrakt?: boolean; listsName?: string; id: string; name: string; groupId: string; joined: boolean; paused?: boolean; trakt: boolean; lists: boolean; rows: Row[] | null; picks?: Record<string, boolean>; settings: Overrides; can: {arrange: boolean; add: boolean; playback: boolean}; pin: string | null; password: string; devices: Device[]}
export interface Group {v?: number; id: string; name: string; rows: Row[] | null; settings: Overrides; paused?: boolean}
export interface Addon {id: string; name: string; note: string; locked?: boolean; custom?: boolean; url?: string}
export interface Hub {
  // The five-minute background work (manager only): last run (unix seconds), runs counted, calls waiting for Trakt, the last day the
  // Trakt/MDBList check finished, for how many people, and how many are part way through.
  jobs?: {last: number | null; runs: number | null; since: number | null; ran: number | null; waiting: number; checked: string | null; people: number; checking: number};
  // In a person's view: their manager's own sign-in is set aside in this browser, to go back to.
  manager?: boolean;
  v?: number; serverName?: string; tmdb?: boolean; mdblist?: boolean; scrobble?: boolean; traktClient?: string; metaUrl?: string; missing?: string[]; traktLink?: string; name: string; code: string; host: string; hostUrl: string; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]; groups: Group[]; people: Person[];
  me: {name: string; theme: 'dark' | 'light' | 'auto'; passkeys: {id: string; name: string; added: string}[]};
}

const row = (id: string, title: string, kind: string, source: string, on = true, covers?: Cover[]): Row => ({id, title, kind, source, origin: 'hub', on, core: true, ...(covers ? {covers} : {})});
// Collection names and cover art mirror a real layout; cover images are public artwork.
const collections = shipped as {row: string; title: string; folders: Cover[]}[];
// Default order: what is hot, where to watch it, the evergreen best, then deep browsing.
// Poster rows and collection rows alternate so Home never reads as one wall of tiles.
export const defaultRows = (): Row[] => [
  row('trending-movies', 'Trending Movies', 'Movies', 'TMDB'),
  row('trending-series', 'Trending Shows', 'Series', 'TMDB'),
  row('movies-by-service', 'Movies by Service', 'Collection', '8 folders', true, collections[0].folders),
  row('shows-by-service', 'Shows by Service', 'Collection', '9 folders', true, collections[1].folders),
  row('top-movies', 'Top Rated Movies', 'Movies', 'TMDB'),
  row('top-series', 'Top Rated Shows', 'Series', 'TMDB'),
  row('movies-by-genre', 'Movies by Genre', 'Collection', '50 folders', true, collections[2].folders),
  row('shows-by-genre', 'Shows by Genre', 'Collection', '18 folders', true, collections[3].folders),
  row('mixed-genre', 'Mixed Genre Collections', 'Collection', '5 folders', true, collections[4].folders),
  row('popular-movies', 'Popular Movies', 'Movies', 'TMDB', false),
  row('popular-series', 'Popular Shows', 'Series', 'TMDB', false),
];
// A person's own rows, from the accounts they connect, sit above the shared ones: saved first, then picked for them.
// Up next is off: nothing writes plays back to Trakt yet, so it would fall behind. The player's own Continue watching covers it.
// Each watchlist is its own row. Recently Watched is one row whose source follows their accounts (sourceOf, below).
export const traktRows = (): Row[] => [
  {id: 'watchlist', title: 'Watchlist', kind: 'Movies & shows, newest first', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'mdblist-watchlist', title: 'Watchlist', kind: 'Movies & shows, newest first', source: 'MDBList', origin: 'own', on: true, core: true},
  {id: 'recommended-movies', title: 'Recommended Movies', kind: 'Movies', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'recommended-series', title: 'Recommended Shows', kind: 'Series', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'up-next', title: 'Up Next', kind: 'Series', source: 'Trakt', origin: 'own', on: false, core: true},
  {id: 'recently-aired', title: 'Recently Aired for You', kind: 'Series', source: 'Trakt', origin: 'own', on: false, core: true},
  // Looking back comes last: Continue Watching and Next Up already cover picking something up again.
  {id: 'recently-watched', title: 'Recently Watched', kind: 'Movies & shows, latest first', source: 'Trakt', origin: 'own', on: true, core: true},
];
export const TRAKT_IDS = new Set(traktRows().map(row => row.id));
/* Which accounts a person has connected: Trakt (to the hub, or the older way through AIOMetadata), and an MDBList key. */
export interface Linked {trakt: boolean; lists: boolean}
/* Whether a person's own row can be filled for them: the MDBList watchlist with MDBList, Recently Watched always (from Trakt, else
   MDBList, else what they played here), the rest with Trakt. */
export const reaches = (id: string, has: Linked) => id === 'recently-watched' || (id === 'mdblist-watchlist' ? has.lists : has.trakt);
/* The two watchlists are told apart by name only while both are on this Home; otherwise the one there is just "Watchlist". */
export function named(rows: Row[]): Row[] {
  const trakt = rows.find(row => row.id === 'watchlist'), lists = rows.find(row => row.id === 'mdblist-watchlist'), both = !!trakt?.on && !!lists?.on;
  return rows.map(row => row === trakt ? {...row, title: both ? 'Watchlist · Trakt' : 'Watchlist'} : row === lists ? {...row, title: both ? 'Watchlist · MDBList' : 'Watchlist'} : row);
}
/* A Home's rows with each of a person's own rows in its place: where this Home put it, else right after the one before it in
   traktRows() (the first at the top). A hub or group Home keeps them even though only someone with the account gets them: that is
   how the manager places them and chooses whether each starts on. */
export function placed(rows: Row[]): Row[] {
  const out = [...rows], all = traktRows();
  all.forEach((row, n) => {if (!out.some(item => item.id === row.id)) out.splice(n ? out.findIndex(item => item.id === all[n - 1].id) + 1 : 0, 0, {...row, origin: 'hub'});});
  return named(out);
}
/* A person's rows: their own Home if they made one, else the Home above with the rows their accounts can fill, each on or off as
   they last chose (`picks`), so switching one keeps them following the Home above. With both watchlists, the MDBList one starts off.
   A row they gain after making a Home of their own comes at its end, off; the MDBList watchlist comes after the Trakt one, on when
   it is their only watchlist. */
export function rowsOf(own: Row[] | null, shared: Row[], has: Linked, picks?: Record<string, boolean>): Row[] {
  const fits = (row: Row) => !TRAKT_IDS.has(row.id) || reaches(row.id, has);
  if (own) {
    const out = own.filter(fits);
    for (const row of traktRows()) if (reaches(row.id, has) && !out.some(item => item.id === row.id)) {
      if (row.id !== 'mdblist-watchlist') {out.push({...row, on: false}); continue;}
      out.splice(out.findIndex(item => item.id === 'watchlist') + 1, 0, {...row, on: !has.trakt});
    }
    return named(out);
  }
  return named(placed(shared).filter(fits).map(row => !TRAKT_IDS.has(row.id) ? row : picks?.[row.id] !== undefined ? {...row, on: picks[row.id]} : row.id === 'mdblist-watchlist' && has.trakt ? {...row, on: false} : row));
}
export const isTrakt = (item: Row) => item.source === 'Trakt' || item.source.startsWith('Trakt ·');
/* ---------- suggested rows ("Or pick one" in Add row) ----------
   Each is a real row: its id is the Home row it makes, so one already on a Home is not offered again. A part is one source:
   a public MDBList list (read with the hub's MDBList key, or the person's own), a TMDB collection or a TMDB search (the TMDB key
   only). A row with tabs is a collection, one tab per part. Ids and lists were checked on 2026-11-20. */
export type Part = {mdblist: number; type: 'movie' | 'series'} | {collection: number} | {discover: string; type: 'movie' | 'series'; params: Record<string, string>};
export type Limit = Settings['limit'];
export interface Suggestion {
  id: string; title: string; kind: string; source: string; parts: {title: string; part: Part}[];
  // hide: limits under which most of it would be filtered out; kids: a row for children, first under a limit; season: [from, to] as MM-DD.
  hide?: Limit[]; kids?: boolean; season?: [string, string];
}
// AIOMetadata works this out each day (tmdbDiscoverDateTokens.ts): only what is out already.
const TODAY = '__tmdb_date__:today:to';
const tmdbOnly = (parts: Suggestion['parts']) => parts.every(item => !('mdblist' in item.part));
const one = (id: string, title: string, kind: string, part: Part, extra: Partial<Suggestion> = {}): Suggestion => ({id, title, kind, source: 'mdblist' in part ? 'MDBList' : 'TMDB', parts: [{title, part}], ...extra});
const tabs = (id: string, title: string, parts: Suggestion['parts'], extra: Partial<Suggestion> = {}): Suggestion => ({id, title, kind: `Collection · ${parts.length} tabs`, source: tmdbOnly(parts) ? 'TMDB' : 'mdblist' in parts[0].part && parts.every(item => 'mdblist' in item.part) ? 'MDBList' : 'TMDB and MDBList', parts, ...extra});
const list = (id: number, type: 'movie' | 'series', title: string, extra: Partial<Suggestion> = {}) => one(`mdblist.${id}.${type}`, title, type === 'movie' ? 'Movies' : 'Series', {mdblist: id, type}, extra);
// The order is the fixed popularity order: what most households reach for first.
export const SUGGESTED: Suggestion[] = [
  list(8113, 'movie', 'Christmas Movies', {season: ['11-15', '12-31']}),
  list(41422, 'movie', 'Halloween Movies', {season: ['10-01', '11-01'], hide: ['kids', 'teen']}),
  tabs('sg.star-wars', 'Star Wars', [{title: 'Films', part: {mdblist: 198749, type: 'movie'}}, {title: 'Shows', part: {mdblist: 202585, type: 'series'}}], {hide: ['kids']}),
  tabs('sg.mcu', 'Marvel Cinematic Universe', [{title: 'Films', part: {discover: 'mcu', type: 'movie', params: {with_keywords: '180547', sort_by: 'primary_release_date.asc', 'primary_release_date.lte': TODAY}}}, {title: 'Shows', part: {mdblist: 32047, type: 'series'}}], {hide: ['kids']}),
  tabs('sg.wizarding-world', 'Wizarding World', [{title: 'Harry Potter', part: {collection: 1241}}, {title: 'Fantastic Beasts', part: {collection: 435259}}], {hide: ['kids']}),
  tabs('sg.middle-earth', 'Middle-earth', [{title: 'The Lord of the Rings', part: {collection: 119}}, {title: 'The Hobbit', part: {collection: 121938}}], {hide: ['kids']}),
  one('sg.bond', 'James Bond', 'Movies, in order', {collection: 645}, {hide: ['kids']}),
  one('sg.pixar', 'Pixar', 'Movies', {discover: 'pixar', type: 'movie', params: {with_companies: '3', sort_by: 'popularity.desc', 'with_runtime.gte': '40', 'primary_release_date.lte': TODAY}}),
  one('sg.ghibli', 'Studio Ghibli', 'Movies', {discover: 'ghibli', type: 'movie', params: {with_companies: '10342', sort_by: 'popularity.desc', 'primary_release_date.lte': TODAY}}),
  list(33459, 'movie', 'Best Picture Winners', {hide: ['kids', 'teen']}),
  list(101881, 'movie', 'IMDb Top 250 Movies', {hide: ['kids', 'teen']}),
  list(101882, 'series', 'IMDb Top 250 Shows', {hide: ['kids', 'teen']}),
  list(86934, 'movie', 'New on Digital', {hide: ['kids']}),
  // For children. Suggested only, never on by default. (The hub's "Popular Animated Shows" list is not for children.)
  list(13621, 'movie', 'Kids’ Movies, around 7', {kids: true}),
  list(154863, 'series', 'Kids’ Shows, around 7', {kids: true}),
  list(185001, 'movie', 'Movies for 9 to 12', {kids: true}),
  list(65386, 'series', 'Kids’ Shows, up to 12', {kids: true}),
];
export const suggestionOf = (id: string) => SUGGESTED.find(item => item.id === id);
/* Whether a suggestion reads an MDBList list: all of it ('all'), some tabs ('some'), or none. */
export const needsLists = (item: Suggestion) => item.parts.every(part => 'mdblist' in part.part) ? 'all' : item.parts.some(part => 'mdblist' in part.part) ? 'some' : 'none';
/* The suggestions for one Home, in order: what is not on it yet, in season, and suited to its content limit. Under a limit the rows
   for children come first. `because`: suggestion id -> a title the person watched (their own Home only); those lead. */
export function suggestedFor(has: (id: string) => boolean, limit: Limit, lists: boolean, today = new Date(), because: Record<string, string> = {}) {
  const day = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const shown = SUGGESTED.filter(item => !has(item.id) && !item.hide?.includes(limit) && (!item.season || (day >= item.season[0] && day <= item.season[1])) && (lists || needsLists(item) !== 'all'));
  const rank = (item: Suggestion) => because[item.id] ? 0 : item.kids ? (limit !== 'all' ? 1 : 3) : 2;
  return {picks: shown.map((item, at) => ({item, at})).sort((a, b) => rank(a.item) - rank(b.item) || a.at - b.at).map(({item}) => item),
    // How many are held back only for want of an MDBList key.
    locked: lists ? 0 : SUGGESTED.filter(item => !has(item.id) && !item.hide?.includes(limit) && (!item.season || (day >= item.season[0] && day <= item.season[1])) && needsLists(item) === 'all').length};
}
// What a connected account would list. Invented names.
export const ownLists = (person: {trakt: boolean; lists: boolean}) => [
  ...(person.trakt ? [{id: 'tl-rewatch', title: 'Weekend rewatches', kind: 'List · 24 titles', source: 'Trakt · your list'}, {id: 'tl-heist', title: 'Heist nights', kind: 'List · 12 titles', source: 'Trakt · your list'}] : []),
  ...(person.lists ? [{id: 'ml-oscars', title: 'Award winners', kind: 'List · 60 titles', source: 'MDBList · your list'}, {id: 'ml-short', title: 'Under 90 minutes', kind: 'List · 41 titles', source: 'MDBList · your list'}] : []),
];
export const countries = ['Nigeria', 'Ghana', 'South Africa', 'South Korea', 'Japan', 'India', 'France', 'Spain', 'Mexico', 'Turkey', 'United Kingdom'];
export const tongues = ['Yoruba', 'Igbo', 'Hausa', 'Korean', 'Japanese', 'Hindi', 'French', 'Spanish', 'Turkish'];
// Where to get an account. The first two are the site owner's referral links.
export const signUp: Record<string, string> = {'TorBox': 'https://torbox.app/subscription?referral=79f669d0-a38c-4d10-96d7-52864fea5f1e', 'Real-Debrid': 'http://real-debrid.com/?id=14676327', 'AllDebrid': 'https://alldebrid.com/', 'Premiumize': 'https://www.premiumize.me/', 'Debrid-Link': 'https://debrid-link.com/', 'EasyDebrid': 'https://easydebrid.com/'};
export const allServices = ['TorBox', 'Real-Debrid', 'AllDebrid', 'Premiumize', 'Debrid-Link', 'EasyDebrid'];
export const hosts = ['ForTheWeak', 'Midnight', 'ElfHosted', 'Your own'];
// Which sources ship, and in what order, comes from a measurement on staging (40 titles, one host,
// one debrid service). Only sources that work with no setup of their own are listed; anything else is added by its link.
export const defaultAddons = (): Addon[] => [
  {id: 'library', name: 'Your library', note: 'What is already saved in the debrid account. Always checked, always first.', locked: true},
  {id: 'torrentio', name: 'Torrentio', note: 'The widest reach. Almost always has something ready to play.'},
  {id: 'comet', name: 'Comet', note: 'Just as wide, and the quickest to answer.'},
  {id: 'meteor', name: 'Meteor', note: 'Finds the most extra versions of a title the others miss.'},
  {id: 'torz', name: 'StremThru Torz', note: 'A spare, off to start with. It adds very little once the three above are on.'},
];
export const defaultSettings = (): Settings => ({
  quality: 'balanced', maxSizeGb: 25, languages: ['English'], cachedFirst: true, search: 'balanced',
  subtitles: ['English'], skip: true,
  limit: 'all', hideWatched: false, spoilers: false, unreleased: true, posters: 'better', ageBadge: false,
  debrid: 'TorBox', sources: ['library', 'torrentio', 'comet', 'meteor'], formatter: formatter as Template,
});
export interface Resolved {values: Settings; from: Record<keyof Settings, Level>}
export function resolve(hub: Hub, group?: Group, person?: Person): Resolved {
  const values = {...hub.defaults, ...(group?.settings ?? {}), ...(person?.settings ?? {})} as Settings;
  const from = {} as Record<keyof Settings, Level>;
  for (const key of Object.keys({...defaultSettings(), ...hub.defaults}) as (keyof Settings)[]) from[key] = person && key in person.settings ? 'own' : group && key in group.settings ? 'group' : 'hub';
  return {values, from};
}
export const groupRows = (hub: Hub, group: Group) => group.rows ?? hub.rows;
// Trakt rows come with either Trakt connection: the hub's own (history), or the older one made through AIOMetadata (trakt).
export const hasTrakt = (person: Person) => person.trakt || (!!person.history && !person.history.again);
// MDBList rows come with their own key saved, whether or not progress is kept there.
export const hasLists = (person: Person) => person.lists || !!person.listsKept;
/* Where a person's Recently Watched comes from: Trakt connected to the hub, else their MDBList, else what they played here. The
   older Trakt link through AIOMetadata does not count: the hub cannot read it. */
export const sourceOf = (person: Person) => (person.history ? !person.history.again : SAMPLE && person.trakt) ? 'Trakt' : hasLists(person) ? 'MDBList' : 'Played here';
export const personRows = (hub: Hub, person: Person) => rowsOf(person.rows, groupRows(hub, hub.groups.find(item => item.id === person.groupId)!), {trakt: hasTrakt(person), lists: hasLists(person)}, person.picks)
  .map(row => row.id === 'recently-watched' ? {...row, source: sourceOf(person)} : row);

const words = ['maple', 'river', 'copper', 'lantern', 'meadow', 'harbor', 'ember', 'willow', 'pebble', 'comet'];
function seed(text: string) {let h = 11; for (const c of text) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h;}
// Made-up sign-in details in a readable shape. Never a real credential.
export const samplePassword = (text: string) => {const h = seed(text + Math.random()); return `${words[h % 10]}-${words[(h >>> 4) % 10]}-${10 + (h >>> 9) % 90}`;};
export const samplePin = (text: string) => String(100000 + seed(text + Math.random()) % 900000);
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '') || 'person';
export function newPerson(hub: Hub, name: string, groupId: string): Person {
  let id = slug(name); while (hub.people.some(item => item.id === id)) id += '-2';
  return {id, name, groupId, joined: false, trakt: false, lists: false, rows: null, settings: {}, can: {arrange: true, add: true, playback: false}, pin: samplePin(id), password: samplePassword(id), devices: []};
}
const person = (id: string, name: string, groupId: string, extra: Partial<Person>): Person => ({id, name, groupId, joined: true, trakt: false, lists: false, rows: null, settings: {}, can: {arrange: true, add: true, playback: false}, pin: samplePin(id), password: samplePassword(id), devices: [], ...extra});
export const sampleHub = (): Hub => ({
  name: 'Our place', code: 'k7m2', host: 'ForTheWeak', hostUrl: '', services: ['TorBox', 'Real-Debrid'], addons: defaultAddons(), defaults: defaultSettings(), rows: defaultRows(),
  me: {name: 'Sam', theme: 'dark', passkeys: [{id: 'k1', name: 'MacBook', added: '8 Nov'}]},
  groups: [
    {id: 'family', name: 'Family', rows: null, settings: {}},
    {id: 'friends', name: 'Friends', rows: defaultRows().map(r => r.id === 'mixed-genre' ? {...r, on: false} : r), settings: {quality: 'saver', maxSizeGb: 10, debrid: 'Real-Debrid'}},
  ],
  people: [
    person('ada', 'Ada', 'family', {trakt: true, devices: [{id: 'd1', app: 'AIOStreams', name: 'Living room TV', seen: 'Now'}, {id: 'd2', app: 'Streamyfin', name: 'Ada’s iPhone', seen: 'Yesterday'}]}),
    person('ben', 'Ben', 'family', {can: {arrange: true, add: false, playback: false}, settings: {limit: 'kids'}, devices: [{id: 'd3', app: 'AIOStreams', name: 'Ben’s tablet', seen: '2 h ago'}]}),
    person('chi', 'Chi', 'family', {joined: false, can: {arrange: true, add: true, playback: true}}),
    person('dev', 'Dev', 'friends', {trakt: true, lists: true, can: {arrange: true, add: true, playback: true}, devices: [{id: 'd4', app: 'Odin', name: 'Apple TV', seen: 'Now'}]}),
  ],
});

// Invented titles. Activity is what the player last reported, not a full play-by-play log.
export interface Play {art?: string; id: string; personId: string; title: string; detail: string; when: string; day: 'Today' | 'Yesterday' | 'Earlier this week'; progress?: number; on: string; where?: string}
export const samplePlays = (): Play[] => [
  {id: 'p1', personId: 'ada', title: 'Harbor Lights', detail: 'Season 2 · Episode 4', when: 'Now', day: 'Today', progress: 62, on: 'AIOStreams · Living room TV'},
  {id: 'p2', personId: 'dev', title: 'The Quiet Orbit', detail: 'Movie', when: 'Now', day: 'Today', progress: 18, on: 'Odin · Apple TV'},
  {id: 'p3', personId: 'ben', title: 'Paper Kites', detail: 'Movie · finished', when: '2 h ago', day: 'Today', on: 'AIOStreams · Ben’s tablet', where: 'Lagos, NG · SpaceX'},
  {id: 'p4', personId: 'ada', title: 'Harbor Lights', detail: 'Season 2 · Episode 3 · finished', when: '5 h ago', day: 'Today', on: 'AIOStreams · Living room TV'},
  {id: 'p5', personId: 'dev', title: 'North of Nowhere', detail: 'Season 1 · Episode 8 · finished', when: '9:40 pm', day: 'Yesterday', on: 'Odin · Apple TV'},
  {id: 'p6', personId: 'ben', title: 'Small Engines', detail: 'Movie · stopped at 41%', when: '7:15 pm', day: 'Yesterday', progress: 41, on: 'AIOStreams · Ben’s tablet'},
  {id: 'p9', personId: 'ben', title: 'Harbor Lights', detail: 'Season 1 · Episode 1 · finished', when: '4:30 pm', day: 'Yesterday', on: 'AIOStreams · Ben’s tablet'},
  {id: 'p7', personId: 'ada', title: 'Glass Garden', detail: 'Movie · finished', when: 'Tuesday', day: 'Earlier this week', on: 'Streamyfin · Ada’s iPhone'},
  {id: 'p8', personId: 'dev', title: 'North of Nowhere', detail: 'Season 1 · Episode 7 · finished', when: 'Monday', day: 'Earlier this week', on: 'Odin · Apple TV'},
  {id: 'p10', personId: 'dev', title: 'Glass Garden', detail: 'Movie · stopped at 70%', when: 'Monday', day: 'Earlier this week', progress: 70, on: 'Odin · Apple TV'},
];
