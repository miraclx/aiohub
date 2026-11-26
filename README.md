# AIOHub

A small website for running streaming for your household and friends on top of
[AIOStreams](https://github.com/Viren070/AIOStreams) and [AIOMetadata](https://github.com/cedya77/aiometadata).

You make a hub, add groups and people, and each person gets their own Home, their own sign-in and their own watch history.
People type the hub's address, their name and a password into any Jellyfin app. Video never passes through the hub: it only
signs people in and keeps their setups on AIOStreams and AIOMetadata in step with what you choose on the site.

- Groups and people, each inheriting from the level above and able to change anything for themselves.
- Home rows, collections by service and by genre, lists by link, content limits, posters.
- For you rows: picked every day for each person from what they watch, such as more from a director, the next film in a series, or a seasonal set.
- Quality, size, languages, sources, subtitles and the stream label, per hub, group or person.
- Each person's own Trakt (rows) and MDBList (watch history), synced with their progress here when they turn sync on.
- Per-app sign-ins you can see and take away, Quick Connect for TVs, pause for a person, passkeys for the manager.

It is one Cloudflare Worker with one small database. The Free plan is enough.

## Run your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/miraclx/aiohub)

The button copies this repository to your account, makes the database and asks for two secrets:

- `VAULT_KEY`: a long random text that locks every key and password the site stores. Keep a copy and never change it.
- `CLAIM_CODE`: a code you make up. Afterwards, open `https://<your site>/#/setup/<that code>` to create your hub.

Or from a terminal (Node 20 or newer):

```sh
npm install
npx wrangler login
node setup.mjs            # or: node setup.mjs --aiostreams https://… --aiometadata https://…
```

The script makes the database, applies its tables, makes the two secrets (kept in `.instance.json`, which you should back
up), deploys, and prints the one-time link that creates your hub.

Inside the site you will need a debrid key (TorBox, Real-Debrid and so on), a free TMDB key, and optionally a free MDBList key.

## Things to know

- `wrangler.jsonc` holds the hub limit (`MAX_HUBS`) and the AIOStreams and AIOMetadata servers hubs use unless
  they choose their own (`UP_ORIGIN`, `AIOM_ORIGIN`). The defaults are the public ForTheWeak servers.
- The hub only ever touches setups it created itself on those servers, and deletes them when the hub is deleted.
- The "Get an account" links for TorBox and Real-Debrid in `src/data.ts` are the original author's referral links. Change or
  remove them in your copy if you prefer.

## Working on it

```sh
npm run dev          # the site alone, with sample data at /?sample
npm run typecheck
npm test -- <path to a Chromium binary>     # starts the Worker locally against stand-in servers
```

`src/` is the site (React, hand-written CSS), `worker/` is the Worker (API, the player-app sign-in front, and the code that
keeps AIOStreams and AIOMetadata in step), `migrations/` is the database, `formatter-preview/` renders the stream-label preview.

## Trakt and privacy

AIOHub uses Trakt but is not endorsed or certified by Trakt. What a hub keeps, and what it does with a connected Trakt
account, is in [PRIVACY.md](PRIVACY.md).

## Licence

AGPL-3.0-only. The stream-label preview reuses formatter code from AIOStreams under the same licence; see
`formatter-preview/NOTICE`.
