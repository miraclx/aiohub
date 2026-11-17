-- What each person last watched, as their player reported it through the hub's address: one row per person and title, updated
-- as they go. It is the latest state, not a log of every play. Titles come from AIOStreams at the moment of playing.
CREATE TABLE plays (hub TEXT NOT NULL, person TEXT NOT NULL, item TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, duration INTEGER NOT NULL DEFAULT 0, device TEXT NOT NULL DEFAULT '', playing INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY (hub, person, item));
CREATE INDEX plays_recent ON plays (hub, updated DESC);
