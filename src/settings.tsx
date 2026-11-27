import {useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {DragDropProvider} from '@dnd-kit/react';
import {isSortableOperation, useSortable} from '@dnd-kit/react/sortable';
import type {Live} from './live';
import {FIXTURES, FormatterPreviewClient} from 'formatter-preview';
import {FOR_YOU_KINDS, allServices, defaultAddons, fillOrder, orderOf, signUp} from './data';
import type {ForYouDetail, Hub, Level, Resolved, Settings, Shown, Template} from './data';
import {Chips, Confirm, Segments, Setting, Switch, hash} from './ui';
import type {Scope} from './ui';
import {Grip, moved} from './home';

export interface EditorProps {
  hub: Hub; resolved: Resolved; scope: Scope; mine?: boolean;
  set: <K extends keyof Settings>(key: K, value: Settings[K], note?: string) => void;
  reset: (key: keyof Settings) => void;
  update: (change: (hub: Hub) => void) => void; toast: (text: string) => void;
  live?: Live;
  /* On a person's own page: whether their MDBList sync is on, which hiding what's been watched needs. */
  kept?: boolean;
  /* On a person's own page: the content limit is set for them, so it is shown but not changed here. */
  limitSet?: boolean;
}
// Names AIOStreams knows. (Yoruba is not one of them, so it cannot be offered for audio.)
const languages = ['English', 'French', 'Spanish', 'German', 'Portuguese', 'Arabic', 'Hindi', 'Japanese', 'Korean', 'Chinese'];

export function PlaybackEditor({hub, resolved: {values, from}, scope, set, reset, mine, live, kept, limitSet}: EditorProps) {
  const unkept = scope.level === 'own' && !kept;
  const line = (key: keyof Settings) => ({from: from[key], scope, onReset: () => reset(key)});
  const who = scope.level === 'hub' ? 'Everyone starts with these.' : scope.level === 'group' ? `Everyone in ${scope.names.group} starts with these.` : mine ? 'Yours. Anything you have not changed follows the group.' : 'Anything not changed here follows the group.';
  return <section>
    <div className="section-head"><div><h2>Playback</h2><p className="muted">{who}</p></div></div>
    <h3 className="sub first">Picking a stream</h3>
    <div className="card settings">
      <Setting title="Quality" hint={values.quality === 'saver' ? 'Small, efficient files, whatever the resolution: a 4K movie that fits wins. Up to about 3 GB a movie. Starts fastest and suits slower connections.' : values.quality === 'best' ? 'Highest quality available.' : 'Good picture without huge files.'} {...line('quality')}>
        <Segments label="Quality" value={values.quality} onChange={value => set('quality', value)} options={[{value: 'saver', label: 'Data saver'}, {value: 'balanced', label: 'Balanced'}, {value: 'best', label: 'Best'}]}/></Setting>
      <Setting title="Largest file" hint={values.maxSizeGb >= 100 ? 'No limit.' : `Skip anything bigger than ${values.maxSizeGb} GB.`} {...line('maxSizeGb')}>
        <input type="range" min={1} max={100} step={1} value={values.maxSizeGb} aria-label="Largest file in gigabytes" onChange={event => set('maxSizeGb', Number(event.target.value), 'Size limit saved')}/></Setting>
      <Setting column title="Audio languages" hint="Streams in these come first." {...line('languages')}><Chips all={languages} value={values.languages} onChange={value => set('languages', value)}/></Setting>
      <Setting title="Instant streams first" hint="Streams the debrid account already has play at once. The rest make it fetch the file first, which can take minutes." {...line('cachedFirst')}><Switch label="Instant streams first" checked={values.cachedFirst} onChange={value => set('cachedFirst', value)}/></Setting>
      <Setting title="How long to look" hint={values.search === 'fast' ? 'Stop at the first good results. Quickest to start.' : values.search === 'thorough' ? 'Wait for every source to answer.' : 'Stop once the library and the main sources have answered.'} {...line('search')}>
        <Segments label="How long to look" value={values.search} onChange={value => set('search', value)} options={[{value: 'fast', label: 'Fast'}, {value: 'balanced', label: 'Balanced'}, {value: 'thorough', label: 'Thorough'}]}/></Setting>
    </div>
    <h3 className="sub">In the player</h3>
    <div className="card settings">
      <Setting column title="Subtitles" hint="Offered in the player, from OpenSubtitles and from tracks inside the file." {...line('subtitles')}><Chips all={languages} value={values.subtitles} onChange={value => set('subtitles', value)}/></Setting>
      {/* AIOStreams holds this once for the whole setup, so on a real hub it is a Defaults-only switch. */}
      {(!live || scope.level === 'hub') && <Setting title="Skip buttons" hint="Skip intro, recap and credits, where the title has them marked." {...line('skip')}><Switch label="Skip buttons" checked={values.skip} onChange={value => set('skip', value)}/></Setting>}
    </div>
    <h3 className="sub">What shows up</h3>
    <div className="card settings">
      {limitSet ? <Setting title="Content limit" hint="Set for you by whoever runs the hub."><span className="muted">{values.limit === 'kids' ? 'Kids' : values.limit === 'teen' ? 'Teens' : 'Everything'}</span></Setting> : <Setting title="Content limit" hint={values.limit === 'kids' ? 'Only titles rated PG or lower, in rows and in search. Anything without a rating is left out as well, so some rows come up shorter.' : values.limit === 'teen' ? 'Nothing rated above PG-13, in rows or in search.' : 'No limit on ratings.'} {...line('limit')}>
        <Segments label="Content limit" value={values.limit} onChange={value => set('limit', value)} options={[{value: 'kids', label: 'Kids'}, {value: 'teen', label: 'Teens'}, {value: 'all', label: 'Everything'}]}/></Setting>}
 {<Setting title="Hide what’s been watched" hint={unkept ? 'Works once MDBList sync is on, under Accounts. Then rows leave out what’s been watched; watchlists and search still show everything.' : scope.level === 'own' ? 'Rows leave out what’s been watched. Watchlists and search still show everything.' : 'Rows leave out what’s been watched, for anyone with MDBList sync on. Watchlists and search still show everything.'} {...line('hideWatched')}><Switch label="Hide watched" checked={values.hideWatched && !unkept} disabled={unkept} onChange={value => set('hideWatched', value)}/></Setting>}
      <Setting title="Hide episode spoilers" hint="Blurs the pictures of episodes not watched yet." {...line('spoilers')}><Switch label="Hide episode spoilers" checked={values.spoilers} onChange={value => set('spoilers', value)}/></Setting>
      <Setting title="Hide unreleased titles" hint="Nothing that cannot be watched yet." {...line('unreleased')}><Switch label="Hide unreleased titles" checked={values.unreleased} onChange={value => set('unreleased', value)}/></Setting>
      {<Setting title="Posters" hint={values.posters === 'better' ? 'Better Posters: clean art with the rating on it.' : 'Standard art, nothing added.'} {...line('posters')}>
        <Segments label="Posters" value={values.posters} onChange={value => set('posters', value)} options={[{value: 'better', label: 'Better Posters'}, {value: 'plain', label: 'Plain'}]}/></Setting>}
      {values.posters === 'better' && <Setting title="Age rating on posters" hint="Adds the age rating, such as PG-13 or TV-MA, to a corner of each poster." {...line('ageBadge')}><Switch label="Age rating on posters" checked={!!values.ageBadge} onChange={value => set('ageBadge', value)}/></Setting>}
    </div>
  </section>;
}

function Formatter({value, onSave}: {value: Template; onSave: (value: Template) => void}) {
  const [draft, setDraft] = useState(value), [editing, setEditing] = useState(false);
  // One representative sample stream. The engine has others, but choosing between samples is not a setting anyone needs.
  const fixture = 'detailed';
  const [out, setOut] = useState<{name: string; description: string} | null>(null), [error, setError] = useState('');
  const client = useMemo(() => new FormatterPreviewClient(), []);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {client.render(draft, fixture).then(result => {if (live) {setOut(result.output); setError('');}}, (reason: Error) => {if (live && reason.message !== 'Preview cancelled.') setError(reason.message);});}, 250);
    return () => {live = false; clearTimeout(timer);};
  }, [draft, fixture, client]);
  const dirty = draft.name !== value.name || draft.description !== value.description;
  return <div className="formatter">
    <div className="stream-sample" aria-label="How a stream looks">{out ? <><pre className="stream-name">{out.name.trim()}</pre><pre>{out.description.trim()}</pre></> : <p className="muted small">{error || 'Rendering…'}</p>}</div>
    {error && out && <p className="warn small">{error}</p>}
    <div className="formatter-bar">
      <span className="muted small">A sample stream, as the player would list it.</span><button type="button" className="ghost small" onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit'}</button>
    </div>
    {editing && <div className="stack formatter-edit">
      <label htmlFor="fmt-name">Left column</label><textarea id="fmt-name" rows={4} spellCheck={false} value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/>
      <label htmlFor="fmt-desc">Details</label><textarea id="fmt-desc" rows={10} spellCheck={false} value={draft.description} onChange={event => setDraft({...draft, description: event.target.value})}/>
      <div className="split"><button type="button" className="ghost" disabled={!dirty} onClick={() => setDraft(value)}>Discard</button><button type="button" className="primary" disabled={!dirty || !!error} onClick={() => onSave(draft)}>Save</button></div>
    </div>}
  </div>;
}

export function SourcesEditor({hub, resolved: {values, from}, scope, set, reset, update, toast, live}: EditorProps) {
  const service_ = (method: string, name: string, body: unknown, note: string) => void live!.call(method, `/api/services/${encodeURIComponent(name)}`, body).then(() => {toast(note); live!.apps(); return live!.reload();}, (error: Error) => toast(error.message));
  const line = (key: keyof Settings) => ({from: from[key], scope, onReset: () => reset(key)});
  const [service, setService] = useState(''), [key, setKey] = useState(''), [link, setLink] = useState(''), [tmdb, setTmdb] = useState(''), [lists, setLists] = useState(''), [replacing, setReplacing] = useState(''), [fresh, setFresh] = useState('');
  const free = allServices.filter(item => !hub.services.includes(item)), shipped = defaultAddons(); // the wording of a built-in source's note is the site's, not what a hub happened to save
  const [ask, setAsk] = useState<{title: string; body: string; action: string; yes: () => void} | null>(null);
  return <section>
    {ask && <Confirm title={ask.title} body={ask.body} action={ask.action} onYes={() => {const yes = ask.yes; setAsk(null); yes();}} onClose={() => setAsk(null)}/>}
    <div className="section-head"><div><h2>Sources</h2><p className="muted">Where streams come from and how they are listed.</p></div></div>
    {scope.level === 'hub' && <><h3 className="sub first">Debrid accounts</h3>
      <ul className="accounts">{hub.services.map(item => <li key={item}><div><h3>{item}</h3><p>{(names => names ? `Used by ${names}.` : 'No group uses it.')(hub.groups.filter(group => (group.settings.debrid ?? hub.defaults.debrid) === item).map(group => group.name).join(', '))}</p>
        {/* Real-Debrid lets an account stream to one IP at a time; the hub leaves AIOStreams' proxy setting alone, so one set there stays. */}
        {item === 'Real-Debrid' && live && <p className="muted small">Real-Debrid allows one IP at a time, so people watching from different places can trip it. A proxy set in AIOStreams avoids that; its login is under <a className="link" href="#/hub/general">General, Advanced</a>.</p>}</div>
        {live && (replacing === item
          ? <form className="field-row narrow" onSubmit={event => {event.preventDefault(); service_('PUT', item, {key: fresh}, `${item} key replaced`); setReplacing(''); setFresh('');}}><input type="password" aria-label={`New ${item} key`} placeholder="New API key" autoComplete="off" autoFocus value={fresh} onChange={event => setFresh(event.target.value)}/><button className="ghost small" disabled={!fresh.trim()}>Save</button></form>
          : <button type="button" className="ghost small" onClick={() => {setReplacing(item); setFresh('');}}>Replace key</button>)}
        {hub.services.length > 1 && <button type="button" className="ghost small" disabled={values.debrid === item || hub.groups.some(group => group.settings.debrid === item) || hub.people.some(person => person.settings.debrid === item)} title="Move every group off this account first" onClick={() => setAsk({title: `Disconnect ${item}?`, body: `Its key leaves the hub, and nothing plays from ${item} until it is connected again.`, action: 'Disconnect', yes: () => {if (live) return service_('DELETE', item, undefined, `${item} disconnected`); update(next => {next.services = next.services.filter(other => other !== item);}); toast(`${item} disconnected`);}})}>Disconnect</button>}</li>)}
        {!!free.length && <li><form className="connect" onSubmit={event => {event.preventDefault(); const name = service || free[0]; if (live) service_('PUT', name, {key}, `${name} connected`); else {update(next => {next.services.push(name);}); toast(`${name} connected`);} setKey(''); setService('');}}>
          <select aria-label="Service" value={service || free[0]} onChange={event => setService(event.target.value)}>{free.map(item => <option key={item}>{item}</option>)}</select>
          <input type="password" aria-label="API key" placeholder="API key" autoComplete="off" value={key} onChange={event => setKey(event.target.value)}/>
          <button className="ghost small" disabled={!key.trim()}>Connect</button><a className="link small" href={signUp[service || free[0]]} target="_blank" rel="noreferrer">Get an account</a></form></li>}
      </ul></>}
    <div className={`card settings${scope.level === 'hub' ? ' gap' : ''}`}>
      <Setting title="Debrid account" hint={scope.level === 'hub' ? 'The one new groups use.' : 'Which connected account plays the streams.'} {...line('debrid')}>
        {hub.services.length > 1 ? <Segments label="Debrid account" value={values.debrid} onChange={value => set('debrid', value)} options={hub.services.map(item => ({value: item, label: item}))}/> : <span className="pill">{values.debrid}</span>}</Setting>
    </div>
    {live && scope.level === 'hub' && <><h3 className="sub">Catalogs</h3>
      {/* Laid out like the debrid accounts above: what it does, then Replace key once it is connected. */}
      <ul className="accounts">{([
        {id: 'tmdb', name: 'TMDB', on: hub.tmdb, does: 'Builds the Home rows.', missing: 'Missing. Home rows are built from TMDB; the key is free.', get: 'https://www.themoviedb.org/settings/api', value: tmdb, setValue: setTmdb},
        {id: 'mdblist', name: 'MDBList', on: hub.mdblist, does: 'Builds the collection rows (by Service, by Genre) from MDBList lists.', missing: 'Optional. Without it the collection rows (by Service, by Genre) stay out of the player apps. The key is free.', get: 'https://mdblist.com/preferences/', value: lists, setValue: setLists},
      ] as const).map(item => {
        const save = () => void live.call('PUT', `/api/keys/${item.id}`, {key: item.value}).then(() => {item.setValue(''); setReplacing(''); toast(`${item.name} key ${item.on ? 'replaced' : 'saved'}`); live.apps(); return live.reload();}, (error: Error) => toast(error.message));
        const field = (label: string) => <form className="field-row" onSubmit={event => {event.preventDefault(); save();}}><input type="password" aria-label={`${item.name} API key`} placeholder={item.on ? 'New API key' : 'API key'} autoComplete="off" autoFocus={item.on} value={item.value} onChange={event => item.setValue(event.target.value)}/><button className="ghost small" disabled={!item.value.trim()}>{label}</button></form>;
        return <li key={item.id} className={!item.on || replacing === item.id ? 'stacked' : ''}><div><h3>{item.name}</h3><p>{item.on ? item.does : item.missing}</p>{!item.on && <a className="link small" href={item.get} target="_blank" rel="noreferrer">Get a key</a>}</div>
          {!item.on ? field('Connect') : replacing === item.id ? field('Save') : <button type="button" className="ghost small" onClick={() => {setReplacing(item.id); item.setValue('');}}>Replace key</button>}
          {item.on && item.id === 'mdblist' && replacing !== item.id && <button type="button" className="ghost small" onClick={() => setAsk({title: 'Remove the hub’s MDBList key?', body: 'The collections and lists that read MDBList leave everyone’s Home, except for people who connected their own MDBList.', action: 'Remove', yes: () => void live.call('DELETE', '/api/keys/mdblist').then(() => {toast('MDBList key removed'); live.apps(); return live.reload();}, (error: Error) => toast(error.message))})}>Remove</button>}</li>;
      })}</ul></>}
    <h3 className="sub">Stream sources</h3>
    <div className="card settings">
      <Setting column title="Search these" hint="Results from all of them are combined, then sorted by the playback settings." {...line('sources')}>
        <ul className="addons">{hub.addons.map(addon => {const absent = !!hub.missing?.includes(addon.id), on = !absent && (addon.locked || values.sources.includes(addon.id)); return <li key={addon.id}><div><strong>{addon.name}</strong><small>{absent ? 'Not offered by your AIOStreams server.' : shipped.find(item => item.id === addon.id)?.note ?? addon.note}{addon.custom && scope.level === 'hub' && <> <button type="button" className="link" onClick={() => {update(next => {next.addons = next.addons.filter(item => item.id !== addon.id); const drop = (target: {sources?: string[]}) => {if (target.sources) target.sources = target.sources.filter(item => item !== addon.id);}; drop(next.defaults); next.groups.forEach(group => drop(group.settings)); next.people.forEach(person => drop(person.settings));}); toast(`${addon.name} removed`);}}>Remove</button></>}</small></div>
          <Switch label={addon.name} checked={on} disabled={addon.locked || absent} onChange={value => set('sources', value ? [...values.sources, addon.id] : values.sources.filter(item => item !== addon.id))}/></li>;})}</ul>
        <form className="field-row" onSubmit={event => {
          event.preventDefault(); const text = link.trim(); if (!text) return;
          const url = text.replace(/^stremio:\/\//, 'https://'), name = url.replace(/^https?:\/\//, '').split('/')[0], id = `custom-${hash(url)}`;
          if (live && !/^https:\/\/\S+\/manifest\.json(\?\S*)?$/.test(url)) return toast('Paste the https address of the source’s manifest.json');
          if (!hub.addons.some(addon => addon.id === id)) update(next => {next.addons.push({id, name, note: scope.level === 'hub' ? 'Added by link.' : 'Added by link. Remove it under Hub.', custom: true, url});});
          set('sources', [...values.sources.filter(item => item !== id), id], `Added ${name}`); setLink('');
        }}><input aria-label="Addon link" placeholder="Add another by its manifest link" value={link} onChange={event => setLink(event.target.value)} autoComplete="off"/><button className="ghost" disabled={!link.trim()}>Add</button></form>
      </Setting>
    </div>
    <h3 className="sub">How a stream is listed</h3>
    <div className="card settings">
      <Setting column title="Stream label" hint="What each choice looks like in the player’s list of streams." {...line('formatter')}><Formatter value={values.formatter} onSave={value => set('formatter', value, 'Label saved')}/></Setting>
    </div>
  </section>;
}

/* What each kind picks, in a line, for whoever is looking (foryou.ts, candidates, is what this says). */
type Words = {you: string; your: string; youve: string};
const ABOUT: Record<string, (w: Words) => string> = {
  series: w => `The other films of a series ${w.youve} started, from ${w.your} four latest films.`,
  pickup: w => `Shows ${w.you} left partway, last watched between three weeks and a year ago.`,
  because: w => `Titles like one ${w.you} watched. From lately: ${w.your} four latest and two older ones. From any time: ${w.your} two latest and four older.`,
  crew: w => `Films by the directors of ${w.your} two latest films.`,
  genres: w => `Top-rated films in the genre that comes up most in what ${w.you} watched lately.`,
  seasonal: () => 'Christmas or Halloween films, only in season.',
  top10: w => `What’s most watched on Netflix where ${w.you} last played, or worldwide. Not from ${w.your} own watching.`,
  different: w => `Well-rated films in a genre ${w.you} haven’t been watching, a different one each day.`,
};
/* One kind of pick in Kinds of pick: dragged into place, switched on or off, with what it picks. Because you watched says how far
   back it looks. */
function KindLine({id, title, about, index, on, limited, children, onSwitch}: {id: string; title: string; about: string; index: number; on: boolean; limited: boolean; children?: ReactNode; onSwitch: (on: boolean) => void}) {
  const sortable = useSortable({id, index});
  return <li ref={sortable.ref} className={`${sortable.isDragging ? 'dragging' : ''}${!on || limited ? ' dim' : ''}`}>
    <Grip handleRef={sortable.handleRef} label={`Move ${title}`}/>
    <div><strong>{title}</strong><small>{about}</small>{limited && <small>Not under this content limit</small>}{on && !limited && children}</div>
    <Switch label={title} checked={on} onChange={onSwitch}/>
  </li>;
}
/* What a person's For you rows would hold if picked now: today's picks and other options (kept by the daily pick, foryou.ts) laid
   out by this order and these switches, with the daily pick's own rule (fillOrder). Kept rows stay. A place with nothing left
   holds a popular stand-in (undefined). */
function previewOf(detail: ForYouDetail, places: string[], order: string[], off: string[]): {pick?: Shown; kept?: boolean}[] {
  const kept = (place: string) => {const pick = detail.places[place]; return pick?.keep && !off.includes(pick.kind) ? pick : undefined;};
  const today = places.filter(place => !kept(place)).flatMap(place => detail.places[place] ? [detail.places[place]] : []);
  const all = fillOrder([...today, ...detail.options].filter(pick => pick.kind !== 'popular' && !off.includes(pick.kind)), order.filter(kind => !off.includes(kind)), places.flatMap(place => kept(place) ? [kept(place)!] : []));
  let next = 0;
  return places.map(place => kept(place) ? {pick: kept(place), kept: true} : {pick: all[next++]});
}
/* A pick's name after its kind's: "Inception" after "Because you watched", whole when it does not start so. */
const after = (name: string, title: string) => name.startsWith(title) ? name.slice(title.length).replace(/^[\s:]+/, '').replace(/^./, letter => letter.toUpperCase()) : name;
/* What the daily For you rows can pick from, on the Home tab (where those rows are): only where For you places exist, each
   person's apps on their own AIOMetadata setup. Set for the hub or a group, or changed for one person, like any setting. The kinds
   come in order (dragged), and the rows fill from the top of it (fillOrder). Folded to a line until opened. On a person's page it
   shows what their rows would hold if picked now (`preview`), and the titles they left out for good, each of which can count again. */
export function ForYouEditor({hub, resolved: {values, from}, scope, set, reset, mine, never = [], onForget, preview}: EditorProps & {never?: {seed: string; title: string}[]; onForget?: (item: {seed: string; title: string}) => void; preview?: {detail: ForYouDetail; places: string[]}}) {
  const [open, setOpen] = useState(false);
  if (!hub.front) return null;
  const order = orderOf(values.forYouOrder), off = values.forYouOff ?? [], on = order.filter(id => !off.includes(id));
  // Three settings shown as one: it says the nearest level any of them was changed at, and Reset puts all three back.
  const keys = ['forYouOrder', 'forYouOff', 'forYouBecause'] as const, rank: Record<Level, number> = {hub: 0, group: 1, own: 2};
  const at = keys.map(key => from[key]).reduce((a, b) => rank[b ?? 'hub'] > rank[a ?? 'hub'] ? b : a, 'hub' as Level);
  const kind = (id: string) => FOR_YOU_KINDS.find(item => item.id === id)!;
  const words: Words = mine ? {you: 'you', your: 'your', youve: 'you’ve'} : {you: 'they', your: 'their', youve: 'they’ve'};
  const hint = `Rows fill from the top: the first For you row gets the best of the first kind with something today, the next row the next kind, then round again. Drag to change the order. Switched off, a kind isn’t picked.${values.limit !== 'all' ? ' Under a content limit only director, genre, something different and seasonal picks are made.' : ''}`;
  const shown = preview && previewOf(preview.detail, preview.places, order, off);
  return <section>
    <h3 className="sub">For you</h3>
    <div className="card settings">
      <Setting column={open} title="Kinds of pick" hint={open ? hint : on.length ? `${kind(on[0]).title} first · ${on.length} of ${order.length} on` : 'All switched off'} from={at} scope={scope} onReset={() => keys.forEach(key => reset(key))}>
        {!open ? <button type="button" className="ghost small" aria-expanded={false} onClick={() => setOpen(true)}>Change</button> : <>
        <DragDropProvider onDragEnd={event => {
          if (event.canceled || !isSortableOperation(event.operation) || !event.operation.source) return;
          const was = order.indexOf(String(event.operation.source.id)), to = event.operation.source.index;
          if (was >= 0 && was !== to) set('forYouOrder', moved(order, was, to), 'Order saved');
        }}><ol className="kinds">{order.map((id, index) => <KindLine key={id} id={id} title={kind(id).title} about={ABOUT[id](words)} index={index} on={!off.includes(id)} limited={values.limit !== 'all' && !kind(id).discover}
          onSwitch={on => set('forYouOff', on ? off.filter(item => item !== id) : [...off, id], on ? `${kind(id).title} can be picked` : `${kind(id).title} won’t be picked`)}>
          {id === 'because' && <Segments label="Because you watched, from" value={values.forYouBecause ?? 'lately'} onChange={value => set('forYouBecause', value)} options={[{value: 'lately', label: 'From lately'}, {value: 'any', label: 'From any time'}]}/>}
        </KindLine>)}</ol></DragDropProvider>
        {/* Worked out here as the order or a switch changes, from what the hub already has: nothing is asked of it. */}
        {shown && !!shown.length && <div className="if-now" aria-label="If picked now"><h4>If picked now</h4>
          <ol>{shown.map(({pick, kept}, n) => {const title = FOR_YOU_KINDS.find(item => item.id === pick?.kind)?.title ?? 'Popular';
            return <li key={n}><strong>{title}</strong><small>{pick ? after(pick.name, title) || pick.why?.title : 'Until there’s more to go on'}{kept ? ' · kept' : ''}</small></li>;})}</ol>
          <p className="muted small">From today’s options. The daily pick looks again at what {words.you} watched.</p></div>}
        <button type="button" className="ghost small" aria-expanded onClick={() => setOpen(false)}>Done</button></>}
      </Setting>
      {scope.level === 'own' && !!never.length && <Setting column title="Not picked from" hint="Titles left out from a For you row. Nothing is picked from them until they count again.">
        <ul className="never">{never.map(item => <li key={item.seed}><span>{item.title}</span>{onForget && <button type="button" className="ghost small" onClick={() => onForget(item)}>Count again</button>}</li>)}</ul>
      </Setting>}
    </div>
  </section>;
}
