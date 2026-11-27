# Settings

Most things are set on the site itself. This page lists what the Worker reads from its own configuration: secrets,
and the `vars` in `wrangler.jsonc`. The few extra names the tests use are in [Working on it](development.md#settings-only-the-tests-use).

Set a secret with `npx wrangler secret put NAME`, or in the Cloudflare dashboard under your Worker, Settings, Variables
and Secrets. Change a var in `wrangler.jsonc` and deploy.

## Secrets

| Name | Needed | What it is |
| --- | --- | --- |
| `VAULT_KEY` | Yes | A long random text, 40 characters or more. Every key and password the site stores is encrypted with it. Keep a copy. Never change it: stored keys cannot be read with a different one. |
| `CLAIM_CODE` | Yes | A code you make up. The site asks for it once, when a hub is created, so a stranger cannot claim your copy. |
| `TRAKT_CLIENT_ID` | No | The client ID of your own Trakt API app. Without it Trakt is not offered anywhere on the site. See [Setting up](setup.md#turn-on-trakt). |

## Vars you may want to change

| Name | Default | What it does |
| --- | --- | --- |
| `AIOSTREAMS_ORIGIN` | `https://aiostreams.fortheweak.cloud` | The AIOStreams server a hub uses until its manager chooses another under Hub, General. |
| `AIOMETADATA_ORIGIN` | `https://aiometadata.fortheweak.cloud` | The same, for AIOMetadata. |
| `MAX_HUBS` | `1` | How many hubs this copy carries. At the limit, the sign-up page says the site is full. Raise it only if you mean to host hubs for other people; see [Cost and limits](limits.md#hosting-for-others). |
| `WEB_PLAYER` | `https://web.aiostreams.org` | Where the "Watch in a browser" link on a person's Devices page goes. Any Jellyfin web player works. Set it to `off` to hide the link. |
| `SITE_ORIGIN` | the address the site is opened on | The site's public address. Set it only if the site is reached at more than one address and the apps should always be given one of them. |

`UP_ORIGIN` and `AIOM_ORIGIN` are the old names of the first two. A copy that still sets them keeps working.

## What Cloudflare provides

`DB` is the D1 database and `ASSETS` is the built site. Both are declared in `wrangler.jsonc` and need no values from
you.

The schedule in `wrangler.jsonc` (`*/5 * * * *`) runs the background work every five minutes. Leave it as it is: the
pace of every job is worked out from it.
