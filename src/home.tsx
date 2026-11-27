import {useState} from 'react';
import type React from 'react';
import {DragDropProvider} from '@dnd-kit/react';
import {isSortableOperation, useSortable} from '@dnd-kit/react/sortable';
import {FOR_YOU_KINDS, SECTIONS, TRAKT_IDS, aboutRow, folderFits, isPlace, nextPlace, pillOf, sourceShown, suggestedFor, suggestionOf} from './data';
import type {Cover, ForYouDetail, Level, Limit, Row, Shown} from './data';
import {Art, Confirm, Covers, NameField, Segments, Sheet, Switch, hash} from './ui';

type Pick = {id: string; title: string; kind: string; source: string};
export function Grip({handleRef, label}: {handleRef: (element: Element | null) => void; label: string}) {
  return <button type="button" ref={handleRef} className="grip" aria-label={label}><i/><i/><i/></button>;
}
// On a hub or group Home, a person's own row is a place kept for it: it fills for each person from their own accounts.
const LATER: Record<string, string> = {
  'recently-watched': 'Fills for each person from Trakt, MDBList or what they play here',
  'watchlist': 'Appears once someone connects Trakt or MDBList. With both, it is one list',
  'recommended-movies': 'Fills for each person from Trakt, or from what they watch', 'recommended-series': 'Fills for each person from Trakt, or from what they watch',
};
const laterOf = (row: Row) => isPlace(row.id) ? 'For you · Picked daily for each person, from what they watch' : LATER[row.id] ?? `${row.source} · Appears once someone connects Trakt`;
// On a hub or group Home a For you place is kept for each person too: what fills it is picked for them every day.
/* On a real person's Home, when their rows that change on their own last did and next will: the UTC hour the day's For you
   picking starts, when they were last picked for, and when their My lists row was last worked out (0 while it waits to be
   again). Unix seconds. */
export interface Times {hour: number; pickedAt?: number; shelfAt?: number; tiles?: {title: string; image: string; liked?: boolean}[]}
// The two rows of a person's Trakt lists: their own, and the ones they liked (shelf.ts on the Worker).
const DAY_MS = 86_400_000, LIKED_ROW = 'trakt-liked-lists', isShelf = (id: string) => id === 'trakt-lists' || id === LIKED_ROW;
// A day in the viewer's own words, and a time with its day when that is not today ("yesterday at 6:04 AM").
const dayOf = (ms: number) => {const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY_MS); return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});};
const atOf = (ms: number) => `${dayOf(ms) === 'today' ? '' : `${dayOf(ms)} `}at ${new Date(ms).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;
/* When a For you place is picked again: the day's picking starts at the hour; someone not picked for since then is on one of the
   next runs (0). Nothing without times (the preview). */
function nextOf(times?: Times) {
  if (!times?.pickedAt) return undefined;
  const now = Date.now(), start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T${String(times.hour).padStart(2, '0')}:00:00Z`);
  return now < start ? start : times.pickedAt * 1000 >= start ? start + DAY_MS : 0;
}
/* A place's line on a person's own Home, under "For you": today's pick, then when it changes, that it is kept, or why a stand-in. */
function pickOf(name: string, kind: string, times?: Times, kept?: boolean) {
  const next = nextOf(times);
  return `Today: ${name} · ${kept ? 'kept' : kind === 'popular' ? 'until there’s more to go on' : next === undefined ? 'picks again each day' : next ? `picks again ${atOf(next)}` : 'picks again soon'}`;
}
/* The same in the row's sheet, in a sentence. */
function againOf(times?: Times) {
  const next = nextOf(times), when = next === undefined ? 'Each day' : next ? atOf(next) : 'Soon';
  return `${when.charAt(0).toUpperCase()}${when.slice(1)} it picks again, and it could be any kind.`;
}
const kindTitle = (kind: string) => FOR_YOU_KINDS.find(item => item.id === kind)?.title ?? 'Popular';
/* When a title was watched, in the viewer's own days: "today", "on Tuesday", "on 3 Nov". */
function seenOf(seconds?: number) {
  if (!seconds) return '';
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(seconds * 1000).setHours(0, 0, 0, 0)) / DAY_MS), at = new Date(seconds * 1000);
  return days <= 0 ? ' today' : days === 1 ? ' yesterday' : days < 7 ? ` on ${at.toLocaleDateString(undefined, {weekday: 'long'})}` : ` on ${at.toLocaleDateString(undefined, {day: 'numeric', month: 'short', ...(at.getFullYear() !== new Date().getFullYear() ? {year: 'numeric'} : {})})}`;
}
/* What a pick came from, in plain words, for whoever is looking (`mine`: their own page). The pick says the facts (foryou.ts);
   a pick made before it did says nothing, rather than its kind again. */
function whyOf(pick: Shown, mine: boolean) {
  const you = mine ? 'you' : 'they', You = mine ? 'You' : 'They', {title = '', seen, who, more = 0} = pick.why ?? {};
  if (pick.kind === 'popular') return 'Popular titles, while there’s too little watched to pick from.';
  if (!pick.why && pick.kind !== 'seasonal') return '';
  return {
    because: `${You} watched it${seenOf(seen)}.`,
    series: `${You} watched ${title}${seenOf(seen)}. ${more === 1 ? 'One more film in the series is out' : `${more} more films in the series are out`}.`,
    pickup: `${title}${more ? ` and ${more} more ${more === 1 ? 'show' : 'shows'}` : ''} ${more ? 'have' : 'has'} episodes ${you} haven’t watched yet.`,
    crew: `${who} directed ${title}, which ${you} watched${seenOf(seen)}.`,
    genres: `${title} comes up most in what ${you} watched lately.`,
    different: `Well liked, and not a genre ${you}’ve been watching.`,
    seasonal: 'In season now.',
    top10: `Most watched on Netflix in ${title} today.`,
  }[pick.kind] ?? '';
}
/* Why a kind has nothing today (foryou.ts): switched off, not under the content limit, too little watched, or nothing left. */
function noneOf(kind: string, code: string, limit: Limit, mine: boolean) {
  if (code === 'off') return 'Switched off';
  if (code === 'limit') return `Not under the ${limit === 'kids' ? 'Kids' : 'Teens'} limit`;
  if (code === 'watching') return 'Not enough watched yet';
  return {because: `Nothing new to suggest from ${mine ? 'your' : 'their'} latest watching`, series: 'No movie series with more to watch', pickup: 'Nothing left partway in the last year', crew: 'No director with enough left to watch',
    genres: 'No genre stands out yet', different: 'Nothing left to suggest today', seasonal: 'No season right now', top10: 'Too little left to watch in the Top 10'}[kind] ?? 'Nothing today';
}
/* My lists and Lists I liked: worked out once a day, and again soon after it is asked for (at 0) or when a day has gone by. */
const listsOf = (at = 0) => !at || Date.now() - at * 1000 >= DAY_MS ? 'Updating now' : `Lists checked ${atOf(at * 1000)} · next check ${dayOf(at * 1000 + DAY_MS)}`;
/* Where a row comes from, by one rule, wherever a row is listed (on Home, under Not on Home, in Add row):
   - from the person's OWN account or watching: a pill says so ("Your Trakt", "What you've watched": pillOf in data.ts), and the
     line under the name keeps only its kind and anything else useful (newest first, when it was last checked);
   - from a PUBLIC source (Trakt trending, TMDB, a collection, a list added by its link): the source in plain text after its kind
     ("Movies · TMDB"), and no pill.
   Never both on one row. `tag` is the other pill, "Yours" for a row the person added themselves: where a row has both, the
   account pill is the one shown. */
const lineOf = (row: Row, limit: Limit, pill?: string) => pill ? kindOf(row) : `${kindOf(row)} · ${sourceShown(row, limit)}`;
// A suggestion's kind as it reads now: rows saved earlier said "tabs" where it says "folders".
const kindOf = (row: Row) => suggestionOf(row.id)?.kind ?? row.kind;
const placeHeld = (row: Row, level: Level) => level !== 'own' && (TRAKT_IDS.has(row.id) || isPlace(row.id));
function RowCard({row, index, tag, pill, locked, later, person, limit = 'all', times, kept, onToggle, onRemove, onArrange}: {row: Row; index: number; tag?: string; pill?: string; locked: boolean; later?: boolean; person?: string; limit?: Limit; times?: Times; kept?: boolean; onToggle: () => void; onRemove?: () => void; onArrange?: () => void}) {
  // Under a content limit only the folders that suit it are shown, as in the player apps.
  const covers = row.covers?.filter(cover => folderFits(row.id, cover.image, limit)), none = !!row.covers?.length && !covers?.length;
  // A suggested collection of tabs has no one catalog to show posters from: its folders' own art instead, as the apps show them.
  // Small copies kept on this site (public/covers/kids), by the art's file name: the apps' own are full size.
  // A row of their Trakt lists shows its lists' own pictures (shelf.ts), wide as in the apps.
  const mine = isShelf(row.id) ? times?.tiles?.filter(tile => !!tile.liked === (row.id === LIKED_ROW)) : undefined, shelf = mine?.length ? mine : undefined;
  const tiles = shelf ?? (!row.covers ? suggestionOf(row.id)?.parts.flatMap(({title, cover}) => cover ? [{title, image: `/covers/kids/${decodeURIComponent(cover.split('/').pop()!).replace(/\.jpg$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`}] : []) : undefined);
  const sortable = useSortable({id: row.id, index, disabled: locked});
  // Rows that are always current (the watchlist, lists, Recently Watched) say nothing of times.
  // A For you place is headed "For you", as on a hub's Home, and says what it holds today: the pick is today's, not the row's.
  // A row whose pill says where it comes from ("Your Trakt") does not say it twice (lineOf).
  const line = row.pick ? pickOf(row.title, row.pick, times, kept) : times && isPlace(row.id) && !times.pickedAt ? 'For you · Picked soon' : times && isShelf(row.id) ? `${pill ? '' : 'Trakt · '}${listsOf(times.shelfAt)}` : lineOf(row, limit, pill);
  const said = later ? undefined : pill ?? tag;
  return <li ref={sortable.ref} className={`row${sortable.isDragging ? ' dragging' : ''}${locked ? ' locked' : ''}${later ? ' later' : ''}`}>
    {!locked && <Grip handleRef={sortable.handleRef} label={`Move ${row.title}`}/>}
    <div className="row-main">
      <div className="row-head">
        <div><h3>{row.pick ? 'For you' : row.title}{said && <em className="tag own">{said}</em>}</h3><p>{later ? laterOf(row) : none ? 'Not shown under this content limit' : line}</p></div>
        {!locked && <div className="row-actions">
          {onArrange && <button type="button" className="ghost small" onClick={onArrange}>Edit</button>}
          {onRemove && <button type="button" className="ghost small" onClick={onRemove}>Remove</button>}
          {!isPlace(row.id) && <Switch checked={row.on} onChange={onToggle} label={`Show ${row.title} on Home`}/>}
        </div>}
      </div>
      {!later && !none && (tiles?.length ? <Covers items={tiles} tall={!shelf}/> : <Art row={covers ? {...row, covers} : row} person={person}/>)}
    </div>
  </li>;
}
function FolderItem({cover, index, onRename}: {cover: Cover; index: number; onRename: (title: string) => void}) {
  const sortable = useSortable({id: cover.image, index});
  return <li ref={sortable.ref} className={sortable.isDragging ? 'dragging' : ''}>
    <Grip handleRef={sortable.handleRef} label={`Move ${cover.title}`}/><span className="folder-art" style={{backgroundImage: `url(${cover.image})`}}/><NameField label={`Name of ${cover.title}`} value={cover.title} onSave={onRename}/>
  </li>;
}
export function moved<T>(list: T[], from: number, to: number) {const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;}

export interface HomeProps {
  rows: Row[]; level: Level; onChange: (rows: Row[], note: string) => void;
  tag: (row: Row) => string | undefined; lists?: Pick[]; listsHint?: string;
  /* On a person's own Home: the pill of a row that comes from their own account or watching (pillOf). */
  pill?: (row: Row) => string | undefined;
  /* On a person's own Home: the rows that wait for an account they have not connected, each with what it needs ("Trakt"), and
     the address of their Accounts tab. Add row lists them greyed, with the way to connect. */
  needs?: {id: string; title: string; needs: string}[]; accounts?: string;
  followLabel?: string; onFollow?: () => void; canAdd?: boolean; canArrange?: boolean; mine?: boolean;
  /* On a person's own page, when they may not add rows: a quiet line where the Add row button would be, saying who can turn it on. */
  addHint?: string;
  /* Whose Home this is, when it is a person's: their own rows' posters show only here. */
  person?: string;
  /* On a real hub: looks a pasted link up, and only what really reaches the player apps is offered. */
  find?: (link: string) => Promise<Pick>; fail?: (text: string) => void;
  /* The content limit this Home is seen under, whether MDBList lists can be read for it, and (a person's own Home, in their own
     view only) which suggestions their watching points to. `keyHint`: what to say when picks wait for an MDBList key. */
  limit?: Limit; listsOk?: boolean; because?: Record<string, string>; keyHint?: React.ReactNode;
  /* Each person's apps sign in to their own AIOMetadata setup: For you places can be added. */
  front?: boolean;
  /* On a person's own Home: stop a kind of For you pick (the For you setting), or move it down their order of kinds (`order`), from
     the place it filled. On a real hub also: when their rows that change on their own last did, their For you today (`forYou`),
     a place asked to change (onPlace: an option, kept or not, a title left out), and their My lists checked now. */
  onMute?: (kind: string) => void; onLess?: (kind: string) => void; order?: string[];
  times?: Times; forYou?: ForYouDetail; onPlace?: (place: string, asked: {use?: string; keep?: boolean; never?: boolean}, note: string) => void; onCheckLists?: () => void;
}
export function HomeEditor({rows, level, onChange, tag, pill, lists = [], listsHint, needs = [], accounts, followLabel, onFollow, canAdd = true, canArrange = true, mine = false, addHint, person, find, fail, limit = 'all', listsOk = true, because = {}, keyHint, front = false, onMute, onLess, order = [], times, forYou, onPlace, onCheckLists}: HomeProps) {
  const [adding, setAdding] = useState(false), [allLists, setAllLists] = useState(false), [link, setLink] = useState(''), [arranging, setArranging] = useState<string | null>(null);
  // A For you row switched off is listed under Not on Home only for someone without Add row, who could not bring one back otherwise;
  // with Add row, "Another For you row" does that, and the For you rows already on Home say there are some.
  const on = rows.filter(row => row.on), off = rows.filter(row => !row.on && !(isPlace(row.id) && canAdd));
  const set = (id: string, next: Partial<Row>, note: string) => onChange(rows.map(row => row.id === id ? {...row, ...next} : row), note);
  // Following the Home above again, or removing a row, throws work away: both ask first.
  const [following, setFollowing] = useState(false), [dropping, setDropping] = useState<Row | null>(null), [placeOpen, setPlaceOpen] = useState<string | null>(null);
  const place = rows.find(row => row.id === placeOpen), placeKind = FOR_YOU_KINDS.find(item => item.id === place?.pick), now = place && forYou?.places[place.id];
  const reason = place ? whyOf(now ?? {key: '', kind: place.pick ?? 'popular', name: place.title}, mine) : '';
  // The day's other options, never one on another of their places; and the kinds with nothing today.
  const options = (forYou?.options ?? []).filter(option => !Object.values(forYou?.places ?? {}).some(pick => pick.key === option.key)).slice(0, 5), none = Object.entries(forYou?.none ?? {});
  const closing = (place: string, asked: {use?: string; keep?: boolean; never?: boolean}, note: string) => {setPlaceOpen(null); onPlace?.(place, asked, note);};
  const apps = mine ? 'Your apps have it in a few minutes.' : 'Their apps have it in a few minutes.';
  function add(item: Pick) {
    if (rows.some(row => row.id === item.id)) return;
    onChange([{...item, origin: level, on: true}, ...rows], `Added “${item.title}”`); setAdding(false); setLink('');
  }
  // A person's own lists are offered to them alone, on their own Home: never on a hub or group Home, nor to their manager.
  const theirs = mine ? lists : [], picked = suggestedFor(id => rows.some(row => row.id === id), limit, !find || listsOk, new Date(), level === 'own' ? because : {});
  const folder = rows.find(row => row.id === arranging), placesOn = rows.filter(row => isPlace(row.id) && row.on).length;
  // Under a content limit the rows for children come first, open; without one they wait folded at the end.
  const sections = [...SECTIONS].sort((a, b) => limit === 'all' ? 0 : Number(b.id === 'children') - Number(a.id === 'children'))
    .map(section => ({...section, items: picked.picks.filter(item => item.section === section.id)})).filter(section => section.items.length);
  // Anything already on this Home stays where it is in Add row, dimmed, saying where it is: groups never shift.
  // An account-driven row (the two rows of their Trakt lists) says what it is instead of its kind (aboutRow, data.ts).
  const choice = (item: Pick, note: string) => {
    const row = rows.find(each => each.id === item.id), at = row && (row.on ? 'On Home' : 'Not on Home'), about = aboutRow(item, mine), own = level === 'own' ? pillOf(item, mine) : undefined;
    if (about && !at) note = about;
    return <li key={item.id}><button type="button" disabled={!!at} onClick={() => add({id: item.id, title: item.title, kind: item.kind, source: item.source})}><span><strong>{item.title}{own && <em className="tag own">{own}</em>}</strong><small>{at || note}</small></span></button></li>;
  };
  return <section>
    <div className="section-head"><div><h2>Home</h2><p className="muted">{mine ? 'What you see first when you open the player.' : level === 'own' ? 'What they see first when they open the player.' : 'The Home everyone here starts with.'}{canArrange ? ' Drag to reorder.' : ''}</p></div>{canAdd ? <button type="button" className="primary" onClick={() => {setAllLists(false); setAdding(true);}}>+ Add row</button> : addHint && <p className="muted small add-hint">{addHint}</p>}</div>
    {onFollow && <div className="notice"><span>This Home has its own changes.</span><button type="button" className="link" onClick={() => setFollowing(true)}>{followLabel}</button></div>}
    {following && onFollow && <Confirm title={`${followLabel}?`} body="This Home’s own changes are dropped: the order, which rows are on, rows added here and any new names. It shows the Home above it again, and follows its changes from then on." action={followLabel ?? 'Follow again'} onYes={() => {setFollowing(false); onFollow();}} onClose={() => setFollowing(false)}/>}
    {dropping && <Confirm title={`Remove “${dropping.title}”?`} body={dropping.covers ? 'It leaves this Home, with its folder order and names. It can be added again from Add row, as it first came.' : 'It leaves this Home. It can be added again from Add row.'} action="Remove" onYes={() => {const row = dropping; setDropping(null); onChange(rows.filter(item => item.id !== row.id), `Removed “${row.title}”`);}} onClose={() => setDropping(null)}/>}
    <p className="pinned"><strong>Always first:</strong> Continue watching and Upcoming. The player adds these itself.</p>
    <DragDropProvider onDragEnd={event => {
      if (event.canceled || !canArrange || !isSortableOperation(event.operation) || !event.operation.source) return;
      const from = on.findIndex(row => row.id === String(event.operation.source!.id)), to = event.operation.source.index;
      if (from >= 0 && from !== to) onChange([...moved(on, from, to), ...off], 'Order saved');
    }}>
      <ol className="rows">{on.map((row, index) => <RowCard key={row.id} row={row} index={index} tag={tag(row)} pill={pill?.(row)} locked={!canArrange} later={placeHeld(row, level)} person={person} limit={limit} times={times} kept={!!forYou?.places[row.id]?.keep}
        onToggle={() => set(row.id, {on: false}, `“${row.title}” is off Home`)}
        onArrange={isPlace(row.id) ? row.pick && (onMute || onPlace) ? () => setPlaceOpen(row.id) : undefined : () => setArranging(row.id)}
        // A For you place is one of several alike: removing it only switches it off, to Not on Home, where Show brings it back
        // (that is arranging, so it needs no Add row).
        onRemove={isPlace(row.id) ? () => set(row.id, {on: false}, 'Removed a For you row') : row.origin === level && !row.core ? () => setDropping(row) : undefined}/>)}</ol>
    </DragDropProvider>
    {!on.length && <p className="empty">Nothing on Home yet. Add a row or turn one on below.</p>}
    {!!off.length && <details className="off" open={off.length <= 4}><summary>Not on Home <span className="count">{off.length}</span></summary>
      <ul>{off.map(row => {const place = placeHeld(row, level);
        const said = place ? undefined : pill?.(row) ?? tag(row);
        return <li key={row.id} className={place ? 'later' : undefined}><div><h3>{row.title}{said && <em className="tag own">{said}</em>}</h3><p>{place ? laterOf(row) : lineOf(row, limit, place ? undefined : pill?.(row))}</p>{/* Off Home there is no Edit to say it in: what the row is, here. */}{!place && aboutRow(row, mine) && <p className="about-row">{aboutRow(row, mine)}</p>}</div>{canArrange && <button type="button" className="ghost small" onClick={() => set(row.id, {on: true}, `“${row.title}” is on Home`)}>Show</button>}</li>;})}</ul>
    </details>}
    {adding && <Sheet title="Add a row" onClose={() => setAdding(false)}>
      <form className="link-form" onSubmit={event => {
        event.preventDefault(); const text = link.trim(); if (!text) return;
        if (find) return void find(text).then(add, (error: Error) => fail?.(error.message));
        const name = text.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/).filter(Boolean);
        add({id: `link-${hash(text)}`, title: name.slice(-1)[0]?.replace(/[-_]/g, ' ') || 'My list', kind: 'List', source: name[0]?.split('.')[0] ?? 'Link'});
      }}>
        <label htmlFor="add-link" className="sheet-sub first">From a link</label>
        <div className="field-row"><input id="add-link" value={link} onChange={event => setLink(event.target.value)} placeholder="Trakt, Letterboxd, MDBList, TMDB…" autoComplete="off"/><button className="primary" disabled={!link.trim()}>Add</button></div>
      </form>
      {(!!theirs.length || (!find && listsHint && mine)) && <><h3 className="sheet-sub">Your lists</h3>
        {/* The first five, the rest a tap away: someone with many lists still sees the ready-made rows without a long scroll. */}
        {theirs.length ? <><ul className="picks compact">{(allLists ? theirs : theirs.slice(0, 5)).map(item => choice(item, pillOf(item, mine) ? item.kind.replace(/^List · /, '') : `${item.source.split(' · ')[0]} · ${item.kind.replace(/^List · /, '')}`))}</ul>
          {theirs.length > 5 && !allLists && <button type="button" className="link more" onClick={() => setAllLists(true)}>Show all {theirs.length}</button>}</>
          : <p className="muted small">{listsHint}</p>}</>}
      {/* Rows an account would add: not to be picked yet, so greyed, each saying what it needs and where to connect it. */}
      {!!needs.length && accounts && <><h3 className="sheet-sub">With an account</h3>
        <ul className="picks compact">{needs.map(item => <li key={item.id} className="needs"><span><strong>{item.title}</strong><small>{aboutRow({id: item.id, source: item.needs}, mine)} Needs {item.needs}.</small></span><a className="link" href={accounts} aria-label={`Connect ${item.needs}, for ${item.title}`}>Connect</a></li>)}</ul></>}
      {!!sections.length && <h3 className="sheet-sub">Ready-made rows</h3>}
      {sections.map(section => {
        const items = <ul className="picks compact">{section.items.map(item => choice(item, because[item.id] && level === 'own' ? `Because you watched ${because[item.id]}` : item.kind === 'Series' ? 'Shows' : item.kind.replace(/^Collection · /, '')))}</ul>;
        return section.id === 'children' ? <details key={section.id} className="pick-section" open={limit !== 'all'}><summary>{section.title} <span className="count">{section.items.length}</span></summary>{items}</details>
          : <div key={section.id} className="pick-section"><h4>{section.title}</h4>{items}</div>;
      })}
      {front && <><h3 className="sheet-sub">For you</h3>
        {/* Never "On Home" like the rest: each tap adds one more, or brings back one that was removed. */}
        <ul className="picks compact"><li><button type="button" onClick={() => {const asleep = rows.find(row => isPlace(row.id) && !row.on); if (asleep) set(asleep.id, {on: true}, `“${asleep.title}” is on Home`); else {const place = nextPlace(rows); onChange([{...place, origin: level}, ...rows], 'Added a For you row');} setAdding(false);}}>
          <span><strong>{placesOn ? 'Another For you row' : 'A For you row'}</strong><small>{mine ? 'Picked for you every day, from what you watch' : 'Picked for each person every day, from what they watch'}{placesOn ? ` · ${placesOn} on Home` : ''}</small></span></button></li></ul></>}
      <div className="muted small foot">
        {!!picked.locked && <p>{picked.locked} more ready-made {picked.locked === 1 ? 'row reads' : 'rows read'} MDBList lists, so {picked.locked === 1 ? 'it shows' : 'they show'} once there’s an MDBList key. {keyHint}</p>}
        {limit !== 'all' && <p>Rows that do not suit this content limit are left out.</p>}
        {level === 'own' && !mine && <p>Their own Trakt and MDBList lists stay private, so only they can add those, from their own page.</p>}
      </div>
    </Sheet>}
    {folder && <Sheet title={folder.title} onClose={() => setArranging(null)}>
      {/* The name shown on Home and in the apps; what fills the row stays the same. */}
      {/* What the row is and how it is put together, for the rows that follow a person's accounts (aboutRow, data.ts). */}
      {aboutRow(folder, mine) && <p className="muted sheet-lead about-row">{aboutRow(folder, mine)}</p>}
      <h3 className="sheet-sub first">Name</h3><NameField label="Name of this row" value={folder.title} onSave={title => set(folder.id, {title}, `Renamed to “${title}”`)}/>
      {/* Checked once a day; a list added or renamed since can be brought in at once. */}
      {isShelf(folder.id) && onCheckLists && <><h3 className="sheet-sub">Lists</h3><p className="sheet-lead">Checked once a day for lists added, removed or renamed on Trakt.</p>
        <button type="button" className="ghost" onClick={() => {setArranging(null); onCheckLists();}}>{mine ? 'Check my lists now' : 'Check their lists now'}</button></>}
      {!find && <><h3 className="sheet-sub">Titles already watched</h3>
      <Segments label="Titles already watched" value={folder.watched ?? 'follow'} onChange={value => set(folder.id, {watched: value === 'follow' ? undefined : value}, 'Saved')} options={[{value: 'follow', label: 'Default'}, {value: 'hide', label: 'Hide here'}, {value: 'show', label: 'Show here'}]}/>
      <p className="muted small note">Default uses the “Hide what’s been watched” switch on the Playback tab.</p></>}
      {folder.covers && <><h3 className="sheet-sub">Folders</h3><p className="muted sheet-lead">Drag to choose what comes first. Tap a name to change it. Inside a folder, titles keep the list’s own ranking.</p>
      <DragDropProvider onDragEnd={event => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return;
        const from = folder.covers!.findIndex(cover => cover.image === String(event.operation.source!.id)), to = event.operation.source.index;
        if (from >= 0 && from !== to) set(folder.id, {covers: moved(folder.covers!, from, to)}, 'Order saved');
      }}><ol className="folders">{folder.covers.map((cover, index) => <FolderItem key={cover.image} cover={cover} index={index} onRename={title => set(folder.id, {covers: folder.covers!.map(item => item.image === cover.image ? {...item, title} : item)}, 'Renamed')}/>)}</ol></DragDropProvider></>}
    </Sheet>}
    {place && <Sheet title="For you" onClose={() => setPlaceOpen(null)}>
      {/* Top to bottom: what the row does and holds today, why, when it picks again or that it is kept (and keeping it), what else
          there is today, what there isn't and why, and less like it. */}
      <div className="sheet-lead story">
        <p>This row picks something new each day from the kinds {mine ? 'you' : 'they'} have on. Today it’s “{place.title}”.</p>
        {reason && <p className="muted">{reason}</p>}
        <p className="muted">{now?.keep ? `Kept: it stays “${place.title}” until you let it change.` : againOf(times)}</p>
        {/* Kept, the place holds this pick at the daily pick until let go; a kind switched off or a content limit still lets it go. */}
        {onPlace && <button type="button" className="ghost" onClick={() => closing(place.id, {keep: !now?.keep}, now?.keep ? 'It changes again from the next daily pick.' : 'Kept. It stays until you let it change.')}>{now?.keep ? 'Let it change again' : `Keep “${place.title}”`}</button>}
      </div>
      {onPlace && <><h3 className="sheet-sub">Today’s other options</h3>
        {/* Already worked out at the day's pick: one goes in at once, as often as wanted. */}
        {options.length ? <ul className="picks compact options">{options.map(option => {
          // The kind, unless the name says it already ("Because you watched …", "Top 10 …"), then why, if known.
          const line = [option.kind === 'popular' || option.name.startsWith(kindTitle(option.kind)) ? '' : kindTitle(option.kind), whyOf(option, mine)].filter(Boolean).join(' · ');
          return <li key={option.key}><button type="button" onClick={() => closing(place.id, {use: option.key}, `“${option.name}” is on this row now. ${apps}`)}><span><strong>{option.name}</strong>{line && <small>{line}</small>}</span></button></li>;
        })}</ul> : <p className="muted small">Nothing else to choose from today.</p>}
        {!!none.length && <details className="none"><summary>Not available today <span className="count">{none.length}</span></summary>
          <ul>{none.map(([kind, code]) => <li key={kind}><strong>{kindTitle(kind)}</strong><small>{noneOf(kind, code, limit, mine)}</small></li>)}</ul></details>}</>}
      {(placeKind && (onLess || onMute) || now?.seed) && <><h3 className="sheet-sub">Less like this</h3>
        <div className="sheet-actions">
          {now?.seed && onPlace && <button type="button" className="ghost" onClick={() => closing(place.id, {never: true}, `Nothing more from “${now.why?.title ?? place.title}”. ${apps}`)}>Not from {now.why?.title ?? 'this title'} again</button>}
          {/* One step down their order of kinds; at the bottom already, it can only be switched off. */}
          {placeKind && (order.indexOf(placeKind.id) < order.length - 1 && onLess ? <button type="button" className="ghost" onClick={() => {setPlaceOpen(null); onLess(placeKind.id);}}>Less “{placeKind.title}”</button>
            : onMute && <button type="button" className="ghost" onClick={() => {setPlaceOpen(null); onMute(placeKind.id);}}>Don’t pick “{placeKind.title}”</button>)}
        </div></>}
      <p className="muted small note">The kinds of pick and their order are under For you, below the rows.</p>
    </Sheet>}
  </section>;
}

/* The order groups are listed in, by dragging. */
function GroupLine({id, name, index}: {id: string; name: string; index: number}) {
  const sortable = useSortable({id, index});
  return <li ref={sortable.ref} className={sortable.isDragging ? 'dragging' : ''}><Grip handleRef={sortable.handleRef} label={`Move ${name}`}/><span>{name}</span></li>;
}
export function GroupOrder({groups, onChange}: {groups: {id: string; name: string}[]; onChange: (from: number, to: number) => void}) {
  return <DragDropProvider onDragEnd={event => {
    if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return;
    const from = groups.findIndex(group => group.id === String(event.operation.source!.id)), to = event.operation.source.index;
    if (from >= 0 && from !== to) onChange(from, to);
  }}><ol className="group-order">{groups.map((group, index) => <GroupLine key={group.id} id={group.id} name={group.name} index={index}/>)}</ol></DragDropProvider>;
}
