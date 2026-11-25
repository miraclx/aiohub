import {useState} from 'react';
import type React from 'react';
import {DragDropProvider} from '@dnd-kit/react';
import {isSortableOperation, useSortable} from '@dnd-kit/react/sortable';
import {FOR_YOU_KINDS, SECTIONS, TRAKT_IDS, folderFits, isPlace, nextPlace, sourceShown, suggestedFor, suggestionOf} from './data';
import type {Cover, Level, Limit, Row} from './data';
import {Art, Confirm, Covers, NameField, Segments, Sheet, Switch, hash} from './ui';

type Pick = {id: string; title: string; kind: string; source: string};
export function Grip({handleRef, label}: {handleRef: (element: Element | null) => void; label: string}) {
  return <button type="button" ref={handleRef} className="grip" aria-label={label}><i/><i/><i/></button>;
}
// On a hub or group Home, a person's own row is a place kept for it: it fills for each person from their own accounts.
const LATER: Record<string, string> = {
  'recently-watched': 'Fills for each person from Trakt, MDBList or what they play here',
  'mdblist-watchlist': 'MDBList · Appears once someone connects MDBList. With Trakt too, it starts off',
};
const laterOf = (row: Row) => isPlace(row.id) ? 'For you · Picked daily for each person, from what they watch' : LATER[row.id] ?? `${row.source} · Appears once someone connects Trakt`;
// On a hub or group Home a For you place is kept for each person too: what fills it is picked for them every day.
/* On a real person's Home, when their rows that change on their own last did and next will: the UTC hour the day's For you
   picking starts, when they were last picked for, the places asked to pick something else today, and when their My Trakt lists
   row was last worked out (0 while it waits to be again). Unix seconds. */
export interface Times {hour: number; pickedAt?: number; redone?: string[]; shelfAt?: number}
const DAY_MS = 86_400_000, SHELF_ROW = 'trakt-lists';
// A day in the viewer's own words, and a time with its day when that is not today ("yesterday at 6:04 AM").
const dayOf = (ms: number) => {const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY_MS); return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});};
const atOf = (ms: number) => `${dayOf(ms) === 'today' ? '' : `${dayOf(ms)} `}at ${new Date(ms).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;
/* On a person's own Home, where today's pick in a place came from, when it was picked and when the next picks come. The day's
   picking starts at the hour; someone not picked for since then is on one of the next runs. The preview has no times. */
function pickOf(kind: string, times?: Times) {
  if (kind === 'popular') return 'Popular, until there’s more to go on';
  const title = FOR_YOU_KINDS.find(item => item.id === kind)?.title ?? 'Picked';
  if (!times?.pickedAt) return `${title} · new each day`;
  const now = Date.now(), start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T${String(times.hour).padStart(2, '0')}:00:00Z`);
  const next = now < start ? start : times.pickedAt * 1000 >= start ? start + DAY_MS : 0;
  return `${title} · picked ${atOf(times.pickedAt * 1000)} · ${next ? `new picks ${atOf(next)}` : 'new picks soon'}`;
}
/* My Trakt lists: worked out once a day, and again soon after it is asked for (at 0) or when a day has gone by. */
const listsOf = (at = 0) => !at || Date.now() - at * 1000 >= DAY_MS ? 'Trakt · Updating now' : `Trakt · Lists checked ${atOf(at * 1000)} · next check ${dayOf(at * 1000 + DAY_MS)}`;
// A suggestion's kind as it reads now: rows saved earlier said "tabs" where it says "folders".
const kindOf = (row: Row) => suggestionOf(row.id)?.kind ?? row.kind;
const placeHeld = (row: Row, level: Level) => level !== 'own' && (TRAKT_IDS.has(row.id) || isPlace(row.id));
function RowCard({row, index, tag, locked, later, person, limit = 'all', times, onToggle, onRemove, onArrange}: {row: Row; index: number; tag?: string; locked: boolean; later?: boolean; person?: string; limit?: Limit; times?: Times; onToggle: () => void; onRemove?: () => void; onArrange?: () => void}) {
  // Under a content limit only the folders that suit it are shown, as in the player apps.
  const covers = row.covers?.filter(cover => folderFits(row.id, cover.image, limit)), none = !!row.covers?.length && !covers?.length;
  // A suggested collection of tabs has no one catalog to show posters from: its folders' own art instead, as the apps show them.
  // Small copies kept on this site (public/covers/kids), by the art's file name: the apps' own are full size.
  const tiles = !row.covers ? suggestionOf(row.id)?.parts.flatMap(({title, cover}) => cover ? [{title, image: `/covers/kids/${decodeURIComponent(cover.split('/').pop()!).replace(/\.jpg$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`}] : []) : undefined;
  const sortable = useSortable({id: row.id, index, disabled: locked});
  // Rows that are always current (the watchlist, lists, Recently Watched) say nothing of times.
  const line = row.pick ? `For you · ${pickOf(row.pick, times)}` : times && isPlace(row.id) && !times.pickedAt ? 'For you · Picked soon' : times && row.id === SHELF_ROW ? listsOf(times.shelfAt) : `${kindOf(row)} · ${sourceShown(row, limit)}`;
  return <li ref={sortable.ref} className={`row${sortable.isDragging ? ' dragging' : ''}${locked ? ' locked' : ''}${later ? ' later' : ''}`}>
    {!locked && <Grip handleRef={sortable.handleRef} label={`Move ${row.title}`}/>}
    <div className="row-main">
      <div className="row-head">
        <div><h3>{row.title}{tag && <em className="tag own">{tag}</em>}</h3><p>{later ? laterOf(row) : none ? 'Not shown under this content limit' : line}</p></div>
        {!locked && <div className="row-actions">
          {onArrange && <button type="button" className="ghost small" onClick={onArrange}>Edit</button>}
          {onRemove && <button type="button" className="ghost small" onClick={onRemove}>Remove</button>}
          {!isPlace(row.id) && <Switch checked={row.on} onChange={onToggle} label={`Show ${row.title} on Home`}/>}
        </div>}
      </div>
      {!later && !none && (tiles?.length ? <Covers items={tiles} tall/> : <Art row={covers ? {...row, covers} : row} person={person}/>)}
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
  followLabel?: string; onFollow?: () => void; canAdd?: boolean; canArrange?: boolean; mine?: boolean;
  /* Whose Home this is, when it is a person's: their own rows' posters show only here. */
  person?: string;
  /* On a real hub: looks a pasted link up, and only what really reaches the player apps is offered. */
  find?: (link: string) => Promise<Pick>; fail?: (text: string) => void;
  /* The content limit this Home is seen under, whether MDBList lists can be read for it, and (a person's own Home, in their own
     view only) which suggestions their watching points to. `keyHint`: what to say when picks wait for an MDBList key. */
  limit?: Limit; listsOk?: boolean; because?: Record<string, string>; keyHint?: React.ReactNode;
  /* Each person's apps sign in to their own AIOMetadata setup: For you places can be added. */
  front?: boolean;
  /* On a person's own Home: stop a kind of For you pick (the For you setting), from the place it filled. On a real hub also: when
     their rows that change on their own last did, have one place picked again, and have their My Trakt lists checked now. */
  onMute?: (kind: string) => void;
  times?: Times; onRedo?: (place: string) => void; onCheckLists?: () => void;
}
export function HomeEditor({rows, level, onChange, tag, lists = [], listsHint, followLabel, onFollow, canAdd = true, canArrange = true, mine = false, person, find, fail, limit = 'all', listsOk = true, because = {}, keyHint, front = false, onMute, times, onRedo, onCheckLists}: HomeProps) {
  const [adding, setAdding] = useState(false), [allLists, setAllLists] = useState(false), [link, setLink] = useState(''), [arranging, setArranging] = useState<string | null>(null);
  const on = rows.filter(row => row.on), off = rows.filter(row => !row.on);
  const set = (id: string, next: Partial<Row>, note: string) => onChange(rows.map(row => row.id === id ? {...row, ...next} : row), note);
  // Following the Home above again, or removing a row, throws work away: both ask first.
  const [following, setFollowing] = useState(false), [dropping, setDropping] = useState<Row | null>(null), [placeOpen, setPlaceOpen] = useState<string | null>(null);
  const place = rows.find(row => row.id === placeOpen), placeKind = FOR_YOU_KINDS.find(item => item.id === place?.pick), redone = !!place && !!times?.redone?.includes(place.id);
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
  const choice = (item: Pick, note: string) => {
    const row = rows.find(each => each.id === item.id), at = row && (row.on ? 'On Home' : 'Not on Home');
    return <li key={item.id}><button type="button" disabled={!!at} onClick={() => add({id: item.id, title: item.title, kind: item.kind, source: item.source})}><span><strong>{item.title}</strong><small>{at || note}</small></span></button></li>;
  };
  return <section>
    <div className="section-head"><div><h2>Home</h2><p className="muted">{mine ? 'What you see first when you open the player.' : level === 'own' ? 'What they see first when they open the player.' : 'The Home everyone here starts with.'}{canArrange ? ' Drag to reorder.' : ''}</p></div>{canAdd && <button type="button" className="primary" onClick={() => {setAllLists(false); setAdding(true);}}>+ Add row</button>}</div>
    {onFollow && <div className="notice"><span>This Home has its own changes.</span><button type="button" className="link" onClick={() => setFollowing(true)}>{followLabel}</button></div>}
    {following && onFollow && <Confirm title={`${followLabel}?`} body="This Home’s own changes are dropped: the order, which rows are on, rows added here and any new names. It shows the Home above it again, and follows its changes from then on." action={followLabel ?? 'Follow again'} onYes={() => {setFollowing(false); onFollow();}} onClose={() => setFollowing(false)}/>}
    {dropping && <Confirm title={`Remove “${dropping.title}”?`} body={dropping.covers ? 'It leaves this Home, with its folder order and names. It can be added again from Add row, as it first came.' : 'It leaves this Home. It can be added again from Add row.'} action="Remove" onYes={() => {const row = dropping; setDropping(null); onChange(rows.filter(item => item.id !== row.id), `Removed “${row.title}”`);}} onClose={() => setDropping(null)}/>}
    <p className="pinned"><strong>Always first:</strong> Continue watching and Upcoming. The player adds these itself.</p>
    <DragDropProvider onDragEnd={event => {
      if (event.canceled || !canArrange || !isSortableOperation(event.operation) || !event.operation.source) return;
      const from = on.findIndex(row => row.id === String(event.operation.source!.id)), to = event.operation.source.index;
      if (from >= 0 && from !== to) onChange([...moved(on, from, to), ...off], 'Order saved');
    }}>
      <ol className="rows">{on.map((row, index) => <RowCard key={row.id} row={row} index={index} tag={tag(row)} locked={!canArrange} later={placeHeld(row, level)} person={person} limit={limit} times={times}
        onToggle={() => set(row.id, {on: false}, `“${row.title}” is off Home`)}
        onArrange={isPlace(row.id) ? row.pick && (onMute || onRedo) ? () => setPlaceOpen(row.id) : undefined : () => setArranging(row.id)}
        // A For you place is one of several alike: removing it only switches it off, to Not on Home, where Show brings it back
        // (that is arranging, so it needs no Add row).
        onRemove={isPlace(row.id) ? () => set(row.id, {on: false}, 'Removed a For you row') : row.origin === level && !row.core ? () => setDropping(row) : undefined}/>)}</ol>
    </DragDropProvider>
    {!on.length && <p className="empty">Nothing on Home yet. Add a row or turn one on below.</p>}
    {!!off.length && <details className="off" open={off.length <= 4}><summary>Not on Home <span className="count">{off.length}</span></summary>
      <ul>{off.map(row => {const place = placeHeld(row, level);
        return <li key={row.id} className={place ? 'later' : undefined}><div><h3>{row.title}</h3><p>{place ? laterOf(row) : `${kindOf(row)} · ${sourceShown(row, limit)}`}</p></div>{canArrange && <button type="button" className="ghost small" onClick={() => set(row.id, {on: true}, `“${row.title}” is on Home`)}>Show</button>}</li>;})}</ul>
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
        {theirs.length ? <><ul className="picks compact">{(allLists ? theirs : theirs.slice(0, 5)).map(item => choice(item, `${item.source.split(' · ')[0]} · ${item.kind.replace(/^List · /, '')}`))}</ul>
          {theirs.length > 5 && !allLists && <button type="button" className="link more" onClick={() => setAllLists(true)}>Show all {theirs.length}</button>}</>
          : <p className="muted small">{listsHint}</p>}</>}
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
      <h3 className="sheet-sub first">Name</h3><NameField label="Name of this row" value={folder.title} onSave={title => set(folder.id, {title}, `Renamed to “${title}”`)}/>
      {/* Checked once a day; a list added or renamed since can be brought in at once. */}
      {folder.id === SHELF_ROW && onCheckLists && <><h3 className="sheet-sub">Lists</h3><p className="sheet-lead">Checked once a day for lists added, removed or renamed on Trakt.</p>
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
    {place && <Sheet title={place.title} onClose={() => setPlaceOpen(null)}>
      {/* A place is re-picked every day from the kinds left on; stopping a kind here is the same as leaving it out under For you below. */}
      <h3 className="sheet-sub first">Picked from</h3>
      <p className="sheet-lead">{placeKind ? `${placeKind.title}.` : 'Popular titles, while there’s too little watched to pick from.'} Each day this place gets a new pick{onRedo ? ', and something else can be asked for once a day' : ''}.</p>
      {/* Once a place a day: this place alone gets another pick on the next run, the others stay as they are. */}
      {onRedo && <button type="button" className="ghost" disabled={redone} onClick={() => {setPlaceOpen(null); onRedo(place.id);}}>{redone ? 'Picked something else today' : 'Pick something else'}</button>}
      {placeKind && onMute && <button type="button" className="ghost" onClick={() => {setPlaceOpen(null); onMute(placeKind.id);}}>Don’t pick {placeKind.title}</button>}
      <p className="muted small note">All the kinds are under For you, below the rows.</p>
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
