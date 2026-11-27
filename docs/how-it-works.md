# How it works

AIOHub is one Cloudflare Worker (a small program Cloudflare runs for you), one D1 database, and a website served by
the same Worker.

```
player app ──▶ your hub ──▶ AIOMetadata   titles, artwork, rows
                      └───▶ AIOStreams    streams, through your debrid account

video and artwork go straight from the device to where they are kept
```

## The parts

- **Player apps** point at `https://<your site>/h/<hub code>`. The hub answers them the way a Jellyfin server would.
  It signs the person in and gives that app a token of its own, which you can see and take away. The app never sees
  the keys behind it.
- **AIOStreams** finds the streams. **AIOMetadata** supplies titles, artwork and rows. The hub makes one setup on each
  for every person and keeps it matching what is chosen on the site. It only touches setups it made itself, and
  deletes them when the hub is deleted.
- **Video and artwork never pass through the hub.** They go straight from the device to where they are kept.

## What happens when

- **Someone changes a setting on the site.** The Worker updates that person's setups, and their apps show it on the
  next refresh.
- **Someone presses play.** The app reports progress to the hub. That is what fills Activity, Recently Watched and,
  with sync on, their Trakt or MDBList.
- **Every five minutes** a scheduled run does the slow work, a person at a time: the day's For you picks, the
  Recommended rows, Trakt and MDBList sync, and anything that has to be tried again. Hub, General, Background work
  shows each job, when it last ran and when it runs next.

## What is stored

The database holds people and groups, their settings, signed-in devices, what was played, each day's picks, and
connected accounts. Keys are encrypted with your `VAULT_KEY` before they are stored. Passwords are hashed or
encrypted. There are no ads and no analytics, and nothing is sold or shared.

The full list is in [Privacy](../PRIVACY.md).
