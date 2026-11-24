-- Activity: whether a play is paused, and since when it has been in its current state (playing since, paused at, stopped at).
-- `updated` stays the last time the player was heard from, so a paused player left open is told apart from one gone quiet.
ALTER TABLE plays ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plays ADD COLUMN since INTEGER NOT NULL DEFAULT 0;
