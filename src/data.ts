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
  limit: 'all' | 'teen' | 'kids'; hideWatched: boolean; spoilers: boolean; unreleased: boolean; posters: 'better' | 'plain';
  debrid: string; sources: string[]; formatter: Template;
}
export type Overrides = Partial<Settings>;
export interface Device {id: string; app: string; name: string; seen: string; where?: string}
export interface Person {v?: number; ready?: boolean; history?: {username: string; again: boolean} | null; aiomTrakt?: boolean; id: string; name: string; groupId: string; joined: boolean; paused?: boolean; trakt: boolean; lists: boolean; rows: Row[] | null; settings: Overrides; can: {arrange: boolean; add: boolean; playback: boolean}; pin: string | null; password: string; devices: Device[]}
export interface Group {v?: number; id: string; name: string; rows: Row[] | null; settings: Overrides; paused?: boolean}
export interface Addon {id: string; name: string; note: string; locked?: boolean; custom?: boolean; url?: string}
export interface Hub {
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
// A person's Trakt rows sit above the shared ones: saved first, then picked for them.
// Up next is off: nothing writes plays back to Trakt yet, so it would fall behind. The player's own Continue watching covers it.
export const traktRows = (): Row[] => [
  {id: 'watchlist', title: 'Watchlist', kind: 'Movies & shows, newest first', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'recommended-movies', title: 'Recommended Movies', kind: 'Movies', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'recommended-series', title: 'Recommended Shows', kind: 'Series', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'up-next', title: 'Up Next', kind: 'Series', source: 'Trakt', origin: 'own', on: false, core: true},
  {id: 'recently-aired', title: 'Recently Aired for You', kind: 'Series', source: 'Trakt', origin: 'own', on: false, core: true},
];
export const isTrakt = (item: Row) => item.source === 'Trakt' || item.source.startsWith('Trakt ·');
export const suggestions = [
  {id: 'sg-nollywood', title: 'Nollywood', kind: 'Movies', source: 'TMDB'},
  {id: 'sg-anime', title: 'Anime This Season', kind: 'Series', source: 'TMDB'},
  {id: 'sg-docs', title: 'Documentaries', kind: 'Movies & shows', source: 'TMDB'},
  {id: 'sg-kids', title: 'Kids & Family', kind: 'Movies & shows', source: 'TMDB'},
  {id: 'sg-4k', title: 'Best in 4K', kind: 'Movies', source: 'TMDB'},
  {id: 'sg-mcu', title: 'Marvel Cinematic Universe', kind: 'Collection', source: 'TMDB'},
  {id: 'sg-starwars', title: 'Star Wars', kind: 'Collection', source: 'TMDB'},
];
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
  limit: 'all', hideWatched: false, spoilers: false, unreleased: true, posters: 'better',
  debrid: 'TorBox', sources: ['library', 'torrentio', 'comet', 'meteor'], formatter: formatter as Template,
});
export interface Resolved {values: Settings; from: Record<keyof Settings, Level>}
export function resolve(hub: Hub, group?: Group, person?: Person): Resolved {
  const values = {...hub.defaults, ...(group?.settings ?? {}), ...(person?.settings ?? {})} as Settings;
  const from = {} as Record<keyof Settings, Level>;
  for (const key of Object.keys(hub.defaults) as (keyof Settings)[]) from[key] = person && key in person.settings ? 'own' : group && key in group.settings ? 'group' : 'hub';
  return {values, from};
}
export const groupRows = (hub: Hub, group: Group) => group.rows ?? hub.rows;
// Trakt rows come with either Trakt connection: the hub's own (history), or the older one made through AIOMetadata (trakt).
export const hasTrakt = (person: Person) => person.trakt || (!!person.history && !person.history.again);
export const personRows = (hub: Hub, person: Person) => person.rows ?? [...(hasTrakt(person) ? traktRows() : []), ...groupRows(hub, hub.groups.find(item => item.id === person.groupId)!)];

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
export interface Play {art?: string; id: string; personId: string; title: string; detail: string; when: string; day: 'Today' | 'Yesterday' | 'Earlier this week'; progress?: number; on: string}
export const samplePlays = (): Play[] => [
  {id: 'p1', personId: 'ada', title: 'Harbor Lights', detail: 'Season 2 · Episode 4', when: 'Now', day: 'Today', progress: 62, on: 'AIOStreams · Living room TV'},
  {id: 'p2', personId: 'dev', title: 'The Quiet Orbit', detail: 'Movie', when: 'Now', day: 'Today', progress: 18, on: 'Odin · Apple TV'},
  {id: 'p3', personId: 'ben', title: 'Paper Kites', detail: 'Movie · finished', when: '2 h ago', day: 'Today', on: 'AIOStreams · Ben’s tablet'},
  {id: 'p4', personId: 'ada', title: 'Harbor Lights', detail: 'Season 2 · Episode 3 · finished', when: '5 h ago', day: 'Today', on: 'AIOStreams · Living room TV'},
  {id: 'p5', personId: 'dev', title: 'North of Nowhere', detail: 'Season 1 · Episode 8 · finished', when: '9:40 pm', day: 'Yesterday', on: 'Odin · Apple TV'},
  {id: 'p6', personId: 'ben', title: 'Small Engines', detail: 'Movie · stopped at 41%', when: '7:15 pm', day: 'Yesterday', progress: 41, on: 'AIOStreams · Ben’s tablet'},
  {id: 'p9', personId: 'ben', title: 'Harbor Lights', detail: 'Season 1 · Episode 1 · finished', when: '4:30 pm', day: 'Yesterday', on: 'AIOStreams · Ben’s tablet'},
  {id: 'p7', personId: 'ada', title: 'Glass Garden', detail: 'Movie · finished', when: 'Tuesday', day: 'Earlier this week', on: 'Streamyfin · Ada’s iPhone'},
  {id: 'p8', personId: 'dev', title: 'North of Nowhere', detail: 'Season 1 · Episode 7 · finished', when: 'Monday', day: 'Earlier this week', on: 'Odin · Apple TV'},
  {id: 'p10', personId: 'dev', title: 'Glass Garden', detail: 'Movie · stopped at 70%', when: 'Monday', day: 'Earlier this week', progress: 70, on: 'Odin · Apple TV'},
];
