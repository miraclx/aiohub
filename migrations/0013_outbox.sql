-- Calls to a person's Trakt that Trakt did not take at once (it turns away the shared addresses Workers send from for a while,
-- or has a fault), kept to try again: soon after, then every five minutes (see trakt.ts). body is what is sent: the title's
-- ids and how far in. made: when it happened. doubt: a refusal that may have got through (anything but a 429).
CREATE TABLE trakt_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, hub TEXT NOT NULL, person TEXT NOT NULL, item TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, made INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL, doubt INTEGER NOT NULL DEFAULT 0);
CREATE INDEX trakt_outbox_due ON trakt_outbox (next);
CREATE INDEX trakt_outbox_person ON trakt_outbox (hub, person, item);
-- The last list Trakt gave for each of a person's hub-served rows (rows.ts), so a row keeps its titles while Trakt is not answering.
CREATE TABLE rows_cache (hub TEXT NOT NULL, person TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, items TEXT NOT NULL, PRIMARY KEY (hub, person, kind));
