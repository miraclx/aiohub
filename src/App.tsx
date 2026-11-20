import {useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {SAMPLE, sampleHub} from './data';
import type {Hub} from './data';
import {Activity} from './activity';
import {call, changes, settle} from './live';
import type {Live, Refused} from './live';
import {AccountPage, GroupPage, HubPage, JoinGate, JoinPage, PeoplePage, PersonPage, SetupPage, SignInPage, backFromTrakt, lostTrakt} from './pages';
import type {PageProps} from './pages';
import {Avatar, showReal, useRoute} from './ui';

function useToast() {
  const [note, setNote] = useState<{text: string; key: number} | null>(null), timer = useRef<number | undefined>(undefined), box = useRef<HTMLDivElement>(null);
  const toast = useMemo(() => (text: string) => {setNote({text, key: Date.now()}); clearTimeout(timer.current); timer.current = window.setTimeout(() => setNote(null), 2600);}, []);
  // An open sheet sits above the whole page, dimming and blurring it. Re-raising the toast each time puts it above the sheet too, so it stays readable.
  useEffect(() => {const el = box.current; if (!el?.showPopover) return; try {if (el.matches(':popover-open')) el.hidePopover(); if (note) el.showPopover();} catch {/* older browser: stays where it was */}}, [note]);
  return [toast, <div className="toast" popover="manual" ref={box} role="status" aria-live="polite">{note && <span key={note.key}>{note.text}</span>}</div>] as const;
}
/* The frame around every page: the top bar, the page, the toast. `mine` is an invited person's own view. */
function Frame({page, parts, mine, bar, toastView, children}: {page?: PageProps; parts: string[]; mine?: string; bar?: ReactNode; toastView: ReactNode; children?: ReactNode}) {
  const [at, id, tab] = parts, people = !at || at === 'person' || at === 'group', hub = page?.hub;
  return <div className="app">
    <header className="top"><a className="brand" href={mine ?? '#/'}><span className="logo" aria-hidden="true"/>AIOHub</a>
      {page && hub && !mine && <nav><a href="#/" className={people ? 'on' : ''}>People</a><a href="#/activity" className={at === 'activity' ? 'on' : ''}>Activity</a><a href="#/hub" className={at === 'hub' ? 'on' : ''}>Hub</a><a href="#/account" className={`me${at === 'account' ? ' on' : ''}`} aria-label="Your account"><Avatar name={hub.me.name} size={26}/></a></nav>}
    </header>
    {bar}
    <main>
      {children ?? (page && hub && <>
        {!at && <PeoplePage {...page}/>}
        {at === 'person' && <PersonPage {...page} id={id ?? ''} tab={tab ?? 'home'}/>}
        {at === 'group' && <GroupPage {...page} id={id ?? ''} tab={tab ?? 'home'}/>}
        {at === 'hub' && <HubPage {...page} tab={id ?? 'home'}/>}
        {at === 'activity' && <><div className="page-head"><h1>Activity</h1><p className="muted">What everyone is watching.</p></div><Activity hub={hub} pick toast={page.toast} live={page.live}/></>}
        {at === 'account' && <AccountPage {...page}/>}
        {!!at && !['person', 'group', 'hub', 'activity', 'account'].includes(at) && <div className="empty"><p>There’s no page at this address.</p><p><a className="link" href="#/">Go to People</a></p></div>}
      </>)}
    </main>
    <footer className="credit">Built with <span className="heart" role="img" aria-label="love">♥︎</span> by <a href="https://github.com/miraclx/aiohub" target="_blank" rel="noreferrer">miraclx</a></footer>
    {toastView}
  </div>;
}

/* The preview: the same screens on made-up data. Nothing is saved or sent. */
function Preview() {
  const [parts, go] = useRoute(), [hub, setHub] = useState<Hub>(sampleHub), [toast, toastView] = useToast();
  const page = useMemo<PageProps>(() => ({hub, go, toast, update: change => setHub(current => {const next = structuredClone(current); change(next); return next;})}), [hub]);
  useEffect(() => {document.documentElement.dataset.theme = hub.me.theme;}, [hub.me.theme]);
  const [at, id, tab] = parts;
  return <Frame page={page} parts={parts} toastView={toastView} mine={at === 'join' ? `#/join/${id}` : undefined}
    bar={<p className="preview-bar">Preview with sample data. Nothing here is saved or sent anywhere. <button type="button" className="link" onClick={() => {setHub(sampleHub()); go('/');}}>Reset</button></p>}>
    {at === 'setup' ? <SetupPage {...page}/> : at === 'join' ? <JoinPage {...page} id={id ?? ''} tab={tab ?? 'home'}/> : undefined}
  </Frame>;
}

// Back from Trakt's sign-in: put aside before the address is read for the first time.
if (!SAMPLE) backFromTrakt();

/* The real hub. What is on screen is the truth for the page; `saved` is what the hub last confirmed. */
function Hubbed() {
  const [parts, go] = useRoute(), [toast, toastView] = useToast();
  const [hub, setHub] = useState<Hub | null>(null), [phase, setPhase] = useState<'loading' | 'out' | 'in'>('loading');
  const [who, setWho] = useState<{role: 'owner' | 'person'; personId: string}>({role: 'owner', personId: ''}), [open, setOpen] = useState<{signup: boolean; code: boolean; hub?: string; proof?: string} | null>(null);
  const shown = useRef<Hub | null>(null), saved = useRef<Hub | null>(null), role = useRef<'owner' | 'person'>('owner'), queue = useRef<Promise<void>>(Promise.resolve()), timer = useRef<number | undefined>(undefined);
  const loaded = useRef(0);
  const show = (next: Hub | null) => {shown.current = next; setHub(next);};
  const live = useMemo<Live & {update: PageProps['update']}>(() => {
    const load = async () => {
      try {
        const state = await call<{role: 'owner' | 'person'; personId: string | null; hub: Hub}>('GET', '/api/state');
        loaded.current = Date.now(); saved.current = structuredClone(state.hub); role.current = state.role; show(state.hub); setWho({role: state.role, personId: state.personId ?? ''}); setPhase('in'); look();
        if (state.role === 'owner') localStorage.setItem('hub-code', state.hub.code);
      } catch (error) {
        if ((error as Refused).status !== 401) {toast((error as Error).message); return;}
        saved.current = null; show(null); setPhase('out'); setOpen(await call<{signup: boolean; code: boolean; hub?: string; proof?: string}>('GET', '/api/open').catch(() => null));
      }
    };
    // What each Home row really holds, fetched beside the page and drawn when it arrives.
    const look = () => void call<{rows: Record<string, string[]>}>('GET', '/api/previews').then(found => {showReal(found.rows); if (shown.current) show(structuredClone(shown.current));}, () => {});
    // After a save, the player apps are brought in step. A problem there is said once, not on every save.
    let said = '';
    const sync = async () => {
      let result = await call<{state: string; message?: string; more?: boolean}>('POST', '/api/sync', {}).catch(() => null);
      // A big change (a new key, many people with their own Home) is brought in step over a few passes.
      for (let pass = 0; result?.more && pass < 8; pass++) result = await call<{state: string; message?: string; more?: boolean}>('POST', '/api/sync', {}).catch(() => null);
      const message = result?.more ? '' : result?.message ?? '';
      if (message && message !== said) toast(message);
      said = message;
      if ((result?.state === 'ok' || result?.state === 'partial') && saved.current && shown.current && !changes(saved.current, shown.current, role.current).length) await load();
    };
    const drain = async () => {
      let sent = false;
      for (;;) {
        if (!saved.current || !shown.current) return;
        const sending = shown.current, jobs = changes(saved.current, sending, role.current);
        if (!jobs.length) break;
        sent = true;
        for (const job of jobs) {
          try {
            const answer = await call<{v?: number}>(job.method, job.path, job.body);
            settle(saved.current, job, answer.v, sending);
            if (shown.current) {const next = structuredClone(shown.current); settle(next, job, answer.v); show(next);}
          } catch (error) {toast((error as Error).message); await load(); return;}
        }
      }
      if (sent) await sync();
    };
    const settled = () => {clearTimeout(timer.current); return queue.current = queue.current.then(drain);};
    return {
      call, settled, sync, reload: () => settled().then(load),
      update: change => {if (!shown.current) return; const next = structuredClone(shown.current); change(next); show(next); clearTimeout(timer.current); timer.current = window.setTimeout(settled, 400);},
    };
  }, []);
  // On opening the site, the player setups are also brought in step once: that is how an improvement to the site reaches a hub
  // that nobody is changing anything on. It is a no-op when nothing differs.
  useEffect(() => {void live.reload().then(() => {if (shown.current?.groups.length) void live.sync();});}, []);
  useEffect(() => {document.documentElement.dataset.theme = hub?.me.theme ?? 'dark';}, [hub?.me.theme]);
  useEffect(() => {if (phase === 'in') {const note = lostTrakt(); if (note) toast(note);}}, [phase]);
  // Other people change things too (someone joins, an app signs in). Pick that up when the tab is looked at again, and now and then while moving around.
  useEffect(() => {const look = () => {if (document.visibilityState === 'visible' && shown.current && Date.now() - loaded.current > 5000) {loaded.current = Date.now(); void live.reload();}}; document.addEventListener('visibilitychange', look); return () => document.removeEventListener('visibilitychange', look);}, []);
  useEffect(() => {if (shown.current && Date.now() - loaded.current > 20_000) {loaded.current = Date.now(); void live.reload();}}, [parts.join('/')]);
  // Leaving the page with something still unsent: send it now.
  useEffect(() => {const leave = () => {void live.settled();}; window.addEventListener('pagehide', leave); return () => window.removeEventListener('pagehide', leave);}, []);
  const page = useMemo<PageProps | undefined>(() => hub ? {hub, go, toast, update: live.update, live} : undefined, [hub]);
  const [at, id, tab] = parts, inside = phase === 'in' && !!page;

  if (phase === 'loading') return <Frame parts={parts} toastView={toastView}><p className="empty">Loading…</p></Frame>;
  if (at === 'join' && id && !(inside && who.role === 'person')) return <Frame parts={parts} toastView={toastView}><JoinGate token={id} live={live} toast={toast} manager={inside} onIn={() => {void live.reload().then(() => go('/me'));}} onAs={id => {void live.reload().then(() => go(`/person/${id}`));}}/></Frame>;
  // One place for first-time setup, so it keeps its step while the account is being created underneath it.
  const creating = phase === 'out' && at === 'setup' && !!open?.signup, unfinished = inside && who.role === 'owner' && !hub!.groups.length;
  if (creating || unfinished) return <Frame parts={parts} toastView={toastView}><SetupPage hub={hub ?? {...sampleHub(), services: [], groups: [], people: []}} go={go} toast={toast} update={live.update} live={live} signedIn={phase === 'in'} needCode={open?.code} linkCode={at === 'setup' ? id : undefined} offer={open?.hub && open.proof ? {hub: open.hub, proof: open.proof} : undefined}/></Frame>;
  if (!inside) return <Frame parts={parts} toastView={toastView}><SignInPage live={live} toast={toast} canCreate={!!open?.signup}/></Frame>;
  if (who.role === 'person') return <Frame page={page} parts={parts} toastView={toastView} mine="#/me"><JoinPage {...page!} id={who.personId} base="/me" tab={(at === 'me' ? id : undefined) ?? 'home'}/></Frame>;
  return <Frame page={page} parts={parts} toastView={toastView}/>;
}

export const App = SAMPLE ? Preview : Hubbed;
