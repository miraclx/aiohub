# Cost and limits

## What it costs

Nothing to run, for a household. AIOHub is built to fit Cloudflare's Free plan. You still pay for your own debrid
account, as before.

### What a hub uses

Measured on the author's hub over one busy day: 11 people, 22 signed-in devices.

| | Used in the day | Free plan allows per day | Share |
| --- | --- | --- | --- |
| Requests to the Worker | 11,400 | 100,000 | 11% |
| Database rows written | 5,200 | 100,000 | 5% |
| Database rows read | 1,100,000 | 5,000,000 | 22% |
| Database size | 1.4 MB | 500 MB | under 1% |

A quiet day on the same hub was about 2,000 requests.

- **Requests in** come from the player apps (browsing Home, opening a title, reporting progress while something
  plays) and from the site's own pages. The background run adds 288 a day. Opening the site's pages themselves is free
  and not counted.
- **Calls out** go to AIOStreams, AIOMetadata, TMDB, MDBList and Trakt: about 9,000 on that day. Cloudflare does not
  cap these per day, only at 50 for each request or background run, which is why the slow work goes a person at a
  time.

All daily counts start again at midnight UTC. If a copy ever passed one, the apps and the site would get errors until
then, and nothing would be lost.

### When to pay

Cloudflare's paid plan is $5 a month and lifts every number above far past what a hub needs. A household does not
need it.

## Size

- **A hub carries up to 20 people.** That is what AIOStreams allows per setup by default.
- **A copy carries one hub** unless you raise `MAX_HUBS`.

### Hosting for others

You can raise `MAX_HUBS` and let other people make hubs on your copy. Know what that means first:

- By the numbers above, one Free account has room for about five busy hubs. Past that, everyone on the copy gets
  errors until midnight UTC.
- Their debrid keys, accounts and watch history sit in your database, under your `VAULT_KEY`.
- Everyone's Trakt goes through your Trakt app.
- You are answerable to Cloudflare for what the copy is used for.

For anyone you do not know well, send them the Deploy button instead.

## Pace

- **Background work runs every five minutes, a person at a time.** For you, Recommended, Up Next and New for you are
  worked out once a day for each person.
- **Sync takes turns.** Something watched in another Trakt app can take a while to show up here. Background work shows
  where things stand.
- **Trakt can be slow to answer.** Trakt sometimes turns away the shared addresses Workers call from. The hub waits
  and tries again, and rows show the last list Trakt gave in the meantime.

## What it does not do

- **Not a player, not a media server.** AIOHub ships no app and stores no video. It needs AIOStreams, AIOMetadata and
  a debrid account behind it.
- **Content limits rely on ratings.** They use US ratings from TMDB. A title with no rating is left out under Kids, and under
  Teens too in the rows the hub makes itself. A newly limited person's own rows can look short for up to an hour while
  ratings are looked up.
- **Real-Debrid allows one IP at a time.** People watching from different places can trip that. A proxy set in
  AIOStreams avoids it.
- **Unwatching on Trakt's own site does not reach the hub.** Unwatching in an app does reach Trakt.
- **Some apps only look for new rows when told to.** Hub, General has an address the hub can call when Home changes,
  for a helper that tells them.
