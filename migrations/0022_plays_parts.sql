-- Activity: which parts of a title were played, merged, as seconds ("0-1310 1500-2008"); repeats are not counted. How many
-- times it was paused, and for how long in all (seconds). Kept on the row each report already rewrites; started over on a rewatch.
ALTER TABLE plays ADD COLUMN parts TEXT NOT NULL DEFAULT '';
ALTER TABLE plays ADD COLUMN pauses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plays ADD COLUMN idle INTEGER NOT NULL DEFAULT 0;
-- For a week only, to learn what player apps send: the field names (never values) seen in their playback reports, per hub, app
-- and kind of report, with only EventName and PlayMethod spelled out. Written when a running copy first sees a shape.
-- Temporary: drop it in a later migration once read (see HEARD_UNTIL in worker/front.ts).
CREATE TABLE heard_fields (hub TEXT NOT NULL, app TEXT NOT NULL, kind TEXT NOT NULL, sig TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (hub, app, kind, sig));
