import {useEffect, useState} from 'react';
import {SAMPLE, samplePlays} from './data';
import type {Hub, Play} from './data';
import type {Live} from './live';
import {Avatar, Posters, Segments, Sheet} from './ui';

/* What the hub noted as players reported it, put into the words the screen uses. Times are shown in this device's own time zone. */
interface Noted {art?: string; person: string; item: string; title: string; detail: string; position: number; duration: number; device: string; playing: number; updated: number}
function told(row: Noted, now: number, code: string): Play | null {
  const at = new Date(row.updated * 1000), today = new Date(now * 1000), days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000);
  if (days > 6) return null;
  const live = !!row.playing && now - row.updated < 180, share = row.duration ? Math.min(100, Math.round(row.position / row.duration * 100)) : 0;
  const end = live ? '' : share >= 90 ? ' · finished' : share ? ` · stopped at ${share}%` : '';
  return {art: row.art ? `/h/${code}/Items/${row.art}/Images/Primary?maxHeight=300` : undefined, id: `${row.person}/${row.item}`, personId: row.person, title: row.title, detail: row.detail + end, progress: live || (share && share < 90) ? share : undefined, on: row.device || 'A player app',
    when: live ? 'Now' : days > 1 ? at.toLocaleDateString(undefined, {weekday: 'long'}) : at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}), day: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier this week'};
}
/* The title's own picture, as the player apps show it. */
const Picture = ({url}: {url: string}) => <div className="posters" aria-hidden="true"><span style={{backgroundImage: `url(${JSON.stringify(url)})`}}/></div>;
export function Activity({hub, personId, groupId, pick, toast, live}: {hub: Hub; personId?: string; groupId?: string; pick?: boolean; toast: (text: string) => void; live?: Live}) {
  const [filter, setFilter] = useState('all'), [title, setTitle] = useState<string | null>(null), [real, setReal] = useState<Play[]>([]), [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!live) return; let on = true;
    void live.call<{now: number; plays: Noted[]}>('GET', '/api/activity').then(found => {if (on) {setReal(found.plays.map(row => told(row, found.now, hub.code)).filter((play): play is Play => !!play)); if (turn) toast('Up to date');}}, (error: Error) => toast(error.message));
    return () => {on = false;};
  }, [live, turn]);
  const scope = groupId ?? (filter === 'all' ? undefined : filter);
  const person = (id: string) => hub.people.find(item => item.id === id);
  const all = (SAMPLE ? samplePlays() : real).filter(play => person(play.personId));
  const plays = all.filter(play => (!personId || play.personId === personId) && (!scope || person(play.personId)!.groupId === scope));
  const name = (id: string) => person(id)?.name ?? '';
  const now = plays.filter(play => play.when === 'Now'), days = ['Today', 'Yesterday', 'Earlier this week'] as const;
  const text = (play: typeof plays[number]) => personId ? play.detail : `${name(play.personId)} · ${play.detail}`;
  const head = <div className="activity-bar">
    {pick && hub.groups.length > 1 ? <Segments label="Show" value={filter} onChange={setFilter} options={[{value: 'all', label: 'Everyone'}, ...hub.groups.map(group => ({value: group.id, label: group.name}))]}/> : <span/>}
    <button type="button" className="ghost small" onClick={() => live ? setTurn(turn + 1) : toast('Up to date')}>Refresh</button>
  </div>;
  if (!plays.length) return <section>{head}<p className="empty">Nothing watched yet. It shows up here once someone presses play.</p></section>;
  return <section>
    {head}
    {!!now.length && <><h2 className="sub first">Watching now</h2><ul className="now">{now.map(play => <li key={play.id}>{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}<div className="now-text">
      <button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small><small className="on-device">{play.on}</small>
      <span className="bar" role="progressbar" aria-valuenow={play.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${play.progress}% watched`}><i style={{width: `${play.progress}%`}}/></span></div></li>)}</ul></>}
    {days.map(day => {
      const items = plays.filter(play => play.day === day && play.when !== 'Now');
      return items.length ? <div key={day}><h2 className="sub">{day}</h2><ul className="feed">{items.map(play => <li key={play.id}>
        {personId ? <span className="thumb">{play.art ? <Picture url={play.art}/> : <Posters seed={play.title}/>}</span> : <Avatar name={name(play.personId)} size={36}/>}
        <div><button type="button" className="title" onClick={() => setTitle(play.title)}>{play.title}</button><small>{text(play)}</small><small className="on-device">{play.on}</small></div><time>{play.when}</time></li>)}</ul></div> : null;
    })}
    <p className="muted small foot">Shows what each player last reported. It is not a minute-by-minute history.</p>
    {title && <Sheet title={title} onClose={() => setTitle(null)}>
      <p className="muted sheet-lead">Who watched it</p>
      <ul className="feed">{all.filter(play => play.title === title).map(play => <li key={play.id}><Avatar name={name(play.personId)} size={36}/><div><strong>{name(play.personId)}</strong><small>{play.when === 'Now' ? `${play.detail} · watching now, ${play.progress}% in` : play.detail}</small><small className="on-device">{play.on}</small></div><time>{play.when === 'Now' ? 'Now' : `${play.day === 'Earlier this week' ? '' : play.day + ' '}${play.when}`}</time></li>)}</ul>
    </Sheet>}
  </section>;
}
