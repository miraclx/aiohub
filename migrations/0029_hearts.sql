-- "Show my Trakt watchlist as Favorites in the apps" (worker/hearts.ts), a person's own choice, off until they turn it on: a row
-- here is the switch being on. `checked`: when the cron last looked at them (0: due at once); `good`: when a look last went well.
CREATE TABLE favs (hub TEXT NOT NULL, person TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, good INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hub, person));
-- The ledger of hearts, one row per person and title (`key`: movie or series, then its IMDb id, else tmdb:<id>). `state` says who
-- made the heart and what became of it: 'hub' (the hub hearted it on their server, from their Trakt watchlist), 'own' (theirs: one
-- they had already, or made in an app, which the hub passed on to Trakt as a watchlist add), 'gone' (they took it away in an app,
-- which the hub passed on to Trakt as a watchlist remove), 'left' (the hub took its own heart away after the title left the
-- watchlist), 'miss' (their server does not have the title). `listed`: Trakt's listed_at the row was made for, or when the app
-- hearted or un-hearted: a title is hearted again only when Trakt lists it later than this. `item`: its id on their server.
CREATE TABLE hearts (hub TEXT NOT NULL, person TEXT NOT NULL, key TEXT NOT NULL, item TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, listed INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (hub, person, key));
