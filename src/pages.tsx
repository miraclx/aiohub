import {Fragment, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {FOR_YOU_KINDS, SAMPLE, isPlace, orderOf, allServices, signUp, defaultRows, defaultSettings, groupRows, hosts, isTrakt, newPerson, placed, pickable, TRAKT_IDS, withKids, withForYou, ownLists, personRows, currentPicks, linkedOf, needOf, resolve, samplePassword, samplePin, slug, traktRows, pillOf, SHELF_TITLES} from './data';
import type {Device, Group, Hub, Person, Row, Settings} from './data';
import {Activity} from './activity';
import {GroupOrder, HomeEditor, moved} from './home';
import {ForYouEditor, PlaybackEditor, SourcesEditor} from './settings';
import type {EditorProps} from './settings';
import {addPasskey, beAs, canPasskey, leaveAs, usePasskey} from './live';
import type {Live} from './live';
import {Avatar, Confirm, NameField, Secret, Segments, Setting, Sheet, Switch, Tabs, addReal} from './ui';

/* `live` is there when the page is backed by the real hub; without it everything runs on the preview's sample data. */
export interface PageProps {hub: Hub; go: (to: string) => void; update: (change: (hub: Hub) => void) => void; toast: (text: string) => void; live?: Live}
const HUB = 'Everyone';
const soon = (toast: (text: string) => void, what: string) => () => toast(`Preview: this opens ${what}`);
const fail = (toast: (text: string) => void) => (error: Error) => toast(error.message);

/* A person's sign-in details. On the real hub they are fetched for one person at a time, only when a page shows them. */
interface Creds {password: string; pin: string | null; link: string}
function useCreds({live}: PageProps, person: Person): [Creds | null, () => void] {
  // Kept with whose they are: another person's page shows nothing until its own have come, never the last person's.
  const [creds, setCreds] = useState<{id: string; creds: Creds} | null>(null), [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!live) return; let on = true;
    void live.settled().then(() => live.call<Creds>('GET', `/api/people/${person.id}/signin`)).then(found => {if (on) setCreds({id: person.id, creds: found});}, () => {});
    return () => {on = false;};
  }, [live, person.id, turn]);
  return [live ? creds?.id === person.id ? creds.creds : null : {password: person.password, pin: person.pin, link: `${location.origin}/${location.search}#/join/${person.id}`}, () => setTurn(turn + 1)];
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
function copyOf(hub: Hub, source: Person, name: string, groupId = source.groupId): Person {
  const copy = newPerson(hub, name, groupId);
  // Layout, settings and permissions come along. Connections, sign-in and devices never do.
  copy.rows = source.rows ? source.rows.filter(row => !TRAKT_IDS.has(row.id) && !isTrakt(row) && !row.source.endsWith('your list')) : null;
  copy.settings = structuredClone(source.settings); copy.can = {...source.can};
  return copy;
}

/* ---------- people ---------- */
export function PeoplePage(page: PageProps) {
  const {hub, go, update, toast} = page;
  const [adding, setAdding] = useState<string | null>(null), [name, setName] = useState(''), [from, setFrom] = useState(''), [grouping, setGrouping] = useState(false), [ordering, setOrdering] = useState(false);
  // Who is watching something right now, said beside their name. The rest of it is under Activity.
  const [playing, setPlaying] = useState<Record<string, string>>({});
  useEffect(() => {if (!page.live) return; void page.live.call<{now: number; sittings: {person: string; title: string; playing: number; paused?: number; updated: number}[]}>('GET', '/api/activity').then(found => setPlaying(Object.fromEntries(found.sittings.filter(play => play.playing && !play.paused && found.now - play.updated < 600).reverse().map(play => [play.person, play.title]))), () => {});}, [hub.v]);
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
/* Where a device was last seen from, said after when it was last used: " · last seen in Lagos, NG · SpaceX Services, Inc." */
const seenAt = (device: Device) => {
  const at = device.place ? [`in ${device.place}`, device.net].filter(Boolean).join(' · ') : device.net ? `on ${device.net}` : '';
  return at ? ` · ${device.seen === 'Now' ? '' : 'last seen '}${at}` : '';
};
function Devices({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {update, toast, live} = page;
  const [code, setCode] = useState(''), [pin, setPin] = useState<string | null>(null);
  const [ask, setAsk] = useState<{title: string; body: string; action: string; yes: () => void} | null>(null);
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
    {ask && <Confirm title={ask.title} body={ask.body} action={ask.action} onYes={() => {const yes = ask.yes; setAsk(null); yes();}} onClose={() => setAsk(null)}/>}
    {person.devices.length ? <><ul className="feed">{person.devices.map(device => <li key={device.id}><div className="quiet-name">{live ? <NameField label={`Name of ${device.name}`} value={device.name} onSave={value => act(live.call('PUT', `${at}/devices/${device.id}`, {name: value}), 'Renamed')}/> : <strong>{device.name}</strong>}<small>{device.app} · {device.seen === 'Now' ? 'active now' : `last used ${device.seen.toLowerCase()}`}{seenAt(device)}</small></div><button type="button" className="ghost small" onClick={() => setAsk({title: `Sign out ${device.name}?`, body: `The app on ${device.name} has to sign in again before it plays anything. Nothing else changes.`, action: 'Sign out', yes: () => live ? act(live.call('DELETE', `${at}/devices/${device.id}`), `${device.name} signed out`) : edit(target => {target.devices = target.devices.filter(item => item.id !== device.id);}, `${device.name} signed out`)})}>Sign out</button></li>)}</ul>
      <button type="button" className="link below" onClick={() => live ? act(live.call('POST', `${at}/rotate`, {}), 'Signed out everywhere. New password set.') : edit(target => {target.devices = []; target.password = samplePassword(person.id);}, 'Signed out everywhere. New password set.')}>Sign {who} out everywhere</button></>
      : <p className="muted">No device yet.</p>}
  </section>;
}
/* Which account is connected, on its own line under the name: a long username is cut short there, not mid-sentence. */
const Who = ({name}: {name: string}) => <p className="who" title={name || undefined}>{name ? <>Connected as <strong>{name}</strong></> : 'Connected'}</p>;
/* What the Accounts tab says, and the Worker does (trakt.ts, sync.ts, hearts.ts, native.ts):
   - Connect means the hub reads from an account, for its rows on Home. It never writes to it. The Trakt and MDBList cards hold
     only that: connect or disconnect, who it is connected as, and what connecting gives.
   - Sync is what writes, and is the Sync card's alone: a switch per connected account for what they watch (finished plays and
     paused spots; sync itself only adds), and one Watchlist switch for the titles they save in the apps.
   - Two things remove, each only in answer to what they did in an app: a title marked unwatched there leaves their Trakt history
     while Trakt sync is on, and a title un-saved there leaves their Trakt watchlist while Watchlist is on (front.ts).
   - Which watchlist is not a setting: Trakt's when Trakt is connected, with MDBList following; else MDBList's.
   - Whose they are (api.ts, `theirs`): once a person has joined, their accounts and their sync are theirs alone. Their manager
     sees whether each account is connected and how each switch stands, and can change none of it: the cards have no buttons,
     and one line at the top says so. For someone who has not joined, the manager connects accounts with them and sets MDBList
     sync and Watchlist; Trakt sync waits for them.
   What each switch drives has one owner, made here once (useTraktSync, useListsSync) and read by the cards: the page's rounds of
   catching up must never run twice. */
function Accounts({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {hub, live} = page, group = hub.groups.find(item => item.id === person.groupId)!;
  const trakt = useTraktSync(page, person, mine), lists = useListsSync(page, person, mine || !person.joined);
  const linked = live ? !!person.history || person.lists || !!person.listsKept || !!person.moving : !!person.trakt || person.lists;
  return <section>
    <div className="section-head"><div><h2>Accounts</h2><p className="muted">{mine ? 'Connect your own accounts. Connecting only reads from them. Sync, below, is what writes.' : live && person.joined ? `${person.name} manages their own accounts and sync.` : live ? <>{person.name} can connect their own accounts, or you can do it here with them. Connecting only reads from them. Sync, below, is what writes.</> : <>Only {person.name} can connect these, from their own page. <a className="link" href={`#/person/${person.id}/settings`}>Get their link</a></>}</p></div></div>
    <ul className="accounts">
      <li><div><h3>Streams</h3><p>Played through the shared {resolve(hub, group, person).values.debrid} account. Nothing to set up.</p></div><span className="pill ok">Shared</span></li>
      <Trakt page={page} person={person} mine={mine}/>
      <MdbList page={page} person={person} mine={mine} sync={lists}/>
    </ul>
    {linked && <SyncCard page={page} person={person} mine={mine} trakt={trakt} lists={lists}/>}
  </section>;
}
/* Trakt: one connection, the hub's own. Connecting gives the Trakt rows on Home and nothing else. Connecting is Trakt's own
   sign-in (OAuth with PKCE), done by this page with Trakt directly: Trakt turns away the
   shared addresses the hub calls from for a while at times, and a browser is not affected. The proof that finishes the sign-in
   stays in this tab; the hub only gets the finished login, to keep and renew. */
const TRAKT_AUTH = 'https://auth.trakt.tv', TRAKT_API = 'https://api.trakt.tv', SIGNING = 'trakt-signing';
interface Signing {state: string; verifier: string; person: string; hub: string; back: string}
let returned: {code: string; state: string; error: string} | null = null, lost = '';
const packed = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signing = () => {try {return JSON.parse(sessionStorage.getItem(SIGNING) ?? 'null') as Signing | null;} catch {return null;}};
/* Back from Trakt's sign-in (the hub sends it on to #/trakt?code=…&state=…): what Trakt sent is set aside for the Trakt card and
   the address goes back to where Connect was pressed, before anything reads it. Run once, as the page loads. */
export function backFromTrakt() {
  if (!location.hash.startsWith('#/trakt?')) return;
  const got = new URLSearchParams(location.hash.slice(8)), saved = signing();
  if (saved) returned = {code: got.get('code') ?? '', state: got.get('state') ?? '', error: got.get('error') ?? ''};
  else lost = 'Trakt’s sign-in came back to a different tab or browser. Connect again from here.';
  history.replaceState(null, '', location.pathname + location.search + (saved?.back || '#/'));
}
/* Said once the hub has loaded, if Trakt's sign-in could not be finished here. */
export const lostTrakt = () => {const note = lost; lost = ''; return note;};
/* Asks Trakt again while it is busy (429, a fault on its side, no answer), as long as it says to wait, for about a minute. */
async function patiently(ask: () => Promise<Response>, waiting: () => void): Promise<Response | null> {
  for (let tries = 0; ; tries++) {
    const answer = await ask().catch(() => null);
    if (answer && answer.status !== 429 && answer.status < 500) return answer;
    if (tries === 4) return null;
    waiting();
    await new Promise(resolve => setTimeout(resolve, Math.min(30, Number(answer?.headers.get('retry-after')) || 2 ** (tries + 1)) * 1000));
  }
}
/* A time as the page says it: "10:42 PM" for today, or the date with it. */
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
const whenOf = (ms: number) => {const date = new Date(ms), today = new Date().toDateString() === date.toDateString(); return today ? clock(ms) : `${date.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})} at ${clock(ms)}`;};
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() === new Date().getFullYear() ? {} : {year: 'numeric'})});
/* What the page says while Trakt has asked the hub to wait (it says for how long; the hub asks nothing of theirs until then). */
const toldToWait = (until: number) => `Trakt asked us to wait until ${clock(until * 1000)}.`;
const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;
// Three days without a good pass (or a call waiting that long for Trakt) is when sync says it is stuck; a page-open pass runs
// when the last good one is older than AGAIN_PASS. QUEUED: how long a call may wait for Trakt before the line says Trakt is not
// answering.
const STUCK = 3 * 86400, AGAIN_PASS = 600, QUEUED = 600;
/* What an account gives, as short lines: the same before and after connecting, so the reasons stay in sight. */
const Gains = ({lines}: {lines: string[]}) => <div className="gains">{lines.map(line => <p key={line}>{line}</p>)}</div>;
/* The Trakt card: Connect gives its rows, and that is all it holds. The hub fills the Trakt rows on Home from the connection
   (rows.ts) and writes nothing to Trakt. Whether their watching or their watchlist is synced is the Sync card's (below).
   Connecting is Trakt's own sign-in (OAuth with PKCE), done by this page with Trakt directly: Trakt turns away the shared
   addresses the hub calls from for a while at times, and a browser is not affected. The proof that finishes the sign-in stays in
   this tab; the hub only gets the finished login, to keep and renew. */
function Trakt({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {hub, update, toast, live} = page, at = `/api/people/${person.id}/scrobble`, link = person.history;
  const [phase, setPhase] = useState<'' | 'going' | 'connecting' | 'busy'>(''), busy = !!phase, [dropping, setDropping] = useState(false);
  const [older, setOlder] = useState(false);
  const their = mine ? 'your' : 'their', client = hub.traktClient ?? '';
  // The sign-in Trakt just sent back here, if it was for this person: the code is exchanged for the login, once.
  useEffect(() => {
    const back = returned, saved_ = signing();
    if (!live || !back || saved_?.person !== person.id || saved_.hub !== hub.code) return;
    returned = null; sessionStorage.removeItem(SIGNING);
    if (back.error || !back.code) return void toast(back.error === 'access_denied' ? 'Trakt wasn’t connected.' : 'Trakt didn’t finish signing in. Connect again.');
    if (back.state !== saved_.state) return void toast('That Trakt sign-in wasn’t started here. Connect again.');
    void finish(back.code, saved_.verifier);
  }, []);
  const finish = async (code: string, verifier: string) => {
    setPhase('connecting');
    const redirect = `${location.origin}/api/trakt/callback`, waiting = () => setPhase('busy');
    // Trakt's sign-in host allows only plain headers from a page; the API host wants its own.
    const token = await patiently(() => fetch(`${TRAKT_AUTH}/oauth/token`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code, client_id: client, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier})}), waiting);
    const said = token ? await token.json().catch(() => null) as {access_token?: string; refresh_token?: string; expires_in?: number; created_at?: number; error?: string} | null : null, got = token?.ok ? said : null;
    // Trakt's own reason (its status and error name, never anything secret) goes in the message, so a failure can be told apart.
    if (!got?.access_token || !got.refresh_token) {setPhase(''); return toast(token ? `Trakt didn’t accept that sign-in (${token.status}${said?.error ? ` ${String(said.error).slice(0, 40)}` : ''}). Connect again.` : 'Trakt isn’t answering right now. Connect again in a few minutes.');}
    const me = await patiently(() => fetch(`${TRAKT_API}/users/settings`, {headers: {'content-type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': client, authorization: `Bearer ${got.access_token}`}}), waiting);
    const username = String((me?.ok ? await me.json().catch(() => null) as {user?: {username?: string}} | null : null)?.user?.username ?? '');
    setPhase('connecting');
    await live!.call('POST', `${at}/link`, {access: got.access_token, refresh: got.refresh_token, lasts: got.expires_in, created: got.created_at, username, redirect})
      .then(() => {toast(username ? `Trakt connected as ${username}` : 'Trakt connected'); live!.apps(); void live!.reload();}, fail(toast));
    setPhase('');
  };
  // What connecting gives. Nothing here needs sync, and only what truly needs Trakt is said:
  // - For you works without Trakt, from what was watched here (or their MDBList); with it, their whole Trakt history is read too
  //   (foryou.ts, gather).
  // - Up Next and New for you work without Trakt, from what was watched here (ahead.ts); with it they are Trakt's own (rows.ts,
  //   fill), which knows what was watched anywhere.
  // - Only their Trakt lists need Trakt. The Watchlist comes with MDBList alone too, Recommended is worked out from what was
  //   watched, and Recently Watched from MDBList or here.
  const gains = [...(hub.front ? [`For you also learns from what ${mine ? 'you’ve' : 'they’ve'} watched on Trakt.`] : []),
    `Up Next and New for you follow ${their} Trakt, so they count what ${mine ? 'you' : 'they'} watch anywhere.`, `Adds ${their} Trakt lists to Home.`];
  // Once they have joined, their accounts are theirs alone: their manager sees who it is connected as, and no buttons.
  const on = !!link && !link.again, shown = !mine && !!live && person.joined;
  if (!live) {
    const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
    return <li className="stacked"><div className="account-row"><div><h3>Trakt <span className="free">Free</span></h3>{person.trakt && <Who name=""/>}</div>
      {person.trakt ? <button type="button" className="ghost small" onClick={() => edit(target => {target.trakt = false; target.rows = target.rows?.filter(row => !isTrakt(row)) ?? null;}, 'Trakt disconnected')}>Disconnect</button>
        : mine ? <button type="button" className="primary small" onClick={() => edit(target => {target.trakt = true; if (target.rows) target.rows = [...traktRows(), ...target.rows];}, 'Trakt connected')}>Connect</button>
        : <span className="pill" title={`Send ${person.name} their link from the Settings tab`}>Waiting for {person.name}</span>}</div><Gains lines={gains}/></li>;
  }
  // Saved once the hub answers; the apps catch up in the background.
  const work = (call: Promise<unknown>, note: string) => {setPhase('going'); void call.then(() => {toast(note); live.apps(); return live.reload();}, fail(toast)).finally(() => setPhase(''));};
  const connect = async () => {
    setPhase('going');
    const verifier = packed(crypto.getRandomValues(new Uint8Array(48))), state = packed(crypto.getRandomValues(new Uint8Array(16)));
    const challenge = packed(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(SIGNING, JSON.stringify({state, verifier, person: person.id, hub: hub.code, back: location.hash} satisfies Signing));
    // Connecting for someone else, this browser may be signed in to Trakt as someone else: Trakt then asks who is signing in.
    const ask = new URLSearchParams({response_type: 'code', client_id: client, redirect_uri: `${location.origin}/api/trakt/callback`, state, code_challenge: challenge, code_challenge_method: 'S256', ...(mine ? {} : {prompt: 'login'})});
    location.assign(`${TRAKT_AUTH}/oauth/authorize?${ask}`);
  };
  if (shown) return <li className="stacked"><div className="account-row"><div><h3>Trakt <span className="free">Free</span></h3>{on ? <Who name={link!.username}/> : <p className="who">Not connected</p>}</div></div>
    {link?.again && <p className="small status-line" role="status"><span className="dot off" aria-hidden="true"/><span>Trakt needs {person.name} to sign in again.</span></p>}</li>;
  return <li className="stacked"><div className="account-row"><div><h3>Trakt <span className="free">Free</span></h3>{on && <Who name={link!.username}/>}</div>
    {!hub.scrobble || !client ? <span className="pill">Not on this site</span>
      : on ? <button type="button" className="ghost small" disabled={busy} onClick={() => setDropping(true)}>Disconnect</button>
      : <button type="button" className="primary small" disabled={busy} onClick={() => void connect()}>Connect</button>}</div>
    <Gains lines={gains}/>
    {phase === 'connecting' || phase === 'busy' ? <p className="muted small" role="status">{phase === 'busy' ? 'Trakt asked us to wait a moment. Still connecting…' : 'Connecting to Trakt…'}</p>
      : link?.again ? <p className="small status-line" role="status"><span className="dot off" aria-hidden="true"/><span>{mine ? 'Trakt needs you to sign in again.' : `Trakt needs ${person.name} to sign in again.`}</span></p>
      : !on && !mine && hub.scrobble && client ? <p className="muted small">Trakt asks who’s signing in, so {person.name} can use their own Trakt account.</p> : null}
    {person.aiomTrakt && <div className="quiet-note"><p className="muted small">{on ? 'An older Trakt link, made through AIOMetadata, is still there. Nothing uses it any more.' : 'Home’s Trakt rows come from an older link made through AIOMetadata for now. Connecting here takes over from it.'}</p>
      <button type="button" className="link small" disabled={busy} onClick={() => on ? work(live.call('DELETE', `/api/people/${person.id}/trakt`), 'Older Trakt link removed') : setOlder(true)}>Disconnect it</button></div>}
    {older && <Confirm title="Disconnect the older Trakt link?" body={`Home’s Trakt rows come from it for now, so they leave ${their} Home until Trakt is connected above. Nothing on Trakt itself changes.`} action="Disconnect" onYes={() => {setOlder(false); work(live.call('DELETE', `/api/people/${person.id}/trakt`), 'Older Trakt link removed');}} onClose={() => setOlder(false)}/>}
    {dropping && <Confirm title="Disconnect Trakt?" body={`${mine ? 'Your' : 'Their'} Trakt rows leave Home and sync stops. Anything still waiting to be sent to Trakt is dropped. Nothing on Trakt itself changes, and connecting again brings the rows back.`} action="Disconnect" onYes={() => {setDropping(false); work(live.call('DELETE', at), 'Trakt disconnected');}} onClose={() => setDropping(false)}/>}
  </li>;
}
/* Trakt sync as the page drives it (sync.ts), strictly off until the person turns it on, on their own page: on, what is watched
   here goes to Trakt as it plays and what is watched in other Trakt apps comes back (plays and paused spots, nothing removed);
   off, nothing moves either way. A manager is never offered any of it. One owner (Accounts), so a round of catching up never
   runs twice.
   - `turn`: the switch, and the answer to the one question asked right after their own sign-in. `early`: with sync on, also
     send what they watched here before it was turned on (the one bulk write Trakt cannot undo in one go).
   - `earlier`: those plays, for the one-off line under the switch: asked for only with sync on, while they have neither agreed
     to send them nor said "Not now" (`later`, kept by the hub for that set).
   - `catching`: a round of catching up under way from this page: how many went to Trakt of about how many. */
type Early = {n: number; plays: {title: string; detail: string; at: number}[]};
function useTraktSync(page: PageProps, person: Person, mine: boolean) {
  const {hub, toast, live} = page, link = person.history, matching = person.matching ?? null, on = !!link && !link.again, whose = `${hub.code}/${person.id}`;
  const [catching, setCatching] = useState<{sent: number; total: number} | null>(null), running = useRef(false), planned = useRef(0), [busy, setBusy] = useState(false);
  // Kept with whose they are: another person's page never shows the last person's.
  const [early, setEarly] = useState<{who: string; found: Early} | null>(null);
  const offered = !!live && mine && on && !!matching?.on && !matching.earlier && !matching.passed;
  useEffect(() => {
    if (!offered) return;
    let gone = false;
    void live!.call<{earlier: number; plays: Early['plays']}>('GET', `/api/people/${person.id}/matching`).then(got => {if (!gone) setEarly({who: whose, found: {n: got.earlier, plays: got.plays ?? []}});}, () => {});
    return () => {gone = true;};
  }, [whose, offered]);
  // Passes of catching up, from this page and only with sync on, until there is no more: what was watched here that Trakt lacks,
  // and what Trakt has that is missing here. `loud`: said when it fails (a press of Try again); otherwise the cron tries again by itself.
  const catchUp = async (loud: boolean, total = 0) => {
    if (running.current) return;
    running.current = true;
    let sent = 0; setCatching({sent, total});
    try {
      for (let pass = 0; pass < 30; pass++) {
        const got = await live!.call<{trakt: number; home: number; left: number; more: boolean}>('POST', `/api/people/${person.id}/matching/pass`, {});
        sent += got.trakt; setCatching({sent, total: Math.max(total, sent + got.left)});
        if (!got.more) break;
      }
      if (loud) toast(sent ? `Added ${things(sent)} to Trakt` : 'Nothing needed adding');
    } catch (error) {const until = (error as {until?: number}).until ?? 0; if (loud) toast(until ? toldToWait(until) : (error as Error).message);} finally {running.current = false; setCatching(null); await live!.reload();}
  };
  // On their own page, with sync on: one round of catching up when the page opens or it is turned on, unless one just ran or Trakt
  // has asked the hub to wait.
  useEffect(() => {if (live && mine && on && matching?.on && Date.now() / 1000 - matching.good > AGAIN_PASS && !((matching.until ?? 0) > Date.now() / 1000)) {const total = planned.current; planned.current = 0; void catchUp(false, total);}}, [person.id, matching?.on]);
  const found = offered && early?.who === whose && early.found.n ? early.found : null;
  const turn = async (yes: boolean, add = false) => {
    if (busy) return;
    const was = !!matching?.on, agreed = yes && add ? found?.n ?? 0 : 0;
    setBusy(true);
    // Once agreed to, earlier plays stay agreed to while sync stays on.
    try {await live!.call('POST', `/api/people/${person.id}/matching`, {on: yes, earlier: yes && (add || (was && !!matching?.earlier))});} catch (error) {setBusy(false); return toast((error as Error).message);}
    setBusy(false);
    // Not now, at the question after connecting; or turned off, which stops both directions at once.
    if (!yes) {toast(was ? 'Trakt sync is off. Nothing is sent to Trakt and nothing comes back.' : 'Trakt sync is off. You can turn it on here any time.'); return void live!.reload();}
    // Caught up by the page-open round above, which starts as it turns on.
    planned.current = agreed; toast(was ? `Adding ${things(agreed)} to Trakt` : 'Trakt sync is on'); await live!.reload();
    // Already on (earlier plays agreed to): that round does not start again by itself.
    if (was) {const total = planned.current; planned.current = 0; await catchUp(false, total);}
  };
  const later = () => {setBusy(true); void live!.call('POST', `/api/people/${person.id}/matching/later`, {}).then(() => live!.reload(), fail(toast)).finally(() => setBusy(false));};
  return {catching, catchUp, turn, later, earlier: found, busy};
}
/* MDBList sync as the page drives it. Underneath, MDBList becomes where their progress is kept and AIOMetadata tracks it there
   itself (worker/native.ts): turning it on copies what was watched here that MDBList lacks, then switches; turning it off copies
   back what only MDBList has, then switches back (places.ts), so nothing is lost either way. Where progress is kept is never
   said on the page. The page drives the copying, a pass at a time, and picks it up again if it was left part way; while it
   runs, in either direction, the line reads "Catching up. You can keep watching." The manager's switch, and Disconnect while
   sync is on (the MDBList card), go the same way, and only while the person has not joined (`sets`: the switch is theirs, or their
   manager's until they join; the hub refuses anyone else). One owner (Accounts): the copying must never run twice. */
function useListsSync(page: PageProps, person: Person, sets: boolean) {
  const {toast, live} = page, at = `/api/people/${person.id}/mdblist`, moving = person.moving ?? null;
  // A switch under way: which way, how many copied of about how many. Then why it stopped, if it did.
  const [copying, setCopying] = useState<{to: 'mdblist' | 'here'; done: number; total: number} | null>(null), [stopped, setStopped] = useState(''), [busy, setBusy] = useState(false);
  const target = moving === 'mdblist' ? true : moving === 'here' ? false : person.lists;
  const done = async (note: string) => {toast(note); live!.apps(); await live!.reload();};
  // Copies what the other side lacks, a pass at a time, and switches once it is all across. True when it switched.
  const move = async (to: 'mdblist' | 'here') => {
    setCopying({to, done: 0, total: 0}); setStopped('');
    try {
      if (to === 'mdblist' && moving !== 'mdblist') {await live!.call('POST', at, {reuse: true, moving: true}); await live!.reload();}
      // Back here: their setup stops passing plays on to MDBList first, so what is ticked here echoes nowhere.
      if (to === 'here') {if (moving !== 'here') {await live!.call('POST', `/api/people/${person.id}/moving`, {to: 'here'}); await live!.reload();} await live!.sync();}
      let added = 0, switched = false;
      for (let pass = 0; pass < 30 && !switched; pass++) {
        const got = await live!.call<{added: number; left: number; more: boolean; switched: boolean}>('POST', `/api/people/${person.id}/compare/${to === 'mdblist' ? 'here-mdblist' : 'mdblist-here'}`, {switch: true});
        added += got.added; switched = got.switched; setCopying({to, done: added, total: added + (got.left ?? 0)});
        if (!got.more && !switched) break;
      }
      if (switched) {await live!.sync(); await done(to === 'mdblist' ? 'MDBList sync is on' : 'MDBList sync is off. Nothing was lost.');}
      return switched;
    } catch (error) {setStopped((error as Error).message); await live!.reload(); return false;} finally {setCopying(null);}
  };
  // Left part way (the page was closed): picked up again when it opens.
  useEffect(() => {if (live && sets && moving && !copying) void move(moving === 'here' ? 'here' : 'mdblist');}, [person.id]);
  // The switch: on copies then switches; off while copying over undoes it at once (nothing switched yet).
  const flip = (on: boolean) => {
    if (copying || busy || !sets) return;
    if (on && moving === 'here') {setBusy(true); void live!.call('POST', `/api/people/${person.id}/moving`, {to: null}).then(() => {setStopped(''); return done('MDBList sync stays on');}, fail(toast)).finally(() => setBusy(false)); return;}
    if (!on && moving === 'mdblist') {setBusy(true); void live!.call('DELETE', at).then(() => {setStopped(''); return done('MDBList sync stays off');}, fail(toast)).finally(() => setBusy(false)); return;}
    void move(on ? 'mdblist' : 'here');
  };
  return {copying, stopped, setStopped, busy, setBusy, target, done, move, flip};
}
/* What was synced: the Sync card offers one short list of what the hub
   did for them lately (the `sent` ledger: what it is called, where it went, when), newest first; a paused spot that took the
   place of an earlier one reads as updated rather than added. Asked for only when opened, and
   only on their own page. A title they marked unwatched in an app reads "removed from Trakt"; a tick taken back whose play
   Trakt did not have reads "not found on Trakt, so nothing was removed", and one Trakt did not answer for "Trakt didn’t answer, so
   nothing was removed". */
interface Sync {title: string; detail: string; to: 'trakt' | 'here' | 'mdblist'; spot: boolean; updated?: boolean; removed?: boolean; missed?: boolean; unasked?: boolean; at: number}
function Synced({page, person}: {page: PageProps; person: Person}) {
  const {live, hub} = page, whose = `${hub.code}/${person.id}`;
  const [open, setOpen] = useState(false), [got, setGot] = useState<{who: string; list: Sync[] | null; failed: boolean}>({who: '', list: null, failed: false});
  useEffect(() => {
    if (!live || !open) return;
    let gone = false;
    void live.call<{synced: Sync[]}>('GET', `/api/people/${person.id}/matching/synced`).then(found => {if (!gone) setGot({who: whose, list: found.synced, failed: false});}, () => {if (!gone) setGot({who: whose, list: null, failed: true});});
    return () => {gone = true;};
  }, [whose, open, person.matching?.good]);
  const list = got.who === whose ? got.list : null, to = {trakt: ['to Trakt', 'on Trakt'], here: ['here', 'here'], mdblist: ['to your MDBList', 'in your MDBList']};
  return <div className="synced">
    <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide what was synced' : 'What was synced'}</button>
    {open && (list ? list.length ? <div className="listed">{list.map((item, n) => <p key={n}><strong>{item.title}</strong> · {item.detail ? `${item.detail} · ` : ''}{item.spot ? 'paused spot ' : ''}{item.missed ? 'not found on Trakt, so nothing was removed' : item.unasked ? 'Trakt didn’t answer, so nothing was removed' : item.removed ? 'removed from Trakt' : item.updated ? `updated ${to[item.to][1]}` : `added ${to[item.to][0]}`} · {dateOf(item.at * 1000)}</p>)}</div>
      : <p className="muted small">Nothing has needed syncing yet.</p> : <p className="muted small">{got.failed && got.who === whose ? 'Couldn’t load the list just now.' : 'Loading…'}</p>)}
  </div>;
}
/* The Sync card, shown once any account is connected: every switch that writes to an account, and nothing else. Stupid simple
   on purpose: a row a switch, each with its name, the switch, one sentence of what it does, and under that at most one quiet
   line. Nothing on it explains sync twice.
   - A row only for an account that is connected: Trakt, MDBList, then Watchlist for whatever is connected (the hub says when
     it can be had: `hearts`). Then, while either sync is on, what unwatching does (in an app it reaches everywhere; on
     Trakt's own site or apps it does not reach here, said only with Trakt sync on), and What was synced.
   - Under a switch: normally "Last checked 6:20 PM" (Trakt) or nothing. A status line speaks only when something is unusual
     (catching up, told to wait, not answering, sign in again, stopped), one short sentence each.
   - The one question, right after their own Trakt sign-in: answering it sets the Trakt switch, and it is never asked again.
   - Two one-off offers, each one line with what can be done, and a small confirm before anything is added: what they watched
     here before turning Trakt sync on, and titles they had saved that their Trakt watchlist lacks (counted by the cron).
   - Who sets what (the API holds the same rule: api.ts, `theirs`): they set all three from their own page. Their manager sets
     none of them once they have joined (each shows as it is; the line at the top of the tab says so); for someone who has not joined, the
     manager sets MDBList sync and Watchlist, and Trakt sync waits for them (only they can turn it on, from their own page).
   Where their progress is kept is not said here. */
function SyncCard({page, person, mine, trakt, lists}: {page: PageProps; person: Person; mine: boolean; trakt: ReturnType<typeof useTraktSync>; lists: ReturnType<typeof useListsSync>}) {
  const {hub, toast, live} = page, link = person.history, matching = person.matching ?? null;
  const [listing, setListing] = useState(false), [going, setGoing] = useState(false), [sure, setSure] = useState<'' | 'plays' | 'saves'>('');
  // The preview has no hub behind it: its Trakt and Watchlist switches are kept here, for show.
  const [shown, setShown] = useState({watching: true, hearts: false});
  const I = mine ? 'I' : 'they', my = mine ? 'my' : 'their', your = mine ? 'your' : 'their', keep = `${mine ? 'You' : 'They'} can keep watching.`;
  // Theirs to set, or their manager's while they have not joined. Trakt sync is theirs alone.
  const sets = mine || !person.joined;
  const hasTrakt = live ? !!link : !!person.trakt, on = live ? !!link && !link.again : !!person.trakt;
  const hasLists = live ? person.lists || !!person.listsKept || !!person.moving : person.lists;
  const watching = live ? on && !!matching?.on : hasTrakt && shown.watching;
  const hearts = live ? person.hearts ?? null : hub.front && (hasTrakt || hasLists) ? {on: shown.hearts} as NonNullable<Person['hearts']> : null;
  const {catching, earlier} = trakt, {copying, stopped} = lists;
  // The question, once: while they have yet to answer after their own sign-in.
  const asking = !!live && mine && on && !!matching?.ask && !matching.on;
  /* Under the Trakt switch. Unusual: told to wait (by Trakt, with the time), not answering, their MDBList key refused, nothing
     taken for three days (with Try again), or paused until Trakt is signed in to again. Otherwise only when it last checked. */
  const time = Date.now() / 1000, since = Math.min(matching?.failing ?? Infinity, matching?.waiting ?? Infinity), stuck = since < Infinity && time - since > STUCK;
  // Calls of theirs waiting for Trakt for a while (it keeps turning them away): not answering, though no look has failed.
  const queued = !!matching?.waiting && time - matching.waiting > QUEUED;
  const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, {weekday: 'long'}), why = matching?.failing ? matching.why ?? '' : '';
  const odd: {dot: 'wait' | 'off'; text: ReactNode} | null = !live || !matching || asking ? null
    : link?.again ? matching.on ? {dot: 'off', text: mine ? 'Paused. Sign in to Trakt again, above.' : 'Paused until they sign in to Trakt again.'} : null
    : catching && (catching.total || catching.sent) ? {dot: 'wait', text: `Catching up. ${keep}`}
    : !matching.on ? null
    : (matching.until ?? 0) > time ? {dot: 'wait', text: toldToWait(matching.until!)}
    : why.startsWith('MDBList') ? {dot: 'off', text: `MDBList isn’t accepting ${your} key. If that lasts a day, connect MDBList again.`}
    : stuck ? {dot: 'off', text: <>Trakt hasn’t answered since {day(since)}. {mine && <button type="button" className="link small" disabled={!!catching} onClick={() => void trakt.catchUp(true)}>Try again</button>}</>}
    : why.startsWith('Trakt') || (queued && !why) ? {dot: 'wait', text: 'Trakt isn’t answering. We’ll try again within the hour.'}
    : why ? {dot: 'wait', text: why}
    : null;
  const checked = !!live && on && !asking && !!matching?.on && !odd && !!matching.good ? `Last checked ${whenOf(matching.good * 1000)}` : '';
  // Leaving watched titles out of rows takes two switches: MDBList sync (here), and Hide what's been watched (under Playback).
  const hiding = resolve(hub, hub.groups.find(item => item.id === person.groupId), person).values.hideWatched, playback = mine ? '#/me/playback' : `#/person/${person.id}/playback`;
  // (Why catching up stopped is the hub's own words: only their first sentence is said here, to keep the line short.)
  const preview = () => toast('Preview: nothing is connected here');
  // The Watchlist switch and its offer: saved once the hub answers. The switch changes their setup, so the apps follow (`apps`).
  const ask = (path: string, body: unknown, note: (got: {added?: number; more?: boolean}) => string, apps = false) => {setGoing(true); void live!.call<{added?: number; more?: boolean}>('POST', `/api/people/${person.id}/favorites${path}`, body).then(got => {toast(note(got)); if (apps) live!.apps(); return live!.reload();}, fail(toast)).finally(() => setGoing(false));};
  const extra = mine && hearts?.on ? hearts.extra ?? 0 : 0;
  // Which watchlist is not a setting (Trakt's when Trakt is connected, else MDBList's), and no account is named here.
  const saves = mine ? 'Save a title in an app (the heart, in some apps) and it’s on my watchlist. Add one to my watchlist and it shows as saved in the apps.'
    : 'A title they save in an app (the heart, in some apps) goes on their watchlist. One added to their watchlist shows as saved in the apps.';
  // What unwatching does, said while a sync is on. In an app: their own setup takes it, MDBList hears through their setup while
  // MDBList sync is on, and Trakt through the hub while Trakt sync is on (front.ts, unmarked). On Trakt's side it is not looked
  // for. On MDBList's side nothing is said: what their setup does with it is its own.
  const anySync = watching || (live ? person.lists : hasLists);
  return <div className="card settings sync-card">
    <div className="setting column"><h3>Sync</h3>
      {asking && <div className="consent">
        <p className="ask"><strong>Sync what you watch with Trakt?</strong> What you watch here goes to Trakt, and what you watch in other Trakt apps comes back.</p>
        <div className="consent-actions"><button type="button" className="primary small" disabled={trakt.busy} onClick={() => void trakt.turn(true)}>Turn on</button>
          <button type="button" className="link small" disabled={trakt.busy} onClick={() => void trakt.turn(false)}>Not now</button></div>
      </div>}
    </div>
    {hasTrakt && <div className="setting column sync-row">
      <div className="switch-row"><h3>Trakt</h3><Switch checked={watching} disabled={!mine || (!!live && !on) || trakt.busy} label="Trakt sync" onChange={value => live ? void trakt.turn(value) : setShown({...shown, watching: value})}/></div>
      <p>Keep what {I} watch the same here and on Trakt.</p>
      {odd ? <p className="status-line" role="status"><span className={`dot ${odd.dot}`} aria-hidden="true"/><span>{odd.text}</span></p>
        : checked ? <p className="quiet">{checked}</p>
        : !mine && sets ? <p className="quiet">Only {person.name} can turn this on, after they join.</p> : null}
      {/* Once, with sync on: what they watched here before turning it on. Never part of turning sync on itself. */}
      {earlier && !catching && <div className="offer">
        <p>{things(earlier.n)} you watched here earlier {earlier.n === 1 ? 'isn’t' : 'aren’t'} on Trakt.</p>
        <div className="offer-actions"><button type="button" className="link small" aria-expanded={listing} onClick={() => setListing(!listing)}>{listing ? 'Hide them' : 'Show them'}</button>
          <button type="button" className="link small" disabled={trakt.busy} onClick={() => setSure('plays')}>Add them</button>
          <button type="button" className="link small" disabled={trakt.busy} onClick={() => {setListing(false); trakt.later();}}>Not now</button></div>
        {listing && <div className="listed">{earlier.plays.map((play, n) => <p key={n}><strong>{play.title}</strong> · {play.detail} · {dateOf(play.at * 1000)}</p>)}{earlier.n > earlier.plays.length && <p>and {earlier.n - earlier.plays.length} more</p>}</div>}
      </div>}
      {sure === 'plays' && earlier && <Confirm plain title={`Add ${things(earlier.n)} to Trakt?`} body="Trakt can’t undo this in one go." action="Add them" onYes={() => {setSure(''); setListing(false); void trakt.turn(true, true);}} onClose={() => setSure('')}/>}
    </div>}
    {hasLists && <div className="setting column sync-row">
      <div className="switch-row"><h3>MDBList</h3><Switch checked={copying ? copying.to === 'mdblist' : lists.target} disabled={!sets || lists.busy} onChange={value => live ? lists.flip(value) : preview()} label="MDBList sync"/></div>
      <p>Keep what {I} watch the same here and on MDBList.</p>
      {copying ? <p className="status-line" role="status"><span className="dot wait" aria-hidden="true"/><span>Catching up. {keep}</span></p>
        : stopped ? <p className="status-line" role="status"><span className="dot off" aria-hidden="true"/><span>Catching up stopped. {/^[^.]*\./.exec(stopped)?.[0] ?? stopped} {sets && <button type="button" className="link small" onClick={() => void lists.move(person.moving === 'here' ? 'here' : 'mdblist')}>Try again</button>}</span></p>
        : person.lists && !hiding ? <p className="quiet">Want watched titles left out of {your} rows? Turn it on under <a className="link" href={playback}>Playback</a>.</p> : null}
    </div>}
    {/* Watchlist (worker/hearts.ts, worker/native.ts): only offered when it can be had (the hub says). */}
    {hearts && <div className="setting column sync-row">
      <div className="switch-row"><h3>Watchlist</h3><Switch checked={hearts.on} disabled={!sets || going} label="Watchlist sync" onChange={value => live ? ask('', {on: value}, () => value ? 'Watchlist is on' : 'Watchlist is off. Nothing was removed.', true) : setShown({...shown, hearts: value})}/></div>
      <p>Saved titles and {my} watchlist are one list.</p>
      <p>{saves}</p>
      {/* With MDBList alone, saves reach it only through MDBList sync (native.ts): said while that is off. */}
      {!hasTrakt && !person.lists && <p className={hearts.on ? 'status-line' : 'quiet'} role={hearts.on ? 'status' : undefined}>{hearts.on && <span className="dot wait" aria-hidden="true"/>}<span>This works once MDBList sync is on.</span></p>}
      {/* Once: titles they had already saved that their Trakt watchlist lacks. Never added by itself. */}
      {extra > 0 && <div className="offer">
        <p>{hearts.more ? 'More than ' : ''}{extra} {extra === 1 ? 'title' : 'titles'} you saved in the apps {extra === 1 ? 'isn’t' : 'aren’t'} on your watchlist.</p>
        <div className="offer-actions"><button type="button" className="link small" disabled={going} onClick={() => setSure('saves')}>Add them</button>
          <button type="button" className="link small" disabled={going} onClick={() => ask('/later', {}, () => 'Left as they are')}>Not now</button></div>
      </div>}
      {sure === 'saves' && <Confirm plain title={`Add ${extra} ${extra === 1 ? 'title' : 'titles'} to your watchlist?`} body="They go on your Trakt watchlist. You can take any of them off later." action="Add them" onYes={() => {setSure(''); ask('/add', {}, got => got.more ? `Adding ${got.added} to your watchlist. The rest are offered after the next check.` : `Adding ${got.added} to your watchlist`);}} onClose={() => setSure('')}/>}
    </div>}
    {anySync && <div className="setting column sync-foot"><p>{mine ? 'Unwatch something in an app and it’s unwatched everywhere.' : 'When they unwatch something in an app, it’s unwatched everywhere.'}{watching && (mine ? ' If you only marked it watched here, just that one play leaves Trakt.' : ' If they only marked it watched here, just that one play leaves Trakt.')}{watching && ' Unwatching on Trakt’s own site or apps doesn’t reach here.'}</p>
      {!!live && mine && on && matching?.on && <Synced page={page} person={person}/>}
    </div>}
  </div>;
}
/* The MDBList card: Connect gives its rows, and that is all it holds. Optional and free. Connecting saves their own key (checked
   with MDBList, kept in the vault); it reads their lists from then on and writes nothing. Whether their watching is synced with
   it is the Sync card's switch (useListsSync). Disconnect while sync is on turns it off the same way first, so nothing is lost.
   For someone who has joined, their manager sees only who it is connected as.
   Another MDBList account is Disconnect, then Connect. */
function MdbList({page, person, mine, sync}: {page: PageProps; person: Person; mine: boolean; sync: ReturnType<typeof useListsSync>}) {
  const {hub, update, toast, live} = page, at = `/api/people/${person.id}/mdblist`;
  const [keying, setKeying] = useState(false), [own, setOwn] = useState(''), [dropping, setDropping] = useState(false), [anyway, setAnyway] = useState(false);
  const their = mine ? 'your' : 'their', moving = person.moving ?? null, connected = person.lists || (!!live && (!!person.listsKept || !!moving));
  const {busy, setBusy, copying, setStopped, done, move} = sync;
  // What connecting gives: their MDBList watchlist in the Watchlist row (rows.ts, fill) and their own MDBList lists to add as
  // rows (api.ts, ownLists). Hiding what was watched is said too, with what it needs (native.ts, hideWatchedMdblist).
  // rows (api.ts, ownLists); with apps on their own setup, also as tiles in My lists and Lists I liked (shelf.ts).
  const gains = [`Adds ${their} MDBList watchlist to Watchlist, and ${their} MDBList lists to ${hub.front ? 'My lists and ' : ''}Add row.`, `Rows can hide what ${mine ? 'you’ve' : 'they’ve'} watched, once MDBList sync is on.`];
  // Once they have joined, their accounts are theirs alone: their manager sees who it is connected as, and no buttons.
  if (live && !mine && person.joined) return <li className="stacked"><div className="account-row"><div><h3>MDBList <span className="free">Free</span></h3>{connected ? <Who name={person.listsName ?? ''}/> : <p className="who">Not connected</p>}</div></div></li>;
  if (!live) {
    const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
    return <li className="stacked"><div className="account-row"><div><h3>MDBList <span className="free">Free</span></h3>{person.lists && <Who name=""/>}</div>
      {person.lists ? null : mine ? <button type="button" className="primary small" onClick={() => edit(target_ => {target_.lists = true;}, 'MDBList connected')}>Connect</button>
        : <span className="pill" title={`Send ${person.name} their link from the Settings tab`}>Waiting for {person.name}</span>}</div><Gains lines={gains}/></li>;
  }
  const save = () => {
    setBusy(true); void live.call<{username: string}>('POST', at, {key: own, ...(person.lists ? {} : {keep: true})}).then(found => {
      toast(found.username ? `MDBList connected as ${found.username}` : 'MDBList connected');
      setKeying(false); setOwn(''); live.apps(); return live.reload();
    }, fail(toast)).finally(() => setBusy(false));
  };
  const forget = () => {setAnyway(false); setBusy(true); void live.call('DELETE', `${at}/key`).then(() => {setStopped(''); return done('MDBList disconnected');}, fail(toast)).finally(() => setBusy(false));};
  // Disconnect while sync is on: what only MDBList has comes back here first, the same way as the switch going off. If that can't be done (often
  // why someone disconnects: MDBList stopped taking their key), they can disconnect anyway.
  const drop = async () => {setDropping(false); if (person.lists || moving === 'here') {if (await move('here')) forget(); else setAnyway(true);} else forget();};
  return <li className="stacked"><div className="account-row"><div><h3>MDBList <span className="free">Free</span></h3>{connected && <Who name={person.listsName ?? ''}/>}</div>
    {connected ? <button type="button" className="ghost small" disabled={busy || !!copying} onClick={() => setDropping(true)}>Disconnect</button>
      : !keying && <button type="button" className="primary small" disabled={busy} onClick={() => setKeying(true)}>Connect</button>}</div>
    <Gains lines={gains}/>
    {keying && <form className="stack link-back" onSubmit={event => {event.preventDefault(); save();}}>
      <p className="muted small">Paste {their} own MDBList API key. It is at <a className="link" href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer">mdblist.com, Preferences, API Access</a>. One key per person: a shared key would mix everyone’s watching together.</p>
      <div className="field-row"><input type="password" aria-label="MDBList API key" placeholder="API key" autoComplete="off" value={own} onChange={event => setOwn(event.target.value)}/><button className="primary" disabled={busy || !own.trim()}>Save</button><button type="button" className="ghost" onClick={() => {setKeying(false); setOwn('');}}>Cancel</button></div>
    </form>}
    {dropping && <Confirm title="Disconnect MDBList?" body={person.lists || moving === 'here' ? `Sync is turned off first: what only MDBList has is copied back here, so nothing is lost. Then ${their} MDBList lists stop showing. Nothing in ${their} MDBList account changes.` : `${mine ? 'Your' : 'Their'} MDBList lists stop showing here. Nothing in ${their} MDBList account changes.`} action="Disconnect" onYes={() => void drop()} onClose={() => setDropping(false)}/>}
    {anyway && <Confirm title="Disconnect anyway?" body={`What only MDBList has couldn’t be copied back just now. Disconnecting anyway leaves those plays in MDBList. Everything else stays as it is.`} action="Disconnect anyway" onYes={forget} onClose={() => setAnyway(false)}/>}
  </li>;
}
type Found = {id: string; title: string; kind: string; source: string};
/* What only the person themselves sees in Add row on their own Home: their own Trakt and MDBList lists, and the suggestions their
   watching points to. Kept with whose they are, so a view of someone else never shows them. */
function useOwnPicks(page: PageProps, person: Person, mine: boolean) {
  const [own, setOwn] = useState<{who: string; lists: Found[]; because: Record<string, string>}>({who: '', lists: [], because: {}});
  const connected = (!!person.history && !person.history.again) || person.lists, who = `${page.hub.code}/${person.id}`;
  useEffect(() => {
    if (!page.live || !mine) return;
    let gone = false;
    void Promise.all([connected ? page.live.call<{lists: Found[]}>('GET', `/api/people/${person.id}/lists`).then(got => got.lists, () => []) : Promise.resolve([]), page.live.call<{because: Record<string, string>}>('GET', `/api/people/${person.id}/because`).then(got => got.because, () => ({}))])
      .then(([lists, because]) => {if (!gone) setOwn({who, lists, because});});
    return () => {gone = true;};
  }, [who, mine, connected]);
  return own.who === who && mine ? own : {lists: [] as Found[], because: {} as Record<string, string>};
}
function PersonSections({page, person, tab, mine, base = `/person/${person.id}`}: {page: PageProps; person: Person; tab: string; mine: boolean; base?: string}) {
  const {hub, update, toast} = page, group = hub.groups.find(item => item.id === person.groupId)!, own = useOwnPicks(page, person, mine);
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  const props = editor(page, group, person, mine), rows = personRows(hub, person), order = orderOf(props.resolved.values.forYouOrder);
  // Adding a row changes Home, which the hub allows only with arranging on too (someone saved before that was enforced may have add alone).
  const canArrange = !mine || person.can.arrange, canAdd = !mine || person.can.arrange && person.can.add;
  // Work their Home asks the hub for on the next run; the page reads again either way, so the row says where it stands.
  const ask = (action: string, note: string) => void page.live!.call('POST', `/api/people/${person.id}/${action}`, {}).then(() => toast(note), fail(toast)).then(() => page.live!.reload());
  // What they would gain with an account: their own rows that wait for one (the Watchlist and the rows of their lists), for Add
  // row to list greyed. The rows of their lists are collections, which only apps on their own AIOMetadata setup show.
  const has = linkedOf(hub, person), needs = [...traktRows().map(row => ({id: row.id, title: row.title, needs: needOf(row.id, has)})),
    ...(hub.front ? [{id: 'trakt-lists', title: SHELF_TITLES['trakt-lists'], needs: has.trakt || has.lists ? '' : 'Trakt or MDBList'}, {id: 'trakt-liked-lists', title: SHELF_TITLES['trakt-liked-lists'], needs: has.trakt || has.lists ? '' : 'Trakt or MDBList'}] : [])].filter(item => item.needs);
  return <>
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} mine={mine} person={person.id} level="own" rows={rows} front={!!hub.front} canAdd={canAdd} canArrange={canArrange}
      // Their own page, without the permission: said where the button would be, rather than nothing there.
      addHint={!mine || canAdd ? undefined : person.can.add ? 'Changing Home is turned off for you. Your manager can turn it on.' : 'Adding rows is turned off for you. Your manager can turn it on.'}
      // A row from their own account or watching says so in a pill (pillOf); "Yours" is for a row they added themselves, and
      // gives way to it (home.tsx, lineOf).
      tag={row => row.origin === 'own' && !row.core ? (mine ? 'Yours' : 'Personal') : undefined} pill={row => pillOf(row, mine)}
      needs={needs} accounts={`#${base}/accounts`}
      lists={page.live ? own.lists : ownLists(person)} listsHint={page.live ? undefined : 'Connect Trakt or MDBList under Accounts to pick from your own lists.'}
      because={own.because} limit={props.resolved.values.limit} listsOk={!!hub.mdblist || person.lists} keyHint={mine ? 'Your own MDBList key, under Accounts, works too.' : <>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>}
      onChange={(next: Row[], note) => edit(target => {
        // Only a Trakt row (or a row for children) switched on or off while following the Home above: kept as their choice, so they still follow it.
        const flipped = !target.rows && next.length === rows.length && next.every((row, at) => row.id === rows[at].id) ? next.filter((row, at) => row.on !== rows[at].on) : [];
        if (flipped.length === 1 && pickable(flipped[0].id)) target.picks = {...currentPicks(target.picks, has), [flipped[0].id]: flipped[0].on}; else target.rows = next;
      }, note)}
      onMute={kind => props.set('forYouOff', [...(props.resolved.values.forYouOff ?? []), kind], `${FOR_YOU_KINDS.find(item => item.id === kind)?.title ?? 'That kind'} won’t be picked`)}
      // "Less" from a For you row: that kind one step down their own order of kinds, so it is picked a little less from the next pick.
      order={order} onLess={kind => {const at = order.indexOf(kind); props.set('forYouOrder', moved(order, at, at + 1), `${FOR_YOU_KINDS.find(item => item.id === kind)?.title ?? 'That kind'} moves down. Picks change in a few minutes.`);}}
      times={page.live && hub.forYouHour !== undefined ? {hour: hub.forYouHour, pickedAt: person.pickedAt, shelfAt: person.shelfAt, tiles: person.shelfTiles} : undefined}
      forYou={page.live ? person.forYouDetail : undefined}
      onPlace={page.live ? (place, asked, note) => void page.live!.call('POST', `/api/people/${person.id}/foryou/${place}`, asked).then(() => toast(note), fail(toast)).then(() => page.live!.reload()) : undefined}
      onCheckLists={page.live ? () => ask('shelf', mine ? 'Checking your lists. Your apps have them in a few minutes.' : 'Checking their lists. Their apps have them in a few minutes.') : undefined}
      onFollow={person.rows && canArrange ? () => edit(target => {target.rows = null;}, `Following ${group.name} again`) : undefined} followLabel={`Follow ${group.name} again`}/>}
    {tab === 'home' && <ForYouEditor {...props} never={person.forYouDetail?.never} preview={page.live && person.forYouDetail ? {detail: person.forYouDetail, places: rows.filter(row => row.on && isPlace(row.id)).map(row => row.id)} : undefined}
      onForget={page.live ? item => void page.live!.call('POST', `/api/people/${person.id}/foryou/never`, {seed: item.seed}).then(() => toast(`“${item.title}” counts again from the next pick`), fail(toast)).then(() => page.live!.reload()) : undefined}/>}
    {tab === 'playback' && <PlaybackEditor {...props} kept={!!person.lists} limitSet={mine && !person.can.limit}/>}
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
  useEffect(() => {
    if (!live) return;
    let on = true;
    const look = () => void live.call<{rows: Record<string, string[]>}>('GET', `/api/previews?person=${encodeURIComponent(id)}`).then(found => {if (on) {addReal(found.rows, id); redraw(count => count + 1);}}, () => {});
    addReal({}, id); look();
    // Once the apps are brought in step, their setup may hold something else: looked at again.
    window.addEventListener('aiohub-synced', look);
    return () => {on = false; window.removeEventListener('aiohub-synced', look);};
  }, [id, person?.v]);
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
        <Setting title="Arrange their Home" hint="Reorder rows and turn them on or off."><Switch label="Arrange their Home" checked={person.can.arrange} onChange={value => edit(target => {target.can.arrange = value; if (!value) target.can.add = false;}, 'Saved')}/></Setting>
        {/* Adding a row changes Home, so it goes with arranging, as the hub holds it. */}
        <Setting title="Add their own rows" hint={person.can.arrange ? 'Paste list links and pick ready-made rows.' : 'Turn on Arrange their Home first.'}><Switch label="Add their own rows" checked={person.can.arrange && person.can.add} disabled={!person.can.arrange} onChange={value => edit(target => {target.can.add = value;}, 'Saved')}/></Setting>
        <Setting title="Change playback" hint="Quality, languages, subtitles and the rest."><Switch label="Change playback" checked={person.can.playback} onChange={value => edit(target => {target.can.playback = value; if (!value) target.can.limit = false;}, 'Saved')}/></Setting>
        {person.can.playback && <Setting title="Change their content limit" hint={person.can.limit ? 'They can raise or lower it themselves.' : 'Stays where you set it, while they change the rest.'}><Switch label="Change their content limit" checked={!!person.can.limit} onChange={value => edit(target => {target.can.limit = value;}, 'Saved')}/></Setting>}
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
  return <GroupView {...page} group={group} members={members} custom={custom} props={props} removing={removing} setRemoving={setRemoving} edit={edit}/>;
}
function GroupView(page: PageProps & {id: string; tab: string; group: Group; members: Person[]; custom: number; props: ReturnType<typeof editor>; removing: boolean; setRemoving: (on: boolean) => void; edit: (change: (group: Group) => void, note: string) => void}) {
  const {hub, go, update, toast, id, tab, live, group, members, custom, props, removing, setRemoving, edit} = page;
  // Its Home with the posters someone in it starts with (see /api/previews): kept apart from any person's own posters.
  const [, redraw] = useState(0), key = `#g:${id}`;
  useEffect(() => {
    if (!live) return;
    let on = true;
    const look = () => void live.call<{rows: Record<string, string[]>}>('GET', `/api/previews?group=${encodeURIComponent(id)}`).then(found => {if (on) {addReal(found.rows, key); redraw(count => count + 1);}}, () => {});
    look(); window.addEventListener('aiohub-synced', look);
    return () => {on = false; window.removeEventListener('aiohub-synced', look);};
  }, [id, group.v]);
  return <>
    <a className="back" href="#/">← People</a>
    <div className="page-head"><h1>{group.name}</h1><p className="muted">Everyone in this group starts here. {members.length} {members.length === 1 ? 'person' : 'people'}{custom ? `, ${custom} with their own changes` : ''}.</p></div>
    <Tabs base={`/group/${id}`} tab={tab} tabs={[['home', 'Home'], ['playback', 'Playback'], ['sources', 'Sources'], ['activity', 'Activity'], ['settings', 'Settings']]}/>
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} level="group" limit={props.resolved.values.limit} listsOk={!!hub.mdblist} keyHint={<>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>} front={!!hub.front} rows={withForYou(withKids(placed(groupRows(hub, group)), props.resolved.values.limit === 'kids'), !!hub.front)} person={key} tag={row => row.origin === 'group' ? 'This group' : undefined} onChange={(rows, note) => edit(target => {target.rows = rows;}, note)}
      onFollow={group.rows ? () => edit(target => {target.rows = null;}, `Following ${HUB} again`) : undefined} followLabel="Use the default Home again"/>}
    {tab === 'home' && <ForYouEditor {...props}/>}
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
    {tab === 'home' && <><HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} level="hub" limit={hub.defaults.limit} listsOk={!!hub.mdblist} keyHint={<>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>} front={!!hub.front} rows={withForYou(placed(hub.rows), !!hub.front)} tag={() => undefined} onChange={(rows, note) => {update(next => {next.rows = rows;}); toast(note);}}/>{page.live && !hub.mdblist && <p className="notice"><span>The collection rows (by Service, by Genre) reach the player apps once the hub has an MDBList key.</span><a className="link" href="#/hub/sources">Add it</a></p>}<p className="muted small foot">{following} of {hub.groups.length} groups follow this Home.</p><ForYouEditor {...props}/></>}
    {tab === 'playback' && <PlaybackEditor {...props}/>}
    {tab === 'sources' && <SourcesEditor {...props}/>}
    {tab === 'general' && page.live && <><ServerName hub={hub} update={update} toast={toast}/><Servers hub={hub} live={page.live} toast={toast}/><Advanced live={page.live} toast={toast}/><Background hub={hub}/></>}
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
interface Doors {aiostreams: Door | null; aiometadata: Door | null; own?: (Door & {name: string; group: boolean; player?: boolean})[]; front?: boolean}
function Advanced({live, toast}: {live: Live; toast: (text: string) => void}) {
  const [asking, setAsking] = useState(false), [pass, setPass] = useState(''), [busy, setBusy] = useState(false), [doors, setDoors] = useState<Doors | null>(null);
  const copy = (text: string) => () => {void navigator.clipboard?.writeText(text).catch(() => {}); toast('Copied');};
  // One line a setup: what it is and a way in, its keys folded away until asked for.
  const [keys, setKeys] = useState<string | null>(null);
  const door = (key: string, title: string, found: Door | null, note: string) => <Fragment key={key}>
    <Setting title={title} hint={found ? note || undefined : 'Not made yet. It appears once the hub has its keys.'}>
      {found && <div className="door-actions"><button type="button" className="ghost small" aria-expanded={keys === key} onClick={() => setKeys(keys === key ? null : key)}>{keys === key ? 'Hide keys' : 'Keys'}</button>
        <a className="ghost small button" href={found.open} target="_blank" rel="noreferrer" aria-label={`Open ${title}`}>Open</a></div>}</Setting>
    {found && keys === key && <dl className="creds inner door-keys"><div><dt>ID</dt><dd><code>{found.id}</code><button type="button" className="ghost small" onClick={copy(found.id)}>Copy</button></dd></div>
      <div><dt>Password</dt><dd><Secret value={found.password} label={`${title} password`} onCopy={() => toast('Copied')}/></dd></div></dl>}
  </Fragment>;
  const groupsOwn = (doors?.own ?? []).filter(found => found.group), peopleOwn = (doors?.own ?? []).filter(found => !found.group);
  return <section>
    <div className="section-head"><div><h2>Advanced</h2><p className="muted">Step into the setups behind your hub, on AIOStreams and AIOMetadata themselves, for anything this site doesn’t offer.</p></div></div>
    {!doors ? <div className="card settings"><Setting column title="Open the setups" hint="These are the real keys to your hub’s setups, so your password is asked for again. Anyone holding them can change the setups directly.">
      {asking ? <form className="field-row" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call<Doors>('POST', '/api/hub/advanced', {password: pass}).then(found => {setDoors(found); setPass('');}, (error: Error) => toast(error.message)).finally(() => setBusy(false));}}>
        <input type="password" aria-label="Your password" placeholder="Your password" autoComplete="current-password" autoFocus value={pass} onChange={event => setPass(event.target.value)}/><button className="primary" disabled={busy || !pass}>Show</button></form>
        : <button type="button" className="ghost small" onClick={() => setAsking(true)}>Show</button>}</Setting></div>
    : <>
      <h3 className="sub first">Shared</h3>
      <div className="card settings">
        {door('aiostreams', 'AIOStreams', doors.aiostreams, doors.front ? 'Finds the streams for everyone: sources, filters, sorting and the stream label.' : 'Sources, filters, sorting and the stream label.')}
        {door('aiometadata', 'AIOMetadata', doors.aiometadata, doors.front ? 'The hub’s own setup: the Home everyone starts from, and its posters.' : 'Catalogs, collections and posters for the shared Home.')}
      </div>
      {/* What a group's or a person's setup is, said once above them rather than on every line. */}
      {!!groupsOwn.length && <><h3 className="sub">Groups</h3><p className="muted small door-about">Made on AIOMetadata while a group’s Home or looks differ from the hub’s, and removed once they don’t.</p><div className="card settings">
        {groupsOwn.map(found => door(`g:${found.name}`, found.name, found, ''))}</div></>}
      {!!peopleOwn.length && <><h3 className="sub">People</h3><p className="muted small door-about">{peopleOwn.every(found => found.player) ? 'Each person’s own setup on AIOMetadata: their Home, looks, accounts and what they’ve watched. Their apps reach it through the hub.' : 'Made on AIOMetadata while someone’s Home or looks differ from their group’s, and removed once they don’t.'}</p><div className="card settings">
        {peopleOwn.map(found => door(`p:${found.name}`, found.name, found, ''))}</div></>}
      <div className="card settings door-note"><Setting column title="What the hub keeps putting back" hint={`The hub rewrites the things it manages each time you change something here: debrid account, the sources it lists, quality and size, languages, the stream label, people, Home rows and collections. Anything else you add there is left alone. ${doors.front ? 'Each person’s Home lives on their own AIOMetadata setup, listed above.' : 'A group’s or a person’s own Home lives in its own AIOMetadata setup, listed above when there is one.'}`}><button type="button" className="ghost small" onClick={() => setDoors(null)}>Hide</button></Setting></div>
    </>}
  </section>;
}
/* What the hub does on its own, one compact row per job, with how often it runs: Trakt sync's two halves (sending what is watched
   here: the five-minute run for calls that waited and players that went quiet; and bringing back what was watched in other
   Trakt apps), the daily Trakt/MDBList check and the daily send of what MDBList lacks, which start with the first run after
   04:00 UTC. Each says whose it runs for: only people with that sync on. Times are the viewer's own. */
const FIVE = 300_000, DAY_MS = 86_400_000;
/* For you: one person a five-minute run from its hour (UTC), then the hub's apps are brought in step. Someone just added, or
   whose places, kinds of pick or limit changed, is picked for at any hour, and one row of someone who just finished something. */
function forYouJob(jobs: NonNullable<Hub['jobs']>, now: number, time: (ms: number) => string, day: (ms: number) => string, ran: (s: number | null) => string) {
  const start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T${String(jobs.forYouHour).padStart(2, '0')}:00:00Z`), picked = jobs.picked ?? 0, everyone = jobs.everyone ?? 0;
  const done = picked >= everyone, waiting = !done && now >= start;
  return {name: 'For you picks', every: `For everyone every day at ${time(start)}; for one person when they change their rows or kinds, or finish something`, last: `${ran(jobs.pickedAt ?? null)}${everyone ? ` · ${Math.min(picked, everyone)} of ${everyone} picked today` : ''}`,
    next: waiting ? 'under way' : jobs.syncing ? 'updating apps' : `next run ${day(done || now >= start ? start + DAY_MS : start)}`};
}
function Background({hub}: {hub: Hub}) {
  const jobs = hub.jobs, [now, setNow] = useState(Date.now());
  useEffect(() => {const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer);}, []);
  if (!jobs) return null;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  const day = (ms: number) => {const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS); return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});};
  const ran = (s: number | null) => s ? `Ran ${day(s * 1000)} at ${time(s * 1000)}` : 'Not run yet';
  const next = Math.ceil((now + 1) / FIVE) * FIVE, start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T04:00:00Z`);
  const daily = jobs.checked === new Date(now).toISOString().slice(0, 10) ? start + DAY_MS : Math.max(start, next);
  const rows = [
    // Each job says what starts it: its times run for everyone in the hub, one person at a time; a play, a change or a press runs
    // for that one person.
    {name: 'Trakt sync: here to Trakt', every: 'For everyone with Trakt sync on, every 5 min; for one person as they play', last: `${ran(jobs.last)}${jobs.waiting ? ` · ${jobs.waiting} waiting to send` : ''}`, next: `next run in ${Math.max(1, Math.ceil((next - now) / 60_000))} min`},
    {name: 'Trakt and MDBList check', every: `For everyone with both Trakt and MDBList sync on, every day at ${time(start)}`, last: ran(jobs.ran), next: jobs.checking ? 'under way' : `next run ${day(daily)}`},
    // Trakt sync (worker/sync.ts): in the same five-minute run, one person each run, so each is looked at about every 20 minutes,
    // or longer once more than four people sync (the hub says how long; never how many).
    ...(hub.scrobble ? [{name: 'Trakt sync: Trakt to here', every: `For everyone with Trakt sync on, one person each run, so each person about every ${jobs.syncEvery ?? 20} min; for one person at once when they turn it on`, last: jobs.matching ? `${ran(jobs.matched ?? null)} · ${jobs.matching} ${jobs.matching === 1 ? 'person' : 'people'}` : 'Nobody has it on yet',
      next: jobs.matching ? `next run in ${Math.max(1, Math.ceil((next - now) / 60_000))} min` : 'once someone turns it on'}] : []),
    // The Watchlist switch with Trakt connected (worker/hearts.ts): in the same five-minute run, one person each run, for whoever
    // has it on: a few titles saved or un-saved on their server to match their Trakt watchlist, and now and then their saves counted.
    ...(hub.scrobble && hub.front ? [{name: 'Watchlist sync with Trakt', every: 'For everyone with Watchlist on and Trakt connected, one person each run: a few titles saved or un-saved in their apps to match their Trakt watchlist, and their saved titles counted a few times a day', last: jobs.hearting ? `${ran(jobs.hearted || null)} · ${jobs.hearting} ${jobs.hearting === 1 ? 'person' : 'people'}` : 'Nobody has it on yet',
      next: jobs.hearting ? `next run in ${Math.max(1, Math.ceil((next - now) / 60_000))} min` : 'once someone turns it on'}] : []),
    // What was watched here and a person's MDBList lacks (worker/sync.ts, leftovers): once a day each, for whoever has MDBList
    // sync on and played something since.
    {name: 'Plays missing from MDBList', every: `For everyone with MDBList sync on, every day from ${time(start)}`, last: jobs.listers ? ran(jobs.listed ?? null) : 'Nobody has MDBList sync on yet',
      next: jobs.listers ? `next run ${day(jobs.listed && new Date(jobs.listed * 1000).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? start + DAY_MS : Math.max(start, next))}` : 'once someone does'},
    ...(hub.front && jobs.forYouHour !== undefined ? [forYouJob(jobs, now, time, day, ran)] : []),
    // Each row of someone's own lists on Trakt or MDBList (the ones they made, the ones they liked): its lists and pictures looked at again a day after the last time (shelf.ts), one person a run, and
    // sooner when someone asks or their lists changed. One due now (asked for, at 0) is under way, not due in 1970.
    ...(hub.front ? [{name: 'My lists rows', every: 'For everyone every day; for one person when their lists change or they press Check now', last: `${ran(jobs.shelved ?? null)}${jobs.shelves ? ` · ${jobs.shelves} ${jobs.shelves === 1 ? 'person' : 'people'}` : ''}`,
      next: typeof jobs.shelfDue === 'number' ? (jobs.shelfDue + 86_400) * 1000 > now ? `next run ${day((jobs.shelfDue + 86_400) * 1000)}` : 'under way' : 'once someone adds one'}] : []),
    // Recommended Movies and Shows where Trakt does not fill them, or under a content limit (worker/recs.ts): worked out from what
    // each person watched, one person a run and once a day each, in a run with nothing else to do. It asks TMDB with the hub's key.
    {name: 'Recommended rows', every: `For everyone with a Recommended row on Home, every day from ${time(start)}`, last: `${ran(jobs.recsAt ?? null)}${jobs.recs ? ` · ${jobs.recs} ${jobs.recs === 1 ? 'person' : 'people'}` : ''}`,
      next: !hub.tmdb ? 'once the hub has a TMDB key' : typeof jobs.recsDue === 'number' ? (jobs.recsDue + 86_400) * 1000 > now ? `next run ${day((jobs.recsDue + 86_400) * 1000)}` : 'under way' : hub.people.length ? `next run in ${Math.max(1, Math.ceil((next - now) / 60_000))} min` : 'once someone is added'},
    // Up Next and New for you for people without Trakt (worker/ahead.ts): which episodes and watchlist films have come out, looked
    // up one person a run and once a day each, in a run with nothing else to do, and again after they finish something. It asks
    // TMDB with the hub's key. With Trakt connected the two rows are Trakt's and need none of this.
    {name: 'Up Next and New for you', every: `For everyone without Trakt who has either row on Home, every day from ${time(start)}; for one person after they finish something, from that hour`, last: `${ran(jobs.aheadAt ?? null)}${jobs.aheads ? ` · ${jobs.aheads} ${jobs.aheads === 1 ? 'person' : 'people'}` : ''}`,
      next: !hub.tmdb ? 'once the hub has a TMDB key' : typeof jobs.aheadDue === 'number' ? (jobs.aheadDue + 86_400) * 1000 > now ? `next run ${day((jobs.aheadDue + 86_400) * 1000)}` : 'under way' : 'once someone turns one on'},
  ];
  return <section>
    <div className="section-head"><div><h2>Background work</h2><p className="muted">The hub does these by itself for everyone, one person at a time. Buttons on a person’s own page act for that person only, right away.</p></div></div>
    <ul className="accounts jobs">{rows.map(row => <li key={row.name}><div className="job">
      <div><h3>{row.name}</h3><span>{row.every}</span></div>
      <div className="muted small"><span>{row.last}</span><span>{row.next}</span></div>
    </div></li>)}</ul>
  </section>;
}
/* The name player apps and Trakt show for this hub. */
function ServerName({hub, update, toast}: {hub: Hub; update: PageProps['update']; toast: (text: string) => void}) {
  const shown = hub.serverName || 'AIOHub', [draft, setDraft] = useState(shown);
  return <section>
    <div className="section-head"><div><h2>Name</h2><p className="muted">What player apps and Trakt call this hub. It’s the same for everyone, because apps read it before anyone signs in.</p></div></div>
    <form className="card settings" onSubmit={event => {event.preventDefault(); update(next => {next.serverName = draft.trim();}); toast('Saved. Apps show it the next time they connect.');}}>
      <Setting column title="Server name" hint="Leave it as AIOHub, or make it yours.">
        <div className="field-row"><input aria-label="Server name" maxLength={40} value={draft} onChange={event => setDraft(event.target.value)}/><button className="ghost" disabled={!draft.trim() || draft.trim() === shown}>Save</button></div></Setting>
    </form>
  </section>;
}
function Servers({hub, live, toast}: {hub: Hub; live: Live; toast: (text: string) => void}) {
  const [up, setUp] = useState(hub.hostUrl), [meta, setMeta] = useState(hub.metaUrl ?? ''), [busy, setBusy] = useState(false);
  const changed = up.trim() !== hub.hostUrl || meta.trim() !== (hub.metaUrl ?? '');
  return <section>
    <div className="section-head"><div><h2>Servers</h2><p className="muted">Where your hub’s setups live. Leave a field empty to use this site’s usual server (ForTheWeak).</p></div></div>
    <form className="card settings" onSubmit={event => {
      event.preventDefault(); setBusy(true);
      void live.call<{missing: string[]}>('PUT', '/api/host', {aiostreams: up, aiometadata: meta}).then(answer => {toast(answer.missing.length ? 'Saved. Some sources are not offered there and are off.' : 'Saved'); live.apps(); return live.reload();}, (error: Error) => toast(error.message)).finally(() => setBusy(false));
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
  const [ask, setAsk] = useState<{title: string; body: string; action: string; yes: () => void} | null>(null);
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
    {ask && <Confirm title={ask.title} body={ask.body} action={ask.action} onYes={() => {const yes = ask.yes; setAsk(null); yes();}} onClose={() => setAsk(null)}/>}
    <ul className="accounts">{hub.me.passkeys.map(key => <li key={key.id}><div><h3>{key.name}</h3><p>Added {key.added}</p></div><button type="button" className="ghost small" onClick={() => setAsk({title: `Remove the passkey on ${key.name}?`, body: 'That device can no longer sign in with it. Your password and other passkeys still work.', action: 'Remove', yes: () => {if (live) return void live.call('DELETE', `/api/account/passkeys/${key.id}`).then(() => live.reload()).then(() => toast('Passkey removed'), fail(toast)); update(next => {next.me.passkeys = next.me.passkeys.filter(item => item.id !== key.id);}); toast('Passkey removed');}})}>Remove</button></li>)}
      <li><div><h3>Add a passkey</h3><p>Sign in with a fingerprint or face on this device, with no hub code to type. Optional; the password always works.</p></div><button type="button" className="ghost small" disabled={adding} onClick={() => {if (live) {setAdding(true); return void addPasskey().then(() => live.reload()).then(() => toast('Passkey added'), (error: Error) => toast(error.name === 'NotAllowedError' ? 'No passkey was added' : error.name === 'InvalidStateError' ? 'This device already has a passkey here' : error.message)).finally(() => setAdding(false));} update(next => {next.me.passkeys.push({id: `k${Date.now()}`, name: 'This device', added: 'today'});}); toast('Passkey added');}}>Add</button></li></ul></>}
    <h3 className="sub">Appearance</h3>
    <div className="card settings"><Setting title="Theme"><Segments label="Theme" value={hub.me.theme} onChange={value => update(next => {next.me.theme = value;})} options={[{value: 'dark', label: 'Dark'}, {value: 'light', label: 'Light'}, {value: 'auto', label: 'Match device'}]}/></Setting></div>
    {SAMPLE && <><h3 className="sub">Preview</h3>
    <div className="card settings"><Setting title="First-time setup" hint="Walk through what a new manager sees."><button type="button" className="ghost small" onClick={() => go('/setup')}>Open</button></Setting></div></>}
    <button type="button" className="danger" onClick={() => live ? void live.call('POST', '/api/signout', {}).then(() => {leaveAs(); go('/'); return live.reload();}, fail(toast)) : toast('Preview: this signs you out')}>Sign out</button>
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
    {(person.paused || hub.groups.find(item => item.id === person.groupId)?.paused) && <div className="notice"><span>Nothing’s playing right now. Try again later.</span></div>}
    <Tabs base={base} tab={tab} tabs={tabs}/>
    {tab === 'home' && ((SAMPLE && !person.trakt) || !person.devices.length) && <div className="todo">
      {!person.devices.length && <a href={`#${base}/devices`}><span className="check" aria-hidden="true">→</span><span><strong>Watch on a device</strong><small>Phone, TV or laptop. Takes a minute.</small></span></a>}
      {!person.trakt && SAMPLE && <a href={`#${base}/accounts`}><span className="check" aria-hidden="true">→</span><span><strong>Connect Trakt</strong><small>Optional. Adds your watchlist and recommendations.</small></span></a>}
    </div>}
    <PersonSections page={page} person={person} tab={tab === 'playback' && !person.can.playback ? 'home' : tab} mine base={base}/>
    {tab === 'you' && <section>
      <div className="card settings">
        <Setting title="Name"><NameField label="Your name" value={person.name} onSave={value => edit(target => {target.name = value;}, 'Renamed')}/></Setting>
        <Setting title="Password" hint={live ? 'For this page. Player apps use their own password, under Devices.' : 'The same one signs you in to the player apps.'}><button type="button" className="ghost small" onClick={() => live ? setChanging(true) : toast('Preview: this asks for the old and a new password')}>Change</button></Setting>
        {SAMPLE && <Setting title="Passkey" hint="Sign in here with a fingerprint or face. Optional."><button type="button" className="ghost small" onClick={() => toast('Preview: this adds a passkey on this device')}>Add</button></Setting>}
      </div>
      {live && <button type="button" className="danger" onClick={() => void live.call('POST', '/api/signout', {}).then(() => {leaveAs(); go('/'); return live.reload();}, fail(toast))}>Sign out</button>}
    </section>}
    {changing && live && <PasswordSheet toast={toast} onClose={() => setChanging(false)} onSave={(old, password) => live.call('POST', `/api/people/${id}/password`, {old, password}).then(() => live.reload())}/>}
  </>;
}

/* ---------- the real hub: opening an invite link, and signing in ---------- */
interface Asked {name: string; username: string; owner: string; joined: boolean}
/* An invite link. Opened by their manager in the same browser, it goes straight to their own view once they have joined. */
export function JoinGate({token, live, toast, manager, signedAs, onIn}: {token: string; live: Live; toast: (text: string) => void; manager: boolean; signedAs?: string; onIn: () => void}) {
  const [info, setInfo] = useState<Asked | 'gone' | null>(null), [waiting, setWaiting] = useState(false), [pass, setPass] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {void live.call<{gone?: boolean; ok?: boolean; as?: string; ask?: Asked; waiting?: Asked}>('POST', '/api/join', {token}).then(found => {
    if (found.as) beAs(found.as);
    if (found.ok) return onIn();
    setWaiting(!!found.waiting); setInfo(found.waiting ?? found.ask ?? 'gone');
  }, fail(toast));}, [token]);
  if (!info) return <p className="empty">Opening…</p>;
  if (info === 'gone') return <p className="empty">This link is no longer valid. Ask for a new one.</p>;
  if (waiting) return <p className="empty">{info.name} hasn’t joined yet. Send them this link, so they can choose their own password. <a className="link" href="#/">Back to people</a></p>;
  if (manager) return <p className="empty">This is {info.name}’s link, for another hub. Send it to them instead of opening it here. <a className="link" href="#/">Back to people</a></p>;
  return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); setBusy(true); void live.call('POST', '/api/join', {token, password: pass}).then(onIn, fail(toast)).finally(() => setBusy(false));}}>
    <div className="stack center"><Avatar name={info.name} size={84}/><h1>Hi {info.name}</h1><p className="muted">{info.joined ? 'Type your password to open your page.' : 'You’ve been invited. Choose a password for your page here. Only you know it.'}</p>{signedAs && <p className="muted small">{signedAs} is signed in on this browser. Continuing signs {info.name} in instead.</p>}</div>
    {/* Their name is their username. It only matters on the Devices tab, so it is not mentioned here; the hidden field lets a password manager file the password under it. */}
    <input type="text" value={info.username} readOnly autoComplete="username" hidden/>
    <label htmlFor="join-pass">Password</label><input id="join-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete={info.joined ? 'current-password' : 'new-password'} autoFocus placeholder={info.joined ? '' : 'At least 8 characters'}/>
    {!info.joined && !!pass && pass.length < 8 && <p className="warn small">At least 8 characters: {8 - pass.length} more to go.</p>}
    <button className="primary big" disabled={busy || pass.length < (info.joined ? 1 : 8)}>Continue</button>
    <p className="muted small center-text">{info.joined ? 'Forgot it? Whoever invited you can let you choose a new one.' : 'Player apps get their own password, which you’ll find inside.'}</p>
  </form>;
}
/* ---------- a TV's Quick Connect link ---------- */
/* A player app's Quick Connect link: front.ts sends /h/<code>/web here, keeping the TV's code after the #. Nothing is approved
   without a tap, and the TV always becomes someone in the hub, named on the Approve button: the manager picks who (never
   themselves); a person approves it as themselves, or as someone else with that person's password for this site; with nobody
   signed in, a person gives their name and password, or the manager signs in first. `tv`: the hub the TV asked. */
export function TvGate({live, toast, hub, person, tv, given}: {live: Live; toast: (text: string) => void; hub: Hub | null; person?: Person; tv: string; given: string}) {
  const [code, setCode] = useState(/^\d{6}$/.test(given) ? given : ''), [typed, setTyped] = useState(''), [pick, setPick] = useState(''), [other, setOther] = useState(false);
  const [name, setName] = useState(''), [pass, setPass] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(''), [error, setError] = useState(''), [signing, setSigning] = useState(false);
  const here = !!hub && (!tv || hub.code === tv), chosen = hub?.people.find(item => item.id === pick);
  // The hub's own answer is said in place: an expired or unknown code, a wrong password.
  const approve = (work: Promise<string>) => {setBusy(true); setError(''); void work.then(setDone, (failure: Error) => setError(failure.message)).finally(() => setBusy(false));};
  const lead = <p className="muted">A TV is asking to sign in with the code {code.slice(0, 3)} {code.slice(3)}.</p>, said = error && <p className="warn">{error}</p>;
  if (done) return <div className="setup stack gate center"><h1>TV approved</h1><p className="muted">It signs in as {done} in a few seconds.</p><a className="link" href="/">Go to the hub</a></div>;
  if (!code) return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); setCode(typed);}}>
    <h1>Sign in a TV</h1><p className="muted">Choose Quick Connect on the TV, then type the code it shows.</p>
    <label htmlFor="tv-code">Code from the TV</label><input id="tv-code" inputMode="numeric" maxLength={6} placeholder="6-digit code" autoFocus value={typed} onChange={event => setTyped(event.target.value.replace(/\D/g, ''))}/>
    <button className="primary big" disabled={typed.length !== 6}>Continue</button>
  </form>;
  if (signing && !hub) return <><SignInPage live={live} toast={toast} canCreate={false}/><button type="button" className="link center-text tv-back" onClick={() => setSigning(false)}>Back to the TV</button></>;
  if (here && !person && !other) return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); if (chosen) approve(live.call('POST', `/api/people/${chosen.id}/quick`, {code}).then(() => chosen.name));}}>
    <h1>Sign this TV in as…</h1>{lead}
    {hub!.people.length ? <div className="tv-people" role="radiogroup" aria-label="Who the TV is for">{hub!.people.map(item => <label key={item.id}><input type="radio" name="tv-person" checked={pick === item.id} onChange={() => setPick(item.id)}/><Avatar name={item.name} size={32}/><span>{item.name}</span></label>)}</div>
      : <p className="muted">Nobody is in this hub yet. Add someone under People first.</p>}
    {said}
    <button className="primary big" disabled={busy || !chosen}>{chosen ? `Approve as ${chosen.name}` : 'Approve'}</button>
    <p className="muted small center-text">The TV gets their Home and plays as them. It never signs in as you.</p>
  </form>;
  if (here && person && !other) return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); approve(live.call('POST', `/api/people/${person.id}/quick`, {code}).then(() => person.name));}}>
    <div className="stack center"><Avatar name={person.name} size={84}/><h1>Sign this TV in as {person.name}?</h1>{lead}</div>
    {said}
    <button className="primary big" disabled={busy}>Approve as {person.name}</button>
    <button type="button" className="ghost big" onClick={() => {setOther(true); setError('');}}>Someone else</button>
  </form>;
  // Someone else, or nobody signed in here: whoever it is for, by their name and password for this site.
  const who = name.trim();
  return <form className="setup stack gate" onSubmit={event => {event.preventDefault(); approve(live.call<{name: string}>('POST', '/api/quick', {hub: tv || hub?.code, code, name: who, password: pass}).then(found => found.name));}}>
    <h1>Sign this TV in</h1>{lead}<p className="muted">Type the name of whoever it’s for, and their password for this site.</p>
    {hub && !here && <p className="muted small">This browser is signed in to another hub.</p>}
    <label htmlFor="tv-name">Name</label><input id="tv-name" value={name} onChange={event => setName(event.target.value)} autoComplete="username" autoCapitalize="words" autoFocus/>
    <label htmlFor="tv-pass">Their password</label><input id="tv-pass" type="password" value={pass} onChange={event => setPass(event.target.value)} autoComplete="current-password"/>
    {said}
    <button className="primary big" disabled={busy || !who || !pass}>{who ? `Approve as ${who}` : 'Approve'}</button>
    {other ? <button type="button" className="link center-text" onClick={() => {setOther(false); setError('');}}>Back</button>
      : !hub && <button type="button" className="link center-text" onClick={() => setSigning(true)}>Run this hub? Sign in</button>}
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
