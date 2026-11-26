-- A title's file asked for by a player app: what a download looks like from here (front.ts, fetched). Every play asks for the file
-- too, so a row only reads as a download on Activity when no sitting of that person with the title goes with it (api.ts), or when
-- the app used the download address itself (`asked`). One row per person, title and device: asked again within half an hour is the
-- same fetch (`last` moves), later is a new one (`at` moves too). `item` is the title's id in lower case with no dashes, as apps
-- send either form.
CREATE TABLE fetches (hub TEXT NOT NULL, person TEXT NOT NULL, item TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, last INTEGER NOT NULL,
  title TEXT, detail TEXT, art TEXT, asked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hub, person, item, device));
CREATE INDEX fetches_recent ON fetches (hub, last);
