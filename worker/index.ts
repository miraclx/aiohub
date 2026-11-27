// AIOHub Worker: the site, its API, and the sign-in front that player apps talk to.
import {api} from './api';
import {front} from './front';
import {drift} from './drift';
import {leftovers, match} from './sync';
import {hearts} from './hearts';
import {forYou, resend} from './foryou';
import {due} from './notice';
import {nightly} from './ahead';
import {sweep, waitOut} from './trakt';
import type {Env} from './util';
import {named, now} from './util';

export default {
  async fetch(request: Request, site: Env, ctx: ExecutionContext): Promise<Response> {
    // AIOSTREAMS_ORIGIN and AIOMETADATA_ORIGIN, or their earlier names: read once here (util.ts, named).
    const env = named(site);
    const url = new URL(request.url), found = /^\/h\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (found) {
      try {return await front(request, env, ctx, url, found[1], found[2] ?? '/');}
      catch (error) {console.error('front', (error as Error).message); return new Response(JSON.stringify({Message: 'The server behind this hub did not answer'}), {status: 502, headers: {'content-type': 'application/json', 'access-control-allow-origin': '*'}});}
    }
    if (url.pathname.startsWith('/api/')) return api(request, env, url, ctx);
    return env.ASSETS.fetch(request);
  },
  // Every five minutes: Trakt calls still waiting are tried again, and plays whose player went quiet without saying stop are
  // stopped on Trakt for it. Then a hub whose Home changes are waiting to reach the apps has its setups saved again (foryou.ts, resend):
  // first of the steps that take a run to themselves, so none of them can hold it up. Then a hub whose manager set an address to call when Home changes, with a call waiting its turn, has it made (notice.ts, due): one call. Then one person's Trakt is synced with their progress (sync.ts): one cheap look at what changed,
  // and a few writes only when something did (on a turn with nothing to do, a few shows for Next Up, until each is done). A run that step left alone
  // hearts a few titles from one person's Trakt watchlist on their own server, if they turned that on (hearts.ts). A run that left alone too takes a step of the day's look at whether Trakt and MDBList
  // agree (drift.ts), each on its own so it never holds those up. A run those left alone takes a step of the day's For you picks
  // (foryou.ts): each makes a few dozen calls, and a run may make only about fifty. A run with none of that to do sends one
  // person's MDBList what was watched here and it lacks (sync.ts, leftovers), once a day each: after those, so it never holds a pick
  // up. Last of all, a run with nothing else to do works out one person's Recommended rows (recs.ts), once a day each, from 4:00 UTC,
  // or with none of those to do looks up one person's Up Next and New for you (ahead.ts: for someone without Trakt), once a day each.
  async scheduled(event: ScheduledController, site: Env, ctx: ExecutionContext) {
    const env = named(site);
    // Each run is counted, for the Hub page. Every job below has its own row under Hub, General, Background work (Background in
    // src/pages.tsx): a job added here gets one there too.
    const counted = env.DB.prepare("INSERT INTO runs (job, at, count, since) VALUES ('cron', ?1, 1, ?1) ON CONFLICT (job) DO UPDATE SET at = excluded.at, count = CASE WHEN runs.since IS NULL THEN 1 ELSE runs.count + 1 END, since = coalesce(runs.since, excluded.at)").bind(now()).run().catch(() => null);
    ctx.waitUntil(counted.then(() => sweep(env)).catch(error => console.error('sweep', (error as Error).message))
      .then(() => resend(env, event.scheduledTime, true)).catch(error => {console.error('resend', (error as Error).message); return true;})
      // (One call at most, so it shares the run with whatever follows.)
      .then(async busy => {await due(env); return busy;})
      .then(busy => busy || match(env, event.scheduledTime)).catch(error => {console.error('match', (error as Error).message); return true;})
      .then(busy => busy || hearts(env)).catch(error => {console.error('hearts', (error as Error).message); return true;})
      .then(busy => busy || drift(env, event.scheduledTime)).catch(error => {console.error('drift', (error as Error).message); return true;})
      .then(busy => busy || forYou(env, event.scheduledTime)).catch(error => {console.error('foryou', (error as Error).message); return true;})
      .then(busy => busy || leftovers(env, event.scheduledTime)).catch(error => {console.error('leftovers', (error as Error).message); return true;})
      .then(busy => busy ? null : nightly(env, event.scheduledTime)).catch(error => console.error('nightly', (error as Error).message))
      // Last, with everything else done: a start, pause or stop Trakt asked the hub to wait a few minutes with goes when that wait ends.
      .then(() => waitOut(env)).catch(error => console.error('wait out', (error as Error).message)));
  },
} satisfies ExportedHandler<Env>;
