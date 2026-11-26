/* "Show my Trakt watchlist as Favorites in the apps": a person's own choice, off until they turn it on from their own page (api.ts,
   'favorites'; never anyone else's: it writes to their Trakt). Only for someone whose Trakt is connected to the hub, who has a
   setup of their own, and whose hearts stay on that server: no MDBList key of theirs is kept (with one, their app Favorites are
   their MDBList watchlist already, native.ts). `favs` holds the switch, `hearts` the ledger (migration 0029), both by hub and person.
   - Trakt to the apps, here: a cron step, one person a run, each about every twenty minutes. The titles on their Trakt watchlist
     (the list the Watchlist row keeps, rows.ts) are hearted on their own server, newest first, a few a run; the next run takes
     the rest. Each heart the hub made is in the ledger with Trakt's listed_at. A title is hearted again only when Trakt lists it
     later than the ledger says, so a heart they took away, or their server did (it may, once the title is watched), is not
     put back over and over. A title already hearted when the hub came to it is theirs ('own'): noted, never written.
     A title that left the watchlist loses its heart only when the ledger says the hub made it, and only when the whole list
     is known (every page of it, not empty): a list Trakt did not give is never read as everything having left.
     Every write goes straight to their own server, signed in as them (here.ts), so the hook below never sees it.
   - The apps to Trakt: front.ts (hearted), as an app's own heart passes through. That is the one place a title is ever taken off
     someone's Trakt watchlist: in answer to their app taking a heart away, while the switch is on. Nothing in this file writes to
     Trakt at all: it has no way to (it imports no send).
   Turning the switch off, or disconnecting Trakt, only stops this: hearts stay where they are, and nothing leaves Trakt. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK} from './trakt';
import {packed, server} from './here';
import type {Ids, Via} from './here';
import {traktWatchlist} from './rows';
import {setupOf} from './places';

// EVERY: how often each person is looked at at most. HEARTS: the hearts made or taken away in a run (each is a write and a read
// back). LOOK: the titles a run asks their server about (one read). CHEAP: a look that read no more of Trakt than this and did not
// need their server is not busy, so the steps after it still run.
const EVERY = 20 * 60, HEARTS = 4, LOOK = 12, CHEAP = 1;
type State = 'hub' | 'own' | 'gone' | 'left' | 'miss';
interface Heart {key: string; item: string; state: State; listed: number}

/* Whether someone may have this at all, as SQL over a hub and a person: Trakt connected to the hub, a setup of their own, and no
   MDBList key of theirs kept. */
const MAY = (hub: string, person: string) => `EXISTS (SELECT 1 FROM secrets s WHERE s.hub = ${hub} AND s.owner = ${person} AND s.kind = '${LINK}') AND EXISTS (SELECT 1 FROM secrets s WHERE s.hub = ${hub} AND s.owner = ${person} AND s.kind = 'upstream-aiom')
  AND NOT EXISTS (SELECT 1 FROM secrets s WHERE s.hub = ${hub} AND s.owner = ${person} AND s.kind = 'mdblist')`;
export const mayHeart = async (env: Env, hub: string, person: string) => !!env.TRAKT_CLIENT_ID && !!await env.DB.prepare(`SELECT 1 AS yes WHERE ${MAY('?1', '?2')}`).bind(hub, person).first();
/* Whether the switch is on for them and still may be, asked of the database each time (never remembered): the hook's gate. */
export const heartsOn = async (env: Env, hub: string, person: string) => !!env.TRAKT_CLIENT_ID && !!await env.DB.prepare(`SELECT 1 AS yes FROM favs f WHERE f.hub = ?1 AND f.person = ?2 AND ${MAY('f.hub', 'f.person')}`).bind(hub, person).first();
export const turnHearts = (env: Env, hub: string, person: string, on: boolean) => on ? env.DB.prepare('INSERT INTO favs (hub, person) VALUES (?, ?) ON CONFLICT (hub, person) DO NOTHING').bind(hub, person)
  : env.DB.prepare('DELETE FROM favs WHERE hub = ? AND person = ?').bind(hub, person);
/* The switch off and the ledger gone (a new Trakt connection, or an MDBList key of their own saved). Rows here only. */
export const forgetHearts = (env: Env, hub: string, person: string) => ['favs', 'hearts'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ? AND person = ?`).bind(hub, person));

/* What a title goes by in the ledger: movie or series, then its IMDb id, else tmdb:<id>. '' with neither. */
export const heartKey = (type: 'movie' | 'series', ids: Ids) => /^tt\d+$/.test(ids.imdb ?? '') ? `${type}:${ids.imdb}` : Number(ids.tmdb) > 0 ? `${type}:tmdb:${ids.tmdb}` : '';
export const noteHeart = (env: Env, hub: string, person: string, key: string, item: string, state: State, listed: number) =>
  env.DB.prepare('INSERT INTO hearts (hub, person, key, item, state, listed, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person, key) DO UPDATE SET item = excluded.item, state = excluded.state, listed = excluded.listed, at = excluded.at')
    .bind(hub, person, key, item, state, listed, now());

/* One step of the cron (index.ts): one person a run, across every hub. True when it did more than look (see CHEAP). */
export async function hearts(env: Env): Promise<boolean> {
  if (!env.TRAKT_CLIENT_ID) return false;
  // Not someone with a call still waiting for Trakt (an add or remove of theirs not there yet): the list would be behind.
  const who = await env.DB.prepare(`SELECT f.hub, f.person FROM favs f WHERE f.checked <= ?1 AND ${MAY('f.hub', 'f.person')}
    AND NOT EXISTS (SELECT 1 FROM trakt_outbox o WHERE o.hub = f.hub AND o.person = f.person) ORDER BY f.checked LIMIT 1`).bind(now() - EVERY).first<{hub: string; person: string}>();
  if (!who) return false;
  const {hub, person} = who, at = now();
  // `again`: due on the next run (more than a run holds). `well`: the look went through.
  const looked = (again: boolean, well: boolean) => env.DB.prepare(`UPDATE favs SET checked = ?${well ? ', good = ?' : ''} WHERE hub = ? AND person = ?`).bind(...(well ? [again ? at - EVERY : at, at] : [again ? at - EVERY : at]), hub, person);
  const list = await traktWatchlist(env, hub, person);
  // A long list read again page by page: that was this run's work. The next one carries on with it kept.
  if (list.reads > CHEAP) {await looked(true, false).run(); return true;}
  const rows = (await env.DB.prepare('SELECT key, item, state, listed FROM hearts WHERE hub = ? AND person = ?').bind(hub, person).all<Heart>()).results, ledger = new Map(rows.map(row => [row.key, row]));
  // Trakt names a title by its IMDb id where it has one, and their server sometimes only by TMDB's: both count as the same title.
  const keysOf = (item: {id: string; type: 'movie' | 'series'; tmdb?: number}) => [`${item.type}:${item.id}`, ...(item.tmdb ? [`${item.type}:tmdb:${item.tmdb}`] : [])];
  const listed = new Set(list.items.flatMap(keysOf));
  // Left the watchlist: only hearts the hub made, and only when the whole list is known.
  const leave = list.whole ? rows.filter(row => row.state === 'hub' && !listed.has(row.key)) : [];
  // To heart, newest first as Trakt gave them: a title the ledger lacks, or one Trakt lists later than the ledger has it.
  const add = list.items.flatMap(item => {
    const known = keysOf(item).flatMap(key => ledger.get(key) ?? []).sort((a, b) => b.listed - a.listed)[0];
    return !known || (item.at ?? 0) > known.listed ? [{item, known}] : [];
  });
  if (!leave.length && !add.length) {await looked(false, list.items.length > 0).run(); return false;}
  const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
  // Their setup as it is right now must keep hearts on the server: one that passes them on (an MDBList key still in it, until the
  // next save of their setup) would turn a heart of the hub's into a change to an account.
  const setup = via ? await setupOf(env, hub, person) : null, services = setup?.jellyfinWatchlistServices;
  if (!via || !Array.isArray(services) || services.length !== 1 || services[0] !== 'server') {await looked(false, false).run(); return true;}
  const own = await server(via);
  if (!own) {await looked(false, false).run(); return true;}
  const notes: D1PreparedStatement[] = [];
  let left = HEARTS, more = add.length > LOOK, down = false;
  try {
    for (const row of leave) {
      if (!left) {more = true; break;}
      left--;
      // Taken away, refused, or not there to take: done with either way, until Trakt lists it again.
      if (await own.heart(row.item, false) === 'down') {down = true; break;}
      notes.push(noteHeart(env, hub, person, row.key, row.item, 'left', row.listed));
    }
    const turn = down ? [] : add.slice(0, LOOK).map(entry => {
      const imdb = /^tt\d+$/.test(entry.item.id) ? entry.item.id : undefined, tmdb = entry.item.tmdb ?? (Number(/^tmdb:(\d+)$/.exec(entry.item.id)?.[1]) || undefined);
      return {...entry, id: packed(entry.item.type, {imdb, tmdb}) ?? '', key: entry.known?.key ?? `${entry.item.type}:${entry.item.id}`, at: entry.item.at ?? 0};
    });
    const found = turn.some(entry => entry.id) ? await own.items(turn.flatMap(entry => entry.id || [])) : [], bare = (id: string) => id.toLowerCase().replace(/-/g, '');
    for (const entry of turn) {
      const held = entry.id ? found.find(item => bare(item.Id) === bare(entry.id)) : undefined;
      // Their server does not have it: not asked about again until Trakt lists it anew.
      if (!held) {notes.push(noteHeart(env, hub, person, entry.key, entry.id, 'miss', entry.at)); continue;}
      // Hearted already: theirs (one they made themselves), unless the ledger says the hub made it. Nothing is written.
      if (held.UserData?.IsFavorite) {notes.push(noteHeart(env, hub, person, entry.key, entry.id, entry.known?.state === 'hub' ? 'hub' : 'own', entry.at)); continue;}
      if (!left) {more = true; break;}
      left--;
      const got = await own.heart(entry.id, true);
      if (got === 'down') {down = true; break;}
      notes.push(noteHeart(env, hub, person, entry.key, entry.id, got === 'done' ? 'hub' : 'miss', entry.at));
    }
  } catch {down = true;}
  finally {await own.done();}
  // Their server stopped answering: what was done is kept, the rest waits for their next turn.
  await env.DB.batch([...notes, looked(more && !down, !down)]);
  return true;
}
