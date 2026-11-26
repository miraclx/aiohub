# Privacy

AIOHub is a small site that sets up Jellyfin player apps for a household or a group of friends. Whoever runs a hub runs their own copy; this page describes what any copy keeps and why.

## What a hub keeps

- **Sign-in:** the manager's username, a hashed password and any passkeys. Sessions expire.
- **People and groups:** the names the manager gives them and their Home and playback settings.
- **Devices:** the name and app of each signed-in player, when it was last seen, and the rough place (city, country, network name) the request came from, so a manager can spot a device they don't know.
- **What's watched:** for each person, the titles played in their apps, each time they watch: how far in, which parts were played and how often they were paused, on which device and from roughly where. Managers see this on the hub's Activity page. When an app saves a title to a device to watch later, the hub notes which title, on which device and when, and shows it there as downloaded.
- **For you:** each person's picks for the day and the day's other options, with the title each came from and when it was watched, and any titles they asked never to be picked from again. Managers see these on that person's Home.
- **Connected accounts:** a person's Trakt sign-in and MDBList key, encrypted before they are stored. Nobody else in the hub can see or use them.

## Trakt

Trakt has two parts: connecting it, and a Sync switch that is off until the person turns it on.

When a person connects Trakt, the hub only reads: their history, watchlist, lists and recommendations, their calendar of new episodes and releases, and the shows they dropped or hid, to fill their rows and to pick For you rows for them. Connecting writes nothing to Trakt.

While their sync is off, nothing they watch here is sent to Trakt and nothing they watched elsewhere is brought back. Anything that was still waiting to be sent when they turned it off is dropped.

While their sync is on, the hub:

- adds to their Trakt history what they watch in their apps, as it plays, with where they paused. Trakt is told nothing about something opened and closed again within a couple of minutes;
- brings back what they watch in other Trakt apps: plays and paused spots missing on either side are added, a paused spot gives way to a later one from Trakt, and nothing is removed. Coming from Trakt, that covers what they watched there in the last 14 days and everything after. Unless they also sync with MDBList, the latest episode of each show they watched on Trakt in the last 120 days is ticked on their own setup too, with the date Trakt has for it, so Next Up in their apps carries on. Shows they dropped or hid on Trakt are left out, and none of that is sent back to Trakt or to MDBList;
- adds what they watched here before turning sync on only if they agree, after showing them the list.

Separately, whether sync is on or off:

- when they turn on showing their Trakt watchlist as Favorites, adds a title to their watchlist when they heart it in their apps, removes it from their watchlist when they take the heart away in their apps, and shows their watchlist as Favorites there. It is off until they turn it on, and a manager cannot turn it on for them. The hub keeps a note of each heart it made or passed on, so it never removes a heart they made themselves; the note goes when Trakt is disconnected.

It never posts comments or ratings, never touches other people's accounts, and never shares the sign-in with anyone else. Disconnecting Trakt deletes the stored sign-in; it can also be revoked any time at trakt.tv under Settings, Connected apps.

Sync is the person's own choice, made on their own page. They are asked once, right after they sign in to Trakt themselves; it stays off until they turn it on, and a manager cannot turn it on for them. The hub keeps a record of each play it synced (its title, where it was added and when), so that nothing is sent twice and a play they delete stays deleted. Only they can see that list, on their own page; it goes when they are removed from the hub.

## MDBList

MDBList works the same way: connecting it, and a Sync switch that is off until it is turned on, by the person or by their manager with them.

Connecting saves the person's own MDBList key, which reads their watchlist and lists for their rows. That writes nothing to MDBList.

While their MDBList sync is on, what they play, tick as watched or pause in their apps is written to their MDBList, what their MDBList has is what their apps show as watched, and, with Trakt sync on too, plays and paused spots from their Trakt are added to it. Turning it on first adds what they watched here that their MDBList lacks, and once a day the hub adds anything that still never got there. Turning it off first copies back what only their MDBList has, so nothing is lost; after that nothing they watch is sent to MDBList and nothing comes back.

Removing the key stops all of it; nothing in their MDBList account is removed.

## Where it lives

Everything is stored with Cloudflare (Workers and D1), which hosts the site. Title details and artwork come from TMDB and the hub's AIOMetadata, which are asked about titles, never about people.

No ads, no analytics, nothing sold or shared.

## Removing your data

Removing a person from a hub deletes their plays, devices, settings and connected accounts. Ask your hub's manager, or open an issue at https://github.com/miraclx/aiohub/issues.
