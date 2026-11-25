# Privacy

AIOHub is a small site that sets up Jellyfin player apps for a household or a group of friends. Whoever runs a hub runs their own copy; this page describes what any copy keeps and why.

## What a hub keeps

- **Sign-in:** the manager's username, a hashed password and any passkeys. Sessions expire.
- **People and groups:** the names the manager gives them and their Home and playback settings.
- **Devices:** the name and app of each signed-in player, when it was last seen, and the rough place (city, country, network name) the request came from, so a manager can spot a device they don't know.
- **What's watched:** for each person, the titles played in their apps, each time they watch: how far in, which parts were played and how often they were paused, on which device and from roughly where. Managers see this on the hub's Activity page.
- **For you:** each person's picks for the day and the day's other options, with the title each came from and when it was watched, and any titles they asked never to be picked from again. Managers see these on that person's Home.
- **Connected accounts:** a person's Trakt sign-in and MDBList key, encrypted before they are stored. Nobody else in the hub can see or use them.

## Trakt

When a person connects Trakt, the hub:

- reads their history, watchlist and lists, to fill their rows and to pick For you rows for them;
- adds to their history what they watch in their apps (scrobbling), and, when they ask, what they watched before connecting.

It never posts comments or ratings, never touches other people's accounts, and never shares the sign-in with anyone else. Disconnecting Trakt deletes the stored sign-in; it can also be revoked any time at trakt.tv under Settings, Connected apps.

## Where it lives

Everything is stored with Cloudflare (Workers and D1), which hosts the site. Title details and artwork come from TMDB and the hub's AIOMetadata, which are asked about titles, never about people.

No ads, no analytics, nothing sold or shared.

## Removing your data

Removing a person from a hub deletes their plays, devices, settings and connected accounts. Ask your hub's manager, or open an issue at https://github.com/miraclx/aiohub/issues.
