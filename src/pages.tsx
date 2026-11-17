import {useEffect, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {SAMPLE, allServices, signUp, defaultRows, defaultSettings, groupRows, hosts, isTrakt, newPerson, ownLists, personRows, resolve, samplePassword, samplePin, slug, traktRows} from './data';
import type {Group, Hub, Person, Row, Settings} from './data';
import {Activity} from './activity';
import {GroupOrder, HomeEditor, moved} from './home';
import {PlaybackEditor, SourcesEditor} from './settings';
import type {EditorProps} from './settings';
import {addPasskey, canPasskey, usePasskey} from './live';
import type {Live} from './live';
import {Avatar, NameField, Secret, Segments, Setting, Sheet, Switch, Tabs, addReal} from './ui';

/* `live` is there when the page is backed by the real hub; without it everything runs on the preview's sample data. */
export interface PageProps {hub: Hub; go: (to: string) => void; update: (change: (hub: Hub) => void) => void; toast: (text: string) => void; live?: Live}
const HUB = 'Everyone';
const soon = (toast: (text: string) => void, what: string) => () => toast(`Preview: this opens ${what}`);
const fail = (toast: (text: string) => void) => (error: Error) => toast(error.message);

/* A person's sign-in details. On the real hub they are fetched for one person at a time, only when a page shows them. */
interface Creds {password: string; pin: string | null; link: string}
function useCreds({live}: PageProps, person: Person): [Creds | null, () => void] {
  const [creds, setCreds] = useState<Creds | null>(null), [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!live) return; let on = true;
    void live.settled().then(() => live.call<Creds>('GET', `/api/people/${person.id}/signin`)).then(found => {if (on) setCreds(found);}, () => {});
    return () => {on = false;};
  }, [live, person.id, turn]);
  return [live ? creds : {password: person.password, pin: person.pin, link: `${location.origin}/${location.search}#/join/${person.id}`}, () => setTurn(turn + 1)];
}
function PasswordSheet({onClose, onSave, toast}: {onClose: () => void; onSave: (old: string, next: string) => Promise<unknown>; toast: (text: string) => void}) {
  const [old, setOld] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false);
  return <Sheet title="Change password" onClose={onClose}><form className="stack" onSubmit={event => {event.preventDefault(); if (next.length < 8) return toast('The new password needs at least 8 characters'); if (busy) return; setBusy(true); void onSave(old, next).then(() => {toast('Password changed'); onClose();}, error => {fail(toast)(error); setBusy(false);});}}>
    <label htmlFor="pw-old">Current password</label><input id="pw-old" type="password" value={old} onChange={event => setOld(event.target.value)} autoComplete="current-password" autoFocus/>
    <label htmlFor="pw-new">New password</label><input id="pw-new" type="password" value={next} onChange={event => setNext(event.target.value)} autoComplete="new-password" />
    <p className={`small ${next && next.length < 8 ? 'warn' : 'muted'}`}>At least 8 characters{next && next.length < 8 ? `: ${8 - next.length} more to go` : ''}.</p>
    <button className="primary" disabled={busy || !old || !next}>{busy ? 'Changing…' : 'Change password'}</button>
  </form></Sheet>;
}

/* One set of editor props for any level. Changing a value stores it at that level; reset drops it again. */
function editor({hub, update, toast, live}: PageProps, group?: Group, person?: Person, mine?: boolean): EditorProps {
  const level = person ? 'own' : group ? 'group' : 'hub';
  const target = (next: Hub) => person ? next.people.find(item => item.id === person.id)!.settings : group ? next.groups.find(item => item.id === group.id)!.settings : next.defaults;
  return {
    hub, update, toast, live, mine, resolved: resolve(hub, group, person), scope: {level, names: {hub: HUB, group: group?.name ?? ''}},
    set: (key, value, note = 'Saved') => {update(next => {(target(next) as Partial<Settings>)[key] = value;}); toast(note);},
    reset: key => {update(next => {delete (target(next) as Partial<Settings>)[key];}); toast(`Following ${person ? group!.name : HUB} again`);},
  };
}
function Confirm({title, body, action, onYes, onClose}: {title: string; body: string; action: string; onYes: () => void; onClose: () => void}) {
  return <Sheet title={title} onClose={onClose}><p className="muted sheet-lead">{body}</p><div className="split"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button type="button" className="primary danger-fill" onClick={onYes}>{action}</button></div></Sheet>;
}
function copyOf(hub: Hub, source: Person, name: string, groupId = source.groupId): Person {
  const copy = newPerson(hub, name, groupId);
  // Layout, settings and permissions come along. Connections, sign-in and devices never do.
  copy.rows = source.rows ? source.rows.filter(row => !isTrakt(row) && !row.source.endsWith('your list')) : null;
  copy.settings = structuredClone(source.settings); copy.can = {...source.can};
  return copy;
}

/* ---------- people ---------- */
export function PeoplePage(page: PageProps) {
  const {hub, go, update, toast} = page;
  const [adding, setAdding] = useState<string | null>(null), [name, setName] = useState(''), [from, setFrom] = useState(''), [grouping, setGrouping] = useState(false), [ordering, setOrdering] = useState(false);
  // Who is watching something right now, said beside their name. The rest of it is under Activity.
  const [playing, setPlaying] = useState<Record<string, string>>({});
  useEffect(() => {if (!page.live) return; void page.live.call<{now: number; plays: {person: string; title: string; playing: number; updated: number}[]}>('GET', '/api/activity').then(found => setPlaying(Object.fromEntries(found.plays.filter(play => play.playing && found.now - play.updated < 600).reverse().map(play => [play.person, play.title]))), () => {});}, [hub.v]);
  return <>
    <div className="page-head"><div className="title-row"><h1>People</h1>{hub.groups.length > 1 && <button type="button" className="link" onClick={() => setOrdering(true)}>Reorder groups</button>}</div><p className="muted">Everyone you share streaming with. Each person gets their own Home.</p></div>
    {hub.groups.map(group => {
      const people = hub.people.filter(person => person.groupId === group.id);
      return <section key={group.id} className="group">
        <div className="group-head"><h2>{group.name}{group.paused && <em className="tag">Paused</em>}</h2><span className="group-links">{SAMPLE && <button type="button" className="link" onClick={soon(toast, `the ${group.name} player`)}>Watch</button>}<a className="link" href={`#/group/${group.id}`}>Group settings</a></span></div>
        <ul className="people">{people.map(person => <li key={person.id}><a href={`#/person/${person.id}`}>
          <Avatar name={person.name}/>
          <span className="person-text"><strong>{person.name}</strong><small>{person.paused || group.paused ? 'Paused' : playing[person.id] ? `Watching ${playing[person.id]}` : person.joined ? `${personRows(hub, person).filter(row => row.on).length} rows on Home${person.rows || Object.keys(person.settings).length ? ' · personalized' : ''}` : 'Link not opened yet'}</small></span>
          <span className={`dot${person.paused || group.paused ? ' paused' : person.joined ? ' ok' : ''}`} aria-label={person.paused || group.paused ? 'Paused' : person.joined ? 'Joined' : 'Waiting'}/>
        </a></li>)}
          <li><button type="button" className="add-person" onClick={() => {setAdding(group.id); setName(''); setFrom('');}}><span className="avatar plus" aria-hidden="true">+</span><span className="person-text"><strong>Add someone to {group.name}</strong></span></button></li>
        </ul>
      </section>;
    })}
    <button type="button" className="ghost wide" onClick={() => {setGrouping(true); setName(''); setFrom('');}}>+ New group</button>
    {adding && <Sheet title="Add someone" onClose={() => setAdding(null)}>
      <form className="stack" onSubmit={event => {
        event.preventDefault(); const text = name.trim(); if (!text) return;
        const source = hub.people.find(item => item.id === from), person = source ? copyOf(hub, source, text, adding) : newPerson(hub, text, adding);
        update(next => {next.people.push(person);}); setAdding(null); go(`/person/${person.id}/settings`);
      }}>
        <label htmlFor="person-name">Their name</label><input id="person-name" value={name} onChange={event => setName(event.target.value)} autoFocus autoComplete="off" placeholder="e.g. Sam"/>
        {!!hub.people.length && <><label htmlFor="person-from">Start from</label><select id="person-from" value={from} onChange={event => setFrom(event.target.value)}><option value="">The group’s Home and playback</option>{hub.people.map(item => <option key={item.id} value={item.id}>A copy of {item.name}’s setup</option>)}</select></>}
        <p className="muted small">{from ? 'Copies their Home, playback and permissions. Their accounts, devices and history stay theirs.' : 'You’ll get a link to send them.'}</p>
        <button className="primary" disabled={!name.trim()}>Add and get link</button>
      </form>
    </Sheet>}
    {ordering && <Sheet title="Reorder groups" onClose={() => setOrdering(false)}>
      <p className="muted small">Drag a group to where it should be.</p>
      <GroupOrder groups={hub.groups} onChange={(from, to) => update(next => {next.groups = moved(next.groups, from, to);})}/>
    </Sheet>}
    {grouping && <Sheet title="New group" onClose={() => setGrouping(false)}>
      <form className="stack" onSubmit={event => {
        event.preventDefault(); const text = name.trim(); if (!text) return;
        let id = slug(text); while (hub.groups.some(item => item.id === id)) id += '-2';
        const source = hub.groups.find(item => item.id === from);
        update(next => {next.groups.push({id, name: text, rows: source?.rows ? structuredClone(source.rows) : null, settings: source ? structuredClone(source.settings) : {}});});
        setGrouping(false); toast(`${text} added`); go(`/group/${id}`);
      }}>
        <label htmlFor="group-name">Name</label><input id="group-name" value={name} onChange={event => setName(event.target.value)} autoFocus autoComplete="off" placeholder="e.g. Cousins"/>
        <label htmlFor="group-from">Start from</label><select id="group-from" value={from} onChange={event => setFrom(event.target.value)}><option value="">The defaults</option>{hub.groups.map(item => <option key={item.id} value={item.id}>A copy of {item.name}</option>)}</select>
        <button className="primary" disabled={!name.trim()}>Create group</button>
      </form>
    </Sheet>}
  </>;
}

/* ---------- a person: shared by the manager's view and the person's own page ---------- */
function Devices({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {update, toast, live} = page;
  const [code, setCode] = useState(''), [pin, setPin] = useState<string | null>(null);
  const [creds, refresh] = useCreds(page, person), at = `/api/people/${person.id}`;
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  const act = (work: Promise<unknown>, note: string) => {void work.then(async () => {await live!.reload(); refresh(); toast(note);}, fail(toast));};
  const copy = (text: string) => () => {void navigator.clipboard?.writeText(text).catch(() => {}); toast('Copied');};
  const who = mine ? 'you' : person.name;
  return <section>
    <div className="section-head"><div><h2>Devices</h2><p className="muted">Any Jellyfin app works: on a phone, a TV or a laptop.</p></div>{SAMPLE && <button type="button" className="primary" onClick={soon(toast, `${mine ? 'your' : person.name + '’s'} player in the browser`)}>Watch here</button>}</div>
    {live && !person.ready && <div className="notice"><span>{mine ? 'Your' : `${person.name}’s`} profile can’t sign in to a player app yet. It is being set up on the streaming server; if this stays, check that a debrid account is connected under Hub, Sources.</span></div>}
    <h3 className="sub first">Sign in to an app</h3>
    <dl className="card creds">
      <div><dt>Server</dt><dd><code>{`${location.origin}/h/${page.hub.code}`}</code><button type="button" className="ghost small" onClick={copy(`${location.origin}/h/${page.hub.code}`)}>Copy</button></dd></div>
      <div><dt>Username</dt><dd><code>{person.name}</code><button type="button" className="ghost small" onClick={copy(person.name)}>Copy</button></dd></div>
      <div><dt>Password</dt><dd><Secret value={creds?.password ?? ''} label="Password" onCopy={() => toast('Copied')}/></dd></div>
    </dl>
    <p className="muted small below">The username is {mine ? 'your' : 'their'} name; capitals and spaces don’t matter. This password is only for player apps{live ? `, separate from the one ${mine ? 'you use' : 'they use'} on this site` : ''}. Signing out everywhere replaces it.</p>
    {live && <><h3 className="sub">In a browser</h3>
    <div className="card settings"><Setting title="Watch in a browser" hint="Opens AIOStreams’ own web player. The first time, paste the server address above, then sign in with the username and password. Quick Connect works there too.">
      <a className="ghost small button" href="https://web.aiostreams.org" target="_blank" rel="noreferrer" onClick={() => {void navigator.clipboard?.writeText(`${location.origin}/h/${page.hub.code}`).catch(() => {}); toast('Server address copied');}}>Watch</a></Setting></div></>}
    <h3 className="sub">On a TV</h3>
    <form className="card quick" onSubmit={event => {event.preventDefault(); if (live) {act(live.call('POST', `${at}/quick`, {code}), 'TV approved. It signs in within a few seconds.'); setCode(''); return;} edit(target => {target.devices.unshift({id: `d${Date.now()}`, app: 'AIOStreams', name: 'New TV', seen: 'Now'});}, 'TV signed in'); setCode('');}}>
      <div><h3>Quick Connect</h3><p>Choose Quick Connect on the TV, then type the code it shows.</p></div>
      <div className="field-row"><input inputMode="numeric" aria-label="Code from the TV" placeholder="6-digit code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/><button className="primary" disabled={code.length !== 6}>Approve</button></div>
    </form>
    {SAMPLE && <><h3 className="sub">Profile PIN</h3>
    <div className="card settings">
      <Setting title="Ask for a PIN" hint={`On a shared screen everyone’s profile is listed. The PIN keeps ${mine ? 'yours' : person.name + '’s'} closed to the others.`}><Switch label="Ask for a PIN" checked={!!person.pin} onChange={value => edit(target => {target.pin = value ? samplePin(person.id) : null;}, value ? 'PIN on' : 'PIN off')}/></Setting>
      {person.pin && <Setting column title="PIN" hint="Changing it signs every device out.">
        {pin === null ? <span className="secret"><Secret value={person.pin} label="PIN" onCopy={() => toast('Copied')}/><button type="button" className="ghost small" onClick={() => setPin('')}>Change</button></span>
          : <form className="field-row narrow" onSubmit={event => {event.preventDefault(); edit(target => {target.pin = pin; target.devices = [];}, 'PIN changed'); setPin(null);}}><input inputMode="numeric" aria-label="New PIN" placeholder="6 digits" maxLength={8} autoFocus value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))}/><button className="primary" disabled={pin.length < 6}>Save</button></form>}
      </Setting>}
    </div></>}
    <h3 className="sub">Signed in</h3>
    {person.devices.length ? <><ul className="feed">{person.devices.map(device => <li key={device.id}><div className="quiet-name">{live ? <NameField label={`Name of ${device.name}`} value={device.name} onSave={value => act(live.call('PUT', `${at}/devices/${device.id}`, {name: value}), 'Renamed')}/> : <strong>{device.name}</strong>}<small>{device.app} · {device.seen === 'Now' ? 'active now' : `last used ${device.seen.toLowerCase()}`}{device.where ? ` · ${device.where}` : ''}</small></div><button type="button" className="ghost small" onClick={() => live ? act(live.call('DELETE', `${at}/devices/${device.id}`), `${device.name} signed out`) : edit(target => {target.devices = target.devices.filter(item => item.id !== device.id);}, `${device.name} signed out`)}>Sign out</button></li>)}</ul>
      <button type="button" className="link below" onClick={() => live ? act(live.call('POST', `${at}/rotate`, {}), 'Signed out everywhere. New password set.') : edit(target => {target.devices = []; target.password = samplePassword(person.id);}, 'Signed out everywhere. New password set.')}>Sign {who} out everywhere</button></>
      : <p className="muted">No device yet.</p>}
  </section>;
}
function Accounts({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {hub, update, toast, live} = page, group = hub.groups.find(item => item.id === person.groupId)!;
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  // Connecting Trakt and MDBList is not wired to the real hub yet, so it offers nothing to press rather than a button that pretends.
  const later = <span className="pill">Not available yet</span>;
  const waiting = live ? later : <span className="pill" title={`Send ${person.name} their link from the Settings tab`}>Waiting for {person.name}</span>;
  const off = (label: string, change: (person: Person) => void) => <button type="button" className="ghost small" onClick={() => edit(change, `${label} disconnected`)}>Disconnect</button>;
  // On a real hub, Trakt is approved on AIOMetadata's own page (it owns the Trakt app), which shows a Token ID to bring back here.
  const [linking, setLinking] = useState(false), [token, setToken] = useState(''), [keying, setKeying] = useState(false), [own, setOwn] = useState(''), [busy, setBusy] = useState(false), at = `/api/people/${person.id}/trakt`;
  return <section>
    <div className="section-head"><div><h2>Accounts</h2><p className="muted">{mine ? 'Connect your own. Nobody else sees them.' : live ? <>{person.name} can connect their own from their page, or you can do it here with them.</> : <>Only {person.name} can connect these, from their own page. <a className="link" href={`#/person/${person.id}/settings`}>Get their link</a></>}</p></div></div>
    <ul className="accounts">
      <li><div><h3>Streams</h3><p>Played through the shared {resolve(hub, group, person).values.debrid} account. Nothing to set up.</p></div><span className="pill ok">Shared</span></li>
      {live && <li className={linking && !person.trakt ? 'stacked' : ''}><div><h3>Trakt</h3><p>{person.trakt ? 'Connected. Watchlist, recommendations and what’s next are on Home. Plays here are not written back to Trakt.' : 'Brings a watchlist, recommendations and what’s next to Home. Plays here are not written back to Trakt.'}</p></div>
        {person.trakt ? <button type="button" className="ghost small" disabled={busy} onClick={() => {setBusy(true); void live.call('DELETE', at).then(() => live.sync()).then(() => live.reload()).then(() => toast('Trakt disconnected'), fail(toast)).finally(() => setBusy(false));}}>Disconnect</button>
          : !linking ? <a className="primary button" href={hub.traktLink} target="_blank" rel="noreferrer" onClick={() => setLinking(true)}>Connect</a>
          : <form className="stack link-back" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call<{username: string}>('POST', at, {tokenId: token}).then(found => live.sync().then(() => live.reload()).then(() => {toast(`Trakt connected as ${found.username}`); setLinking(false); setToken('');}), fail(toast)).finally(() => setBusy(false));}}>
            <p className="muted small">Approve on the Trakt page that opened. It ends on a page saying “Trakt connected” with a Token ID. Copy the Token ID and paste it here.</p>
            <div className="field-row"><input aria-label="Token ID" placeholder="Token ID" autoComplete="off" value={token} onChange={event => setToken(event.target.value)}/><button className="primary" disabled={busy || !token.trim()}>Save</button></div>
            <a className="link small" href={hub.traktLink} target="_blank" rel="noreferrer">Open the Trakt page again</a>
          </form>}</li>}
      {!live && <li><div><h3>Trakt</h3><p>{person.trakt ? 'Connected. Watchlist and recommendations are on Home.' : 'Brings a watchlist and recommendations to Home.'}</p></div>
        {person.trakt ? off('Trakt', target => {target.trakt = false; target.rows = target.rows?.filter(row => !isTrakt(row)) ?? null;})
          : mine ? <button type="button" className="primary" onClick={() => edit(target => {target.trakt = true; if (target.rows) target.rows = [...traktRows(), ...target.rows];}, 'Trakt connected')}>Connect</button> : waiting}</li>}
      {live && <li className={keying && !person.lists ? 'stacked' : ''}><div><h3>MDBList</h3><p>{person.lists ? 'Connected. What’s played is recorded to this MDBList account, and “Hide what’s been watched” reads from it.' : 'Records what’s played and how far, in the person’s own MDBList account, and lets Home hide what’s been watched. Free.'}</p></div>
        {person.lists ? <button type="button" className="ghost small" disabled={busy} onClick={() => {setBusy(true); void live.call('DELETE', `/api/people/${person.id}/mdblist`).then(() => live.sync()).then(() => live.reload()).then(() => toast('MDBList disconnected'), fail(toast)).finally(() => setBusy(false));}}>Disconnect</button>
          : !keying ? <button type="button" className="primary small" onClick={() => setKeying(true)}>Connect</button>
          : <form className="stack link-back" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call<{username: string}>('POST', `/api/people/${person.id}/mdblist`, {key: own}).then(found => live.sync().then(() => live.reload()).then(() => {toast(found.username ? `MDBList connected as ${found.username}` : 'MDBList connected'); setKeying(false); setOwn('');}), fail(toast)).finally(() => setBusy(false));}}>
            <p className="muted small">Paste {mine ? 'your' : 'their'} own MDBList API key. It is at <a className="link" href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer">mdblist.com, Preferences, API Access</a>. One key per person: a shared key would mix everyone’s watching together.</p>
            <div className="field-row"><input type="password" aria-label="MDBList API key" placeholder="API key" autoComplete="off" value={own} onChange={event => setOwn(event.target.value)}/><button className="primary" disabled={busy || !own.trim()}>Save</button></div>
          </form>}</li>}
      {!live && <li><div><h3>MDBList</h3><p>{person.lists ? 'Connected. Keeps what’s been watched and how far, and its lists can be added as rows.' : 'Remembers what’s been watched and how far, across every device. Its lists can be added as rows.'}</p></div>
        {person.lists ? off('MDBList', target => {target.lists = false; target.rows = target.rows?.filter(row => !row.source.startsWith('MDBList')) ?? null;})
          : live ? later : mine ? <button type="button" className="primary" onClick={() => edit(target => {target.lists = true;}, 'MDBList connected')}>Connect</button> : waiting}</li>}
    </ul>
  </section>;
}
function PersonSections({page, person, tab, mine}: {page: PageProps; person: Person; tab: string; mine: boolean}) {
  const {hub, update, toast} = page, group = hub.groups.find(item => item.id === person.groupId)!;
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  const props = editor(page, group, person, mine), rows = personRows(hub, person);
  const canArrange = !mine || person.can.arrange, canAdd = !mine || person.can.add;
  return <>
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} mine={mine} level="own" rows={rows} canAdd={canAdd} canArrange={canArrange}
      tag={row => row.origin === 'own' && !row.core ? (mine ? 'Yours' : 'Personal') : undefined}
      lists={ownLists(person)} listsHint={mine ? 'Connect Trakt or MDBList under Accounts to pick from your own lists.' : `Shows up once ${person.name} connects Trakt or MDBList.`}
      onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined}
      onChange={(next: Row[], note) => edit(target => {target.rows = next;}, note)}
      onFollow={person.rows && canArrange ? () => edit(target => {target.rows = null;}, `Following ${group.name} again`) : undefined} followLabel={`Follow ${group.name} again`}/>}
    {tab === 'playback' && <PlaybackEditor {...props}/>}
    {tab === 'sources' && <SourcesEditor {...props}/>}
    {tab === 'activity' && <Activity hub={hub} personId={person.id} toast={toast} live={page.live}/>}
    {tab === 'devices' && <Devices page={page} person={person} mine={mine}/>}
    {tab === 'accounts' && <Accounts page={page} person={person} mine={mine}/>}
  </>;
}
function Invite({page, person}: {page: PageProps; person: Person}) {
  const [creds] = useCreds(page, person), link = creds?.link ?? '';
  return <div className="card share"><div className={`qr${link ? '' : ' wait'}`}>{link && <QRCodeSVG value={link} size={112} bgColor="#ffffff" fgColor="#111111" marginSize={2}/>}</div>
    <div className="share-text"><p>{person.joined ? `${person.name} has joined. The link still opens their page on a new device.` : `Send ${person.name} this link, or let them scan the code. They choose a password and set up their own side.`}</p><code className={link ? '' : 'wait'} aria-busy={!link}>{link}</code>
      <div className="share-actions"><button type="button" className="primary" disabled={!link} onClick={() => {void navigator.clipboard?.writeText(link).catch(() => {}); page.toast('Link copied');}}>Copy link</button>{SAMPLE && <a className="link" href={`#/join/${person.id}`}>See what {person.name} sees →</a>}</div></div></div>;
}
export function PersonPage(page: PageProps & {id: string; tab: string}) {
  const {hub, go, update, toast, id, tab, live} = page;
  const [copying, setCopying] = useState(false), [name, setName] = useState(''), [removing, setRemoving] = useState(false);
  const person = hub.people.find(item => item.id === id);
  // Their own rows (Trakt, lists, a Home of their own) get real posters too, from the setup they are on.
  const [, redraw] = useState(0);
  useEffect(() => {if (!live) return; addReal({}); void live.call<{rows: Record<string, string[]>}>('GET', `/api/previews?person=${encodeURIComponent(id)}`).then(found => {addReal(found.rows); redraw(count => count + 1);}, () => {});}, [id, person?.v]);
  if (!person) return <p className="empty">This person is gone. <a className="link" href="#/">Back to people</a></p>;
  const group = hub.groups.find(item => item.id === person.groupId)!;
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === id)!)); toast(note);};
  return <>
    <a className="back" href="#/">← People</a>
    <div className="person-head"><Avatar name={person.name} size={64}/><div><h1>{person.name}</h1><p className="muted">{group.name} · {person.paused ? 'playing paused' : person.joined ? 'joined' : 'link not opened yet'}</p></div></div>
    <Tabs base={`/person/${id}`} tab={tab} tabs={[['home', 'Home'], ['playback', 'Playback'], ['sources', 'Sources'], ['activity', 'Activity'], ['devices', 'Devices'], ['accounts', 'Accounts'], ['settings', 'Settings']]}/>
    <PersonSections page={page} person={person} tab={tab} mine={false}/>
    {tab === 'settings' && <section>
      <h3 className="sub first">Invite</h3>
      <Invite page={page} person={person}/>
      <h3 className="sub">{person.name} can</h3>
      <div className="card settings">
        <Setting title="Arrange their Home" hint="Reorder rows and turn them on or off."><Switch label="Arrange their Home" checked={person.can.arrange} onChange={value => edit(target => {target.can.arrange = value;}, 'Saved')}/></Setting>
        <Setting title="Add their own rows" hint="Paste list links and pick collections."><Switch label="Add their own rows" checked={person.can.add} onChange={value => edit(target => {target.can.add = value;}, 'Saved')}/></Setting>
        <Setting title="Change playback" hint="Quality, languages, subtitles and the rest."><Switch label="Change playback" checked={person.can.playback} onChange={value => edit(target => {target.can.playback = value;}, 'Saved')}/></Setting>
      </div>
      <h3 className="sub">Profile</h3>
      <div className="card settings">
        <Setting title="Name"><NameField label="Name" value={person.name} onSave={value => edit(target => {target.name = value;}, 'Renamed')}/></Setting>
        {hub.groups.length > 1 && <Setting title="Group" hint="Moving keeps their own changes and follows the new group for the rest."><select aria-label="Group" value={person.groupId} onChange={event => edit(target => {target.groupId = event.target.value;}, 'Moved')}>{hub.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Setting>}
        {live && person.joined && <Setting title="Forgotten password" hint={`Lets ${person.name} choose a new password for their page through the invite link. Their apps stay signed in.`}><button type="button" className="ghost small" onClick={() => void live.call('POST', `/api/people/${id}/reset`, {}).then(() => live.reload()).then(() => toast('They can choose a new password with their link'), fail(toast))}>Reset</button></Setting>}
        <Setting title="Make a copy" hint="A new person with the same Home, playback and permissions. Accounts and devices are not copied."><button type="button" className="ghost small" onClick={() => {setCopying(true); setName('');}}>Copy</button></Setting>
        <Setting title="Pause playing" hint={group.paused && !person.paused ? `All of ${group.name} is paused, ${person.name} with them. Turn it off in the group’s settings.` : person.paused ? `${person.name} can browse and search, but nothing plays. Something already playing runs to its end.` : 'They can still browse and search, but nothing new plays. Nothing is deleted.'}><Switch label="Pause playing" checked={!!person.paused} onChange={value => edit(target => {target.paused = value;}, value ? `${person.name} is paused` : `${person.name} can play again`)}/></Setting>
      </div>
      {SAMPLE && <><h3 className="sub">Advanced</h3>
      <div className="card settings"><Setting title="Open in AIOMetadata" hint={`Everything about ${person.name}’s catalogs that isn’t covered here.`}><button type="button" className="ghost small" onClick={soon(toast, 'their AIOMetadata setup')}>Open</button></Setting></div></>}
      <button type="button" className="danger" onClick={() => setRemoving(true)}>Remove {person.name}</button>
    </section>}
    {copying && <Sheet title={`Copy ${person.name}`} onClose={() => setCopying(false)}>
      <form className="stack" onSubmit={event => {event.preventDefault(); const text = name.trim(); if (!text) return; const copy = copyOf(hub, person, text); update(next => {next.people.push(copy);}); setCopying(false); toast(`${text} added`); go(`/person/${copy.id}/settings`);}}>
        <label htmlFor="copy-name">Name for the new person</label><input id="copy-name" value={name} onChange={event => setName(event.target.value)} autoFocus autoComplete="off"/>
        <button className="primary" disabled={!name.trim()}>Create copy</button>
      </form>
    </Sheet>}
    {removing && <Confirm title={`Remove ${person.name}?`} body="Their Home, connections and sign-in are deleted. What they watched is kept and comes back if you add them again." action="Remove" onClose={() => setRemoving(false)} onYes={() => {update(next => {next.people = next.people.filter(item => item.id !== id);}); toast(`${person.name} removed`); go('/');}}/>}
  </>;
}

/* ---------- a group ---------- */
export function GroupPage(page: PageProps & {id: string; tab: string}) {
  const {hub, go, update, toast, id, tab} = page;
  const [removing, setRemoving] = useState(false);
  const group = hub.groups.find(item => item.id === id);
  if (!group) return <p className="empty">This group is gone. <a className="link" href="#/">Back to people</a></p>;
  const edit = (change: (group: Group) => void, note: string) => {update(next => change(next.groups.find(item => item.id === id)!)); toast(note);};
  const members = hub.people.filter(person => person.groupId === id), custom = members.filter(person => person.rows || Object.keys(person.settings).length).length;
  const props = editor(page, group);
  return <>
    <a className="back" href="#/">← People</a>
    <div className="page-head"><h1>{group.name}</h1><p className="muted">Everyone in this group starts here. {members.length} {members.length === 1 ? 'person' : 'people'}{custom ? `, ${custom} with their own changes` : ''}.</p></div>
    <Tabs base={`/group/${id}`} tab={tab} tabs={[['home', 'Home'], ['playback', 'Playback'], ['sources', 'Sources'], ['activity', 'Activity'], ['settings', 'Settings']]}/>
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined} level="group" rows={groupRows(hub, group)} tag={row => row.origin === 'group' ? 'This group' : undefined} onChange={(rows, note) => edit(target => {target.rows = rows;}, note)}
      onFollow={group.rows ? () => edit(target => {target.rows = null;}, `Following ${HUB} again`) : undefined} followLabel="Use the default Home again"/>}
    {tab === 'playback' && <PlaybackEditor {...props}/>}
    {tab === 'sources' && <SourcesEditor {...props}/>}
    {tab === 'activity' && <Activity hub={hub} groupId={id} toast={toast} live={page.live}/>}
    {tab === 'settings' && <section>
      <div className="card settings">
        <Setting title="Name"><NameField label="Group name" value={group.name} onSave={value => edit(target => {target.name = value;}, 'Renamed')}/></Setting>
        {SAMPLE && <Setting title="Shared player" hint="One page for a shared screen. Everyone in the group is listed, each behind their PIN."><button type="button" className="ghost small" onClick={soon(toast, `the ${group.name} player`)}>Watch</button></Setting>}
        <Setting title="Pause playing" hint={group.paused ? `Nobody in ${group.name} can start anything. They can still browse and search. Something already playing runs to its end.` : 'Everyone in this group can still browse and search, but nothing new plays. Nothing is deleted.'}><Switch label="Pause playing for the group" checked={!!group.paused} onChange={value => edit(target => {target.paused = value;}, value ? `${group.name} is paused` : `${group.name} can play again`)}/></Setting>
        <Setting title="Make a copy" hint="A new group with the same Home, playback and sources. No people."><button type="button" className="ghost small" onClick={() => {let next = slug(`${group.name} copy`); while (hub.groups.some(item => item.id === next)) next += '-2'; update(draft => {draft.groups.push({id: next, name: `${group.name} copy`, rows: structuredClone(group.rows), settings: structuredClone(group.settings)});}); toast('Group copied'); go(`/group/${next}/settings`);}}>Copy</button></Setting>
      </div>
      {SAMPLE && <><h3 className="sub">Advanced</h3>
      <div className="card settings"><Setting title="Open in AIOStreams" hint="Everything about this group’s streams that isn’t covered here."><button type="button" className="ghost small" onClick={soon(toast, 'the group’s AIOStreams setup')}>Open</button></Setting></div></>}
      <button type="button" className="danger" disabled={!!members.length || hub.groups.length < 2} onClick={() => setRemoving(true)}>Remove this group</button>
      {!!members.length && <p className="muted small">Move or remove its people first.</p>}
    </section>}
    {removing && <Confirm title={`Remove ${group.name}?`} body="The group and its settings are deleted." action="Remove" onClose={() => setRemoving(false)} onYes={() => {update(next => {next.groups = next.groups.filter(item => item.id !== id);}); toast('Group removed'); go('/');}}/>}
  </>;
}

/* ---------- defaults for everyone ---------- */
export function HubPage(page: PageProps & {tab: string}) {
  const {hub, update, toast, tab} = page, props = editor(page);
  const following = hub.groups.filter(group => !group.rows).length;
  return <>
    <a className="back" href="#/">← People</a>
    <div className="page-head"><h1>Hub</h1><p className="muted">What every group starts with, where things play from, and the hub’s own setup. A group or a person can change anything for themselves.</p></div>
    <Tabs base="/hub" tab={tab} tabs={[['home', 'Home'], ['playback', 'Playback'], ['sources', 'Sources'], ['general', 'General']]}/>
    {tab === 'home' && <><HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined} level="hub" rows={hub.rows} tag={() => undefined} onChange={(rows, note) => {update(next => {next.rows = rows;}); toast(note);}}/>{page.live && !hub.mdblist && <p className="notice"><span>The collection rows (by Service, by Genre) reach the player apps once the hub has an MDBList key.</span><a className="link" href="#/hub/sources">Add it</a></p>}<p className="muted small foot">{following} of {hub.groups.length} groups follow this Home.</p></>}
    {tab === 'playback' && <PlaybackEditor {...props}/>}
    {tab === 'sources' && <SourcesEditor {...props}/>}
    {tab === 'general' && page.live && <><Servers hub={hub} live={page.live} toast={toast}/><Advanced live={page.live} toast={toast}/></>}
    {tab === 'general' && SAMPLE && <section>
      <div className="card settings">
        <Setting column title="AIOStreams server" hint="Where the players connect behind the scenes. Changing it moves every group; watch history moves with it.">
          <Segments label="AIOStreams server" value={hub.host} onChange={value => {update(next => {next.host = value;}); toast('Saved');}} options={hosts.map(item => ({value: item, label: item}))}/>
          {hub.host === 'Your own' && <NameField label="Server address" value={hub.hostUrl || 'https://'} onSave={value => {update(next => {next.hostUrl = value;}); toast('Saved');}}/>}
        </Setting>
      </div>
      <h3 className="sub">Advanced</h3>
      <div className="card settings"><Setting title="Open in AIOStreams" hint="The shared setup every group builds on."><button type="button" className="ghost small" onClick={soon(toast, 'the shared AIOStreams setup')}>Open</button></Setting></div>
    </section>}
  </>;
}

/* Which AIOStreams and AIOMetadata servers the hub's setups live on. The site checks an address before keeping it. */
/* The way into the hub's own setups on AIOStreams and AIOMetadata, behind the manager's password. */
interface Door {open: string; id: string; password: string}
interface Doors {aiostreams: Door | null; aiometadata: Door | null; own?: (Door & {name: string; group: boolean})[]}
function Advanced({live, toast}: {live: Live; toast: (text: string) => void}) {
  const [asking, setAsking] = useState(false), [pass, setPass] = useState(''), [busy, setBusy] = useState(false), [doors, setDoors] = useState<Doors | null>(null);
  const copy = (text: string) => () => {void navigator.clipboard?.writeText(text).catch(() => {}); toast('Copied');};
  const door = (name: string, found: Door | null, note: string) => <Setting key={name} column title={name} hint={found ? note : 'Not made yet. It appears once the hub has its keys.'}>
    {found && <dl className="creds inner"><div><dt>ID</dt><dd><code>{found.id}</code><button type="button" className="ghost small" onClick={copy(found.id)}>Copy</button></dd></div>
      <div><dt>Password</dt><dd><Secret value={found.password} label={`${name} password`} onCopy={() => toast('Copied')}/></dd></div>
      <div><dt></dt><dd><a className="ghost small button" href={found.open} target="_blank" rel="noreferrer">Open {name}</a></dd></div></dl>}</Setting>;
  return <section>
    <div className="section-head"><div><h2>Advanced</h2><p className="muted">Step into the setups behind your hub, on AIOStreams and AIOMetadata themselves, for anything this site doesn’t offer.</p></div></div>
    {!doors ? <div className="card settings"><Setting column title="Open the setups" hint="These are the real keys to your hub’s setups, so your password is asked for again. Anyone holding them can change the setups directly.">
      {asking ? <form className="field-row" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call<Doors>('POST', '/api/hub/advanced', {password: pass}).then(found => {setDoors(found); setPass('');}, (error: Error) => toast(error.message)).finally(() => setBusy(false));}}>
        <input type="password" aria-label="Your password" placeholder="Your password" autoComplete="current-password" autoFocus value={pass} onChange={event => setPass(event.target.value)}/><button className="primary" disabled={busy || !pass}>Show</button></form>
        : <button type="button" className="ghost small" onClick={() => setAsking(true)}>Show</button>}</Setting></div>
    : <div className="card settings">
      {door('AIOStreams', doors.aiostreams, 'Sources, filters, sorting and the stream label. If it asks, use this ID and password.')}
      {door('AIOMetadata', doors.aiometadata, 'Catalogs, collections and posters for the shared Home. It asks for this password.')}
      {(doors.own ?? []).map(found => door(`AIOMetadata for ${found.name}`, found, `${found.group ? `The ${found.name} group’s` : `${found.name}’s`} own Home, looks and accounts. The hub made it because they differ from the shared one, and removes it once they don’t.`))}
      <Setting column title="What the hub keeps putting back" hint="The hub rewrites the things it manages each time you change something here: debrid account, the sources it lists, quality and size, languages, the stream label, people, Home rows and collections. Anything else you add there is left alone. A group’s or a person’s own Home lives in its own AIOMetadata setup, listed above when there is one."><button type="button" className="ghost small" onClick={() => setDoors(null)}>Hide</button></Setting>
    </div>}
  </section>;
}
function Servers({hub, live, toast}: {hub: Hub; live: Live; toast: (text: string) => void}) {
  const [up, setUp] = useState(hub.hostUrl), [meta, setMeta] = useState(hub.metaUrl ?? ''), [busy, setBusy] = useState(false);
  const changed = up.trim() !== hub.hostUrl || meta.trim() !== (hub.metaUrl ?? '');
  return <section>
    <div className="section-head"><div><h2>Servers</h2><p className="muted">Where your hub’s setups live. Leave a field empty to use this site’s usual server (ForTheWeak).</p></div></div>
    <form className="card settings" onSubmit={event => {
      event.preventDefault(); setBusy(true);
      void live.call<{missing: string[]}>('PUT', '/api/host', {aiostreams: up, aiometadata: meta}).then(answer => live.sync().then(() => live.reload()).then(() => toast(answer.missing.length ? 'Saved. Some sources are not offered there and are off.' : 'Saved')), (error: Error) => toast(error.message)).finally(() => setBusy(false));
    }}>
      <Setting column title="AIOStreams" hint="Finds the streams and is what the player apps talk to behind your hub’s address."><input aria-label="AIOStreams address" placeholder="https://aiostreams.fortheweak.cloud" value={up} onChange={event => setUp(event.target.value)} autoComplete="off" inputMode="url"/></Setting>
      <Setting column title="AIOMetadata" hint="Builds the Home rows, collections and search."><input aria-label="AIOMetadata address" placeholder="https://aiometadata.fortheweak.cloud" value={meta} onChange={event => setMeta(event.target.value)} autoComplete="off" inputMode="url"/></Setting>
      <Setting column title="Moving" hint="Changing a server makes fresh setups on the new one and removes the old ones. Apps stay signed in and everything set here carries over. What has been watched so far stays behind on the old AIOStreams server.">
        <button className="primary" disabled={busy || !changed}>{busy ? 'Checking…' : 'Check and save'}</button></Setting>
    </form>
  </section>;
}

/* ---------- the manager's own account ---------- */
export function AccountPage({hub, update, toast, go, live}: PageProps) {
  const [codes, setCodes] = useState<string[] | null>(null), [changing, setChanging] = useState(false), [ending, setEnding] = useState(false), [pass, setPass] = useState(''), [busy, setBusy] = useState(false), [adding, setAdding] = useState(false);
  const samples = Array.from({length: 10}, (_, i) => `sample-${String(1000 + i * 731 % 9000)}-${String(2000 + i * 419 % 8000)}`);
  return <>
    <div className="person-head"><Avatar name={hub.me.name} size={64}/><div><h1>{live ? 'Your account' : hub.me.name}</h1><p className="muted">{live ? 'You run this hub.' : 'You run this hub. Your name is what invited people see.'}</p></div></div>
    <h3 className="sub first">Sign-in</h3>
    <div className="card settings">
      {live ? <Setting title="Hub code" hint="You sign in with this code and your password."><span className="secret"><code>{hub.code}</code><button type="button" className="ghost small" onClick={() => {void navigator.clipboard?.writeText(hub.code).catch(() => {}); toast('Copied');}}>Copy</button></span></Setting>
        : <Setting title="Name"><NameField label="Your name" value={hub.me.name} onSave={value => {update(next => {next.me.name = value;}); toast('Saved');}}/></Setting>}
      <Setting title="Password" hint="Works on any device and in a password manager."><button type="button" className="ghost small" onClick={() => live ? setChanging(true) : toast('Preview: this asks for the old and a new password')}>Change</button></Setting>
      <Setting title="Recovery codes" hint={live ? 'Ten spare keys for the day you lose your password. Any one gets you back in, once. They are shown only when made; making new ones retires the old.' : 'Ten one-time codes for the day you lose your password.'}><button type="button" className="ghost small" onClick={() => live ? void live.call<{codes: string[]}>('POST', '/api/account/recovery', {}).then(made => setCodes(made.codes), fail(toast)) : setCodes(samples)}>{live ? 'New codes' : 'Show'}</button></Setting>
    </div>
    {(SAMPLE || canPasskey()) && <><h3 className="sub">Passkeys</h3>
    <ul className="accounts">{hub.me.passkeys.map(key => <li key={key.id}><div><h3>{key.name}</h3><p>Added {key.added}</p></div><button type="button" className="ghost small" onClick={() => {if (live) return void live.call('DELETE', `/api/account/passkeys/${key.id}`).then(() => live.reload()).then(() => toast('Passkey removed'), fail(toast)); update(next => {next.me.passkeys = next.me.passkeys.filter(item => item.id !== key.id);}); toast('Passkey removed');}}>Remove</button></li>)}
      <li><div><h3>Add a passkey</h3><p>Sign in with a fingerprint or face on this device, with no hub code to type. Optional; the password always works.</p></div><button type="button" className="ghost small" disabled={adding} onClick={() => {if (live) {setAdding(true); return void addPasskey().then(() => live.reload()).then(() => toast('Passkey added'), (error: Error) => toast(error.name === 'NotAllowedError' ? 'No passkey was added' : error.name === 'InvalidStateError' ? 'This device already has a passkey here' : error.message)).finally(() => setAdding(false));} update(next => {next.me.passkeys.push({id: `k${Date.now()}`, name: 'This device', added: 'today'});}); toast('Passkey added');}}>Add</button></li></ul></>}
    <h3 className="sub">Appearance</h3>
    <div className="card settings"><Setting title="Theme"><Segments label="Theme" value={hub.me.theme} onChange={value => update(next => {next.me.theme = value;})} options={[{value: 'dark', label: 'Dark'}, {value: 'light', label: 'Light'}, {value: 'auto', label: 'Match device'}]}/></Setting></div>
    {SAMPLE && <><h3 className="sub">Preview</h3>
    <div className="card settings"><Setting title="First-time setup" hint="Walk through what a new manager sees."><button type="button" className="ghost small" onClick={() => go('/setup')}>Open</button></Setting></div></>}
    <button type="button" className="danger" onClick={() => live ? void live.call('POST', '/api/signout', {}).then(() => {go('/'); return live.reload();}, fail(toast)) : toast('Preview: this signs you out')}>Sign out</button>
    {codes && <Sheet title="Recovery codes" onClose={() => setCodes(null)}><p className="muted sheet-lead">{live ? 'Any one of these, with your hub code, gets you back in. Each works once. Save them now: they are not shown again.' : 'Each works once. Keep them somewhere safe. These are samples.'}</p><ul className="codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul></Sheet>}
    {changing && live && <PasswordSheet toast={toast} onClose={() => setChanging(false)} onSave={(old, password) => live.call('POST', '/api/account/password', {old, password})}/>}
    {live && <><h3 className="sub">Danger</h3><div className="card settings"><Setting title="Delete this hub" hint="Removes the hub, everyone in it and its setup on the streaming server. There is no undo."><button type="button" className="ghost small" onClick={() => {setEnding(true); setPass('');}}>Delete</button></Setting></div></>}
    {ending && live && <Sheet title="Delete this hub?" onClose={() => setEnding(false)}><form className="stack" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call('POST', '/api/hub/delete', {password: pass}).then(() => {localStorage.removeItem('hub-code'); go('/'); return live.reload();}, error => {fail(toast)(error); setBusy(false);});}}>
      <p className="muted sheet-lead">Everyone is signed out of their apps and their sign-ins stop working. Type your password to confirm.</p>
      <label htmlFor="end-pass">Password</label><input id="end-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete="current-password" autoFocus/>
      <button className="primary danger-fill" disabled={busy || !pass}>{busy ? 'Deleting…' : 'Delete everything'}</button>
    </form></Sheet>}
  </>;
}

/* ---------- first-time setup ---------- */
export function SetupPage({hub, go, update, toast, live, signedIn, needCode, linkCode, offer}: PageProps & {signedIn?: boolean; needCode?: boolean; linkCode?: string; offer?: {hub: string; proof: string}}) {
  // A code in the link always wins, even if the page was already open without one.
  // Issued by the site before the hub exists, so it is on screen next to the password and a password manager saves the two together.
  const [mine] = useState(offer?.hub ?? ''), [proof] = useState(offer?.proof ?? '');
  const [tmdb, setTmdb] = useState(''), [lists, setLists] = useState('');
  const [typed, setCode] = useState(''), code = linkCode || typed, [busy, setBusy] = useState(false);
  const [step, setStep] = useState(signedIn ? 1 : 0), [user, setUser] = useState(''), [pass, setPass] = useState(''), [service, setService] = useState(hub.services[0] ?? 'TorBox'), [key, setKey] = useState(''), [quality, setQuality] = useState<Settings['quality']>('balanced'), [first, setFirst] = useState(''), [groupName, setGroupName] = useState('Family');
  const back = <button type="button" className="ghost" onClick={() => setStep(step - 1)}>Back</button>;
  const work = (job: Promise<unknown>, then: () => void) => {setBusy(true); void job.then(then, fail(toast)).finally(() => setBusy(false));};
  // On a real hub the keys get a step each: what plays the streams, then what fills Home.
  const names = live ? ['You', 'Streams', 'Home', 'Quality', 'First person'] : ['You', 'Account', 'Quality', 'First person'], at = names[step];
  return <div className="setup">
    <ol className="steps" aria-label="Progress">{names.map((label, index) => <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>{label}</li>)}</ol>
    {at === 'You' && <form className="stack" onSubmit={event => {event.preventDefault(); if (live) work(live.call('POST', '/api/signup', {password: pass, code, hub: mine, proof}).then(() => {localStorage.setItem('hub-code', mine); return live.reload();}), () => setStep(1)); else setStep(1);}}>
      <h1>{live ? 'Create your hub' : 'Create your account'}</h1><p className="muted">{live ? 'Choose a password. You sign in with it and the hub code below, which is made for you. Save both.' : 'This is how you get back in, on any device.'}</p>
      {/* Shown as a fact, not a field: nobody chooses or edits it. The out-of-sight input is only there so a password manager saves it with the password. */}
      {live && <><span className="label">Your hub code</span><div className="code-show"><code>{mine}</code><button type="button" className="ghost small" onClick={() => {void navigator.clipboard?.writeText(mine).catch(() => {}); toast('Copied');}}>Copy</button></div>
        <input className="out-of-sight" aria-label="Hub code" name="username" value={mine} readOnly tabIndex={-1} autoComplete="username"/></>}
      {!live && <><label htmlFor="setup-user">Username</label><input id="setup-user" value={user} onChange={event => setUser(event.target.value)} autoComplete="off" autoFocus/></>}
      <label htmlFor="setup-pass">Password</label><input id="setup-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete="off"/>
      {needCode && !linkCode && <><label htmlFor="setup-code">Setup code</label><input id="setup-code" value={typed} onChange={event => setCode(event.target.value)} autoComplete="off"/><p className="muted small">The code that was chosen when this site was installed. If that wasn’t you, ask whoever did it.</p></>}
      <p className="muted small">{live ? 'Use at least 8 characters for the password.' : 'Preview: any text works. Nothing is sent anywhere. A passkey can be added later.'}</p>
      <button className="primary big" disabled={busy || (live ? pass.length < 8 || (needCode && !code.trim()) : !user.trim() || !pass)}>Continue</button>
      {live && <a className="link center-text" href="#/">I already have an account</a>}
    </form>}
    {(at === 'Streams' || at === 'Account') && <form className="stack" onSubmit={event => {event.preventDefault(); setStep(step + 1);}}>
      {live && <div className="notice"><span>Your hub code is <strong>{hub.code}</strong>. You need it with your password to sign in, so save it now. It’s also on your account page.</span></div>}
      <h1>Which account do your streams come from?</h1><p className="muted">One account powers everyone. People you add never see the key. More can be connected later.</p>
      <div className="choices">{allServices.slice(0, 4).map(item => <button key={item} type="button" aria-pressed={service === item} className={service === item ? 'on' : ''} onClick={() => setService(item)}>{item}</button>)}</div>
      {live && <p className="muted small">Stored encrypted and passed only to your hub’s own setup on AIOStreams.</p>}
      <label htmlFor="setup-key">{service} API key</label><input id="setup-key" type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" placeholder="Paste it here"/>
      <p className="muted small">No {service} account yet? <a className="link" href={signUp[service]} target="_blank" rel="noreferrer">Get one here</a>{service === 'TorBox' || service === 'Real-Debrid' ? ' (a referral link: it supports whoever runs this site).' : '.'}</p>
      <div className="split">{!live && back}<button className="primary big" disabled={busy || !key.trim()}>Continue</button></div>
    </form>}
    {at === 'Home' && live && <form className="stack" onSubmit={event => {event.preventDefault(); work(live.call('PUT', '/api/keys/tmdb', {key: tmdb}).then(() => lists.trim() ? live.call('PUT', '/api/keys/mdblist', {key: lists}) : undefined), () => setStep(step + 1));}}>
      <h1>What fills Home?</h1><p className="muted">The rows people see when they open the player are built from two free catalogs. Both keys stay with your hub.</p>
      <label htmlFor="setup-tmdb">TMDB API key</label><input id="setup-tmdb" type="password" value={tmdb} onChange={event => setTmdb(event.target.value)} autoComplete="off" placeholder="Paste it here" autoFocus/>
      <p className="muted small">Trending, top rated and popular rows, and search. <a className="link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Get a key</a>, and copy the one labelled “API Key”.</p>
      <label htmlFor="setup-mdblist">MDBList API key <span className="muted">(optional)</span></label><input id="setup-mdblist" type="password" value={lists} onChange={event => setLists(event.target.value)} autoComplete="off" placeholder="Paste it here"/>
      <p className="muted small">The collection rows: movies and shows by service and by genre. <a className="link" href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer">Get a key</a>. It can be added later under Hub, Sources.</p>
      <div className="split">{back}<button className="primary big" disabled={busy || !tmdb.trim()}>Continue</button></div>
    </form>}
    {at === 'Quality' && <form className="stack" onSubmit={event => {event.preventDefault(); setStep(step + 1);}}>
      <h1>How should it pick streams?</h1><p className="muted">A starting point for everyone. Anyone can be adjusted later.</p>
      <div className="choices tall">{([['saver', 'Data saver', 'Smaller files. Best for phones and slow connections.'], ['balanced', 'Balanced', 'Good picture without huge files. Recommended.'], ['best', 'Best', 'Highest quality available, largest files.']] as const).map(([value, label, detail]) => <button key={value} type="button" aria-pressed={quality === value} className={quality === value ? 'on' : ''} onClick={() => setQuality(value)}><strong>{label}</strong><small>{detail}</small></button>)}</div>
      <div className="split">{back}<button className="primary big">Continue</button></div>
    </form>}
    {at === 'First person' && <form className="stack" onSubmit={event => {
      event.preventDefault(); const text = first.trim(); if (!text) return;
      const group: Group = {id: slug(groupName) === 'person' ? 'family' : slug(groupName), name: groupName.trim() || 'Family', rows: null, settings: {}};
      const person = newPerson({...hub, people: []}, text, group.id);
      const finish = () => {
        update(next => {
          next.defaults = {...defaultSettings(), quality, debrid: service}; next.rows = defaultRows(); next.groups = [group]; next.people = [person];
          if (!live) {next.services = [service]; next.me.name = user.trim() || next.me.name;}
        });
        toast('You’re set up'); go(`/person/${person.id}/settings`);
      };
      // The key is stored first, on its own, so it never rides along with an ordinary save.
      if (live) work(live.call('PUT', `/api/services/${encodeURIComponent(service)}`, {key}).then(() => live.reload()), finish); else finish();
    }}>
      <h1>Who’s first?</h1><p className="muted">Add yourself or someone you’re sharing with. People sit in groups that share a Home and playback; more of both can come later.</p>
      <label htmlFor="setup-group">Group</label><input id="setup-group" value={groupName} onChange={event => setGroupName(event.target.value)} autoComplete="off"/>
      <label htmlFor="setup-first">Name</label><input id="setup-first" value={first} onChange={event => setFirst(event.target.value)} autoComplete="off" autoFocus placeholder="e.g. Sam"/>
      <div className="split">{back}<button className="primary big" disabled={busy || !first.trim()}>Finish</button></div>
    </form>}
  </div>;
}

/* ---------- what an invited person sees ---------- */
export function JoinPage(page: PageProps & {id: string; tab: string; base?: string}) {
  const {hub, update, toast, id, tab, live, go} = page, base = page.base ?? `/join/${id}`;
  const [pass, setPass] = useState(''), [changing, setChanging] = useState(false);
  const person = hub.people.find(item => item.id === id);
  if (!person) return <p className="empty">This link is no longer valid.</p>;
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === id)!)); toast(note);};
  if (!person.joined) return <form className="setup stack" onSubmit={event => {event.preventDefault(); edit(target => {target.joined = true; target.password = pass;}, 'You’re in');}}>
    <div className="stack center"><Avatar name={person.name} size={84}/><h1>Hi {person.name}</h1><p className="muted">{hub.me.name} invited you. Choose a password. It signs you in here and in the player apps.</p></div>

    <label htmlFor="join-pass">Password</label><input id="join-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete="off" autoFocus placeholder="At least 8 characters"/>
    <button className="primary big" disabled={pass.length < 8}>Continue</button>
    <p className="muted small center-text">Preview: any text works. A passkey can be added afterwards.</p>
  </form>;
  const tabs: [string, string][] = [['home', 'Home'], ...(person.can.playback ? [['playback', 'Playback'] as [string, string]] : []), ['devices', 'Devices'], ['accounts', 'Accounts'], ['activity', 'Activity'], ['you', 'You']];
  return <>
    <div className="person-head"><Avatar name={person.name} size={64}/><div><h1>{person.name}</h1><p className="muted">{hub.me.name ? `Shared with you by ${hub.me.name}` : 'Shared with you'}</p></div></div>
    {(person.paused || hub.groups.find(item => item.id === person.groupId)?.paused) && <div className="notice"><span>Nothing will play for you right now. Whoever set you up can sort it out. You can still browse and set things up.</span></div>}
    <Tabs base={base} tab={tab} tabs={tabs}/>
    {tab === 'home' && ((SAMPLE && !person.trakt) || !person.devices.length) && <div className="todo">
      {!person.devices.length && <a href={`#${base}/devices`}><span className="check" aria-hidden="true">→</span><span><strong>Watch on a device</strong><small>Phone, TV or laptop. Takes a minute.</small></span></a>}
      {!person.trakt && SAMPLE && <a href={`#${base}/accounts`}><span className="check" aria-hidden="true">→</span><span><strong>Connect Trakt</strong><small>Optional. Adds your watchlist and recommendations.</small></span></a>}
    </div>}
    <PersonSections page={page} person={person} tab={tab === 'playback' && !person.can.playback ? 'home' : tab} mine/>
    {tab === 'you' && <section>
      <div className="card settings">
        <Setting title="Name"><NameField label="Your name" value={person.name} onSave={value => edit(target => {target.name = value;}, 'Renamed')}/></Setting>
        <Setting title="Password" hint={live ? 'For this page. Player apps use their own password, under Devices.' : 'The same one signs you in to the player apps.'}><button type="button" className="ghost small" onClick={() => live ? setChanging(true) : toast('Preview: this asks for the old and a new password')}>Change</button></Setting>
        {SAMPLE && <Setting title="Passkey" hint="Sign in here with a fingerprint or face. Optional."><button type="button" className="ghost small" onClick={() => toast('Preview: this adds a passkey on this device')}>Add</button></Setting>}
      </div>
      {live && <button type="button" className="danger" onClick={() => void live.call('POST', '/api/signout', {}).then(() => {go('/'); return live.reload();}, fail(toast))}>Sign out</button>}
    </section>}
    {changing && live && <PasswordSheet toast={toast} onClose={() => setChanging(false)} onSave={(old, password) => live.call('POST', `/api/people/${id}/password`, {old, password}).then(() => live.reload())}/>}
  </>;
}

/* ---------- the real hub: opening an invite link, and signing in ---------- */
interface Asked {name: string; username: string; owner: string; joined: boolean}
export function JoinGate({token, live, toast, manager, onIn}: {token: string; live: Live; toast: (text: string) => void; manager: boolean; onIn: () => void}) {
  const [info, setInfo] = useState<Asked | 'gone' | null>(null), [pass, setPass] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {void live.call<{gone?: boolean; ok?: boolean; ask?: Asked}>('POST', '/api/join', {token}).then(found => found.ok ? onIn() : setInfo(found.ask ?? 'gone'), fail(toast));}, [token]);
  if (!info) return <p className="empty">Opening…</p>;
  if (info === 'gone') return <p className="empty">This link is no longer valid. Ask for a new one.</p>;
  if (manager) return <p className="empty">This is {info.name}’s link, and you’re signed in as the manager. Send it to them instead of opening it here. <a className="link" href="#/">Back to people</a></p>;
  return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call('POST', '/api/join', {token, password: pass}).then(onIn, fail(toast)).finally(() => setBusy(false));}}>
    <div className="stack center"><Avatar name={info.name} size={84}/><h1>Hi {info.name}</h1><p className="muted">{info.joined ? 'Type your password to open your page.' : 'You’ve been invited. Choose a password for your page here. Only you know it.'}</p></div>
    {/* Their name is their username. It only matters on the Devices tab, so it is not mentioned here; the hidden field lets a password manager file the password under it. */}
    <input type="text" value={info.username} readOnly autoComplete="username" hidden/>
    <label htmlFor="join-pass">Password</label><input id="join-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete={info.joined ? 'current-password' : 'new-password'} autoFocus placeholder={info.joined ? '' : 'At least 8 characters'}/>
    {!info.joined && !!pass && pass.length < 8 && <p className="warn small">At least 8 characters: {8 - pass.length} more to go.</p>}
    <button className="primary big" disabled={busy || pass.length < (info.joined ? 1 : 8)}>Continue</button>
    <p className="muted small center-text">{info.joined ? 'Forgot it? Whoever invited you can let you choose a new one.' : 'Player apps get their own password, which you’ll find inside.'}</p>
  </form>;
}
export function SignInPage({live, toast, canCreate}: {live: Live; toast: (text: string) => void; canCreate: boolean}) {
  // This browser remembers the last hub code used on it, so signing out never loses it.
  const [user, setUser] = useState(() => localStorage.getItem('hub-code') ?? ''), [pass, setPass] = useState(''), [code, setCode] = useState(''), [lost, setLost] = useState(false), [busy, setBusy] = useState(false);
  return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call('POST', '/api/signin', lost ? {username: user, recovery: code, password: pass} : {username: user, password: pass}).then(() => {localStorage.setItem('hub-code', user.trim().toLowerCase()); return live.reload();}, fail(toast)).finally(() => setBusy(false));}}>
    <h1>{lost ? 'Use a recovery code' : 'Sign in'}</h1><p className="muted">{lost ? 'A recovery code works once. Choose a new password with it.' : 'For the person who runs the hub. Invited? Open the link you were sent.'}</p>
    <label htmlFor="in-user">Hub code</label><input id="in-user" value={user} onChange={event => setUser(event.target.value)} autoComplete="username" autoCapitalize="none" autoFocus/>
    <p className="muted small">The short code you got when you created the hub.</p>
    {lost && <><label htmlFor="in-code">Recovery code</label><input id="in-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off"/></>}
    <label htmlFor="in-pass">{lost ? 'New password' : 'Password'}</label><input id="in-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete={lost ? 'new-password' : 'current-password'} placeholder={lost ? 'At least 8 characters' : ''}/>
    <button className="primary big" disabled={busy || !user.trim() || !pass || (lost && (!code.trim() || pass.length < 8))}>{lost ? 'Set password and sign in' : 'Sign in'}</button>
    {!lost && canPasskey() && <button type="button" className="ghost big" disabled={busy} onClick={() => {setBusy(true); void usePasskey().then(() => live.reload(), (error: Error) => toast(error.name === 'NotAllowedError' ? 'No passkey was used' : error.message)).finally(() => setBusy(false));}}>Use a passkey</button>}
    <button type="button" className="link center-text" onClick={() => setLost(!lost)}>{lost ? 'Back to sign in' : 'Forgot your password?'}</button>
    {canCreate ? <a className="link center-text" href="#/setup">Create a hub</a> : <p className="muted small center-text">This site isn’t taking new hubs right now.</p>}
  </form>;
}
