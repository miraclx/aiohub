/* The watchlist as Favorites: a person's own choice, off until they turn it on from their own page (api.ts, 'favorites'; never
   anyone else's: it writes to their Trakt). For anyone whose Trakt is connected to the hub and who has a setup of their own, with
   or without an MDBList key of theirs. `favs` holds the switch, `hearts` the ledger (migrations 0029 and 0030), both by hub and
   person. Trakt leads: its watchlist decides what is hearted.
   - Trakt to the apps, here: a cron step, one person a run, each about every twenty minutes. The titles on their Trakt watchlist
     (the list the Watchlist row keeps, rows.ts) are hearted on their own server, newest first, a few a run; the next run takes
     the rest. Each heart the hub made is in the ledger with Trakt's listed_at. A title is hearted again only when Trakt lists it
     later than the ledger says, so a heart they took away, or their server did (it may, once the title is watched), is not
     put back over and over. A title already hearted when the hub came to it is theirs ('own'): noted, never written.
   - In step: a title the hub itself saw on the watchlist (`seen`: it hearted it from there, or found it hearted while Trakt
     listed it, which is also how a heart an app made and the hook sent on is confirmed) loses its heart on their server when it
     leaves the watchlist. Only when the whole list is known (every page of it, not empty): a list Trakt did not give is never
     read as everything having left. A heart never seen on Trakt is never touched: one sent on by the hook counts only once the
     list really shows it, since Trakt may have refused the add.
   - MDBList follows, through their own server: with their own MDBList key and MDBList sync on, their setup passes every heart
     made or taken away on to their MDBList watchlist by itself (native.ts, jellyfinWatchlistServices ['mdblist'] with
     mdblistWatchTracking). The hub never calls MDBList for a heart. With MDBList sync off their setup keeps hearts on the server
     (['server']), and nothing reaches MDBList. A setup that says anything else right now is left alone until its next save.
   - Every write goes straight to their own server, signed in as them (here.ts), so the hook below never sees it.
   - The apps to Trakt: front.ts (hearted), as an app's own heart passes through. That is the one place a title is ever taken off
     someone's Trakt watchlist: in answer to their app taking a heart away, while the switch is on. Nothing in this file writes to
     Trakt at all: it has no way to (it imports no send).
   - Hearts they already had that Trakt lacks are only counted here, now and then (`found`), for their page to offer once: adding
     them is theirs to ask for (api.ts), never done by itself. One they said "Not now" to is kept as 'pass' and not offered again.
   Turning the switch off, or disconnecting Trakt, only stops this: hearts stay where they are, and nothing leaves Trakt. */
import type {Env} from './util';
import {getSecret, now} from './util';
import {LINK} from './trakt';
import {packed, server, unpacked} from './here';
import type {Ids, Via} from './here';
import {traktWatchlist} from './rows';
import {setupOf} from './places';

// EVERY: how often each person is looked at at most. HEARTS: the hearts made or taken away in a run (each is a write and a read
// back). LOOK: the titles a run asks their server about (one read). CHEAP: a look that read no more of Trakt than this and did not
// need their server is not busy, so the steps after it still run. COUNT_EVERY: how often their hearts are counted for the offer
// (one read of their server's favourites, the newest READ of them); OFFER: how many of those the offer holds at most.
const EVERY = 20 * 60, HEARTS = 4, LOOK = 12, CHEAP = 1, COUNT_EVERY = 6 * 3600, READ = 200;
export const OFFER = 50;
type State = 'hub' | 'own' | 'gone' | 'left' | 'miss' | 'pass';
interface Heart {key: string; item: string; state: State; listed: number; seen: number}
/* A heart on their server that Trakt lacks, as the offer keeps it: its ledger key, its id there, and what Trakt knows it by. */
export interface Spare {key: string; item: string; type: 'movie' | 'series'; ids: Ids}
export interface Found {list: Spare[]; more: boolean}
export const foundOf = (kept: string | null | undefined): Found | null => {try {const found = kept ? JSON.parse(kept) as Found : null; return found && Array.isArray(found.list) && found.list.length ? found : null;} catch {return null;}};

/* Whether someone may have this at all, as SQL over a hub and a person: Trakt connected to the hub and a setup of their own. */
const MAY = (hub: string, person: string) => `EXISTS (SELECT 1 FROM secrets s WHERE s.hub = ${hub} AND s.owner = ${person} AND s.kind = '${LINK}') AND EXISTS (SELECT 1 FROM secrets s WHERE s.hub = ${hub} AND s.owner = ${person} AND s.kind = 'upstream-aiom')`;
export const mayHeart = async (env: Env, hub: string, person: string) => !!env.TRAKT_CLIENT_ID && !!await env.DB.prepare(`SELECT 1 AS yes WHERE ${MAY('?1', '?2')}`).bind(hub, person).first();
/* Whether the switch is on for them and still may be, asked of the database each time (never remembered): the hook's gate. */
export const heartsOn = async (env: Env, hub: string, person: string) => !!env.TRAKT_CLIENT_ID && !!await env.DB.prepare(`SELECT 1 AS yes FROM favs f WHERE f.hub = ?1 AND f.person = ?2 AND ${MAY('f.hub', 'f.person')}`).bind(hub, person).first();
export const turnHearts = (env: Env, hub: string, person: string, on: boolean) => on ? env.DB.prepare('INSERT INTO favs (hub, person) VALUES (?, ?) ON CONFLICT (hub, person) DO NOTHING').bind(hub, person)
  : env.DB.prepare('DELETE FROM favs WHERE hub = ? AND person = ?').bind(hub, person);
/* The switch off and the ledger gone (a new Trakt connection, which may be another account). Rows here only. */
export const forgetHearts = (env: Env, hub: string, person: string) => ['favs', 'hearts'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE hub = ? AND person = ?`).bind(hub, person));

/* What a title goes by in the ledger: movie or series, then its IMDb id, else tmdb:<id>. '' with neither. */
export const heartKey = (type: 'movie' | 'series', ids: Ids) => /^tt\d+$/.test(ids.imdb ?? '') ? `${type}:${ids.imdb}` : Number(ids.tmdb) > 0 ? `${type}:tmdb:${ids.tmdb}` : '';
/* `seen`: the hub saw the title on their Trakt watchlist as it wrote this (see above). The hook never says so: what it sends may
   not be taken, and what it takes away is no longer there. */
export const noteHeart = (env: Env, hub: string, person: string, key: string, item: string, state: State, listed: number, seen = false) =>
  env.DB.prepare('INSERT INTO hearts (hub, person, key, item, state, listed, at, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hub, person, key) DO UPDATE SET item = excluded.item, state = excluded.state, listed = excluded.listed, at = excluded.at, seen = excluded.seen')
    .bind(hub, person, key, item, state, listed, now(), seen ? 1 : 0);
/* The offer answered (api.ts), in one write however many there are (a Worker on the Free plan may make only so many queries a
   run): each of these hearts noted as `state`, dated now and not seen on Trakt. Never over a title the ledger already has: one
   she took the heart off, or the hub dealt with, since the count is left exactly as it is. */
export const noteHearts = (env: Env, hub: string, person: string, hearts: Spare[], state: State) =>
  env.DB.prepare(`INSERT INTO hearts (hub, person, key, item, state, listed, at, seen) SELECT ?1, ?2, json_extract(e.value, '$.key'), json_extract(e.value, '$.item'), ?3, ?4, ?4, 0 FROM json_each(?5) e WHERE true ON CONFLICT (hub, person, key) DO NOTHING`)
    .bind(hub, person, state, now(), JSON.stringify(hearts.map(({key, item}) => ({key, item}))));
/* The offer answered (api.ts): what was counted goes, and is counted again in COUNT_EVERY. */
export const clearFound = (env: Env, hub: string, person: string) => env.DB.prepare('UPDATE favs SET found = NULL, found_at = ? WHERE hub = ? AND person = ?').bind(now(), hub, person);
/* Whether their setup, as it is right now, lets the hub heart on their server: hearts stay there (['server']), or it passes them
   on to their own MDBList with MDBList sync on (['mdblist'] and mdblistWatchTracking, which only a key of their own gets:
   native.ts). ['mdblist'] without that (a key of theirs kept while MDBList sync is off, until the setup's next save) would turn
   a heart of the hub's into a change to an account that is not synced: nothing is written then. */
export const heartsStay = (setup: Record<string, unknown> | null) => {
  const services = setup?.jellyfinWatchlistServices;
  return Array.isArray(services) && services.length === 1 && (services[0] === 'server' || (services[0] === 'mdblist' && setup?.mdblistWatchTracking === true));
};

/* One step of the cron (index.ts): one person a run, across every hub. True when it did more than look (see CHEAP). */
export async function hearts(env: Env): Promise<boolean> {
  if (!env.TRAKT_CLIENT_ID) return false;
  // Not someone with a call still waiting for Trakt (an add or remove of theirs not there yet): the list would be behind.
  const who = await env.DB.prepare(`SELECT f.hub, f.person, f.found_at FROM favs f WHERE f.checked <= ?1 AND ${MAY('f.hub', 'f.person')}
    AND NOT EXISTS (SELECT 1 FROM trakt_outbox o WHERE o.hub = f.hub AND o.person = f.person) ORDER BY f.checked LIMIT 1`).bind(now() - EVERY).first<{hub: string; person: string; found_at: number}>();
  if (!who) return false;
  const {hub, person} = who, at = now();
  // `again`: due on the next run (more than a run holds). `well`: the look went through.
  const looked = (again: boolean, well: boolean) => env.DB.prepare(`UPDATE favs SET checked = ?${well ? ', good = ?' : ''} WHERE hub = ? AND person = ?`).bind(...(well ? [again ? at - EVERY : at, at] : [again ? at - EVERY : at]), hub, person);
  const list = await traktWatchlist(env, hub, person);
  // A long list read again page by page: that was this run's work. The next one carries on with it kept.
  if (list.reads > CHEAP) {await looked(true, false).run(); return true;}
  const rows = (await env.DB.prepare('SELECT key, item, state, listed, seen FROM hearts WHERE hub = ? AND person = ?').bind(hub, person).all<Heart>()).results, ledger = new Map(rows.map(row => [row.key, row]));
  // Trakt names a title by its IMDb id where it has one, and their server sometimes only by TMDB's: both count as the same title.
  const keysOf = (item: {id: string; type: 'movie' | 'series'; tmdb?: number}) => [`${item.type}:${item.id}`, ...(item.tmdb ? [`${item.type}:tmdb:${item.tmdb}`] : [])];
  const listed = new Set(list.items.flatMap(keysOf));
  // A heart of theirs the list now shows (one an app made and the hook sent on, one they asked to add, or one they passed on
  // and added on Trakt themselves): seen there from now on, in one write.
  const sighted = rows.filter(row => !row.seen && (row.state === 'own' || row.state === 'pass') && listed.has(row.key)).map(row => row.key);
  const notes: D1PreparedStatement[] = sighted.length ? [env.DB.prepare("UPDATE hearts SET seen = 1, state = 'own' WHERE hub = ? AND person = ? AND key IN (SELECT value FROM json_each(?))").bind(hub, person, JSON.stringify(sighted))] : [];
  // Left the watchlist: only hearts the hub saw there, and only when the whole list is known.
  const leave = list.whole ? rows.filter(row => !!row.seen && (row.state === 'hub' || row.state === 'own') && !listed.has(row.key)) : [];
  // To heart, newest first as Trakt gave them: a title the ledger lacks, or one Trakt lists later than the ledger has it.
  const add = list.items.flatMap(item => {
    const known = keysOf(item).flatMap(key => ledger.get(key) ?? []).sort((a, b) => b.listed - a.listed)[0];
    return !known || (item.at ?? 0) > known.listed ? [{item, known}] : [];
  });
  // Their hearts counted for the offer: now and then, and only against a whole list (what is not on it is otherwise not known).
  const count = list.whole && at - who.found_at >= COUNT_EVERY;
  if (!leave.length && !add.length && !count) {await env.DB.batch([...notes, looked(false, list.items.length > 0)]); return false;}
  const via = await getSecret<Via>(env, hub, person, 'upstream-aiom');
  // Their setup as it is right now must keep the hub's hearts where they belong (heartsStay, above).
  if (!via || !heartsStay(await setupOf(env, hub, person))) {await env.DB.batch([...notes, looked(false, false)]); return true;}
  const own = await server(via);
  if (!own) {await env.DB.batch([...notes, looked(false, false)]); return true;}
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
      // Hearted already: theirs (one they made themselves), unless the ledger says the hub made it. Nothing is written; it is
      // on the watchlist right now, so it is seen there.
      if (held.UserData?.IsFavorite) {notes.push(noteHeart(env, hub, person, entry.key, entry.id, entry.known?.state === 'hub' ? 'hub' : 'own', entry.at, true)); continue;}
      if (!left) {more = true; break;}
      left--;
      const got = await own.heart(entry.id, true);
      if (got === 'down') {down = true; break;}
      notes.push(noteHeart(env, hub, person, entry.key, entry.id, got === 'done' ? 'hub' : 'miss', entry.at, got === 'done'));
    }
    // The offer: hearts on their server that the watchlist lacks and the ledger has never heard of (so never one the hub or
    // they took away, one waiting to leave, or one passed on before). Films and shows the server says are hearted, by the ids
    // Trakt could use. A server that did not answer leaves the last count as it was.
    const hearted = count && !down ? await own.favourites(READ) : null;
    if (hearted) {
      const spare: Spare[] = [];
      for (const item of hearted) {
        const type = item.Type === 'Movie' ? 'movie' as const : item.Type === 'Series' ? 'series' as const : null, known = unpacked(item.Id);
        if (!type || !item.UserData?.IsFavorite) continue;
        const imdb = /^tt\d+$/.test(item.ProviderIds?.Imdb ?? '') ? item.ProviderIds!.Imdb : known && /^tt\d+$/.test(known.id) ? known.id : undefined, tmdb = Number(item.ProviderIds?.Tmdb) || Number(/^tmdb:(\d+)$/.exec(known?.id ?? '')?.[1]) || undefined;
        const ids: Ids = {...(tmdb ? {tmdb} : {}), ...(imdb ? {imdb} : {})}, keys = [...(imdb ? [`${type}:${imdb}`] : []), ...(tmdb ? [`${type}:tmdb:${tmdb}`] : [])];
        if (keys.length && !keys.some(key => listed.has(key) || ledger.has(key)) && !spare.some(had => had.key === keys[0])) spare.push({key: keys[0], item: item.Id, type, ids});
      }
      const kept: Found = {list: spare.slice(0, OFFER), more: spare.length > OFFER || hearted.length >= READ};
      notes.push(env.DB.prepare('UPDATE favs SET found = ?, found_at = ? WHERE hub = ? AND person = ?').bind(spare.length ? JSON.stringify(kept) : null, at, hub, person));
    }
  } catch {down = true;}
  finally {await own.done();}
  // Their server stopped answering: what was done is kept, the rest waits for their next turn.
  await env.DB.batch([...notes, looked(more && !down, !down)]);
  return true;
}
