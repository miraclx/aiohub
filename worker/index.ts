// AIOHub Worker: the site, its API, and the sign-in front that player apps talk to.
import {api} from './api';
import {front} from './front';
import {drift} from './drift';
import {leftovers, match} from './sync';
import {forYou} from './foryou';
import {recommend} from './recs';
import {sweep} from './trakt';
import type {Env} from './util';
import {now} from './util';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url), found = /^\/h\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (found) {
      try {return await front(request, env, ctx, url, found[1], found[2] ?? '/');}
      catch (error) {console.error('front', (error as Error).message); return new Response(JSON.stringify({Message: 'The server behind this hub did not answer'}), {status: 502, headers: {'content-type': 'application/json', 'access-control-allow-origin': '*'}});}
    }
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    return env.ASSETS.fetch(request);
  },
  // Every five minutes: Trakt calls still waiting are tried again, and plays whose player went quiet without saying stop are
  // stopped on Trakt for it. Then one person's Trakt is synced with their progress (sync.ts): one cheap look at what changed,
  // and a few writes only when something did (on a turn with nothing to do, a few shows for Next Up, until each is done). A run that step left alone takes a step of the day's look at whether Trakt and MDBList
  // agree (drift.ts), each on its own so it never holds those up. A run those left alone takes a step of the day's For you picks
  // (foryou.ts): each makes a few dozen calls, and a run may make only about fifty. A run with none of that to do sends one
  // person's MDBList what was watched here and it lacks (sync.ts, leftovers), once a day each: after those, so it never holds a pick
  // up. Last of all, a run with nothing else to do works out one person's Recommended rows (recs.ts), once a day each, from 4:00 UTC.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Each run is counted, for the Hub page. Every job below has its own row under Hub, General, Background work (Background in
    // src/pages.tsx): a job added here gets one there too.
    const counted = env.DB.prepare("INSERT INTO runs (job, at, count, since) VALUES ('cron', ?1, 1, ?1) ON CONFLICT (job) DO UPDATE SET at = excluded.at, count = CASE WHEN runs.since IS NULL THEN 1 ELSE runs.count + 1 END, since = coalesce(runs.since, excluded.at)").bind(now()).run().catch(() => null);
    ctx.waitUntil(counted.then(() => sweep(env)).catch(error => console.error('sweep', (error as Error).message))
      .then(() => match(env, event.scheduledTime)).catch(error => {console.error('match', (error as Error).message); return true;})
      .then(busy => busy || drift(env, event.scheduledTime)).catch(error => {console.error('drift', (error as Error).message); return true;})
      .then(busy => busy || forYou(env, event.scheduledTime)).catch(error => {console.error('foryou', (error as Error).message); return true;})
      .then(busy => busy || leftovers(env, event.scheduledTime)).catch(error => {console.error('leftovers', (error as Error).message); return true;})
      .then(busy => busy ? null : recommend(env, event.scheduledTime)).catch(error => console.error('recommend', (error as Error).message)));
  },
} satisfies ExportedHandler<Env>;
