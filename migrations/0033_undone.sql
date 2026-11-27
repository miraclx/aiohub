-- Activity shows what happened, and an undo leaves no trace of what it undid. A title marked unwatched in an app (front.ts,
-- unmarked) loses the ticks it had here: a sitting that was only a tick goes, and one that was a play keeps its parts without
-- the tick. Where the title was really played, the un-mark is its own quiet line: a sitting with `undone` 1 (its device and
-- time, nothing played). Such a line is never carried on by a later play, and counts as no watch anywhere.
ALTER TABLE sittings ADD COLUMN undone INTEGER NOT NULL DEFAULT 0;
