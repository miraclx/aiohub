import {useEffect, useState} from 'react';
import {SAMPLE, samplePlays} from './data';
import type {Hub, Play} from './data';
import type {Live} from './live';
import {Avatar, Posters, Segments, Sheet} from './ui';

/* What the hub noted as players reported it, put into the words the screen uses: one entry each time someone sat down to watch a
   title (a sitting, front.ts). Times are shown in this device's own time zone. */
interface Noted {art?: string; person: string; item: string; started: number; title: string; detail: string; position: number; duration: number; device: string; playing: number; paused?: number; since?: number; updated: number; place?: string | null; net?: string | null; parts?: string; pauses?: number; idle?: number}
function told(row: Noted, now: number, code: string): Play | null {
  const at = new Date(row.updated * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  if (days > 6) return null;
  // `updated` is when the player was last heard from: a player left open keeps reporting, paused or not. One that went quiet
  // without saying it stopped is shown with when it was last heard, and, if it sat paused, when that pause began.
  // A paused player is noted once in ten minutes (front.ts), so it counts as heard for fifteen.
  const heard = !!row.playing && now - row.updated < (row.paused ? 900 : 180), live = heard && !row.paused, share = row.duration ? Math.min(100, Math.round(row.position / row.duration * 100)) : 0;
  const quiet = !!row.playing && !heard, last = new Date(row.updated * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  const end = live ? '' : row.paused && row.playing ? ` · paused at ${clock(row.position)}${row.since ? heard ? ` for ${span(now - row.since)}` : ` since ${new Date(row.since * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}` : ''}` : row.parts === 'marked' ? ' · marked as watched' : share >= 90 ? ' · finished' : share ? ` · stopped at ${share}%` : '';
  const parts = partsOf(row), seen = row.duration && row.parts ? parts.map(([a, b]) => [a / row.duration * 100, (b - a) / row.duration * 100] as [number, number]) : undefined;
  return {art: row.art ? `/h/${code}/Items/${row.art}/Images/Primary?maxHeight=300` : undefined, id: `${row.person}/${row.item}/${row.started}`, personId: row.person, title: row.title, detail: row.detail + end, parts: seen, mark: row.duration ? Math.min(100, row.position / row.duration * 100) : undefined, ranges: parts.map(([a, b]) => `${clock(a)}–${clock(b)}`), line: lineOf(row, parts), progress: heard || (share && share < 90) ? share : undefined, on: row.device || 'A player app', where: row.place ? [row.place, brief(row.net)].filter(Boolean).join(' · ') : undefined,
    when: heard ? 'Now' : quiet && days === 0 ? `Last heard ${last}` : days > 1 ? at.toLocaleDateString(undefined, {weekday: 'long'}) : at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
}
/* The parts of a title that were played, as the hub noted them (front.ts): seconds, from and to. Rows from before it have none. */
const partsOf = (row: Noted) => (row.parts ?? '').split(' ').map(part => part.split('-').map(Number)).filter(([a, b]) => b > a) as [number, number][];
const played = (parts: [number, number][]) => parts.reduce((sum, [a, b]) => sum + b - a, 0);
const TIMES = ['', 'once', 'twice'], minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
/* One line when there is something to say: a skip (the gaps between the parts played, not before the first, and only those
   behind where it is now: after a jump back, what lies ahead was not skipped yet) or a pause. */
function lineOf(row: Noted, parts: [number, number][]) {
  const skipped = parts.slice(1).reduce((sum, [a], i) => sum + (a <= row.position ? a - parts[i][1] : 0), 0), pauses = row.pauses ?? 0, idle = row.idle ?? 0;
  if (skipped < 60 && !pauses) return undefined;
  const watched = parts.length ? `Watched ${minutes(played(parts))}${row.duration ? ` of ${minutes(row.duration)}` : ''} min` : '';
  const paused = pauses ? `paused ${TIMES[pauses] ?? `${pauses} times`}${idle >= 60 ? pauses === 1 ? ` for ${span(idle)}` : `, ${span(idle)} in all` : ''}` : '';
  const line = [watched, skipped >= 60 ? `skipped ${minutes(skipped)} min` : '', paused].filter(Boolean).join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
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
  for (const row of rows) if (now - row.updated < 7 * 86400) by.set(row.person, [...(by.get(row.person) ?? []), row]);
  return [...by].map(([person, list]) => {
    const count = new Map<string, number>(); for (const row of list) count.set(row.device || 'A player app', (count.get(row.device || 'A player app') ?? 0) + 1);
    const done = (row: Noted) => row.duration > 0 && row.position / row.duration >= 0.9;
    return {person, plays: list.length, when: partOf(list.map(row => row.started)), streak: inARow(list, now), titles: new Set(list.map(row => row.item)).size, finished: new Set(list.filter(done).map(row => row.item)).size, devices: count.size, mostly: [...count].sort((a, b) => b[1] - a[1])[0][0], last: Math.max(...list.map(row => row.updated)),
      seconds: list.reduce((sum, row) => sum + (row.parts ? played(partsOf(row)) : done(row) ? row.duration : row.duration ? Math.min(row.position, row.duration) : row.position), 0)};
  }).sort((a, b) => b.seconds - a.seconds);
}
const hours = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.round(seconds / 60))} min` : `about ${Math.round(seconds / 3600)} h`;
/* How far in, or, once parts are kept, only the parts played, with a mark where it was left. Shown for past plays too. */
function Bar({play}: {play: Play}) {
  // The times of each part played: under the bar while the row is pointed at, or after a tap on the bar (phones can't hover).
  const [open, setOpen] = useState(false), ranges = play.ranges?.length ? `Played ${play.ranges.join(' · ')}` : '';
  return <><span className={`bar${ranges ? ' timed' : ''}`} onClick={ranges ? () => setOpen(!open) : undefined} role="progressbar" aria-valuenow={play.progress} aria-valuemin={0} aria-valuemax={100} aria-label={play.parts ? `${Math.round(play.parts.reduce((sum, [, width]) => sum + width, 0))}% watched, now at ${play.progress}%` : `${play.progress}% watched`}>
        {play.parts ? <>{play.parts.map(([left, width]) => <i key={left} className="part" style={{left: `${left}%`, width: `${width}%`}}/>)}{play.mark !== undefined && <b style={{left: `${play.mark}%`}}/>}</> : <i style={{width: `${play.progress}%`}}/>}</span>{ranges && <small className={`ranges${open ? ' open' : ''}`}>{ranges}</small>}</>;
}
/* The title's own picture, as the player apps show it. */
const Picture = ({url}: {url: string}) => <div className="posters" aria-hidden="true"><span style={{backgroundImage: `url(${JSON.stringify(url)})`}}/></div>;
export function Activity({hub, personId, groupId, pick, toast, live}: {hub: Hub; personId?: string; groupId?: string; pick?: boolean; toast: (text: string) => void; live?: Live}) {
  const [filter, setFilter] = useState('all'), [title, setTitle] = useState<string | null>(null), [real, setReal] = useState<Play[]>([]), [turn, setTurn] = useState(0), [noted, setNoted] = useState<{now: number; sittings: Noted[]}>({now: 0, sittings: []});
  useEffect(() => {
    if (!live) return; let on = true;
    void live.call<{now: number; sittings: Noted[]}>('GET', '/api/activity').then(found => {if (on) {setNoted(found); setReal(found.sittings.map(row => told(row, found.now, hub.code)).filter((play): play is Play => !!play)); if (turn) toast('Up to date');}}, (error: Error) => toast(error.message));
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
      const shown = weeks(noted.sittings, noted.now).filter(week => person(week.person) && (!scope || person(week.person)!.groupId === scope));
      return shown.length > 0 && <><h2 className="sub first">This week</h2><ul className="feed">{shown.map(week => <li key={week.person}><Avatar name={name(week.person)} size={36}/>
        <div><strong>{name(week.person)}</strong><small>{week.titles} {week.titles === 1 ? 'title' : 'titles'} · {hours(week.seconds)}{week.finished ? ` · ${week.finished} finished` : ''}{week.plays > 1 ? ` · pressed play ${week.plays} times` : ''}{week.when ? `, mostly ${week.when}` : ''}</small>{week.streak && <small>{week.streak}</small>}<small className="on-device">Mostly on {week.mostly}{week.devices > 1 ? ` · ${week.devices} devices` : ''}</small></div></li>)}</ul></>;
    })()}
    {!!now.length && <><h2 className="sub">Watching now</h2><ul className="now">{now.map(play => <li key={play.id}>{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}<div className="now-text">
      <button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small>{play.line && <small>{play.line}</small>}<small className="on-device">{play.on}<Where where={play.where}/>{atOnce(play.personId) > 1 ? ` · watching on ${atOnce(play.personId)} devices` : ''}</small>
      <Bar play={play}/></div></li>)}</ul></>}
    {days.map(day => {
      const items = plays.filter(play => play.day === day && play.when !== 'Now');
      return items.length ? <div key={day}><h2 className="sub">{day}</h2><ul className="feed">{items.map(play => <li key={play.id}>
        {personId ? <span className="thumb">{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}</span> : <Avatar name={name(play.personId)} size={36}/>}
        <div><button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small>{play.line && <small>{play.line}</small>}<small className="on-device">{play.on}<Where where={play.where}/></small>{play.parts && <Bar play={play}/>}</div><time>{play.when}</time></li>)}</ul></div> : null;
    })}
    <p className="muted small foot">Each time a title is watched, it gets its own entry, with the parts played. Carrying on after half an hour away counts as another time.</p>
    {title && <Sheet title={title} onClose={() => setTitle(null)}>
      <p className="muted sheet-lead">Who watched it</p>
      <ul className="feed">{all.filter(play => play.title === title).map(play => <li key={play.id}><Avatar name={name(play.personId)} size={36}/><div><strong>{name(play.personId)}</strong><small>{play.when === 'Now' ? `${play.detail} · watching now, ${play.progress}% in` : play.detail}</small><small className="on-device">{play.on}</small></div><time>{play.when === 'Now' ? 'Now' : `${play.day === 'Earlier this week' ? '' : play.day + ' '}${play.when}`}</time></li>)}</ul>
    </Sheet>}
  </section>;
}
