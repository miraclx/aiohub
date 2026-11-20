// AIOHub Worker: the site, its API, and the sign-in front that player apps talk to.
import {api} from './api';
import {front} from './front';
import {drift} from './drift';
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
  // stopped on Trakt for it. Then a step of the day's look at whether Trakt and MDBList agree, on its own so it never holds those up.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Each run is counted, for the Hub page.
    const counted = env.DB.prepare("INSERT INTO runs (job, at, count, since) VALUES ('cron', ?1, 1, ?1) ON CONFLICT (job) DO UPDATE SET at = excluded.at, count = CASE WHEN runs.since IS NULL THEN 1 ELSE runs.count + 1 END, since = coalesce(runs.since, excluded.at)").bind(now()).run().catch(() => null);
    ctx.waitUntil(counted.then(() => sweep(env)).catch(error => console.error('sweep', (error as Error).message)).then(() => drift(env, event.scheduledTime)).catch(error => console.error('drift', (error as Error).message)));
  },
} satisfies ExportedHandler<Env>;
