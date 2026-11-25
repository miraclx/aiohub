-- Keeping a person's Trakt and their progress matching (sync.ts). One row per person, made only when they answer for themselves
-- on their own page: `matching` (on or off) and `earlier` (whether what they watched here before connecting may go to Trakt too).
-- Then how the cron's matching stands: Trakt's last-activity stamps at the last good pass (`stamps`), when it last looked
-- (`checked`), the last good pass (`good`), since when it has been failing and why (`failing`, `why`: words the page shows), the
-- day of the last daily look for someone whose progress is kept here (`day`) and the stamps at the last daily look (`daily`).
CREATE TABLE sync (hub TEXT NOT NULL, person TEXT NOT NULL, matching INTEGER NOT NULL DEFAULT 0, earlier INTEGER NOT NULL DEFAULT 0, stamps TEXT, checked INTEGER NOT NULL DEFAULT 0,
  good INTEGER NOT NULL DEFAULT 0, failing INTEGER, why TEXT, day TEXT NOT NULL DEFAULT '', daily TEXT, PRIMARY KEY (hub, person));
-- What the hub copied to one of a person's places for them (`place`: trakt, here or mdblist), each play once: it is never sent
-- there again, so a play they deleted there stays deleted. `play` is the title or episode, and for a paused spot or a dated play,
-- its date. `at`: when it was sent. Kept through a Trakt disconnect, so connecting again sends nothing twice.
CREATE TABLE sent (hub TEXT NOT NULL, person TEXT NOT NULL, place TEXT NOT NULL, play TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (hub, person, place, play));
-- When the daily look's differences were last copied across by themselves (drift.ts, for someone keeping Trakt matching).
ALTER TABLE drift ADD COLUMN fixed INTEGER;
-- Since when the daily look (or what it found, copied across) has kept failing for someone keeping Trakt matching, and why in
-- words the page shows: their page says so after three days. Cleared by the next look or copy that works.
ALTER TABLE drift ADD COLUMN failing INTEGER;
ALTER TABLE drift ADD COLUMN why TEXT;
