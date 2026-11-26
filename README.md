# AIOHub

AIOHub gives a household, or a group of friends, one address to type into a Jellyfin player app. Everyone signs in there
with their own name and password, and gets their own Home, watch history, playback settings and devices. It sits in front of
[AIOStreams](https://github.com/Viren070/AIOStreams) (which finds the streams) and
[AIOMetadata](https://github.com/cedya77/aiometadata) (which supplies titles, artwork and rows), and keeps each person's
setup on both in step with what you choose on a small website. It is for the person who already runs streaming for the
people around them and is tired of doing it one config at a time. It runs on Cloudflare's Free plan.

Jellyfin is an open media system with player apps for phones, TVs and desktops. AIOHub answers those apps the way a
Jellyfin server would, so people keep using the app they like, such as Strand or Streamyfin. AIOHub is not a player
itself and hosts no video.

## What you get

### Each person

- **A Home of their own.** Trending, popular and top rated rows, collections by streaming service and by genre, and any
  list added by its link. Each row can be renamed, reordered or switched off.
- **Rows from their own watching.** One Watchlist (from Trakt, MDBList or both), Recommended Movies and Recommended
  Shows, and Recently Watched. Recommended works without a Trakt account: the hub works it out from what they watched.
  With Trakt connected there are also Up Next and New for you (new episodes of shows they watch, and watchlist movies that
  are now out to stream).
- **For you rows.** Places on Home that the hub fills once a day for each person: because you watched, the next film in a
  series, a show to pick back up, more from a director, their genres, something different, a seasonal set, a Top 10.
  Each pick says why it was made. A person can keep a pick, swap it for one of the day's other options, or ask never to be
  picked for from a given title again.
- **Sign-in that suits a TV.** Quick Connect is the Jellyfin way to sign in without typing a password on a remote: the TV
  shows a six-digit code, and you approve it from your page on the hub. Phones and laptops sign in with the hub address, a
  name and a password.
- **Their own Trakt and MDBList.** Trakt and MDBList are services that keep a record of what you watch, plus watchlists
  and lists. A person can connect either or both. Connecting gives its rows on Home and sends nothing. Each has one
  Sync switch, off until it is turned on: on, what is watched here goes there as it plays and what is watched elsewhere
  comes back; off, nothing moves either way. Sync never marks anything as unwatched. One more switch, Watchlist, makes
  the titles they save in the apps (the heart or Save button) and their watchlist one list: Trakt's watchlist when Trakt is
  connected, with MDBList following, else MDBList's.
  Their lists and liked lists can be rows on Home.
- **Playback settings.** Quality (Data saver, Balanced or Best), a size limit, audio languages, subtitles, skipping intros and
  credits where a title has them marked, and hiding what they have already watched.
- **Devices.** Every signed-in app is listed with its name, when it was last seen and roughly where. Any of them can be
  renamed or signed out.

### The manager

- **Invites.** Add a person, then send them a link or let them scan a code. They choose their own password.
- **Groups.** Put people in groups such as Family or Friends. Settings and Home rows flow from the hub to a group to a
  person, and each level can change anything for itself.
- **Content limits.** Set a person or a group to Kids or Teens. Their rows then show only titles with a rating that
  fits, and Kids get rows and folders made for children. The manager decides whether a person may change their own limit.
- **Activity.** Who is watching what right now, and what was watched before: how far in, which parts were played, on
  which device and from roughly where. Titles saved to a device to watch later show as downloaded.
- **Background work.** A list, under Hub, General, of every job the hub runs by itself, when each last ran and when it
  runs next.
- **Debrid accounts.** A debrid service is a paid account that fetches a file and hands back a direct link to stream it
  from. The hub can hold several (TorBox, Real-Debrid, AllDebrid, Premiumize, Debrid-Link, EasyDebrid), and each group or
  person uses the one you pick for them. People never see the keys.
- **Control.** Pause playing for a person or a whole group (they can still browse), sign a device out, reset a forgotten
  password, and choose how stream names are labelled in the apps.
- **A safe account.** Passkeys (sign in with a fingerprint or face) and one-time recovery codes for the manager.

## How it works

AIOHub is one Cloudflare Worker (a small program Cloudflare runs for you), one D1 database, and a React site served by
the same Worker.

- A player app points at `https://<your site>/h/<hub code>`. The Worker signs the person in and gives that app a token
  of its own, which you can see and take away. The app never sees the keys behind it.
- Video and artwork go straight from the device to where they are kept. They never pass through the hub.
- When you change something on the site, the Worker updates that person's setup on AIOStreams and AIOMetadata. It only
  touches setups it created itself, and deletes them when the hub is deleted.
- Every five minutes a scheduled run does the slow work: the day's For you picks, Recommended rows, Trakt and MDBList
  sync, and retries of anything Trakt turned away.

The database holds people and groups, their settings, signed-in devices, what was played, each day's picks, and connected
accounts. Keys are encrypted and passwords hashed or encrypted before they are stored. No ads, no analytics, nothing sold or shared. The full
list of what a hub keeps, and what it does with a connected Trakt or MDBList account, is in [PRIVACY.md](PRIVACY.md).

## What you need

- A Cloudflare account. The Free plan is enough.
- An AIOStreams server and an AIOMetadata server. The defaults in `wrangler.jsonc` are the public ForTheWeak servers; you
  can point at your own.
- A key for at least one debrid service.
- A free key from TMDB, the film and TV database that fills most rows. Optionally a free MDBList key for the hub, which
  the collection rows (by service, by genre) need to reach the apps.
- For the Trakt features, a Trakt API app of your own (see below). Without one, Trakt is not offered.
- For the terminal route, Node 20 or newer.

## Run your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/miraclx/aiohub)

The button copies this repository to your account, makes the database and asks for two secrets:

- `VAULT_KEY`: a long random text (40 characters or more) that locks every key and password the site stores. Keep a copy
  and never change it. Without it, stored keys cannot be read again.
- `CLAIM_CODE`: a code you make up. Afterwards, open `https://<your site>/#/setup/<that code>` to create your hub.

Or from a terminal:

```sh
npm install
npx wrangler login
node setup.mjs            # or: node setup.mjs --aiostreams https://your.aiostreams.host --aiometadata https://your.aiometadata.host
```

The script makes the database, applies its tables, makes the two secrets (kept in `.instance.json`, which you should back
up), builds and deploys the site, and prints the one-time link that creates your hub. It is safe to run again: it keeps
what already exists.

Then, on the site:

1. Open the one-time link and choose a password. The site makes a hub code for you. You sign in with the two together, so
   save both.
2. Follow the remaining steps: paste a debrid key, then your TMDB key (and an MDBList key if you have one), pick a
   starting quality, and add your first group and person.
3. Add more groups and people, and send each person their invite link.
4. Each person opens their link, chooses a password, and finds the server address and their app password under Devices.

### Turning on Trakt

A fresh copy has Trakt switched off. To offer it, create an API app in your Trakt account with the redirect address
`https://<your site>/api/trakt/callback`, then give the Worker its client ID as a secret named `TRAKT_CLIENT_ID`:

```sh
npx wrangler secret put TRAKT_CLIENT_ID
```

Only the client ID is needed. Each person then connects their own Trakt account from their own page.

### Updating

If you set up from a terminal:

```sh
git pull
npm install
npm run build
npm run deploy       # applies new database tables, then deploys
```

### Settings in `wrangler.jsonc`

- `MAX_HUBS`: how many hubs this copy of the site will carry. The default is 1.
- `UP_ORIGIN` and `AIOM_ORIGIN`: the AIOStreams and AIOMetadata servers hubs use unless they choose their own under Hub,
  General.

## Working on it

```sh
npm run dev          # the site alone, with sample data at /?sample
npm run typecheck
npm test -- <path to a Chromium binary>
```

`npm run dev` needs no account or keys: the preview runs on made-up data and saves nothing.

`npm test` builds the site, starts the Worker locally on a fresh database against stand-in servers, and runs the API
tests, a browser walk-through, and the AIOMetadata tests. With the shipped test values (`tests/local.vars`) every outside
address points at a stand-in on your own machine. If you keep a `.dev.vars` of your own, the run uses that instead. It
needs a Chromium binary because the browser walk-through drives one.

`src/` is the site (React, hand-written CSS). `worker/` is the Worker: the API, the sign-in front that player apps talk
to, and the code that keeps AIOStreams and AIOMetadata in step. `migrations/` is the database. `formatter-preview/`
renders the stream-label preview.

## Limits and what it is not

- **Not a player, not a media server.** AIOHub ships no app and stores no video. It answers player apps the way a Jellyfin
  server would, and needs AIOStreams, AIOMetadata and a debrid account behind it.
- **Free plan pace.** A Worker on the Free plan may make about fifty outside calls and database queries per run. So
  background work goes one person at a time, every five minutes. For you and Recommended are worked out once a day per
  person, and Trakt sync takes turns, so a play made elsewhere can take a while to show up. The Background work page shows
  where things stand.
- **Size.** A hub carries up to 20 people, which is what AIOStreams allows per setup by default. A copy of the site
  carries one hub unless you raise `MAX_HUBS`.
- **Trakt can be slow to answer.** Trakt sometimes turns away the shared addresses Workers call from. The hub waits and
  tries again, and rows show the last list Trakt gave in the meantime.
- **Real-Debrid allows one IP at a time.** People watching from different places can trip that. A proxy set in AIOStreams
  avoids it.
- **Content limits rely on ratings.** They use US ratings from TMDB. Under Kids, a title with no rating is left out.
- **Not affiliated.** AIOHub is an independent project. It is not part of, or endorsed by, AIOStreams, AIOMetadata,
  Jellyfin, Cloudflare, TMDB, MDBList, any debrid service or any player app. It uses Trakt but is not endorsed or
  certified by Trakt.
- **Referral links.** The "Get an account" links for TorBox and Real-Debrid in `src/data.ts` are the original author's
  referral links. Change or remove them in your copy if you prefer.

## What's new

Newest first. Dates are the commit dates on `main`.

### 2026-11-26

- The Sync card is one row a switch: Trakt, MDBList and Watchlist, each with one sentence, and a status line only when
  something is unusual. Watchlist follows one rule for everyone: off, the titles you save stay in the apps; on, they and your
  watchlist are one list (Trakt's when connected, else MDBList's, which no longer happens by itself). A manager can set
  MDBList sync and Watchlist only for someone who has not joined.
- Accounts has one Sync card: a plain line of what is synced, a switch per account for your watching, and one switch that
  shows your watchlist as Favorites, with or without MDBList. Trakt leads the watchlist and MDBList follows; a title that
  leaves your Trakt watchlist loses its heart, and hearts that were never on Trakt are left alone. Earlier plays and hearts
  you already had are offered once, never added by themselves. A whole season ticked in an app counts as its episodes, and
  Recently Watched includes what you finished here while Trakt sync is off.
- Accounts have one idea each: Connect gives the rows, and one Sync switch moves watching both ways. Trakt sends nothing
  until its sync is on, and asks once right after you connect. MDBList's switch is called Sync too.
- Each account-driven row says in one line what it is, where it is edited and in Add row.
- Favorites: an opt-in switch on the Trakt card shows your Trakt watchlist as Favorites in the apps, and a heart added or removed in an app adds or removes the title on your watchlist.
- New for you: a row of new episodes of shows you watch, and watchlist movies that are now out to stream (needs Trakt).
- Recommended Movies and Recommended Shows work without Trakt, worked out from what you watched.
- One Watchlist row, from Trakt, MDBList or both merged.
- Your own Trakt lists and the lists you liked are separate rows.
- Activity shows titles saved to a device to watch later as downloaded.
- A TV's Quick Connect link opens a page on the hub where you approve the code.
- A For you row is picked again within minutes of finishing something.
- The Accounts page shows what was synced and where, and says when the hub is waiting on Trakt.
- Next Up in the apps carries on with shows watched on Trakt: with Trakt sync on (and MDBList sync off), the latest
  episode of each show from the last 120 days is ticked, with its Trakt date.

### 2026-11-25

- One switch syncs Trakt with your progress. It only adds, and a play you delete stays deleted. Plays from before you
  connected are added only if you agree.
- My Trakt lists: all of a person's Trakt lists as one Home row, with a pictured tile per list.
- Each For you row says why it was picked and offers the day's other options. You can keep a pick, or see less from a
  title or a kind of pick.
- For you also draws on older watching, and can offer something different from your usual genres.
- Add row groups its ready-made rows and marks what is already on Home.
- Rows that refresh on a schedule say when they were last filled and when they are next.
- Playback settings are a person's own to change by default. Their content limit stays the manager's unless opened up.

### 2026-11-24

- Activity shows which parts of a title were played, in the order watched, and tells a paused player from a playing one.
- Something opened and closed within two minutes is not counted as a watch and is not sent to Trakt.
- Each For you pick says what kind it is, and a person can add For you rows from their own page.
- A privacy page, and a clear notice about what connecting Trakt does.

### 2026-11-22 and 2026-11-23

- For you rows arrive: places on Home filled every day from what each person watches.
- Kids' Channels and Animation Studios collections, with a tile for each folder.
- Any row can be renamed.
- The site asks before removing a row, signing out a device, or disconnecting an account.

### 2026-11-20 and 2026-11-21

- Background work page: what the hub does by itself, when it last ran and when it runs next.
- Trakt sign-in happens from the person's own page.
- Recently Watched row, and a daily check that Trakt and MDBList agree on what was watched.
- Kids and Teens limits fill their rows with rated titles only, and Kids get the rows and folders made for children.
- A manager can open a person's page and see what they see.
- Activity keeps roughly where each play's device was.

### 2026-11-18 and 2026-11-19

- Each person's apps are served by their own AIOMetadata setup, with no one signed out by the move.
- The hub serves each person's Trakt rows itself.
- The hub has a name that apps and Trakt show.
- Quality choices (Data saver, Balanced, Best) pick streams by how heavy they are, with a size cap, and Data saver works
  at any resolution.
- A paused person sees a short, neutral message.

### 2026-11-17

- First release: hubs, groups and people on top of AIOStreams and AIOMetadata, with per-person Home, sign-in and history.
- Rename a signed-in device. Pause a whole group. Put groups in any order.
- Real posters on a person's own rows, and pictures on Activity.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE). The stream-label preview reuses formatter code from AIOStreams under the same
licence; see `formatter-preview/NOTICE`.
