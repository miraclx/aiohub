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

When a person connects Trakt, the hub:

- reads their history, watchlist, lists and recommendations, their calendar of new episodes and releases, and the shows they dropped or hid, to fill their rows and to pick For you rows for them;
- adds to their history what they watch in their apps, as it plays. Trakt is told nothing about something opened and closed again within a couple of minutes;
- once they turn sync on, syncs their Trakt with their progress from then on: plays and paused spots missing on either side are added, and nothing is removed. Coming from Trakt, that covers what they watched there in the last 14 days and everything after;
- adds what they watched here before connecting only if they agree, after showing them the list.

It never posts comments or ratings, never touches other people's accounts, and never shares the sign-in with anyone else. Disconnecting Trakt deletes the stored sign-in; it can also be revoked any time at trakt.tv under Settings, Connected apps.

Sync is the person's own choice, made on their own page; it stays off until they turn it on, and a manager cannot turn it on for them. The hub keeps a record of each play it synced (its title, where it was added and when), so that nothing is sent twice and a play they delete stays deleted. Only they can see that list, on their own page; it goes when they are removed from the hub.

## MDBList

While a person's progress is kept in their MDBList, what they play, tick as watched or pause in their apps is written to their MDBList, and, with Trakt sync on, plays and paused spots from their Trakt are added to it. Once a day the hub also adds anything they watched here that their MDBList lacks. Their MDBList key also reads their watchlist and lists for their rows. Removing the key stops all of it; nothing in their MDBList account is removed.

## Where it lives

Everything is stored with Cloudflare (Workers and D1), which hosts the site. Title details and artwork come from TMDB and the hub's AIOMetadata, which are asked about titles, never about people.

No ads, no analytics, nothing sold or shared.

## Removing your data

Removing a person from a hub deletes their plays, devices, settings and connected accounts. Ask your hub's manager, or open an issue at https://github.com/miraclx/aiohub/issues.
