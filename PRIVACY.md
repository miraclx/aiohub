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

Connecting an account and syncing with it are two things. Connect means the hub reads from the account, to fill the person's rows; it never writes to it. Sync is what writes, and each kind of sync has its own switch on the person's Sync card, off until it is turned on. There are three: Trakt and MDBList, each for what they watch (finished plays and paused spots), and Watchlist, for the titles they save in their apps.

When a person connects Trakt, the hub only reads: their history, watchlist, lists and recommendations, their calendar of new episodes and releases, and the shows they dropped or hid, to fill their rows and to pick For you rows for them. Connecting writes nothing to Trakt.

While their sync is off, nothing they watch here is sent to Trakt, nothing they mark unwatched here is removed from Trakt, and nothing they watched elsewhere is brought back. Anything that was still waiting to be sent when they turned it off is dropped.

While their sync is on, the hub:

- adds to their Trakt history what they watch in their apps, as it plays, with where they paused. Trakt is told nothing about something opened and closed again within a couple of minutes;
- brings back what they watch in other Trakt apps: plays and paused spots missing on either side are added, a paused spot gives way to a later one from Trakt, and nothing is removed. Coming from Trakt, that covers what they watched there in the last 14 days and everything after. Unless they also sync with MDBList, the latest episode of each show they watched on Trakt in the last 120 days is ticked on their own setup too, with the date Trakt has for it, so Next Up in their apps carries on. Shows they dropped or hid on Trakt are left out, and none of that is sent back to Trakt or to MDBList;
- adds what they watched here before turning sync on only if they ask for it. Their page offers it once, with the list to look at first; if they say not now, those plays are not offered again;
- takes a tick on a whole season or show in an app as each of its episodes ticked, up to 60 at a time;
- removes a title's plays from their Trakt history when they mark it unwatched in an app. Trakt removes every play of that film or episode, not only the latest. A whole season or show marked unwatched is each of its episodes, up to 60 at a time; over that, nothing is sent. This is the only time the hub removes a play from Trakt: never on its own, and never when sync is turned off, Trakt is disconnected or the person is removed.

Something they mark unwatched in an app stays unwatched on their own setup, sync on or off: the hub notes the title and when, and never adds back plays of it from before then that Trakt or MDBList still list. If they watch it again, it syncs as usual.

Removals made on Trakt's own site or apps do not come back here: a title unwatched there stays watched on their own setup.

### The Watchlist switch

One switch for whichever accounts are connected, separate from the two above, and off until it is turned on. Saving a title is the heart or Save button in the apps.

While it is off, the titles a person saves stay on their own setup and reach no account, whatever is connected.

While it is on, the titles they save and their watchlist are one list. Which watchlist is not a setting: Trakt's when Trakt is connected, and MDBList's when only MDBList is.

With Trakt connected:

- What is added. A title on their Trakt watchlist shows as saved on their own setup. A title they save in their apps is added to their Trakt watchlist.
- What is removed. A title they un-save in their apps is removed from their Trakt watchlist. That is the only time the hub removes anything from their Trakt watchlist: never on its own, and never when the switch is turned off, Trakt is disconnected or the person is removed. A title that leaves their Trakt watchlist stops showing as saved on their own setup, but only if the hub itself saw that title on the watchlist before. A saved title that was never on their Trakt watchlist is never touched.
- Titles they had already saved. The hub counts the saved titles on their own setup that their Trakt watchlist lacks and offers once, on their own page, to add them. Nothing is added unless they ask; if they say not now, those titles are not offered again.
- With MDBList connected too, their MDBList watchlist follows. The hub never writes a saved title to MDBList. While their MDBList sync is on, their own AIOMetadata setup passes each title saved or un-saved on to their MDBList watchlist by itself, including the ones the hub saves or un-saves there. While their MDBList sync is off, saved titles stay on their own setup and nothing reaches MDBList. A title removed on MDBList's side changes nothing on Trakt and is not put back.

The hub keeps a note of each title it saved, passed on or saw on the watchlist, which is how it tells these apart; the note goes when Trakt is disconnected.

With only MDBList connected, the hub itself writes nothing: with the switch and their MDBList sync both on, their own AIOMetadata setup shows their MDBList watchlist as their saved titles and passes each title they save or un-save on to it. While their MDBList sync is off the switch does nothing, and their page says so.

### Whose accounts and switches they are

A person connects their own accounts and sets their own switches, from their own page. Once they have joined (they have their own sign-in to the hub's site), all of it is theirs alone. Their manager sees whether Trakt and MDBList are connected, as whom, and whether each of the three switches is on, and can change none of it: a manager cannot connect, disconnect or reconnect their Trakt, save or remove their MDBList key, or turn any switch on or off. A manager can still remove the person from the hub, which deletes the hub's copies of their connections and sends nothing to any account.

For someone who has not joined, the manager can connect and disconnect accounts with them, and turn MDBList sync and the Watchlist switch on or off for them; Trakt sync stays off until they join and turn it on themselves. Only the person sees the offers on their card and the list of what was synced.

It never posts comments or ratings, never touches other people's accounts, and never shares the sign-in with anyone else. Disconnecting Trakt deletes the stored sign-in; it can also be revoked any time at trakt.tv under Settings, Connected apps.

Trakt sync is the person's own choice, made on their own page. They are asked once, right after they sign in to Trakt themselves; it stays off until they turn it on, and a manager can never turn it on for them. The hub keeps a record of each play it synced (its title, where it was added and when) and of each title it removed from Trakt, so that nothing is sent twice and a play they delete stays deleted. Only they can see that list, on their own page; it goes when they are removed from the hub.

## MDBList

MDBList works the same way: connecting it only reads, and its Sync switch is off until it is turned on, by the person, or by their manager while the person has not joined.

Connecting saves the person's own MDBList key, which reads their watchlist and lists for their rows. That writes nothing to MDBList.

While their MDBList sync is on, what they play, tick as watched or pause in their apps is written to their MDBList, what their MDBList has is what their apps show as watched, and, with Trakt sync on too, plays and paused spots from their Trakt are added to it. Turning it on first adds what they watched here that their MDBList lacks, and once a day the hub adds anything that still never got there. Turning it off first copies back what only their MDBList has, so nothing is lost; after that nothing they watch is sent to MDBList and nothing comes back.

Removing the key stops all of it; nothing in their MDBList account is removed.

## Where it lives

Everything is stored with Cloudflare (Workers and D1), which hosts the site. Title details and artwork come from TMDB and the hub's AIOMetadata, which are asked about titles, never about people.

No ads, no analytics, nothing sold or shared.

## Removing your data

Removing a person from a hub deletes their plays, devices, settings and connected accounts. Ask your hub's manager, or open an issue at https://github.com/miraclx/aiohub/issues.
