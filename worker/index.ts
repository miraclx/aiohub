// AIOHub Worker: the site, its API, and the sign-in front that player apps talk to.
import {api} from './api';
import {front} from './front';
import {sweep} from './trakt';
import type {Env} from './util';

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
  // Every quarter hour: plays whose player went quiet without saying stop are stopped on Trakt for it.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {ctx.waitUntil(sweep(env).catch(error => console.error('sweep', (error as Error).message)));},
} satisfies ExportedHandler<Env>;
