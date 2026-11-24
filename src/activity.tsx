import {useEffect, useState} from 'react';
import {SAMPLE, samplePlays} from './data';
import type {Hub, Play} from './data';
import type {Live} from './live';
import {Avatar, Posters, Segments, Sheet} from './ui';

/* What the hub noted as players reported it, put into the words the screen uses. Times are shown in this device's own time zone. */
interface Noted {art?: string; person: string; item: string; title: string; detail: string; position: number; duration: number; device: string; playing: number; paused?: number; since?: number; updated: number; place?: string | null; net?: string | null}
function told(row: Noted, now: number, code: string): Play | null {
  const at = new Date(row.updated * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  if (days > 6) return null;
  // `updated` is when the player was last heard from: a player left open keeps reporting, paused or not. One that went quiet
  // without saying it stopped is shown with when it was last heard.
  const heard = !!row.playing && now - row.updated < 180, live = heard && !row.paused, share = row.duration ? Math.min(100, Math.round(row.position / row.duration * 100)) : 0;
  const quiet = !!row.playing && !heard, last = new Date(row.updated * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  const end = live ? '' : row.paused && row.playing ? ` · paused at ${clock(row.position)}${heard && row.since ? ` for ${span(now - row.since)}` : ''}` : share >= 90 ? ' · finished' : share ? ` · stopped at ${share}%` : '';
  return {art: row.art ? `/h/${code}/Items/${row.art}/Images/Primary?maxHeight=300` : undefined, id: `${row.person}/${row.item}`, personId: row.person, title: row.title, detail: row.detail + end, progress: heard || (share && share < 90) ? share : undefined, on: row.device || 'A player app', where: row.place ? [row.place, brief(row.net)].filter(Boolean).join(' · ') : undefined,
    when: heard ? 'Now' : quiet && days === 0 ? `Last heard ${last}` : days > 1 ? at.toLocaleDateString(undefined, {weekday: 'long'}) : at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
}
/* 33:28, or 1:02:05 for an hour or more in; and how long something has lasted, roughly. */
const clock = (seconds: number) => {const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, rest = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;};
const span = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : seconds < 86400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86400)} days`;
/* A network's everyday name: "SpaceX Services, Inc." is SpaceX. Company endings are dropped; a name that would go empty is kept. */
const ENDINGS = /\s+(inc|llc|ltd|limited|plc|corp|corporation|gmbh|services|communications?|networks?)\.?$/i;
function brief(net?: string | null) {
  let name = (net ?? '').split(',')[0].trim();
  for (let shorter = name.replace(ENDINGS, ''); shorter && shorter !== name; shorter = name.replace(ENDINGS, '')) name = shorter;
  return name;
}
/* Where the device was when it last reported this play, kept folded behind a small pin until asked for. */
function Where({where}: {where?: string}) {
  const [open, setOpen] = useState(false);
  if (!where) return null;
  return <span className={`where${open ? ' open' : ''}`}><button type="button" className="where-pin" aria-label="Where" aria-expanded={open} onClick={() => setOpen(!open)}></button><span className="where-text" aria-hidden={!open}>{where}</span></span>;
}
/* A week per person, from the same notes: how many titles, roughly how long (each title counts up to where it was last left),
   how many were finished, and the device used most. Rough on purpose; it is for spotting who watches what, not for billing. */
interface Week {person: string; titles: number; seconds: number; finished: number; devices: number; mostly: string; last: number; plays: number; when: string}
/* The part of the day most plays started in, in this device's time zone; said only once there are a few to go on. */
const PARTS: [number, string][] = [[5, 'late at night'], [12, 'in the mornings'], [17, 'in the afternoons'], [22, 'in the evenings'], [24, 'late at night']];
function partOf(starts: number[]) {
  if (starts.length < 3) return '';
  const count = new Map<string, number>(); for (const at of starts) {const hour = new Date(at * 1000).getHours(), part = PARTS.find(([end]) => hour < end)![1]; count.set(part, (count.get(part) ?? 0) + 1);}
  return [...count].sort((a, b) => b[1] - a[1])[0][0];
}
function weeks(rows: Noted[], now: number, starts: {person: string; at: number}[] = []): Week[] {
  const by = new Map<string, Noted[]>();
  for (const row of rows) if (now - row.updated < 7 * 86400) by.set(row.person, [...(by.get(row.person) ?? []), row]);
  return [...by].map(([person, list]) => {
    const count = new Map<string, number>(); for (const row of list) count.set(row.device || 'A player app', (count.get(row.device || 'A player app') ?? 0) + 1);
    const done = (row: Noted) => row.duration > 0 && row.position / row.duration >= 0.9;
    const mine = starts.filter(start => start.person === person).map(start => start.at);
    return {person, plays: mine.length, when: partOf(mine), titles: list.length, finished: list.filter(done).length, devices: count.size, mostly: [...count].sort((a, b) => b[1] - a[1])[0][0], last: Math.max(...list.map(row => row.updated)),
      seconds: list.reduce((sum, row) => sum + (done(row) ? row.duration : row.duration ? Math.min(row.position, row.duration) : row.position), 0)};
  }).sort((a, b) => b.seconds - a.seconds);
}
const hours = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `about ${Math.round(seconds / 3600)} h`;
/* The title's own picture, as the player apps show it. */
const Picture = ({url}: {url: string}) => <div className="posters" aria-hidden="true"><span style={{backgroundImage: `url(${JSON.stringify(url)})`}}/></div>;
export function Activity({hub, personId, groupId, pick, toast, live}: {hub: Hub; personId?: string; groupId?: string; pick?: boolean; toast: (text: string) => void; live?: Live}) {
  const [filter, setFilter] = useState('all'), [title, setTitle] = useState<string | null>(null), [real, setReal] = useState<Play[]>([]), [turn, setTurn] = useState(0), [noted, setNoted] = useState<{now: number; plays: Noted[]; starts?: {person: string; at: number}[]}>({now: 0, plays: []});
  useEffect(() => {
    if (!live) return; let on = true;
    void live.call<{now: number; plays: Noted[]; starts?: {person: string; at: number}[]}>('GET', '/api/activity').then(found => {if (on) {setNoted(found); setReal(found.plays.map(row => told(row, found.now, hub.code)).filter((play): play is Play => !!play)); if (turn) toast('Up to date');}}, (error: Error) => toast(error.message));
    return () => {on = false;};
  }, [live, turn]);
  const scope = groupId ?? (filter === 'all' ? undefined : filter);
  const person = (id: string) => hub.people.find(item => item.id === id);
  const all = (SAMPLE ? samplePlays() : real).filter(play => person(play.personId));
  const plays = all.filter(play => (!personId || play.personId === personId) && (!scope || person(play.personId)!.groupId === scope));
  const name = (id: string) => person(id)?.name ?? '';
  const now = plays.filter(play => play.when === 'Now'), days = ['Today', 'Yesterday', 'Earlier this week'] as const;
  // How many devices one profile is playing on right now. Shown plainly; the manager decides what it means.
  const atOnce = (id: string) => new Set(now.filter(play => play.personId === id).map(play => play.on)).size;
  const text = (play: typeof plays[number]) => personId ? play.detail : `${name(play.personId)} · ${play.detail}`;
  const head = <div className="activity-bar">
    {pick && hub.groups.length > 1 ? <Segments label="Show" value={filter} onChange={setFilter} options={[{value: 'all', label: 'Everyone'}, ...hub.groups.map(group => ({value: group.id, label: group.name}))]}/> : <span/>}
    <button type="button" className="ghost small" onClick={() => live ? setTurn(turn + 1) : toast('Up to date')}>Refresh</button>
  </div>;
  if (!plays.length) return <section>{head}<p className="empty">Nothing watched yet. It shows up here once someone presses play.</p></section>;
  return <section>
    {head}
    {!personId && (() => {
      const shown = weeks(noted.plays, noted.now, noted.starts).filter(week => person(week.person) && (!scope || person(week.person)!.groupId === scope));
      return shown.length > 0 && <><h2 className="sub first">This week</h2><ul className="feed">{shown.map(week => <li key={week.person}><Avatar name={name(week.person)} size={36}/>
        <div><strong>{name(week.person)}</strong><small>{week.titles} {week.titles === 1 ? 'title' : 'titles'} · {hours(week.seconds)}{week.finished ? ` · ${week.finished} finished` : ''}{week.plays > 1 ? ` · pressed play ${week.plays} times` : ''}{week.when ? `, mostly ${week.when}` : ''}</small><small className="on-device">Mostly on {week.mostly}{week.devices > 1 ? ` · ${week.devices} devices` : ''}</small></div></li>)}</ul></>;
    })()}
    {!!now.length && <><h2 className="sub">Watching now</h2><ul className="now">{now.map(play => <li key={play.id}>{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}<div className="now-text">
      <button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small><small className="on-device">{play.on}<Where where={play.where}/>{atOnce(play.personId) > 1 ? ` · watching on ${atOnce(play.personId)} devices` : ''}</small>
      <span className="bar" role="progressbar" aria-valuenow={play.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${play.progress}% watched`}><i style={{width: `${play.progress}%`}}/></span></div></li>)}</ul></>}
    {days.map(day => {
      const items = plays.filter(play => play.day === day && play.when !== 'Now');
      return items.length ? <div key={day}><h2 className="sub">{day}</h2><ul className="feed">{items.map(play => <li key={play.id}>
        {personId ? <span className="thumb">{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}</span> : <Avatar name={name(play.personId)} size={36}/>}
        <div><button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small><small className="on-device">{play.on}<Where where={play.where}/></small></div><time>{play.when}</time></li>)}</ul></div> : null;
    })}
    <p className="muted small foot">Shows what each player last reported. It is not a minute-by-minute history.</p>
    {title && <Sheet title={title} onClose={() => setTitle(null)}>
      <p className="muted sheet-lead">Who watched it</p>
      <ul className="feed">{all.filter(play => play.title === title).map(play => <li key={play.id}><Avatar name={name(play.personId)} size={36}/><div><strong>{name(play.personId)}</strong><small>{play.when === 'Now' ? `${play.detail} · watching now, ${play.progress}% in` : play.detail}</small><small className="on-device">{play.on}</small></div><time>{play.when === 'Now' ? 'Now' : `${play.day === 'Earlier this week' ? '' : play.day + ' '}${play.when}`}</time></li>)}</ul>
    </Sheet>}
  </section>;
}
