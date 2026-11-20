import {useState} from 'react';
import type React from 'react';
import {DragDropProvider} from '@dnd-kit/react';
import {isSortableOperation, useSortable} from '@dnd-kit/react/sortable';
import {TRAKT_IDS, countries, suggestedFor, tongues} from './data';
import type {Cover, Level, Limit, Row} from './data';
import {Art, Chips, NameField, Posters, Segments, Sheet, Switch, hash} from './ui';

type Pick = {id: string; title: string; kind: string; source: string};
export function Grip({handleRef, label}: {handleRef: (element: Element | null) => void; label: string}) {
  return <button type="button" ref={handleRef} className="grip" aria-label={label}><i/><i/><i/></button>;
}
// On a hub or group Home, a Trakt row is a place kept for it: only someone who connects Trakt gets it.
const LATER = 'Appears once someone connects Trakt';
function RowCard({row, index, tag, locked, later, person, onToggle, onRemove, onArrange}: {row: Row; index: number; tag?: string; locked: boolean; later?: boolean; person?: string; onToggle: () => void; onRemove?: () => void; onArrange?: () => void}) {
  const sortable = useSortable({id: row.id, index, disabled: locked});
  return <li ref={sortable.ref} className={`row${sortable.isDragging ? ' dragging' : ''}${locked ? ' locked' : ''}${later ? ' later' : ''}`}>
    {!locked && <Grip handleRef={sortable.handleRef} label={`Move ${row.title}`}/>}
    <div className="row-main">
      <div className="row-head">
        <div><h3>{row.title}{tag && <em className="tag own">{tag}</em>}</h3><p>{later ? `${row.source} · ${LATER}` : `${row.kind} · ${row.source}`}</p></div>
        {!locked && <div className="row-actions">
          {onArrange && <button type="button" className="ghost small" onClick={onArrange}>Edit</button>}
          {onRemove && <button type="button" className="ghost small" onClick={onRemove}>Remove</button>}
          <Switch checked={row.on} onChange={onToggle} label={`Show ${row.title} on Home`}/>
        </div>}
      </div>
      {!later && <Art row={row} person={person}/>}
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
  followLabel?: string; onFollow?: () => void; onBuild?: () => void; canAdd?: boolean; canArrange?: boolean; mine?: boolean;
  /* Whose Home this is, when it is a person's: their own rows' posters show only here. */
  person?: string;
  /* On a real hub: looks a pasted link up, and only what really reaches the player apps is offered. */
  find?: (link: string) => Promise<Pick>; fail?: (text: string) => void;
  /* The content limit this Home is seen under, whether MDBList lists can be read for it, and (a person's own Home, in their own
     view only) which suggestions their watching points to. `keyHint`: what to say when picks wait for an MDBList key. */
  limit?: Limit; listsOk?: boolean; because?: Record<string, string>; keyHint?: React.ReactNode;
}
export function HomeEditor({rows, level, onChange, tag, lists = [], listsHint, followLabel, onFollow, onBuild, canAdd = true, canArrange = true, mine = false, person, find, fail, limit = 'all', listsOk = true, because = {}, keyHint}: HomeProps) {
  const [country, setCountry] = useState(''), [tongue, setTongue] = useState(''), [kinds, setKinds] = useState(['Movies']), [adding, setAdding] = useState(false), [link, setLink] = useState(''), [arranging, setArranging] = useState<string | null>(null);
  const on = rows.filter(row => row.on), off = rows.filter(row => !row.on);
  const set = (id: string, next: Partial<Row>, note: string) => onChange(rows.map(row => row.id === id ? {...row, ...next} : row), note);
  function add(item: Pick) {
    if (rows.some(row => row.id === item.id)) return;
    onChange([{...item, origin: level, on: true}, ...rows], `Added “${item.title}”`); setAdding(false); setLink('');
  }
  const has = (item: Pick) => rows.some(row => row.id === item.id);
  // A person's own lists belong on their own Home only: a hub or group Home never lists anyone's.
  const theirs = level === 'own' ? lists : [], picked = suggestedFor(id => rows.some(row => row.id === id), limit, !find || listsOk, new Date(), level === 'own' ? because : {});
  const folder = rows.find(row => row.id === arranging);
  return <section>
    <div className="section-head"><div><h2>Home</h2><p className="muted">{mine ? 'What you see first when you open the player.' : level === 'own' ? 'What they see first when they open the player.' : 'The Home everyone here starts with.'}{canArrange ? ' Drag to reorder.' : ''}</p></div>{canAdd && <button type="button" className="primary" onClick={() => setAdding(true)}>+ Add row</button>}</div>
    {onFollow && <div className="notice"><span>This Home has its own changes.</span><button type="button" className="link" onClick={onFollow}>{followLabel}</button></div>}
    <p className="pinned"><strong>Always first:</strong> Continue watching and Upcoming. The player adds these itself.</p>
    <DragDropProvider onDragEnd={event => {
      if (event.canceled || !canArrange || !isSortableOperation(event.operation) || !event.operation.source) return;
      const from = on.findIndex(row => row.id === String(event.operation.source!.id)), to = event.operation.source.index;
      if (from >= 0 && from !== to) onChange([...moved(on, from, to), ...off], 'Order saved');
    }}>
      <ol className="rows">{on.map((row, index) => <RowCard key={row.id} row={row} index={index} tag={tag(row)} locked={!canArrange} later={level !== 'own' && TRAKT_IDS.has(row.id)} person={person}
        onToggle={() => set(row.id, {on: false}, `“${row.title}” is off Home`)}
        onArrange={find && !row.covers ? undefined : () => setArranging(row.id)}
        onRemove={row.origin === level && !row.core ? () => onChange(rows.filter(item => item.id !== row.id), `Removed “${row.title}”`) : undefined}/>)}</ol>
    </DragDropProvider>
    {!on.length && <p className="empty">Nothing on Home yet. Add a row or turn one on below.</p>}
    {!!off.length && <details className="off" open={off.length <= 4}><summary>Not on Home <span className="count">{off.length}</span></summary>
      <ul>{off.map(row => <li key={row.id} className={level !== 'own' && TRAKT_IDS.has(row.id) ? 'later' : undefined}>{!(level !== 'own' && TRAKT_IDS.has(row.id)) && <Art row={row} dim person={person}/>}<div><h3>{row.title}</h3><p>{level !== 'own' && TRAKT_IDS.has(row.id) ? `${row.source} · ${LATER}` : `${row.kind} · ${row.source}`}</p></div>{canArrange && <button type="button" className="ghost small" onClick={() => set(row.id, {on: true}, `“${row.title}” is on Home`)}>Show</button>}</li>)}</ul>
    </details>}
    {adding && <Sheet title="Add a row" onClose={() => setAdding(false)}>
      <form className="link-form" onSubmit={event => {
        event.preventDefault(); const text = link.trim(); if (!text) return;
        if (find) return void find(text).then(add, (error: Error) => fail?.(error.message));
        const name = text.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/).filter(Boolean);
        add({id: `link-${hash(text)}`, title: name.slice(-1)[0]?.replace(/[-_]/g, ' ') || 'My list', kind: 'List', source: name[0]?.split('.')[0] ?? 'Link'});
      }}>
        <label htmlFor="add-link">Paste a list link</label>
        <div className="field-row"><input id="add-link" value={link} onChange={event => setLink(event.target.value)} placeholder="Trakt, Letterboxd, MDBList, TMDB…" autoComplete="off"/><button className="primary" disabled={!link.trim()}>Add</button></div>
        {find && <p className="muted small">Any public list from Trakt, Letterboxd, MDBList or TMDB.</p>}
      </form>
      {(!!theirs.length || (!find && listsHint && level === 'own')) && <><h3 className="sheet-sub">{mine ? 'Your lists' : 'Their lists'}</h3>
        {theirs.length ? <ul className="picks compact mine">{theirs.map(item => <li key={item.id}><button type="button" disabled={has(item)} onClick={() => add(item)}><span><strong>{item.title}</strong><small>{has(item) ? 'Added' : `${item.source.split(' · ')[0]} · ${item.kind.replace(/^List · /, '')}`}</small></span></button></li>)}</ul>
          : <p className="muted small">{listsHint}</p>}</>}
      {find && <><h3 className="sheet-sub">Or pick one</h3>
        {picked.picks.length ? <ul className="picks compact suggested">{picked.picks.map(item => <li key={item.id}><button type="button" onClick={() => add({id: item.id, title: item.title, kind: item.kind, source: item.source})}><span><strong>{item.title}</strong><small>{because[item.id] && level === 'own' ? `Because you watched ${because[item.id]}` : item.kind}</small></span></button></li>)}</ul>
          : <p className="muted small">Every pick is already on this Home.</p>}
        {!!picked.locked && <p className="muted small note">{picked.locked} more {picked.locked === 1 ? 'pick reads' : 'picks read'} MDBList lists, so {picked.locked === 1 ? 'it shows' : 'they show'} once there’s an MDBList key. {keyHint}</p>}
      </>}
      {!find && <><h3 className="sheet-sub">From a country or language</h3>
      <form className="region" onSubmit={event => {
        event.preventDefault(); if ((!country && !tongue) || !kinds.length) return;
        const kind = kinds.length > 1 ? 'Both' : kinds[0];
        const what = kind === 'Both' ? 'movies & shows' : kind.toLowerCase(), named = tongue ? `${tongue} ${what}` : what[0].toUpperCase() + what.slice(1);
        add({id: `where-${country}-${tongue}-${kind}`.toLowerCase().replace(/\s+/g, '-'), title: country ? `${named} from ${country}` : named, kind: kind === 'Both' ? 'Movies & shows' : kind === 'Movies' ? 'Movies' : 'Series', source: 'TMDB · popular first'});
      }}>
        <div className="region-picks"><label>Country<select value={country} onChange={event => setCountry(event.target.value)}><option value="">Any</option>{countries.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Language<select value={tongue} onChange={event => setTongue(event.target.value)}><option value="">Any</option>{tongues.map(item => <option key={item}>{item}</option>)}</select></label></div>
        <div className="region-go"><Chips all={['Movies', 'Shows']} value={kinds} onChange={setKinds}/><button className="primary" disabled={(!country && !tongue) || !kinds.length}>Add</button></div>
      </form>
      <h3 className="sheet-sub">Or pick one</h3>
      <ul className="picks">{picked.picks.map(item => <li key={item.id}><button type="button" onClick={() => add({id: item.id, title: item.title, kind: item.kind, source: item.source})}><Posters seed={item.id}/><span><strong>{item.title}</strong><small>{item.kind}</small></span></button></li>)}</ul>
      </>}
      {!mine && onBuild && <p className="muted small foot">Want one that isn’t here? <button type="button" className="link" onClick={onBuild}>Build it in AIOMetadata</button> and it shows up in this list.</p>}
    </Sheet>}
    {folder && <Sheet title={folder.title} onClose={() => setArranging(null)}>
      {!find && <><h3 className="sheet-sub first">Titles already watched</h3>
      <Segments label="Titles already watched" value={folder.watched ?? 'follow'} onChange={value => set(folder.id, {watched: value === 'follow' ? undefined : value}, 'Saved')} options={[{value: 'follow', label: 'Default'}, {value: 'hide', label: 'Hide here'}, {value: 'show', label: 'Show here'}]}/>
      <p className="muted small note">Default uses the “Hide what’s been watched” switch on the Playback tab.</p></>}
      {folder.covers && <><h3 className="sheet-sub">Folders</h3><p className="muted sheet-lead">Drag to choose what comes first. Tap a name to change it. Inside a folder, titles keep the list’s own ranking.</p>
      <DragDropProvider onDragEnd={event => {
        if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return;
        const from = folder.covers!.findIndex(cover => cover.image === String(event.operation.source!.id)), to = event.operation.source.index;
        if (from >= 0 && from !== to) set(folder.id, {covers: moved(folder.covers!, from, to)}, 'Order saved');
      }}><ol className="folders">{folder.covers.map((cover, index) => <FolderItem key={cover.image} cover={cover} index={index} onRename={title => set(folder.id, {covers: folder.covers!.map(item => item.image === cover.image ? {...item, title} : item)}, 'Renamed')}/>)}</ol></DragDropProvider></>}
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
