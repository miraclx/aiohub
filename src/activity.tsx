import {useEffect, useState} from 'react';
import type {Hub, Play} from './data';
import {picture} from './live';
import type {Live} from './live';
import {Avatar, Posters, Segments, Sheet} from './ui';

/* What the hub noted as players reported it, put into the words the screen uses: one entry each time someone sat down to watch a
   title (a sitting, front.ts). Times are shown in this device's own time zone. */
interface Noted {art?: string; person: string; item: string; started: number; title: string; detail: string; position: number; duration: number; device: string; playing: number; paused?: number; since?: number; updated: number; place?: string | null; net?: string | null; parts?: string; pauses?: number; idle?: number; over?: number; reached?: number;
  /* A line of its own for a title marked unwatched after it was played here (worker/front.ts, unmarked): nothing was played in it. */
  undone?: number}
/* A title whose file runs longer than its listing (`over`: the furthest second any report of it reached; worker/util.ts): its
   listed length says nothing about how far in a sitting is. Its bar is drawn against the furthest point reached, where it is is
   said as a time, never a share, and it is finished only when an app ticked it as watched during the sitting, or the sitting got
   to within 5% of where earlier sittings of it had (`reached`). The first sitting to pass the listed length cannot know where the
   end is: it reads as stopped. Until someone plays past the listed end, nothing here knows: a stop between 90% and 100% of the
   listed length reads as finished. */
const NEAR_END = 0.95, ticked = (row: Noted) => !!row.parts?.split(' ').includes('marked');
const finishedLong = (row: Noted) => (ticked(row) && partsOf(row).length > 0) || (!!row.reached && row.position >= row.reached * NEAR_END);
/* A time of day, in this device's own zone. */
const hm = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
/* When a play ran, as a span from when it started to when its player was last heard: "3:12 PM to 3:50 PM"; "Since 3:12 PM"
   while it is on; "3:12 PM, last heard 3:50 PM" for one that went quiet today without saying it stopped; and, before yesterday,
   the weekday first. One time only (the end) for a moment: a tick in an app (nothing played), a start and end within the same
   minute, or a sitting that ran past midnight (its start was on another day, and no dates are said). */
function ran(row: Noted, days: number, heard: boolean, quiet: boolean) {
  const from = hm(row.started), to = hm(row.updated), at = new Date(row.updated * 1000);
  if (heard) return `Since ${from}`;
  const moment = !!row.undone || (ticked(row) && !partsOf(row).length) || new Date(row.started * 1000).toDateString() !== at.toDateString() || from === to;
  if (quiet && days === 0) return moment ? `Last heard ${to}` : `${from}, last heard ${to}`;
  return `${days > 1 ? `${at.toLocaleDateString(undefined, {weekday: 'long'})}, ` : ''}${moment ? to : `${from} to ${to}`}`;
}
function told(row: Noted, now: number, code: string): Play | null {
  const at = new Date(row.updated * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  if (days > 6) return null;
  // Marked unwatched in an app, after it was played here: said quietly, with the device and time, like a tick as watched.
  if (row.undone) return {art: row.art ? picture(code, row.art) : undefined, id: `${row.person}/${row.item}/${row.started}`, stamp: row.updated, personId: row.person, title: row.title, detail: `${row.detail} · marked unwatched`, on: row.device || 'A player app',
    when: ran(row, days, false, false), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
  // `updated` is when the player was last heard from: a player left open keeps reporting, paused or not. One that went quiet
  // without saying it stopped is shown with when it was last heard, and, if it sat paused, when that pause began. Where it was
  // paused is said only when there is no bar of parts played to show it (its mark, and the times on hover); since when, only
  // when that was a while before it was last heard (otherwise "last heard" says it).
  // A paused player is noted once in ten minutes (front.ts), so it counts as heard for fifteen.
  const heard = !!row.playing && now - row.updated < (row.paused ? 900 : 180), live = heard && !row.paused, whole = row.over || row.duration, share = whole ? Math.min(100, Math.round(row.position / whole * 100)) : 0;
  const quiet = !!row.playing && !heard;
  const end = live ? '' : row.paused && row.playing ? ` · paused${partsOf(row).length && !row.over ? '' : ` at ${clock(row.position)}`}${row.since ? heard ? ` for ${span(now - row.since)}` : row.updated - row.since < 300 ? '' : ` since ${hm(row.since)}` : ''}` : row.over ? (ticked(row) && !partsOf(row).length ? ' · marked as watched' : finishedLong(row) ? ' · finished' : row.position ? ` · stopped at ${clock(row.position)}` : '')
    : ticked(row) && Math.max(0, ...partsOf(row).map(([, b]) => b)) < row.duration * 0.9 ? ' · marked as watched' : share >= 90 ? ' · finished' : share ? ` · stopped at ${share}%` : '';
  const parts = joined(partsOf(row)), seen = whole && row.parts ? parts.map(([a, b]) => [a / whole * 100, (b - a) / whole * 100] as [number, number]) : undefined;
  return {art: row.art ? picture(code, row.art) : undefined, id: `${row.person}/${row.item}/${row.started}`, stamp: row.updated, personId: row.person, title: row.title, detail: row.detail + end, parts: seen, mark: whole ? Math.min(100, row.position / whole * 100) : undefined, ranges: parts.map(([a, b], n) => `${parts.length > 1 && row.started >= ORDERED ? `${nth(n + 1)} · ` : ''}${clock(a)}–${clock(b)}`), line: lineOf(row, parts), longer: row.over ? `Runs longer than listed (${minutes(row.duration)} min)` : undefined, clock: row.over ? clock(row.position) : undefined, progress: heard || (share && (row.over ? !finishedLong(row) : share < 90)) ? share : undefined, on: row.device || 'A player app', where: row.place ? [row.place, brief(row.net)].filter(Boolean).join(' · ') : undefined,
    live: heard, quiet: quiet && days === 0, when: ran(row, days, heard, quiet), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
}
/* A title's file fetched by an app with no play to go with it (api.ts): shown as its own entry, as a download. */
interface Fetched {person: string; item: string; at: number; title: string; detail: string; art?: string | null; device: string}
function downloaded(row: Fetched, now: number, code: string): Play | null {
  const at = new Date(row.at * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  if (days > 6) return null;
  return {art: row.art ? picture(code, row.art) : undefined, id: `down/${row.person}/${row.item}/${row.device}/${row.at}`, personId: row.person, title: row.title, detail: `${row.detail} · downloaded`, on: row.device || 'A player app', down: true, stamp: row.at,
    when: days > 1 ? at.toLocaleDateString(undefined, {weekday: 'long'}) : at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
}
/* Parts are kept in the order they were first played since this deploy (front.ts); earlier sittings kept them in the order they
   sit in the title, so they are not numbered. A part played on from later keeps its first number. */
const ORDERED = Date.UTC(2026, 10, 24, 16, 32) / 1000;
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/* The parts of a title that were played, as the hub noted them (front.ts): seconds, from and to. Rows from before it have none. */
const partsOf = (row: Noted) => (row.parts ?? '').split(' ').map(part => part.split('-').map(Number)).filter(([a, b]) => b > a) as [number, number][];
/* Parts less than half a minute apart along the title are shown as one: a skip-ahead tap, or a nudge while paused, says nothing
   about what was watched. In watch order, the joined part keeps the earlier one's place. */
const NEAR = 30;
function joined(parts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of parts) {
    const at = out.findIndex(([x, y]) => a <= y + NEAR && x <= b + NEAR);
    if (at < 0) out.push([a, b]); else out[at] = [Math.min(out[at][0], a), Math.max(out[at][1], b)];
  }
  // A part that grew can now reach another kept before it.
  return out.length < parts.length ? joined(out) : out;
}
const played = (parts: [number, number][]) => parts.reduce((sum, [a, b]) => sum + b - a, 0);
const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
/* One line, only when something was skipped (the gaps between the parts played, not before the first, and only those behind
   where it is now: after a jump back, what lies ahead was not skipped yet). How often or how long it was paused is not said:
   only whether it is paused now (above). */
function lineOf(row: Noted, parts: [number, number][]) {
  const along = [...parts].sort((x, y) => x[0] - y[0]), skipped = along.slice(1).reduce((sum, [a], i) => sum + (a <= row.position ? Math.max(0, a - along[i][1]) : 0), 0);
  if (skipped < 60) return undefined;
  // (Out of how long is left unsaid for a title that runs longer than listed: the listed length is not it.)
  return `Watched ${minutes(played(parts))}${row.duration && !row.over ? ` of ${minutes(row.duration)}` : ''} min · skipped ${minutes(skipped)} min`;
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
/* A week per person, from the same notes: how many titles, roughly how long (the parts played in each sitting, or, for one noted
   before parts were kept, up to where it was last left), how many were finished, how many times they sat down to watch, and the
   device used most. Rough on purpose; it is for spotting who watches what, not for billing. */
interface Week {person: string; titles: number; seconds: number; finished: number; devices: number; mostly: string; last: number; plays: number; when: string; streak: string}
/* The part of the day most sittings started in, in this device's time zone; said only once there are a few to go on. */
const PARTS: [number, string][] = [[5, 'late at night'], [12, 'in the mornings'], [17, 'in the afternoons'], [22, 'in the evenings'], [24, 'late at night']];
function partOf(starts: number[]) {
  if (starts.length < 3) return '';
  const count = new Map<string, number>(); for (const at of starts) {const hour = new Date(at * 1000).getHours(), part = PARTS.find(([end]) => hour < end)![1]; count.set(part, (count.get(part) ?? 0) + 1);}
  return [...count].sort((a, b) => b[1] - a[1])[0][0];
}
/* The most episodes of one show someone watched one after another (each started within half an hour of the one before last
   being heard), said when it is three or more: "4 episodes in a row on Sunday". The same episode again does not add one. */
function inARow(mine: Noted[], now: number) {
  let best = {count: 0, at: 0}, run = {count: 0, at: 0}, prev: Noted | undefined;
  for (const row of [...mine].sort((a, b) => a.started - b.started)) {
    if (row.detail === 'Movie') {prev = undefined; continue;}
    const follows = !!prev && prev.title === row.title && row.started - prev.updated <= 1800;
    if (follows && prev!.item === row.item) {prev = row; continue;}
    run = follows ? {count: run.count + 1, at: run.at} : {count: 1, at: row.started};
    if (run.count > best.count) best = run;
    prev = row;
  }
  if (best.count < 3) return '';
  const at = new Date(best.at * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  return `${best.count} episodes in a row ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `on ${at.toLocaleDateString(undefined, {weekday: 'long'})}`}`;
}
function weeks(rows: Noted[], now: number): Week[] {
  const by = new Map<string, Noted[]>();
  for (const row of rows) if (!row.undone && now - row.updated < 7 * 86400) by.set(row.person, [...(by.get(row.person) ?? []), row]);
  return [...by].map(([person, list]) => {
    const count = new Map<string, number>(); for (const row of list) count.set(row.device || 'A player app', (count.get(row.device || 'A player app') ?? 0) + 1);
    const done = (row: Noted) => row.over ? finishedLong(row) : row.duration > 0 && row.position / row.duration >= 0.9;
    return {person, plays: list.length, when: partOf(list.map(row => row.started)), streak: inARow(list, now), titles: new Set(list.map(row => row.item)).size, finished: new Set(list.filter(done).map(row => row.item)).size, devices: count.size, mostly: [...count].sort((a, b) => b[1] - a[1])[0][0], last: Math.max(...list.map(row => row.updated)),
      seconds: list.reduce((sum, row) => sum + (row.parts ? played(partsOf(row)) : done(row) ? row.over || row.duration : row.duration && !row.over ? Math.min(row.position, row.duration) : row.position), 0)};
  }).sort((a, b) => b.seconds - a.seconds);
}
const hours = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `about ${Math.round(seconds / 3600)} h`;
/* How far in, or, once parts are kept, only the parts played, with a mark where it was left. Shown for past plays too. */
function Bar({play}: {play: Play}) {
  // Each part played names its times in a small tooltip, when pointed at or tapped (a tap focuses it on a phone).
  return <span className="bar" role="progressbar" aria-valuenow={play.progress} aria-valuemin={0} aria-valuemax={100} aria-label={play.clock ? `Now at ${play.clock}` : play.parts ? `${Math.round(play.parts.reduce((sum, [, width]) => sum + width, 0))}% watched, now at ${play.progress}%` : `${play.progress}% watched`}>
    {play.parts ? <>{play.parts.map(([left, width], index) => <i key={left} className="part" tabIndex={play.ranges?.[index] ? 0 : undefined} data-time={play.ranges?.[index]} style={{left: `${left}%`, width: `${width}%`}}/>)}{play.mark !== undefined && <b style={{left: `${play.mark}%`}}/>}</> : <i style={{width: `${play.progress}%`}}/>}</span>;
}
/* The title's own picture, as the player apps show it. */
const Picture = ({url}: {url: string}) => <div className="posters" aria-hidden="true"><span style={{backgroundImage: `url(${JSON.stringify(url)})`}}/></div>;
export function Activity({hub, personId, groupId, pick, toast, live}: {hub: Hub; personId?: string; groupId?: string; pick?: boolean; toast: (text: string) => void; live: Live}) {
  const [filter, setFilter] = useState('all'), [title, setTitle] = useState<string | null>(null), [real, setReal] = useState<Play[]>([]), [turn, setTurn] = useState(0), [noted, setNoted] = useState<{now: number; sittings: Noted[]}>({now: 0, sittings: []});
  useEffect(() => {
    let on = true;
    void live.call<{now: number; sittings: Noted[]; downloads?: Fetched[]}>('GET', '/api/activity').then(found => {if (on) {setNoted(found); setReal([...found.sittings.map(row => told(row, found.now, hub.code)), ...(found.downloads ?? []).map(row => downloaded(row, found.now, hub.code))].filter((play): play is Play => !!play).sort((a, b) => (b.stamp ?? 0) - (a.stamp ?? 0))); if (turn) toast('Up to date');}}, (error: Error) => toast(error.message));
    return () => {on = false;};
  }, [live, turn]);
  const scope = groupId ?? (filter === 'all' ? undefined : filter);
  const person = (id: string) => hub.people.find(item => item.id === id);
  const all = real.filter(play => person(play.personId));
  const plays = all.filter(play => (!personId || play.personId === personId) && (!scope || person(play.personId)!.groupId === scope));
  const name = (id: string) => person(id)?.name ?? '';
  const now = plays.filter(play => play.live), days = ['Today', 'Yesterday', 'Earlier this week'] as const;
  // How many devices one profile is playing on right now. Shown plainly; the manager decides what it means.
  const atOnce = (id: string) => new Set(now.filter(play => play.personId === id).map(play => play.on)).size;
  const text = (play: typeof plays[number]) => personId ? play.detail : `${name(play.personId)} · ${play.detail}`;
  const head = <div className="activity-bar">
    {pick && hub.groups.length > 1 ? <Segments label="Show" value={filter} onChange={setFilter} options={[{value: 'all', label: 'Everyone'}, ...hub.groups.map(group => ({value: group.id, label: group.name}))]}/> : <span/>}
    <button type="button" className="ghost small" onClick={() => setTurn(turn + 1)}>Refresh</button>
  </div>;
  if (!plays.length) return <section>{head}<p className="empty">Nothing watched yet. It shows up here once someone presses play.</p></section>;
  return <section>
    {head}
    {!personId && (() => {
      const shown = weeks(noted.sittings, noted.now).filter(week => person(week.person) && (!scope || person(week.person)!.groupId === scope));
      return shown.length > 0 && <><h2 className="sub first">This week</h2><ul className="feed">{shown.map(week => <li key={week.person}><Avatar name={name(week.person)} size={36}/>
        <div><strong>{name(week.person)}</strong><small>{week.titles} {week.titles === 1 ? 'title' : 'titles'} · {hours(week.seconds)}{week.finished ? ` · ${week.finished} finished` : ''}{week.plays > 1 ? ` · pressed play ${week.plays} times` : ''}{week.when ? `, mostly ${week.when}` : ''}</small>{week.streak && <small>{week.streak}</small>}<small className="on-device">Mostly on {week.mostly}{week.devices > 1 ? ` · ${week.devices} devices` : ''}</small></div></li>)}</ul></>;
    })()}
    {!!now.length && <><h2 className="sub">Watching now</h2><ul className="now">{now.map(play => <li key={play.id}>{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}<div className="now-text">
      <button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small>{play.line && <small>{play.line}</small>}{play.longer && <small>{play.longer}</small>}<small className="on-device">{play.on}<Where where={play.where}/>{atOnce(play.personId) > 1 ? ` · watching on ${atOnce(play.personId)} devices` : ''}</small><time>{play.when}</time>
      <Bar play={play}/></div></li>)}</ul></>}
    {days.map(day => {
      const items = plays.filter(play => play.day === day && !play.live);
      return items.length ? <div key={day}><h2 className="sub">{day}</h2><ul className="feed plays">{items.map(play => <li key={play.id}>
        {/* The title's picture everywhere; whose it is is in the line (text, above). */}<span className="thumb">{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}</span>
        <div><button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small>{play.line && <small>{play.line}</small>}{play.longer && <small>{play.longer}</small>}<small className="on-device">{play.on}<Where where={play.where}/></small></div><time>{play.when}</time>{play.parts && <Bar play={play}/>}</li>)}</ul></div> : null;
    })}
    <p className="muted small foot">Each time a title is watched, it gets its own entry, with the parts played. Carrying on after half an hour away counts as another time.{plays.some(play => play.down) ? ' A title saved to a device to watch later shows as downloaded.' : ''}</p>
    {title && <Sheet title={title} onClose={() => setTitle(null)}>
      <p className="muted sheet-lead">Who watched it</p>
      <ul className="feed who">{all.filter(play => play.title === title).map(play => <li key={play.id}><Avatar name={name(play.personId)} size={36}/><div><strong>{name(play.personId)}</strong><small>{play.live ? `${play.detail} · watching now, ${play.clock ? `at ${play.clock}` : `${play.progress}% in`}` : play.detail}</small><small className="on-device">{play.on}</small></div><time>{play.live || play.quiet || play.day === 'Earlier this week' ? play.when : `${play.day}, ${play.when}`}</time></li>)}</ul>
    </Sheet>}
  </section>;
}
