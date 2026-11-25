import {useEffect, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {FOR_YOU_KINDS, SAMPLE, allServices, signUp, defaultRows, defaultSettings, groupRows, hosts, isTrakt, newPerson, placed, pickable, TRAKT_IDS, withKids, withForYou, ownLists, personRows, resolve, samplePassword, samplePin, slug, traktRows} from './data';
import type {Device, Group, Hub, Miss, Person, Row, Settings} from './data';
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
function Accounts({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {hub, live} = page, group = hub.groups.find(item => item.id === person.groupId)!;
  return <section>
    <div className="section-head"><div><h2>Accounts</h2><p className="muted">{mine ? `Connect your own; nobody else sees them. Both are optional: without them, progress is kept here${hub.front ? ' and For you learns from what you play' : ''}.` : live ? <>{person.name} can connect their own from their page, or you can do it here with them.</> : <>Only {person.name} can connect these, from their own page. <a className="link" href={`#/person/${person.id}/settings`}>Get their link</a></>}</p></div></div>
    <ul className="accounts">
      <li><div><h3>Streams</h3><p>Played through the shared {resolve(hub, group, person).values.debrid} account. Nothing to set up.</p></div><span className="pill ok">Shared</span></li>
      <Trakt page={page} person={person} mine={mine}/>
      <MdbList page={page} person={person} mine={mine}/>
    </ul>
    <Progress page={page} person={person} mine={mine}/>
  </section>;
}
/* Trakt: one connection, the hub's own. It keeps Trakt in step with what is watched here, and the hub fills the Trakt rows on Home
   from it. Connecting is Trakt's own sign-in (OAuth with PKCE), done by this page with Trakt directly: Trakt turns away the
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
function Trakt({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {hub, update, toast, live} = page, at = `/api/people/${person.id}/scrobble`, link = person.history;
  const [phase, setPhase] = useState<'' | 'going' | 'connecting' | 'busy'>(''), busy = !!phase, [dropping, setDropping] = useState(false);
  const [older, setOlder] = useState(false);
  const their = mine ? 'your' : 'their', client = hub.traktClient ?? '';
  // The sign-in Trakt just sent back here, if it was for this person: the code is exchanged for the login, once.
  useEffect(() => {
    const back = returned, saved = signing();
    if (!live || !back || saved?.person !== person.id || saved.hub !== hub.code) return;
    returned = null; sessionStorage.removeItem(SIGNING);
    if (back.error || !back.code) return void toast(back.error === 'access_denied' ? 'Trakt wasn’t connected.' : 'Trakt didn’t finish signing in. Connect again.');
    if (back.state !== saved.state) return void toast('That Trakt sign-in wasn’t started here. Connect again.');
    void finish(back.code, saved.verifier);
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
  // What Trakt does once connected (front.ts scrobbling, rows.ts, places.ts): said plainly, in the order people notice it.
  const about = `${hub.front ? `The For you rows pick from everything on ${their} Trakt, so they know ${mine ? 'your' : `${person.name}’s`} taste from the start. ` : ''}${mine ? 'Your' : 'Their'} Trakt watchlist, recommendations and recently watched show up on Home, and what ${mine ? 'you watch' : `${person.name} watches`} here is added to ${their} Trakt as it plays.`;
  if (!live) {
    const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
    return <li><div><h3>Trakt</h3><p>{person.trakt ? `Connected. ${about}` : `Free. ${about}`}</p></div>
      {person.trakt ? <button type="button" className="ghost small" onClick={() => edit(target => {target.trakt = false; target.rows = target.rows?.filter(row => !isTrakt(row)) ?? null;}, 'Trakt disconnected')}>Disconnect</button>
        : mine ? <button type="button" className="primary" onClick={() => edit(target => {target.trakt = true; if (target.rows) target.rows = [...traktRows(), ...target.rows];}, 'Trakt connected')}>Connect</button>
        : <span className="pill" title={`Send ${person.name} their link from the Settings tab`}>Waiting for {person.name}</span>}</li>;
  }
  const on = !!link && !link.again;
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
  return <li className="stacked"><div className="account-row"><div><h3>Trakt</h3>{on && <Who name={link!.username}/>}
    <p>{on ? about : link?.again ? `Trakt asked to be connected again. ${about}` : `Free. ${about}`}</p></div>
    {!hub.scrobble || !client ? <span className="pill">Not on this site</span>
      : on ? <button type="button" className="ghost small" disabled={busy} onClick={() => setDropping(true)}>Disconnect</button>
      : <button type="button" className="primary small" disabled={busy} onClick={() => void connect()}>Connect</button>}</div>
    {phase === 'connecting' || phase === 'busy' ? <p className="muted small" role="status">{phase === 'busy' ? 'Trakt is busy, trying again…' : 'Connecting to Trakt…'}</p>
      : !on && !mine && hub.scrobble && client ? <p className="muted small">Trakt asks who’s signing in, so {person.name} can use their own Trakt account.</p> : null}
    {person.aiomTrakt && <div className="quiet-note"><p className="muted small">{on ? 'An older Trakt link, made through AIOMetadata, is still there. Nothing uses it any more.' : 'Home’s Trakt rows come from an older link made through AIOMetadata for now. Connecting here takes over from it.'}</p>
      <button type="button" className="link small" disabled={busy} onClick={() => on ? work(live.call('DELETE', `/api/people/${person.id}/trakt`), 'Older Trakt link removed') : setOlder(true)}>Disconnect it</button></div>}
    {older && <Confirm title="Disconnect the older Trakt link?" body={`Home’s Trakt rows come from it for now, so they leave ${their} Home until Trakt is connected above. Nothing on Trakt itself changes.`} action="Disconnect" onYes={() => {setOlder(false); work(live.call('DELETE', `/api/people/${person.id}/trakt`), 'Older Trakt link removed');}} onClose={() => setOlder(false)}/>}
    {dropping && <Confirm title="Disconnect Trakt?" body={`Trakt stops following along, and ${their} Trakt rows leave Home. Plays still waiting to reach Trakt are dropped. Nothing on Trakt itself changes, and connecting again brings the rows back.`} action="Disconnect" onYes={() => {setDropping(false); work(live.call('DELETE', at), 'Trakt disconnected');}} onClose={() => setDropping(false)}/>}
  </li>;
}
/* MDBList, an account like Trakt: optional and free. Connecting only saves their own key (checked with MDBList, kept in the
   vault); it reads their lists from then on. Keeping progress there is chosen below it (Progress). Another MDBList account is
   Disconnect, then Connect. */
function MdbList({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {update, toast, live} = page, at = `/api/people/${person.id}/mdblist`;
  const [keying, setKeying] = useState(false), [own, setOwn] = useState(''), [busy, setBusy] = useState(false), [dropping, setDropping] = useState(false);
  const their = mine ? 'your' : 'their', moving = person.moving ?? null, connected = person.lists || (!!live && (!!person.listsKept || !!moving));
  const about = `Free. Keep ${their} progress there and rows can leave out what ${mine ? 'you’ve' : 'they’ve'} already seen. ${mine ? 'Your' : 'Their'} MDBList watchlist and lists show up on Home too.`;
  if (!live) {
    const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
    return <li><div><h3>MDBList</h3><p>{person.lists ? `Connected. Keeps ${their} progress.` : about}</p></div>
      {person.lists ? null : mine ? <button type="button" className="primary small" onClick={() => edit(target => {target.lists = true;}, 'MDBList connected')}>Connect</button>
        : <span className="pill" title={`Send ${person.name} their link from the Settings tab`}>Waiting for {person.name}</span>}</li>;
  }
  const save = () => {
    setBusy(true); void live.call<{username: string}>('POST', at, {key: own, ...(person.lists ? {} : {keep: true})}).then(found => {
      toast(found.username ? `MDBList connected as ${found.username}` : 'MDBList connected');
      setKeying(false); setOwn(''); live.apps(); return live.reload();
    }, fail(toast)).finally(() => setBusy(false));
  };
  const forget = () => {setDropping(false); setBusy(true); void live.call('DELETE', `${at}/key`).then(() => {toast('MDBList disconnected'); live.apps(); return live.reload();}, fail(toast)).finally(() => setBusy(false));};
  const state = !connected ? about : person.lists ? `Keeps ${their} progress, so rows can hide what’s been watched. ${mine ? 'Your' : 'Their'} watchlist and lists show up on Home.` : moving ? '' : `Not keeping progress, so rows still show what’s been watched. Choose MDBList under Where progress is kept to leave it out. ${mine ? 'Your' : 'Their'} watchlist and lists show up on Home.`;
  return <li className="stacked"><div className="account-row"><div><h3>MDBList</h3>{connected && <Who name={person.listsName ?? ''}/>}{state && <p>{state}</p>}
</div>
    {connected ? <button type="button" className="ghost small" disabled={busy} onClick={() => setDropping(true)}>Disconnect</button>
      : !keying && <button type="button" className="primary small" disabled={busy} onClick={() => setKeying(true)}>Connect</button>}</div>
    {keying && <form className="stack link-back" onSubmit={event => {event.preventDefault(); save();}}>
      <p className="muted small">Paste {their} own MDBList API key. It is at <a className="link" href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer">mdblist.com, Preferences, API Access</a>. One key per person: a shared key would mix everyone’s watching together.</p>
      <div className="field-row"><input type="password" aria-label="MDBList API key" placeholder="API key" autoComplete="off" value={own} onChange={event => setOwn(event.target.value)}/><button className="primary" disabled={busy || !own.trim()}>Save</button><button type="button" className="ghost" onClick={() => {setKeying(false); setOwn('');}}>Cancel</button></div>
    </form>}
    {dropping && <Confirm title="Disconnect MDBList?" body={person.lists || moving ? `Progress goes back to being kept here, and ${their} MDBList lists stop showing. Plays only in MDBList stay there; to bring them here first, choose Here under Where progress is kept.` : `${mine ? 'Your' : 'Their'} MDBList lists stop showing here. Nothing in ${their} MDBList account changes.`} action="Disconnect" onYes={forget} onClose={() => setDropping(false)}/>}
  </li>;
}
/* Where someone's progress is kept: Continue Watching, what's ticked as watched, Next Up. Here (AIOMetadata keeps it, nothing to
   connect), or their own MDBList account once MDBList is connected above. Hiding watched titles only works with MDBList:
   AIOMetadata hides only by what a connected tracker says, and here it has none. */
function Progress({page, person, mine}: {page: PageProps; person: Person; mine: boolean}) {
  const {update, toast, live} = page, at = `/api/people/${person.id}/mdblist`;
  const [busy, setBusy] = useState(false), [leaving, setLeaving] = useState(false), [back, setBack] = useState(false);
  // On their own page a switch is a move (the card below), and it happens only once their plays are across.
  const self = mine && !!live, moving = person.moving ?? null;
  const chooses = person.lists || (!!live && (!!person.listsKept || !!moving));
  const their = mine ? 'your' : 'their', choice = person.lists ? (back || moving === 'here' ? 'here' : 'mdblist') : moving === 'mdblist' ? 'mdblist' : 'here';
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  // MDBList again, with the key saved above: on their own page it opens the move; anyone else's choice switches at once.
  const take = () => {
    const move = self, as = (found: {username: string}) => found.username ? ` as ${found.username}` : '';
    setBusy(true); void live!.call<{username: string}>('POST', at, {reuse: true, ...(move ? {moving: true} : {})}).then(found => {
      toast(move ? 'Move your plays across to switch to MDBList.' : `Back on MDBList${as(found)}`); live!.apps(); return live!.reload();
    }, fail(toast)).finally(() => setBusy(false));
  };
  const pick = (value: 'here' | 'mdblist') => {
    if (busy) return;
    if (value === 'mdblist') {if (person.lists) setBack(false); else if (moving !== 'mdblist') {if (live) take(); else if (mine) edit(target => {target.lists = true;}, 'Progress kept in MDBList');} return;}
    if (person.lists) {if (self) setBack(true); else setLeaving(true);}
  };
  const leave = () => {
    setLeaving(false);
    if (!live) return edit(target => {target.lists = false; target.rows = target.rows?.filter(row => !row.source.startsWith('MDBList')) ?? null;}, 'Progress kept here');
    setBusy(true); void live.call('DELETE', at).then(() => {toast('Progress kept here'); live.apps(); return live.reload();}, fail(toast)).finally(() => setBusy(false));
  };
  const canChoose = chooses && (!!live || mine);
  return <>
    <ul className="accounts progress">
      <li className="stacked"><div className="account-row"><div><h3>Where progress is kept</h3>
        <p>Continue Watching, what’s ticked as watched and Next Up. {choice === 'here' ? chooses ? 'Kept on this hub, in the player apps.' : 'Kept on this hub, in the player apps. Connect MDBList to keep it there instead.' : `Kept in ${their} own MDBList account, where other apps read it too.`}</p></div>
        {canChoose && <Segments label="Where progress is kept" value={choice} onChange={pick} options={[{value: 'here', label: 'Here'}, {value: 'mdblist', label: 'MDBList'}]}/>}</div>
        {choice === 'here' && chooses && <p className="muted small">Hiding what’s been watched needs MDBList. With progress kept here, watched titles stay in rows.</p>}
      </li>
      {live && self && <Trackers page={page} person={person} back={back} onBack={setBack}/>}
      {live && !self && (person.lists || person.history) && <li><div><h3>What they watched</h3><p>{person.name}’s own page, under Accounts, shows what’s missing between where {their} progress is kept and Trakt. It’s theirs, so it isn’t shown here.</p>{person.joined && <OpenPage page={page} person={person}/>}</div></li>}
    </ul>
    {leaving && <Confirm title="Keep progress here?" body={`MDBList stops keeping ${mine ? 'your' : `${person.name}’s`} progress. What’s already in MDBList stays there.`} action="Keep it here" onYes={leave} onClose={() => setLeaving(false)}/>}
  </>;
}
/* Their own page, in a tab of its own: this one stays the manager's. */
function OpenPage({page, person}: {page: PageProps; person: Person}) {
  const [creds] = useCreds(page, person);
  return creds?.link ? <a className="link" href={creds.link} target="_blank" rel="noopener">Open {person.name}’s page →</a> : null;
}
type Cell = 'has' | 'add' | 'none';
type Place = 'here' | 'trakt' | 'lists';
interface Line {key: string; title: string; detail: string; at?: string; pct?: number; here?: Cell; trakt?: Cell; lists?: Cell; elsewhere?: boolean}
interface Look {lines: Line[]; more: boolean; unmatched: number; already: number; checked?: number}
type Pair = 'here-trakt' | 'here-mdblist' | 'mdblist-here' | 'mdblist-trakt';
const NAMES: Record<Place, string> = {here: 'Here', trakt: 'Trakt', lists: 'MDBList'};
const short = (detail: string) => detail.replace(/^Season (\d+) · Episode (\d+)$/, 'S$1E$2');
const SHOWN = 8;
/* One card that always compares two places: where progress is kept (Here or MDBList) and Trakt, or, while moving where progress is
   kept, the old place and the new one (worker/places.ts). Each line is a play one side lacks, with an arrow toward it; every line
   starts included, and tapping one leaves it out (and out of later looks). Nothing is ever removed. Moving switches only once the
   plays are across. With nothing missing it folds to one line; with nothing connected there is no card. */
function Trackers({page, person, back, onBack}: {page: PageProps; person: Person; back: boolean; onBack: (back: boolean) => void}) {
  const {toast, live, hub} = page, trakt = !!person.history && !person.history.again, lists = person.lists, moving = person.moving ?? null;
  const [looks, setLooks] = useState<Record<string, Look | 'failed'>>({}), [out, setOut] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(''), [all, setAll] = useState(false);
  // What each pair holds, kept with whose it is: a look at someone else never shows here.
  const whose = `${hub.code}/${person.id}`, lookOf = (pair: Pair) => looks[`${whose}/${pair}/${person.v}`];
  const want: Pair[] = moving === 'mdblist' ? ['here-mdblist'] : lists && (back || moving === 'here') ? ['mdblist-here'] : lists ? (trakt ? ['here-mdblist', 'mdblist-trakt'] : ['here-mdblist']) : trakt ? ['here-trakt'] : [];
  const [checking, setChecking] = useState(false);
  const lookAt = (pair: Pair, fresh = false) => {const at = `${whose}/${pair}/${person.v}`; return live!.call<Look>('GET', `/api/people/${person.id}/compare/${pair}${fresh ? '?fresh=1' : ''}`).then(got => setLooks(was => ({...was, [at]: got})), () => setLooks(was => ({...was, [at]: 'failed'})));};
  useEffect(() => {
    if (!live) return;
    for (const pair of want) if (!looks[`${whose}/${pair}/${person.v}`]) void lookAt(pair);
  }, [whose, want.join(), person.v]);
  // Looks again now instead of using the last look (kept up to six hours); the hub waits two minutes between looks.
  const again = checking ? null : <button type="button" className="link small" onClick={() => {setChecking(true); void Promise.all(want.map(pair => lookAt(pair, true))).finally(() => setChecking(false));}}>Check again</button>;
  if (!live || (!trakt && !lists && !moving)) return null;
  const leftover = lookOf('here-mdblist'), leftovers = lists && !moving && !back && leftover && leftover !== 'failed' && leftover.lines.length > 0;
  // Which state the card is in: the pair, its two columns, and its words.
  const state = moving === 'mdblist' ? {kind: 'to-lists', pair: 'here-mdblist' as Pair, cols: ['here', 'lists'] as Place[], title: 'Moving to MDBList', count: 'to move'}
    : lists && (back || moving === 'here') ? {kind: 'to-here', pair: 'mdblist-here' as Pair, cols: ['here', 'lists'] as Place[], title: 'Moving back to Here', count: 'to move'}
    : leftovers ? {kind: 'finish', pair: 'here-mdblist' as Pair, cols: ['here', 'lists'] as Place[], title: 'Finish moving from Here', count: 'to move'}
    : lists && trakt ? {kind: 'both', pair: 'mdblist-trakt' as Pair, cols: ['lists', 'trakt'] as Place[], title: 'MDBList and Trakt', count: 'missing'}
    : trakt ? {kind: 'here-trakt', pair: 'here-trakt' as Pair, cols: ['here', 'trakt'] as Place[], title: 'Here and Trakt', count: 'missing'}
    : {kind: 'lists', pair: null, cols: ['here', 'lists'] as Place[], title: 'MDBList', count: 'missing'};
  const found = person.drift, moves = state.kind === 'to-lists' || state.kind === 'to-here';
  if (lists && !moving && !back && leftover === undefined) return <li className="trackers quiet"><span className="dot wait" aria-hidden="true"/><p><strong>{trakt ? 'MDBList and Trakt' : 'MDBList'}</strong> <span className="muted">· looking…</span></p></li>;
  const looked = state.pair ? lookOf(state.pair) : undefined;
  if (state.pair && !looked) return <li className="trackers quiet"><span className="dot wait" aria-hidden="true"/><p><strong>{state.title}</strong> <span className="muted">· looking…</span></p></li>;
  const when = (ms: number) => {const date = new Date(ms), today = new Date().toDateString() === date.toDateString(); return `${today ? 'today' : date.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})} at ${date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;};
  const stamp = (ms: number) => `${new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}, ${new Date(ms).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;
  const lines: Line[] = state.kind === 'both' ? [
    ...(found?.toMdblist ?? []).map(miss => ({key: miss.key, title: miss.name || 'Untitled', detail: miss.season != null ? `S${miss.season}E${miss.episode}` : 'Movie', at: stamp(miss.at * 1000), trakt: 'has' as Cell, lists: 'add' as Cell})),
    ...(found?.toTrakt ?? []).map(miss => ({key: miss.key, title: miss.name || 'Untitled', detail: miss.season != null ? `S${miss.season}E${miss.episode}` : 'Movie', at: stamp(miss.at * 1000), trakt: 'add' as Cell, lists: 'has' as Cell})),
    // Paused points one of them has and the other lacks (looked at when the card opens).
    ...(looked && looked !== 'failed' ? looked.lines.map(line => ({...line, detail: short(line.detail), at: undefined})) : []),
  ] : looked && looked !== 'failed' ? looked.lines.map(line => ({...line, detail: short(line.detail), at: line.pct == null && line.at ? stamp(Date.parse(line.at)) : undefined})) : [];
  const checkedAt = state.kind === 'both' ? (found ? found.checked * 1000 : 0) : looked && looked !== 'failed' && looked.checked ? looked.checked * 1000 : 0;
  const [left, right] = state.cols, kept = lines.filter(line => !out.has(line.key));
  const flip = (key: string) => setOut(was => {const next = new Set(was); if (!next.delete(key)) next.add(key); return next;});
  const after = async (note: string) => {setOut(new Set()); setLooks({}); await live.sync(); await live.reload(); toast(note);};
  const plays = (n: number) => `${n} ${n === 1 ? 'play' : 'plays'}`;
  // One press: as many passes as it takes (each fits in what the hub may do per request), showing how far it has got.
  const run = async () => {
    setBusy('…'); let added = 0, unmatched = 0;
    try {
      if (state.kind === 'both') {
        const got = await live.call<{trakt: number; mdblist: number}>('POST', `/api/people/${person.id}/drift`, {leave: [...out]}); added = got.trakt + got.mdblist;
        if (lines.some(line => line.key.startsWith('pm:') || line.key.startsWith('pt:'))) added += (await live.call<{added: number}>('POST', `/api/people/${person.id}/compare/mdblist-trakt`, {})).added;
        return await after(added ? `Added ${plays(added)}` : 'Both already had them');
      }
      if (state.kind === 'to-here' && moving !== 'here') {await live.call('POST', `/api/people/${person.id}/moving`, {to: 'here'}); await live.sync();}
      let switched = false;
      for (let pass = 0, leave = [...out]; pass < 30; pass++, leave = []) {
        const got = await live.call<{added: number; unmatched: number; more: boolean; switched: boolean}>('POST', `/api/people/${person.id}/compare/${state.pair}`, {leave, ...(moves ? {switch: true} : {})});
        added += got.added; unmatched += got.unmatched; switched = got.switched; setBusy(` ${added} so far`);
        if (!got.more) break;
      }
      const missed = unmatched ? ` ${plays(unmatched)} couldn’t be matched and ${unmatched === 1 ? 'was' : 'were'} left out.` : '';
      onBack(false);
      await after(state.kind === 'to-lists' && switched ? `Moved ${plays(added)}. Progress is kept in MDBList now.${missed}` : state.kind === 'to-here' && switched ? `Moved ${plays(added)}. Progress is kept here now.${missed}` : added ? `Added ${plays(added)}.${missed}` : `Nothing needed adding.${missed}`);
    } catch (error) {toast((error as Error).message); setLooks({}); await live.reload();} finally {setBusy('');}
  };
  const stay = async () => {
    setBusy('…');
    try {
      if (state.kind === 'to-lists') {await live.call('DELETE', `/api/people/${person.id}/mdblist`); return await after('Staying on Here');}
      if (moving === 'here') await live.call('POST', `/api/people/${person.id}/moving`, {to: null});
      onBack(false); await after('Staying on MDBList');
    } catch (error) {toast((error as Error).message);} finally {setBusy('');}
  };
  if (looked === 'failed') return <li className="trackers quiet"><span className="dot wait" aria-hidden="true"/><p><strong>{state.title}</strong> <span className="muted">· couldn’t look just now</span></p></li>;
  if (!lines.length && !moves) return state.kind === 'lists' && !leftover ? null : <li className="trackers quiet"><span className="dot ok" aria-hidden="true"/><p><strong>{state.kind === 'both' ? 'Trakt and MDBList' : state.kind === 'here-trakt' ? 'Here and Trakt' : 'MDBList'}</strong> <span className="muted">· all in step{checkedAt ? ` · checked ${when(checkedAt)}` : ''}</span> {checking ? <span className="muted small">Checking…</span> : again}</p></li>;
  const cell = (state_: Cell | undefined, off: boolean) => !state_ || state_ === 'none' ? <span className="cell none" aria-hidden="true">–</span> : <span className={`cell ${state_}${off ? ' off' : ''}`} aria-hidden="true">{state_ === 'has' ? '✓' : '+'}</span>;
  const arrow = (line: Line) => line[right] === 'add' && line[left] === 'add' ? '← →' : line[right] === 'add' ? '→' : '←';
  const visible = all ? lines : lines.slice(0, SHOWN);
  const label = busy ? `${moves || state.kind === 'finish' ? 'Moving' : 'Adding'}…${busy.trim() === '…' ? '' : busy}` : moves ? (kept.length ? `Move ${plays(kept.length)} and switch` : state.kind === 'to-lists' ? 'Switch to MDBList' : 'Switch back to Here') : state.kind === 'finish' ? `Move ${plays(kept.length)}` : `Add ${plays(kept.length)}`;
  return <li className="stacked trackers">
    <div className="trackers-head"><h3>{state.title}</h3><span className="muted small">{checkedAt ? `Checked ${when(checkedAt)} · ` : ''}{checking ? 'Checking…' : again}</span></div>
    <p className="muted small">{lines.length ? `${plays(lines.length)} ${state.count}` : 'Nothing to move'}{(looked as Look | undefined)?.more ? ', and more after these' : ''}</p>
    {!!lines.length && <div className="trackers-cols muted small" aria-hidden="true"><span>{NAMES[left]}</span><span>{NAMES[right]}</span></div>}
    {!!lines.length && <ul className="plays">{visible.map(line => {const off = out.has(line.key); return <li key={line.key}>
      <button type="button" className={`play${off ? ' left' : ''}`} aria-pressed={!off} aria-label={`Add ${line.title} ${line.detail}`} onClick={() => flip(line.key)}>
        {cell(line[left], off)}
        <span className="what"><strong>{line.title}</strong><small>{line.detail}{line.at ? ` · ${line.at}` : ''}{line.pct != null && <> · partway · <em>{line.pct}%</em></>}{line.elsewhere ? ' · watched elsewhere' : ''}</small><small className="arrow" aria-hidden="true">{arrow(line)}</small></span>
        {cell(line[right], off)}
      </button></li>;})}</ul>}
    {lines.length > SHOWN && !all && <button type="button" className="link small center-text more-plays" onClick={() => setAll(true)}>and {lines.length - SHOWN} more</button>}
    <button type="button" className="primary" disabled={!!busy || (!kept.length && !moves)} onClick={() => void run()}>{label}</button>
    <p className="muted small center-text">{state.kind === 'to-lists' ? <>Everything stays Here too. <button type="button" className="link small stay" disabled={!!busy} onClick={() => void stay()}>Stay on Here</button></>
      : state.kind === 'to-here' ? <>Everything stays in MDBList too. <button type="button" className="link small stay" disabled={!!busy} onClick={() => void stay()}>Stay on MDBList</button></>
      : state.kind === 'finish' ? 'These were watched here before MDBList. Everything stays Here too.' : 'Tap a play to leave it out. Nothing is ever removed.'}</p>
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
function PersonSections({page, person, tab, mine}: {page: PageProps; person: Person; tab: string; mine: boolean}) {
  const {hub, update, toast} = page, group = hub.groups.find(item => item.id === person.groupId)!, own = useOwnPicks(page, person, mine);
  const edit = (change: (person: Person) => void, note: string) => {update(next => change(next.people.find(item => item.id === person.id)!)); toast(note);};
  const props = editor(page, group, person, mine), rows = personRows(hub, person);
  const canArrange = !mine || person.can.arrange, canAdd = !mine || person.can.add;
  return <>
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} mine={mine} person={person.id} level="own" rows={rows} front={!!hub.front} canAdd={canAdd} canArrange={canArrange}
      tag={row => row.origin === 'own' && !row.core ? (mine ? 'Yours' : 'Personal') : undefined}
      lists={page.live ? own.lists : ownLists(person)} listsHint={page.live ? undefined : mine ? 'Connect Trakt or MDBList under Accounts to pick from your own lists.' : `Shows up once ${person.name} connects Trakt or MDBList.`}
      because={own.because} limit={props.resolved.values.limit} listsOk={!!hub.mdblist || person.lists} keyHint={mine ? 'Your own MDBList key, under Accounts, works too.' : <>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>}
      onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined}
      onChange={(next: Row[], note) => edit(target => {
        // Only a Trakt row (or a row for children) switched on or off while following the Home above: kept as their choice, so they still follow it.
        const flipped = !target.rows && next.length === rows.length && next.every((row, at) => row.id === rows[at].id) ? next.filter((row, at) => row.on !== rows[at].on) : [];
        if (flipped.length === 1 && pickable(flipped[0].id)) target.picks = {...target.picks, [flipped[0].id]: flipped[0].on}; else target.rows = next;
      }, note)}
      onMute={kind => props.set('forYouOff', [...(props.resolved.values.forYouOff ?? []), kind], `${FOR_YOU_KINDS.find(item => item.id === kind)?.title ?? 'That kind'} won’t be picked`)}
      onFollow={person.rows && canArrange ? () => edit(target => {target.rows = null;}, `Following ${group.name} again`) : undefined} followLabel={`Follow ${group.name} again`}/>}
    {tab === 'home' && <ForYouEditor {...props}/>}
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
        <Setting title="Arrange their Home" hint="Reorder rows and turn them on or off."><Switch label="Arrange their Home" checked={person.can.arrange} onChange={value => edit(target => {target.can.arrange = value;}, 'Saved')}/></Setting>
        <Setting title="Add their own rows" hint="Paste list links and pick collections."><Switch label="Add their own rows" checked={person.can.add} onChange={value => edit(target => {target.can.add = value;}, 'Saved')}/></Setting>
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
    {tab === 'home' && <HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined} level="group" limit={props.resolved.values.limit} listsOk={!!hub.mdblist} keyHint={<>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>} front={!!hub.front} rows={withForYou(withKids(placed(groupRows(hub, group)), props.resolved.values.limit === 'kids'), !!hub.front)} person={key} tag={row => row.origin === 'group' ? 'This group' : undefined} onChange={(rows, note) => edit(target => {target.rows = rows;}, note)}
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
    {tab === 'home' && <><HomeEditor find={page.live ? link => page.live!.call('POST', '/api/lists', {link}) : undefined} fail={page.toast} onBuild={SAMPLE ? soon(toast, 'the AIOMetadata builder') : undefined} level="hub" limit={hub.defaults.limit} listsOk={!!hub.mdblist} keyHint={<>It goes under <a className="link" href="#/hub/sources">Hub, Sources</a>.</>} front={!!hub.front} rows={withForYou(placed(hub.rows), !!hub.front)} tag={() => undefined} onChange={(rows, note) => {update(next => {next.rows = rows;}); toast(note);}}/>{page.live && !hub.mdblist && <p className="notice"><span>The collection rows (by Service, by Genre) reach the player apps once the hub has an MDBList key.</span><a className="link" href="#/hub/sources">Add it</a></p>}<p className="muted small foot">{following} of {hub.groups.length} groups follow this Home.</p><ForYouEditor {...props}/></>}
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
      {door('AIOStreams', doors.aiostreams, doors.front ? 'Sources, filters, sorting and the stream label. It finds the streams; browsing happens on each person’s own AIOMetadata. If it asks, use this ID and password.' : 'Sources, filters, sorting and the stream label. If it asks, use this ID and password.')}
      {door('AIOMetadata', doors.aiometadata, doors.front ? 'The hub’s own setup. It draws the posters everyone sees. It asks for this password.' : 'Catalogs, collections and posters for the shared Home. It asks for this password.')}
      {(doors.own ?? []).map(found => door(`AIOMetadata for ${found.name}`, found, found.player ? `${found.name}’s own server: their Home, looks, accounts and what they’ve watched. Their apps reach it through the hub, which keeps it in step with the hub and their group.` : `${found.group ? `The ${found.name} group’s` : `${found.name}’s`} own Home, looks and accounts. The hub made it because they differ from the shared one, and removes it once they don’t.`))}
      <Setting column title="What the hub keeps putting back" hint={`The hub rewrites the things it manages each time you change something here: debrid account, the sources it lists, quality and size, languages, the stream label, people, Home rows and collections. Anything else you add there is left alone. ${doors.front ? 'Each person’s Home lives on their own AIOMetadata setup, listed above.' : 'A group’s or a person’s own Home lives in its own AIOMetadata setup, listed above when there is one.'}`}><button type="button" className="ghost small" onClick={() => setDoors(null)}>Hide</button></Setting>
    </div>}
  </section>;
}
/* What the hub does on its own, one compact row per job, with how often it runs: the five-minute run (Trakt calls that waited,
   players that went quiet) and the daily Trakt/MDBList check, which starts with the first run after 04:00 UTC. Times are the
   viewer's own. */
const FIVE = 300_000, DAY_MS = 86_400_000;
/* For you: one person a five-minute run from its hour (UTC), then the hub's apps are brought in step. Someone just added is
   picked for at any hour. */
function forYouJob(jobs: NonNullable<Hub['jobs']>, now: number, time: (ms: number) => string, day: (ms: number) => string, ran: (s: number | null) => string) {
  const start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T${String(jobs.forYouHour).padStart(2, '0')}:00:00Z`), picked = jobs.picked ?? 0, everyone = jobs.everyone ?? 0;
  const done = picked >= everyone, waiting = !done && now >= start;
  return {name: 'For you picks', every: `every day at ${time(start)}`, last: `${ran(jobs.pickedAt ?? null)}${everyone ? ` · ${Math.min(picked, everyone)} of ${everyone} picked today` : ''}`,
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
    {name: 'Trakt sync', every: 'every 5 min', last: `${ran(jobs.last)}${jobs.waiting ? ` · ${jobs.waiting} waiting to send` : ''}`, next: `next run in ${Math.max(1, Math.ceil((next - now) / 60_000))} min`},
    {name: 'Trakt and MDBList check', every: `every day at ${time(start)}`, last: ran(jobs.ran), next: jobs.checking ? 'under way' : `next run ${day(daily)}`},
    ...(hub.front && jobs.forYouHour !== undefined ? [forYouJob(jobs, now, time, day, ran)] : []),
  ];
  return <section>
    <div className="section-head"><div><h2>Background work</h2></div></div>
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
    <PersonSections page={page} person={person} tab={tab === 'playback' && !person.can.playback ? 'home' : tab} mine/>
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
