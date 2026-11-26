// Shapes shared by the site and the Worker, the defaults a new hub starts with, and the sample data behind the preview.
// The sample data holds no real accounts, keys or viewing history.
import formatter from './formatter.json';
import shipped from './collections.json';
/* The preview (address ends in ?sample) runs entirely on made-up data and saves nothing. */
export const SAMPLE = new URLSearchParams((globalThis as {location?: {search: string}}).location?.search ?? '').has('sample');
export type Level = 'hub' | 'group' | 'own';
export interface Cover {title: string; image: string}
export interface Row {id: string; title: string; kind: string; source: string; origin: Level; on: boolean; core?: boolean; watched?: 'hide' | 'show'; covers?: Cover[];
  /* Site only, never saved: on a person's Home, the kind of today's For you pick in this place (FOR_YOU_KINDS id, or 'popular'). */
  pick?: string}
export interface Template {name: string; description: string}
export interface Settings {
  quality: 'saver' | 'balanced' | 'best'; maxSizeGb: number; languages: string[]; cachedFirst: boolean; search: 'fast' | 'balanced' | 'thorough';
  subtitles: string[]; skip: boolean;
  limit: 'all' | 'teen' | 'kids'; hideWatched: boolean; spoilers: boolean; unreleased: boolean; posters: 'better' | 'plain'; ageBadge?: boolean;
  debrid: string; sources: string[]; formatter: Template;
  // Kinds of For you pick left out (FOR_YOU_KINDS). Missing or empty: every kind may be picked.
  forYouOff?: string[];
  // The kinds of pick in the order they count for (orderOf). Missing or empty: FOR_YOU_ORDER.
  forYouOrder?: string[];
  // Because you watched: from what was watched lately (the four newest titles and two older), or from any time (two and four).
  forYouBecause?: 'lately' | 'any';
}
export type Overrides = Partial<Settings>;
export interface Device {id: string; app: string; name: string; seen: string; place?: string; net?: string}
/* What a For you pick says of itself on the site: its key, kind and name, and what it came from (`why`, worded on the site, so a
   time reads in the viewer's own days). `seed`: the title it was worked out from, which can be left out for good; `keep`: the place
   keeps it at the daily pick. */
export interface Why {title?: string; seen?: number; who?: string; more?: number}
export interface Shown {key: string; kind: string; name: string; why?: Why; seed?: string; keep?: boolean}
/* A person's For you today (foryou.ts): each place's pick, the other options from the day's pick, the kinds with nothing today and
   why ('off', 'limit', 'watching', 'none'), and the titles they never want picked from again. */
export interface ForYouDetail {places: Record<string, Shown>; options: Shown[]; none: Record<string, string>; never: {seed: string; title: string}[]}
/* pickedAt: when their For you places were last picked (unix seconds); shelfAt: when their Trakt lists rows were last worked out,
   0 while they wait to be again; shelfTiles: each list's name and picture (`liked`: one they liked, not their own). */
/* Whether their Trakt sync is on (worker/sync.ts: off, nothing of their watching moves either way), and how that stands: `ask` while they have yet to answer,
   the last good pass, since when it has failed and why, since when a call has waited for Trakt, and until when Trakt asked the
   hub to wait (unix seconds). */
// `earlier`: they agreed to send what they watched here before turning sync on; `passed`: they said "Not now" to that, for the
// plays from before this turning on.
export interface Matching {on: boolean; earlier: boolean; passed?: boolean; ask: boolean; good: number; failing: number | null; why: string | null; waiting: number | null; until?: number}
// hearts: their watchlist as Favorites in the apps (worker/hearts.ts), on or off. Only on a person's own page, and only when it is
// theirs to have: null or missing for anyone else. `extra`: hearts of theirs that their Trakt watchlist lacks, as last counted,
// for the offer to add them (`more`: more than the offer holds).
export interface Person {matching?: Matching | null; hearts?: {on: boolean; extra?: number; more?: boolean} | null; forYou?: Record<string, string>; forYouKinds?: Record<string, string>; pickedAt?: number; forYouDetail?: ForYouDetail; shelfAt?: number; shelfTiles?: {title: string; image: string; liked?: boolean}[]; played?: boolean; moving?: 'mdblist' | 'here' | null; listsKept?: boolean; v?: number; ready?: boolean; history?: {username: string; again: boolean} | null; aiomTrakt?: boolean; listsName?: string; id: string; name: string; groupId: string; joined: boolean; paused?: boolean; trakt: boolean; lists: boolean; rows: Row[] | null; picks?: Record<string, boolean>; settings: Overrides; can: {arrange: boolean; add: boolean; playback: boolean; limit?: boolean}; pin: string | null; password: string; devices: Device[]}
export interface Group {v?: number; id: string; name: string; rows: Row[] | null; settings: Overrides; paused?: boolean}
export interface Addon {id: string; name: string; note: string; locked?: boolean; custom?: boolean; url?: string}
export interface Hub {
  // The five-minute background work (manager only): last run (unix seconds), runs counted, calls waiting for Trakt, the last day the
  // Trakt/MDBList check finished, for how many people, and how many are part way through.
  jobs?: {shelved?: number | null; shelves?: number; shelfDue?: number | null;
    /* Recommended rows worked out by the hub (worker/recs.ts): the last time for anyone here, for how many people, and the oldest still kept. */
    recsAt?: number | null; recs?: number; recsDue?: number | null; last: number | null; runs: number | null; since: number | null; ran: number | null; waiting: number; checked: string | null; people: number; checking: number;
    /* For you (each person's apps on their own AIOMetadata only): people picked for today of everyone, the last pick, whether the
       hub's apps are waiting to be brought in step, and the UTC hour picking starts. */
    picked?: number; pickedAt?: number | null; everyone?: number; syncing?: number; forYouHour?: number;
    /* Trakt sync (worker/sync.ts): the last good pass for anyone here, how many have it on, and about how many minutes pass
       between one person's turns (one person each run across the site). */
    matched?: number | null; matching?: number; syncEvery?: number;
    /* Favorites from Trakt watchlists (worker/hearts.ts): the last look that went well for anyone here, and how many have it on. */
    hearted?: number | null; hearting?: number;
    /* What was watched here and MDBList lacks (worker/sync.ts, leftovers): the last finished look for anyone here, and how many
       have MDBList sync on. */
    listed?: number | null; listers?: number};
  // In a person's view: their manager's own sign-in is set aside in this browser, to go back to.
  manager?: boolean;
  // front: each person's apps sign in to their own AIOMetadata setup; only then are there For you places. forYouHour: the UTC hour
  // the day's For you picking starts.
  front?: boolean; forYouHour?: number; v?: number; serverName?: string; tmdb?: boolean; mdblist?: boolean; scrobble?: boolean; traktClient?: string; metaUrl?: string; missing?: string[]; traktLink?: string; name: string; code: string; host: string; hostUrl: string; services: string[]; addons: Addon[]; defaults: Settings; rows: Row[]; groups: Group[]; people: Person[];
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
// A person's own rows, from their accounts and their watching, sit above the shared ones: saved first, then picked for them.
// Up Next and New for you start off: the player's own Continue watching and Next Up cover most of it.
// One Watchlist, from Trakt, MDBList or both merged. Recommended is Trakt's, or without Trakt worked out from what they watched
// (recs.ts on the Worker). Recently Watched is one row whose source follows their accounts (sourceOf, below).
export const traktRows = (): Row[] => [
  {id: 'watchlist', title: 'Watchlist', kind: 'Movies & shows, newest first', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'recommended-movies', title: 'Recommended Movies', kind: 'Movies', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'recommended-series', title: 'Recommended Shows', kind: 'Series', source: 'Trakt', origin: 'own', on: true, core: true},
  {id: 'up-next', title: 'Up Next', kind: 'Series', source: 'Trakt', origin: 'own', on: false, core: true},
  // New episodes of the shows they watch, and movies on their watchlist that are out to stream now (rows.ts on the Worker).
  {id: 'new-for-you', title: 'New for you', kind: 'Movies & shows, newest first', source: 'Trakt', origin: 'own', on: false, core: true},
  // Looking back comes last: Continue Watching and Next Up already cover picking something up again.
  {id: 'recently-watched', title: 'Recently Watched', kind: 'Movies & shows, latest first', source: 'Trakt', origin: 'own', on: true, core: true},
];
export const TRAKT_IDS = new Set(traktRows().map(row => row.id));
/* What each account-driven row is and how it is put together, as one plain line: shown where the row is edited and in Add row.
   The facts are the Worker's: New for you, Up Next, the Watchlist and Recently Watched in rows.ts, Recommended in rows.ts (Trakt's
   own) and recs.ts (worked out from what was watched), the two rows of Trakt lists in shelf.ts. `source` is the row's own, as
   their Home has it (personRows, below): it says which form a row with more than one takes. `mine`: said to the person
   themselves. A row read from Trakt says so, which keeps the line true with their Trakt sync on or off: with it off Trakt does
   not hear of what is watched here, so such a row goes by what Trakt has from elsewhere. */
export function aboutRow(row: {id: string; source: string}, mine = true): string | undefined {
  const you = mine ? 'you' : 'they', your = mine ? 'your' : 'their', Your = mine ? 'Your' : 'Their', kind = row.id === 'recommended-movies' ? 'Movies' : 'Shows';
  switch (row.id) {
    case 'new-for-you': return `From ${your} Trakt: new episodes of shows ${you} watch and watchlist movies now out to stream, newest first. A title leaves once ${you} start it.`;
    case 'recommended-movies': case 'recommended-series': return row.source === 'What was watched'
      ? `${kind} like the ones ${you} watched lately, a few from each in turn, worked out once a day. What ${you} watched or have on a watchlist is left out.`
      : `${kind} Trakt recommends for ${mine ? 'you' : 'them'}, from ${your} whole Trakt history. What is on ${your} watchlist is left out.`;
    case 'up-next': return `From ${your} Trakt: shows with an episode ${you} haven’t watched yet, the ones ${you} watched most lately first.`;
    case 'watchlist': return row.source === 'Trakt and MDBList' ? `${Your} Trakt and MDBList watchlists as one list, newest added first. A title on both shows once.` : `${Your} ${['MDBList', 'Trakt or MDBList'].includes(row.source) ? row.source : 'Trakt'} watchlist, newest added first.`;
    case 'recently-watched': return `What ${you} watched lately, newest first, each show once. From ${row.source === 'MDBList' ? `${your} MDBList` : row.source === 'Played here' ? `what ${you} played here` : row.source === TRAKT_AND_HERE ? `${your} Trakt history and what ${you} finished here` : `${your} Trakt history`}.`;
    case 'trakt-lists': return `${Your} own Trakt lists, a tile for each. Opening a tile shows that list. Checked once a day.`;
    case 'trakt-liked-lists': return `Trakt lists ${you} liked, a tile for each. Opening a tile shows that list. Checked once a day.`;
  }
  return undefined;
}
/* Which accounts a person has connected: Trakt (to the hub, or the older way through AIOMetadata), and an MDBList key; and whether
   the hub can show something they watched (Trakt connected to the hub, an MDBList key, or a play here). */
export interface Linked {trakt: boolean; lists: boolean; watched: boolean; kids?: boolean; front?: boolean}
/* Whether a person's own row can be filled for them: the Watchlist with Trakt or MDBList, Recently Watched once there is something
   to put in it (from Trakt, else MDBList, else what they played here), Recommended with Trakt or once they watched something,
   the rest with Trakt. */
export const reaches = (id: string, has: Linked) => id === 'recently-watched' ? has.watched : id === 'watchlist' ? has.trakt || has.lists
  : id === 'recommended-movies' || id === 'recommended-series' ? has.trakt || has.watched : has.trakt;
/* The account a row waits for, for Add row to say ("Needs Trakt."): '' when it is filled already, or waits for watching rather
   than an account. */
export const needOf = (id: string, has: Linked) => reaches(id, has) || !TRAKT_IDS.has(id) || id === 'recently-watched' || id.startsWith('recommended-') ? '' : id === 'watchlist' ? 'Trakt or MDBList' : 'Trakt';
/* Rows kept under an id from before: Recently Aired became New for you, and the MDBList watchlist folded into the one Watchlist.
   Nothing kept is rewritten for it. A Home is read as what its rows are now, each in its place and on or off as it was: an old
   row whose new one is on the same Home too joins it (on if either was), and a name nobody changed becomes the new one. A Home
   saved again is saved under the new ids. */
export const WAS: Record<string, string> = {'recently-aired': 'new-for-you', 'mdblist-watchlist': 'watchlist'};
export function current(rows: Row[]): Row[] {
  if (!rows.some(row => WAS[row.id] || row.id === 'watchlist')) return rows;
  const here = new Set(rows.map(row => row.id)), on = new Set(rows.filter(row => row.on).map(row => WAS[row.id] ?? row.id)), now = new Map(traktRows().map(row => [row.id, row]));
  return rows.flatMap(row => {
    const id = WAS[row.id] ?? row.id, to = now.get(id)!;
    if (id !== row.id && here.has(id)) return [];
    // A watchlist kept while two were on says whose it was ("Watchlist · Trakt"): there is one now.
    if (id === 'watchlist') return [{...row, id, title: row.title.replace(/ · (Trakt|MDBList)$/, ''), source: to.source, on: on.has(id)}];
    return id === row.id ? [row] : [{...row, id, title: row.title === 'Recently Aired for You' ? to.title : row.title, kind: to.kind, source: to.source}];
  });
}
/* The same for what someone following the Home above switched on or off for themselves. With Trakt too, the MDBList watchlist
   started off, so only switching it on says anything about the one Watchlist; alone, it was their watchlist. */
export function currentPicks(picks: Record<string, boolean> | undefined, has: Linked): Record<string, boolean> {
  const {'recently-aired': aired, 'mdblist-watchlist': lists, ...out} = picks ?? {};
  if (aired !== undefined) out['new-for-you'] ??= aired;
  if (lists !== undefined && has.lists) {
    if (!has.trakt) out.watchlist = lists;
    else if (lists) out.watchlist = true;
  }
  return out;
}
/* Rows on the same Home with the same name, on together and from different places, each say where they come from ("Top 250 ·
   TMDB", "Top 250 · MDBList"); otherwise the plain name. Only what is shown changes: the name kept stays the plain one. */
const placeOf = (row: Row) => row.source.split(' · ')[0];
const plainName = (row: Row) => {const tail = ` · ${placeOf(row)}`; return row.title.endsWith(tail) ? row.title.slice(0, -tail.length) : row.title;};
export function named(rows: Row[]): Row[] {
  const places = new Map<string, Set<string>>(), key = (row: Row) => plainName(row).trim().toLowerCase();
  for (const row of rows) if (row.on) places.set(key(row), (places.get(key(row)) ?? new Set()).add(placeOf(row)));
  return rows.map(row => {
    const title = row.on && (places.get(key(row))?.size ?? 0) > 1 ? `${plainName(row)} · ${placeOf(row)}` : plainName(row);
    return title === row.title ? row : {...row, title};
  });
}
/* A Home's rows with each of a person's own rows in its place: where this Home put it, else right after the one before it in
   traktRows() (the first at the top). A hub or group Home keeps them even though only someone they can be filled for gets them:
   that is how the manager places them and chooses whether each starts on. */
export function placed(rows: Row[]): Row[] {
  const out = [...current(rows)], all = traktRows();
  all.forEach((row, n) => {if (!out.some(item => item.id === row.id)) out.splice(n ? out.findIndex(item => item.id === all[n - 1].id) + 1 : 0, 0, {...row, origin: 'hub'});});
  return named(out);
}
/* A person's rows: their own Home if they made one, else the Home above with the rows that can be filled for them, each on or off
   as they last chose (`picks`), so switching one keeps them following the Home above. A row they gain after making a Home of their
   own comes at its end, off; the Watchlist at the top, on. */
export function rowsOf(own: Row[] | null, shared: Row[], has: Linked, picks?: Record<string, boolean>): Row[] {
  const fits = (row: Row) => !TRAKT_IDS.has(row.id) || reaches(row.id, has), chosen = currentPicks(picks, has);
  // Under the Kids limit the rows for children come too (see KIDS_IDS), unless this Home has them already.
  if (own) {
    const out = withForYou(current(own).filter(fits), !!has.front);
    if (has.kids) for (const row of kidsRows()) if (!out.some(item => item.id === row.id)) out.push({...row, on: false});
    // The Watchlist, gained with a first account, comes first and on, as a watchlist always did.
    for (const row of traktRows()) if (reaches(row.id, has) && !out.some(item => item.id === row.id)) {if (row.id === 'watchlist') out.unshift(row); else out.push({...row, on: false});}
    return named(out);
  }
  return named(withForYou(withKids(placed(shared), !!has.kids), !!has.front).filter(fits).map(row => pickable(row.id) && chosen[row.id] !== undefined ? {...row, on: chosen[row.id]} : row));
}
/* Collection folders under a content limit, known by their row and cover. Kids get only the folders made for children: the others
   are filtered title by title after fetching, so they come thin, and shows with a rating read loosely slip through. Teen loses Adult
   Animation. The site shows the same folders the player apps get (native.ts). */
const FRK = 'https://raw.githubusercontent.com/itsrenoria/fusion-starter-kit/refs/heads/main/resources/widgets/genres/wide/dannyrutledge/';
const KIDS_ONLY: Record<string, string[]> = {
  'movies-by-genre': [`${FRK}kids-wide.png`, `${FRK}family-movie-night-wide.png`, `${FRK}favorite-cartoons-wide.png`, `${FRK}lovable-monsters-wide.png`, '/covers/20.jpg', '/covers/21.jpg'],
  'shows-by-genre': [`${FRK}kids-wide.png`, `${FRK}nature-wide.png`], 'mixed-genre': ['/covers/33.jpg'],
};
const NOT_FOR_TEEN: Record<string, string[]> = {'movies-by-genre': ['/covers/17.jpg']};
/* By-service folders under a limit come from TMDB's where-to-watch instead of the public lists, asking for rated titles only (and
   for Kids, what is made for children): the lists let mature shows through. Provider ids and regions as AIOMetadata 4.1.0 uses them. */
const SERVICES: Record<string, {provider: string; region: string}> = {
  '/covers/00.jpg': {provider: '350', region: 'GB'}, '/covers/01.jpg': {provider: '8', region: 'GB'}, '/covers/02.jpg': {provider: '337', region: 'GB'}, '/covers/03.jpg': {provider: '1899', region: 'NL'}, '/covers/04.jpg': {provider: '9', region: 'US'}, '/covers/05.jpg': {provider: '2303', region: 'US'},
  '/covers/08.jpg': {provider: '350', region: 'GB'}, '/covers/09.jpg': {provider: '8', region: 'GB'}, '/covers/10.jpg': {provider: '337', region: 'GB'}, '/covers/11.jpg': {provider: '1899', region: 'NL'}, '/covers/12.jpg': {provider: '9', region: 'US'}, '/covers/13.jpg': {provider: '2303', region: 'US'},
};
/* The US ratings each content limit lets through, for movies and for shows: what a TMDB search is asked for under it (native.ts),
   and what a title the hub lists itself must be rated (recs.ts). */
export const CERTS: Record<string, Record<'movie' | 'series', string>> = {kids: {movie: 'G|PG', series: 'TV-Y|TV-Y7|TV-G|TV-PG'}, teen: {movie: 'G|PG|PG-13', series: 'TV-Y|TV-Y7|TV-G|TV-PG|TV-14'}};
export const serviceOf = (row: string, image: string, limit: Limit) => limit !== 'all' && (row === 'movies-by-service' || row === 'shows-by-service') ? SERVICES[image] ?? null : null;
export const folderFits = (row: string, image: string, limit: Limit) => serviceOf(row, image, limit) ? true : limit === 'kids' ? !!KIDS_ONLY[row]?.includes(image) : limit !== 'teen' || !NOT_FOR_TEEN[row]?.includes(image);
/* The rows for children a Home under the Kids limit gets without anyone adding them: on, right after a person's own rows, and
   switched off like a Trakt row (picks) by someone following the Home above. Any Home that has them keeps its own place and choice. */
export const KIDS_IDS = new Set(['sg.kids-channels', 'sg.animation-studios']);
/* A Home's rows with the rows for children added, under the Kids limit, where the Home does not have them already. */
export const withKids = (rows: Row[], kids: boolean) => {
  const young = kids ? kidsRows().filter(row => !rows.some(item => item.id === row.id)) : [], first = rows.findIndex(row => !TRAKT_IDS.has(row.id)), out = [...rows];
  out.splice(first < 0 ? out.length : first, 0, ...young);
  return out;
};
const kidsRows = (): Row[] => [...KIDS_IDS].map(id => suggestionOf(id)!).map(item => ({id: item.id, title: item.title, kind: item.kind, source: item.source, origin: 'hub', on: true}));
/* "For you" places: rows the hub fills for each person every day with something picked for them (foryou.ts on the Worker),
   only where each person's apps sign in to their own AIOMetadata setup. A Home without any gets three, spread through it; a place
   has no name of its own (the pick names it), and Remove only switches it off, to Not on Home, like a Trakt row. More can be added
   from Add row. */
export const PLACE = /^for-you-(\d{1,2})$/;
export const isPlace = (id: string) => PLACE.test(id);
export const placeRow = (n: number, on = true): Row => ({id: `for-you-${n}`, title: 'For you', kind: 'For you', source: 'Picked daily', origin: 'hub', on, core: true});
/* The next free place on a Home. */
export const nextPlace = (rows: Row[]) => {let n = 1; while (rows.some(row => row.id === `for-you-${n}`)) n++; return placeRow(n);};
/* A Home's rows with the three For you places added where it has none: after the second, fifth and eighth of its shared rows that
   are on (a person's own rows, at the top, are not counted), or at the end of a short Home. */
export function withForYou(rows: Row[], front: boolean): Row[] {
  if (!front || rows.some(row => isPlace(row.id))) return rows;
  const out = [...rows];
  for (const [n, after] of [[1, 2], [2, 5], [3, 8]]) {
    let seen = 0, at = out.length;
    for (let i = 0; i < out.length; i++) if (out[i].on && !TRAKT_IDS.has(out[i].id) && !isPlace(out[i].id) && ++seen === after) {at = i + 1; break;}
    out.splice(at, 0, placeRow(n));
  }
  return out;
}
/* The kinds of For you pick, in the order they are offered. `discover`: AIOMetadata fills it from a TMDB search, so it suits a content
   limit; the others are filled by the hub and are left out under one. */
export const FOR_YOU_KINDS: {id: string; title: string; discover: boolean}[] = [
  {id: 'because', title: 'Because you watched', discover: false}, {id: 'series', title: 'Next in a movie series', discover: false},
  {id: 'pickup', title: 'Pick back up', discover: false}, {id: 'crew', title: 'More from a director', discover: true},
  {id: 'genres', title: 'Your genres', discover: true}, {id: 'different', title: 'Something different', discover: true}, {id: 'seasonal', title: 'Seasonal', discover: true},
  {id: 'top10', title: 'Top 10', discover: false},
];
/* The order of the kinds when nobody has changed it: following a series and the person's own watching first. */
export const FOR_YOU_ORDER = ['series', 'pickup', 'because', 'crew', 'genres', 'seasonal', 'top10', 'different'];
/* A saved order made whole: unknown kinds dropped, each kind once, any kind it lacks in its default place among the rest. */
export function orderOf(saved: string[] = []): string[] {
  const out = [...new Set(saved.filter(id => FOR_YOU_ORDER.includes(id)))];
  for (const [at, id] of FOR_YOU_ORDER.entries()) if (!out.includes(id)) out.splice(Math.min(at, out.length), 0, id);
  return out;
}
/* The order For you rows fill in (foryou.ts picks with it; Kinds of pick shows it ahead with it): the best of the first kind in
   `order` that has something, then the best of the next, a kind with nothing skipped; then round again from the top for a second of
   each, and so on. `found` is best first within each kind. A kept pick stays where it is and counts as its kind's pick in that round.
   What follows the last of them (`rest`, the stand-ins) comes after. */
export function fillOrder<T extends {kind: string; key: string}>(found: T[], order: string[], kept: {kind: string; key: string}[] = [], rest: T[] = []): T[] {
  const taken = new Set(kept.map(pick => pick.key)), left = new Map<string, T[]>(), had = new Map<string, number>(), out: T[] = [];
  for (const pick of kept) had.set(pick.kind, (had.get(pick.kind) ?? 0) + 1);
  for (const item of found) if (!taken.has(item.key)) {taken.add(item.key); left.set(item.kind, [...left.get(item.kind) ?? [], item]);}
  for (let round = 0; order.some(kind => left.get(kind)?.length); round++)
    for (const kind of order) if (left.get(kind)?.length && (had.get(kind) ?? 0) <= round) out.push(left.get(kind)!.shift()!);
  return [...out, ...rest.filter(item => !taken.has(item.key))];
}
/* Rows someone following the Home above can switch on or off for themselves. A choice kept under an id from before (WAS) is
   still read (currentPicks). */
export const PICKABLE = new Set([...TRAKT_IDS, ...KIDS_IDS]);
export const pickable = (id: string) => PICKABLE.has(id) || isPlace(id);
/* Where a row's titles come from, as shown: Trending is Trakt's chart, or under a content limit a TMDB search (native.ts). */
export const sourceShown = (row: Row, limit: Limit = 'all') => (row.id === 'trending-movies' || row.id === 'trending-series') && limit === 'all' ? 'Trakt' : row.source;
export const isTrakt = (item: Row) => item.source === 'Trakt' || item.source.startsWith('Trakt ·');
/* ---------- suggested rows ("Ready-made rows" in Add row) ----------
   Each is a real row: its id is the Home row it makes, so one already on a Home shows as on it. A part is one source:
   a public MDBList list (read with the hub's MDBList key, or the person's own), a TMDB collection or a TMDB search (the TMDB key
   only). A row with folders is a collection, one folder per part. Ids and lists were checked on 2026-11-20. */
export type Part = {mdblist: number; type: 'movie' | 'series'} | {collection: number} | {discover: string; type: 'movie' | 'series'; params: Record<string, string>};
export type Limit = Settings['limit'];
export interface Suggestion {
  id: string; title: string; kind: string; source: string; parts: {title: string; part: Part; cover?: string}[];
  // section: where Add row lists it (SECTIONS); hide: limits under which most of it would be filtered out; season: [from, to] as MM-DD.
  section: Section; hide?: Limit[]; season?: [string, string];
}
/* Add row lists the suggestions in small labelled sections, in this order; under a content limit "For children" comes first. */
export const SECTIONS = [{id: 'season', title: 'In season'}, {id: 'worlds', title: 'Worlds and series'}, {id: 'studios', title: 'Studios and channels'},
  {id: 'acclaimed', title: 'Acclaimed and new'}, {id: 'children', title: 'For children'}] as const;
export type Section = typeof SECTIONS[number]['id'];
// AIOMetadata works this out each day (tmdbDiscoverDateTokens.ts): only what is out already.
const TODAY = '__tmdb_date__:today:to';
const tmdbOnly = (parts: Suggestion['parts']) => parts.every(item => !('mdblist' in item.part));
const one = (id: string, title: string, kind: string, part: Part, extra: Partial<Suggestion> & {section: Section}): Suggestion => ({id, title, kind, source: 'mdblist' in part ? 'MDBList' : 'TMDB', parts: [{title, part}], ...extra});
// Folder art for suggested collections, shown as each folder's tile in the apps: Kometa's default images (pinned), and ours where it
// has none (public/covers in this repository; the 2023 CBBC logo is public domain).
const KOMETA = 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/ab842c454921a738121e7744209e38def7e2a27d/';
const OWN_ART = 'https://raw.githubusercontent.com/miraclx/aiohub/main/public/covers/';
const tabs = (id: string, title: string, parts: Suggestion['parts'], extra: Partial<Suggestion> & {section: Section}): Suggestion => ({id, title, kind: `Collection · ${parts.length} folders`, source: tmdbOnly(parts) ? 'TMDB' : 'mdblist' in parts[0].part && parts.every(item => 'mdblist' in item.part) ? 'MDBList' : 'TMDB and MDBList', parts, ...extra});
const list = (id: number, type: 'movie' | 'series', title: string, extra: Partial<Suggestion> & {section: Section}) => one(`mdblist.${id}.${type}`, title, type === 'movie' ? 'Movies' : 'Series', {mdblist: id, type}, extra);
// The order is the fixed popularity order: what most households reach for first.
export const SUGGESTED: Suggestion[] = [
  list(8113, 'movie', 'Christmas Movies', {section: 'season', season: ['11-15', '12-31']}),
  list(41422, 'movie', 'Halloween Movies', {section: 'season', season: ['10-01', '11-01'], hide: ['kids', 'teen']}),
  tabs('sg.star-wars', 'Star Wars', [{title: 'Movies', part: {mdblist: 198749, type: 'movie'}}, {title: 'Shows', part: {mdblist: 202585, type: 'series'}}], {section: 'worlds', hide: ['kids']}),
  tabs('sg.mcu', 'Marvel Cinematic Universe', [{title: 'Movies', part: {discover: 'mcu', type: 'movie', params: {with_keywords: '180547', sort_by: 'primary_release_date.asc', 'primary_release_date.lte': TODAY}}}, {title: 'Shows', part: {mdblist: 32047, type: 'series'}}], {section: 'worlds', hide: ['kids']}),
  tabs('sg.wizarding-world', 'Wizarding World', [{title: 'Harry Potter', part: {collection: 1241}}, {title: 'Fantastic Beasts', part: {collection: 435259}}], {section: 'worlds', hide: ['kids']}),
  tabs('sg.middle-earth', 'Middle-earth', [{title: 'The Lord of the Rings', part: {collection: 119}}, {title: 'The Hobbit', part: {collection: 121938}}], {section: 'worlds', hide: ['kids']}),
  one('sg.bond', 'James Bond', 'Movies, in order', {collection: 645}, {section: 'worlds', hide: ['kids']}),
  one('sg.pixar', 'Pixar', 'Movies', {discover: 'pixar', type: 'movie', params: {with_companies: '3', sort_by: 'popularity.desc', 'with_runtime.gte': '40', 'primary_release_date.lte': TODAY}}, {section: 'studios'}),
  one('sg.ghibli', 'Studio Ghibli', 'Movies', {discover: 'ghibli', type: 'movie', params: {with_companies: '10342', sort_by: 'popularity.desc', 'primary_release_date.lte': TODAY}}, {section: 'studios'}),
  list(33459, 'movie', 'Best Picture Winners', {section: 'acclaimed', hide: ['kids', 'teen']}),
  list(101881, 'movie', 'IMDb Top 250 Movies', {section: 'acclaimed', hide: ['kids', 'teen']}),
  list(101882, 'series', 'IMDb Top 250 Shows', {section: 'acclaimed', hide: ['kids', 'teen']}),
  list(86934, 'movie', 'New on Digital', {section: 'acclaimed', hide: ['kids']}),
  // Kids' TV channels and animation studios, from TMDB (network and company ids checked on 2026-11-21): under a limit each folder
  // asks TMDB for rated titles only, so they come full.
  tabs('sg.kids-channels', 'Kids’ Channels', ([['Disney Channel', 54], ['Disney Junior', 281], ['Disney XD', 44], ['Cartoon Network', 56], ['Nickelodeon', 13], ['Nick Jr.', 35, 'Nick Jr'], ['PBS Kids', 122], ['CBeebies', 166, 'Cbeebies'], ['CBBC', 15, null]] as [string, number, (string | null)?][])
    .map(([title, id, art]) => ({title, cover: art === null ? `${OWN_ART}cbbc.jpg` : `${KOMETA}network/color/${encodeURIComponent(art ?? title)}.jpg`, part: {discover: `network-${id}`, type: 'series' as const, params: {with_networks: String(id), sort_by: 'popularity.desc', 'vote_count.gte': '5'}}})), {section: 'studios'}),
  tabs('sg.animation-studios', 'Animation Studios', ([['Pixar', 3], ['Disney Animation', 6125, 'Walt Disney Animation Studios'], ['DreamWorks', 521, 'DreamWorks Pictures'], ['Illumination', 6704, 'Illumination Entertainment'], ['Sony Animation', 2251, 'Sony Pictures Animation'], ['Studio Ghibli', 10342], ['Aardman', 297], ['LAIKA', 11537, 'Laika Entertainment']] as [string, number, string?][])
    .map(([title, id, art]) => ({title, cover: `${KOMETA}studio/${encodeURIComponent(art ?? title)}.jpg`, part: {discover: `studio-${id}`, type: 'movie' as const, params: {with_companies: String(id), sort_by: 'popularity.desc', 'with_runtime.gte': '40', 'primary_release_date.lte': TODAY}}})), {section: 'studios'}),
  // For children. Suggested only, never on by default. (The hub's "Popular Animated Shows" list is not for children.)
  list(13621, 'movie', 'Kids’ Movies, around 7', {section: 'children'}),
  list(154863, 'series', 'Kids’ Shows, around 7', {section: 'children'}),
  list(185001, 'movie', 'Movies for 9 to 12', {section: 'children'}),
  list(65386, 'series', 'Kids’ Shows, up to 12', {section: 'children'}),
];
export const suggestionOf = (id: string) => SUGGESTED.find(item => item.id === id);
/* Whether a suggestion reads an MDBList list: all of it ('all'), some folders ('some'), or none. */
export const needsLists = (item: Suggestion) => item.parts.every(part => 'mdblist' in part.part) ? 'all' : item.parts.some(part => 'mdblist' in part.part) ? 'some' : 'none';
/* The suggestions for one Home, in order: in season and suited to its content limit, those on it already included (Add row shows
   them as on Home). `because`: suggestion id -> a title the person watched (their own Home only); those lead their section. */
export function suggestedFor(has: (id: string) => boolean, limit: Limit, lists: boolean, today = new Date(), because: Record<string, string> = {}) {
  const day = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fits = (item: Suggestion) => !item.hide?.includes(limit) && (!item.season || (day >= item.season[0] && day <= item.season[1]));
  const shown = SUGGESTED.filter(item => fits(item) && (lists || has(item.id) || needsLists(item) !== 'all'));
  return {picks: shown.map((item, at) => ({item, at})).sort((a, b) => Number(!because[a.item.id]) - Number(!because[b.item.id]) || a.at - b.at).map(({item}) => item),
    // How many are held back only for want of an MDBList key.
    locked: lists ? 0 : SUGGESTED.filter(item => fits(item) && !has(item.id) && needsLists(item) === 'all').length};
}
// What a connected account would list. Invented names.
export const ownLists = (person: {trakt: boolean; lists: boolean}) => [
  ...(person.trakt ? [{id: 'tl-rewatch', title: 'Weekend rewatches', kind: 'List · 24 titles', source: 'Trakt · your list'}, {id: 'tl-heist', title: 'Heist nights', kind: 'List · 12 titles', source: 'Trakt · your list'}] : []),
  ...(person.lists ? [{id: 'ml-oscars', title: 'Award winners', kind: 'List · 60 titles', source: 'MDBList · your list'}, {id: 'ml-short', title: 'Under 90 minutes', kind: 'List · 41 titles', source: 'MDBList · your list'}] : []),
];
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
  debrid: 'TorBox', sources: ['library', 'torrentio', 'comet', 'meteor'], formatter: formatter as Template, forYouOff: [], forYouOrder: [], forYouBecause: 'lately',
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
   older Trakt link through AIOMetadata does not count: the hub cannot read it. With Trakt connected and their Trakt sync off,
   Trakt does not hear of what is watched here, so the row is Trakt's history and what they finished here together (rows.ts). */
export const TRAKT_AND_HERE = 'Trakt and played here';
export const sourceOf = (person: Person) => (person.history ? !person.history.again : SAMPLE && person.trakt) ? (person.history && !person.matching?.on ? TRAKT_AND_HERE : 'Trakt') : hasLists(person) ? 'MDBList' : 'Played here';
/* What can be filled for a person, from their accounts and their watching. */
export const linkedOf = (hub: Hub, person: Person): Linked => ({trakt: hasTrakt(person), lists: hasLists(person), watched: SAMPLE || hasLists(person) || !!person.history && !person.history.again || !!person.played,
  kids: resolve(hub, hub.groups.find(item => item.id === person.groupId), person).values.limit === 'kids', front: !!hub.front});
/* Where each of a person's own rows comes from, as their Home says it: the one Watchlist from whichever of Trakt and MDBList they
   have, Recommended from Trakt or else from what they watched. */
const fromOf = (id: string, person: Person): string | undefined => id === 'recently-watched' ? sourceOf(person)
  : id === 'watchlist' ? (hasTrakt(person) ? hasLists(person) ? 'Trakt and MDBList' : 'Trakt' : 'MDBList')
  : id === 'recommended-movies' || id === 'recommended-series' ? (hasTrakt(person) ? 'Trakt' : 'What was watched') : undefined;
export const personRows = (hub: Hub, person: Person) => rowsOf(person.rows, groupRows(hub, hub.groups.find(item => item.id === person.groupId)!), linkedOf(hub, person), person.picks)
  .map(row => fromOf(row.id, person) ? {...row, source: fromOf(row.id, person)!} : isPlace(row.id) && person.forYou?.[row.id] ? {...row, title: person.forYou[row.id], pick: person.forYouKinds?.[row.id] ?? 'popular'} : row);

const words = ['maple', 'river', 'copper', 'lantern', 'meadow', 'harbor', 'ember', 'willow', 'pebble', 'comet'];
function seed(text: string) {let h = 11; for (const c of text) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h;}
// Made-up sign-in details in a readable shape. Never a real credential.
export const samplePassword = (text: string) => {const h = seed(text + Math.random()); return `${words[h % 10]}-${words[(h >>> 4) % 10]}-${10 + (h >>> 9) % 90}`;};
export const samplePin = (text: string) => String(100000 + seed(text + Math.random()) % 900000);
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '') || 'person';
export function newPerson(hub: Hub, name: string, groupId: string): Person {
  let id = slug(name); while (hub.people.some(item => item.id === id)) id += '-2';
  // Playback is theirs to change from the start, all but the content limit, which their manager opens up separately.
  return {id, name, groupId, joined: false, trakt: false, lists: false, rows: null, settings: {}, can: {arrange: true, add: true, playback: true, limit: false}, pin: samplePin(id), password: samplePassword(id), devices: []};
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
export interface Play {art?: string; id: string; personId: string; title: string; detail: string; when: string; day: 'Today' | 'Yesterday' | 'Earlier this week'; progress?: number; on: string; where?: string; parts?: [number, number][]; ranges?: string[]; mark?: number; line?: string; down?: boolean; stamp?: number}
export const samplePlays = (): Play[] => [
  {id: 'p1', personId: 'ada', title: 'Harbor Lights', detail: 'Season 2 · Episode 4', when: 'Now', day: 'Today', progress: 62, on: 'AIOStreams · Living room TV', parts: [[0, 40], [48, 14]], line: 'Watched 27 of 50 min · skipped 4 min · paused twice'},
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
