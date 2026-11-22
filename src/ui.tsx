import {SAMPLE} from './data';
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import type {Level, Row} from './data';

export function useRoute(): [string[], (to: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {setParts(read()); window.scrollTo(0, 0);};
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [parts, to => {location.hash = to;}];
}

export function hash(text: string) {let h = 7; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h;}
/* On the real hub a row shows what it really holds: the posters a player app would get. Until those are known it shows plain blanks,
   never the preview's sample art. */
const real = new Map<string, string[]>();
export const showReal = (rows: Record<string, string[]>) => {real.clear(); for (const [id, posters] of Object.entries(rows)) real.set(id, posters);};
/* One person's own rows, kept apart from the shared ones so a reload of either never wipes the other. They are shown only on that
   person's own Home: rows of the same name elsewhere (a hub or group Home) never get them. */
const own = new Map<string, string[]>();
let ownFor = '';
export const addReal = (rows: Record<string, string[]>, person: string) => {own.clear(); ownFor = person; for (const [id, posters] of Object.entries(rows)) own.set(id, posters);};
/* Both forgotten when someone else is signed in, in this tab. */
export const forgetReal = () => {real.clear(); own.clear(); ownFor = '';};
// `blank`: only blanks, for a row that holds nothing until someone connects an account.
export function Posters({seed, dim, person, blank}: {seed: string; dim?: boolean; person?: string; blank?: boolean}) {
  if (!SAMPLE) return <div className={`posters${dim ? ' dim' : ''}`} aria-hidden="true">{((blank ? null : (person && person === ownFor ? own.get(seed) : null) ?? real.get(seed)) ?? Array<string>(7).fill('')).map((poster, i) => <span key={i} className={poster ? '' : 'blank'} style={poster ? {backgroundImage: `url(${JSON.stringify(poster)})`} : undefined}/>)}</div>;
  return <div className={`posters${dim ? ' dim' : ''}`} aria-hidden="true">{Array.from({length: 7}, (_, i) => {
    const h = hash(`${i}:${seed}:${i * 7}`), a = (hash(seed) + i * 47 + h % 30) % 360, b = (a + 40 + (h >> 4) % 80) % 360;
    const poster = String((hash(seed) + i * 5) % 56).padStart(2, '0');
    return <span key={i} style={{backgroundImage: `url(/posters/${poster}.webp), linear-gradient(${150 + (h % 60)}deg, hsl(${a} 55% 42%), hsl(${b} 60% 20%))`}}/>;
  })}</div>;
}
export function Covers({items, dim, tall}: {items: {title: string; image: string}[]; dim?: boolean; tall?: boolean}) {
  return <div className={`covers${dim ? ' dim' : ''}${tall ? ' tall' : ''}`} aria-hidden="true">{items.slice(0, 9).map(item => <span key={item.image} style={{backgroundImage: `url(${item.image})`}}/>)}</div>;
}
export function Art({row, dim, person, blank}: {row: Row; dim?: boolean; person?: string; blank?: boolean}) {return row.covers?.length ? <Covers items={row.covers} dim={dim}/> : <Posters seed={row.id} dim={dim} person={person} blank={blank}/>;}
export function Avatar({name, size = 44}: {name: string; size?: number}) {
  const a = hash(name || 'manager') % 360;
  return <span className="avatar" style={{width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, hsl(${a} 60% 48%), hsl(${(a + 50) % 360} 60% 32%))`}} aria-hidden="true">{name ? name.slice(0, 1).toUpperCase() : <svg viewBox="0 0 24 24" width="58%" height="58%" fill="currentColor"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c0-4.2 3.6-6.5 8-6.5s8 2.300 8 6.500z"/></svg>}</span>;
}

export function Switch({checked, onChange, label, disabled}: {checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}><span/></button>;
}
export function Segments<T extends string>({value, options, onChange, label}: {value: T; options: {value: T; label: string}[]; onChange: (value: T) => void; label: string}) {
  return <div className="segments" role="radiogroup" aria-label={label}>{options.map(option =>
    <button key={option.value} type="button" role="radio" aria-checked={option.value === value} className={option.value === value ? 'on' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
export function Chips({all, value, onChange}: {all: string[]; value: string[]; onChange: (value: string[]) => void}) {
  return <div className="chips">{all.map(item => {
    const on = value.includes(item);
    return <button key={item} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => onChange(on ? value.filter(other => other !== item) : [...value, item])}>{item}</button>;
  })}</div>;
}
export function Sheet({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {ref.current?.showModal();}, []);
  return <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose} onClick={event => {if (event.target === ref.current) onClose();}}>
    <div className="sheet-body"><header><h2>{title}</h2><button type="button" className="ghost" onClick={onClose} aria-label="Close">✕</button></header>{children}</div>
  </dialog>;
}
export function Tabs({base, tabs, tab}: {base: string; tabs: readonly (readonly [string, string])[]; tab: string}) {
  return <nav className="tabs" aria-label="Sections">{tabs.map(([key, label]) => <a key={key} href={`#${base}/${key}`} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}>{label}</a>)}</nav>;
}

/* A setting line. Below the hub level it says quietly where the value comes from, and offers a way back. */
export interface Scope {level: Level; names: {hub: string; group: string}}
export function Setting({title, hint, column, from, scope, onReset, children}: {title: string; hint?: ReactNode; column?: boolean; from?: Level; scope?: Scope; onReset?: () => void; children: ReactNode}) {
  const parent = scope?.level === 'own' ? scope.names.group : scope?.names.hub;
  const pill = !scope || scope.level === 'hub' || !from ? null
    : from === scope.level ? <button type="button" className="from own" onClick={onReset} aria-label={`Reset ${title} to ${parent}`}>Changed · reset</button>
    : <span className="from">{from === 'group' ? scope.names.group : scope.names.hub}</span>;
  return <div className={`setting${column ? ' column' : ''}`}><div><h3>{title}{pill}</h3>{hint && <p>{hint}</p>}</div>{children}</div>;
}
export function Secret({value, label, onCopy}: {value: string; label: string; onCopy: () => void}) {
  const [shown, setShown] = useState(false);
  return <span className="secret"><code aria-label={label}>{shown ? value : '•'.repeat(Math.min(value.length, 10))}</code>
    <button type="button" className="ghost small" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>
    <button type="button" className="ghost small" onClick={() => {void navigator.clipboard?.writeText(value).catch(() => {}); onCopy();}}>Copy</button></span>;
}
/* A name that saves when you leave the field, not on every key. */
export function NameField({value, label, onSave}: {value: string; label: string; onSave: (value: string) => void}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {const next = text.trim(); if (next && next !== value) onSave(next); else setText(value);};
  return <input aria-label={label} value={text} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}} autoComplete="off"/>;
}
/* Asks before something that throws work away. */
export function Confirm({title, body, action, onYes, onClose, plain}: {title: string; body: string; action: string; onYes: () => void; onClose: () => void; plain?: boolean}) {
  return <Sheet title={title} onClose={onClose}><p className="muted sheet-lead">{body}</p><div className="split"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button type="button" className={plain ? 'primary' : 'primary danger-fill'} onClick={onYes}>{action}</button></div></Sheet>;
}
