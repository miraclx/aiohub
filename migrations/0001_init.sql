-- AIOHub (rebuild). Who can sign in, what they set, and the references needed to reach AIOStreams/AIOMetadata.
-- Media, history and catalogs stay in AIOStreams/AIOMetadata. Nothing secret is stored outside `secrets`, and that is encrypted.
CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass TEXT NOT NULL, recovery TEXT NOT NULL DEFAULT '[]', theme TEXT NOT NULL DEFAULT 'dark', created INTEGER NOT NULL);
-- A browser session on the site: a manager (account) or an invited person (hub + person).
CREATE TABLE sessions (id TEXT PRIMARY KEY, account TEXT, hub TEXT, person TEXT, expires INTEGER NOT NULL);
CREATE TABLE hubs (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, owner TEXT NOT NULL UNIQUE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE groups (hub TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, PRIMARY KEY (hub, id));
-- id doubles as the username typed into a player app; unique inside a hub. jf is the user id the apps see.
CREATE TABLE people (hub TEXT NOT NULL, id TEXT NOT NULL, grp TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, joined INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, jf TEXT NOT NULL UNIQUE, invite TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, PRIMARY KEY (hub, id));
-- Encrypted records: a person's sign-in, their upstream sign-in, their invite link, a hub's debrid keys.
CREATE TABLE secrets (hub TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (hub, owner, kind));
-- One row per signed-in app. id is the hash of the token the app holds; ref is what the site shows and revokes by.
CREATE TABLE devices (id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, hub TEXT NOT NULL, person TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', seen INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX devices_person ON devices (hub, person);
CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
-- Written before anything is created or changed in AIOStreams/AIOMetadata, so a half-finished step can be found and finished.
CREATE TABLE ops (id INTEGER PRIMARY KEY AUTOINCREMENT, hub TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, updated INTEGER NOT NULL);
