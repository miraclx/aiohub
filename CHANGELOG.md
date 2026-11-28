# What's new

Newest first. Dates are the commit dates on `main`.

## 2026-11-28

- Passkeys are for everyone now, not only the manager. A person adds one on their own page, under You, and after that
  signs in with their fingerprint, face or screen lock: from their link, or from the site's front page, where the one
  "Use a passkey" button opens a manager's hub or a person's own page, whoever the passkey belongs to. The password comes
  first and always works: a passkey is added only after signing in with one.
- After signing in with a password, a person or a manager with no passkey is offered one in a single line on their page,
  once on each device. "Not now" ends it there for good.
- A person's passkeys are theirs alone. Their manager sees how many they have and nothing else, and cannot add or remove
  one, not even from a view of their page. "Reset" under a person's Forgotten password now removes their passkeys with
  their password, for a lost or stolen device. Removing a person or the hub removes them too.
- A passkey works only at the address it was made on. A site that moves to a new address keeps its passwords; passkeys
  are added again there. The Passkeys list says so.
- A passkey the site already holds is refused when added a second time, instead of being reported as added.
- New table `person_passkeys` (migration 0037).
- A content limit now covers every row the hub makes itself, not only the ones AIOMetadata builds: the Watchlist, Recently
  Watched, Up Next, New for you, a person's own Trakt lists and Recommended all leave out what is rated above Kids or Teens,
  and what has no US rating. A row is filtered as it is read, so a limit the manager changes counts at the next refresh.
  Ratings are looked up on TMDB a few titles each run (new row under Hub, General, Background work: "Ratings for content
  limits"), and a title is left out until its rating is known. Under a limit the hub also saves to Favorites only what the
  limit lets through; it never takes a saved title away for a limit, and what was watched is untouched.
- First-time setup has a Servers step, before anything is set up on a server: the site's own AIOStreams and AIOMetadata
  servers are filled in as recommended, and another address is checked the way it is under Hub, General.
- The Servers card names this site's own servers as it is set up, not a fixed name, and says what moving really does:
  the old setups are removed first and new ones made, apps stay signed in, and watched marks are kept on the server and do
  not move. With MDBList sync on, what was watched comes back by itself.
- The Hub page finds who has played something with one look per person, not a read of every play.
- The preview (`/?sample`) is the real site now, not a second copy of it: the same pages, asking a pretend hub kept in the
  browser instead of the network. Its data is recorded from the local test Worker (`npm run sample:record`), changes made
  in it are kept in that browser until Reset, and a person's own page opens from their link as it does for a manager. The
  test run fails when the recording no longer matches what the Worker answers.
- The README is one page, and the rest moved to `docs/`: Setting up, Updating, Settings, Features, How it works, Cost and
  limits, Working on it. What's new lives in this file.
- The two server settings are named for what they are: `AIOSTREAMS_ORIGIN` and `AIOMETADATA_ORIGIN`. The earlier names,
  `UP_ORIGIN` and `AIOM_ORIGIN`, still work.
- New setting `WEB_PLAYER`: where "Watch in a browser" on a person's Devices page goes, or `off` to hide it.
- The Hub page asks the database for far less each time it opens.
- The setup script stops instead of making a new `VAULT_KEY` when the site already has one, says which database it uses,
  and explains a failed step in plain words. It needs Node 22 or newer.
- A few addresses only the tests ask are closed on a real site.

## 2026-11-27

- Trakt shows someone as watching as soon as they start, not two minutes in. Something opened and closed within two
  minutes still never counts as watched: it ends on Trakt as paused, at the spot it had before where there was one.
- A start, pause or stop that Trakt turns away for being asked too often is sent again when the wait Trakt asked for ends,
  as the title is by then, and never a start after its stop. Several rows opening at once read the same Trakt list once.
- New, under Hub, General: "Call this address when Home changes". After a Home change has reached the apps, the hub sends
  one empty request to an address the manager entered, at most once every five minutes. Background work shows how the
  last one went.
- What you watched is one list for every row: your Trakt history, your MDBList and what you finished here, newest first, a
  title in more than one of them once. Recently Watched is that list, For you and Recommended go by it, and connecting Trakt
  no longer stops your MDBList from being read. "Watched here" means finished or ticked, never only begun.
- Up Next and New for you add what Trakt does not know of: with Trakt connected, a show you finished an episode of here
  while Trakt sync was off, or one only your MDBList has, comes after Trakt's own. Without Trakt, shows you watch on
  MDBList count as well as the ones you watch here.
- A row that leaves out what you watched lists nothing while one of your accounts has never answered, instead of listing
  titles you may have seen.
- The offer to add earlier plays to Trakt is checked first. It lists only what you finished, leaves out anything Trakt
  already has, and does not show while Trakt is not answering. Connecting the same Trakt account again no longer offers
  what Trakt was already told.
- Right after connecting Trakt, the Trakt row in Sync carries a Recommended tag until you turn it on. The separate box that
  asked the same thing is gone.
- A change that alters someone's rows (connecting or removing Trakt or an MDBList key, the Watchlist switch) reaches their
  apps within seconds with no page open, and a Home change left waiting is sent by the next background run or the one after,
  ahead of the other background work. Hub, General, Background work says when one is waiting and since when.
- The rows by service and by genre say what order they are in: most popular first.
- A new hub's Home starts in a new order: New for you (on) and the Watchlist, a For you row and the Recommended rows,
  Trending and a For you row, the rows by service and by genre, a For you row and the themed collections, Top Rated, then
  Recently Watched. Up Next and the Popular rows start off. A Home saved before is left as it is;
  `node scripts/default-home.mjs` prints the new default rows for bringing one to it by hand.
- Up Next and New for you work without Trakt. Up Next lists the shows you watch here that have a next episode out. New for
  you lists new episodes of those shows and of shows on your MDBList watchlist, and watchlist movies now out to stream. The
  hub checks what has come out once a day. With Trakt connected both rows follow Trakt, as before.
- My lists and Lists I liked hold your MDBList lists too, next to your Trakt ones, or by themselves without Trakt. They are
  read with your own MDBList key only.
- The rows by streaming service and by genre say what order their titles are in: each tile opens a public list, in that
  list's own order. Under a content limit a service tile shows the most popular on TMDB first.
- Unwatching something you had only marked as watched here removes just that one play from Trakt. A play Trakt had from
  before stays. Unwatching something you really played here still removes every play of it, as before. If Trakt does not
  answer when that one play is looked for, it is tried again like any other write, for up to a week.
- A For you row of a film series is named "More from" the series, since what is left may be an earlier film. It no longer
  lists a film you watched elsewhere after you mark something else unwatched.
- The Trakt card says plainly what connecting does for For you: it also learns from what you watched on Trakt. The MDBList
  card says the same of MDBList, which For you reads only while Trakt is not connected.
- Activity shows what happened: marking something watched and then unwatched leaves nothing on it. If you had really played the title, the play
  stays and a small line says it was marked unwatched.

## 2026-11-26

- Unwatch something in an app and, with Trakt sync on, its plays leave your Trakt history too (every play of that film or
  episode; a season or show is each of its episodes, up to 60). It stays unwatched here: older plays Trakt or MDBList still
  list are not brought back, and watching it again syncs as usual. Unwatching on Trakt's own site or apps does not reach
  the hub.
- Once a person has joined, their accounts are theirs alone: a manager sees whether Trakt and MDBList are connected, and
  can no longer connect or disconnect them. A manager can still remove the person.
- Home rows say where they come from by one rule: a row from your own account or watching has a pill ("Your Trakt",
  "What you've watched"), and a row from a public source names it after its kind ("Movies · TMDB"). The two rows of your
  Trakt lists are now called My lists and Lists I liked.
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

## 2026-11-25

- One switch syncs Trakt with your progress. It only adds, and a play you delete stays deleted. Plays from before you
  connected are added only if you agree.
- My Trakt lists: all of a person's Trakt lists as one Home row, with a pictured tile per list.
- Each For you row says why it was picked and offers the day's other options. You can keep a pick, or see less from a
  title or a kind of pick.
- For you also draws on older watching, and can offer something different from your usual genres.
- Add row groups its ready-made rows and marks what is already on Home.
- Rows that refresh on a schedule say when they were last filled and when they are next.
- Playback settings are a person's own to change by default. Their content limit stays the manager's unless opened up.

## 2026-11-24

- Activity shows which parts of a title were played, in the order watched, and tells a paused player from a playing one.
- Something opened and closed within two minutes is not counted as a watch and is not sent to Trakt.
- Each For you pick says what kind it is, and a person can add For you rows from their own page.
- A privacy page, and a clear notice about what connecting Trakt does.

## 2026-11-22 and 2026-11-23

- For you rows arrive: places on Home filled every day from what each person watches.
- Kids' Channels and Animation Studios collections, with a tile for each folder.
- Any row can be renamed.
- The site asks before removing a row, signing out a device, or disconnecting an account.

## 2026-11-20 and 2026-11-21

- Background work page: what the hub does by itself, when it last ran and when it runs next.
- Trakt sign-in happens from the person's own page.
- Recently Watched row, and a daily check that Trakt and MDBList agree on what was watched.
- Kids and Teens limits fill their rows with rated titles only, and Kids get the rows and folders made for children.
- A manager can open a person's page and see what they see.
- Activity keeps roughly where each play's device was.

## 2026-11-18 and 2026-11-19

- Each person's apps are served by their own AIOMetadata setup, with no one signed out by the move.
- The hub serves each person's Trakt rows itself.
- The hub has a name that apps and Trakt show.
- Quality choices (Data saver, Balanced, Best) pick streams by how heavy they are, with a size cap, and Data saver works
  at any resolution.
- A paused person sees a short, neutral message.

## 2026-11-17

- First release: hubs, groups and people on top of AIOStreams and AIOMetadata, with per-person Home, sign-in and history.
- Rename a signed-in device. Pause a whole group. Put groups in any order.
- Real posters on a person's own rows, and pictures on Activity.
