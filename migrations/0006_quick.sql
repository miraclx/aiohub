-- Quick Connect, kept by the hub itself: a TV asks for a code, someone signed in on the site types it, the TV is let in as them.
-- A request lives ten minutes. `secret` is the hash of what only the TV holds.
CREATE TABLE quick (secret TEXT PRIMARY KEY, hub TEXT NOT NULL, code TEXT NOT NULL, person TEXT, device TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
CREATE INDEX quick_code ON quick (hub, code);
