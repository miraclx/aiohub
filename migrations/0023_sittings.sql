-- Activity: one row each time someone sits down to watch a title, so watching it again later shows as its own play. A sitting
-- ends once the player has been quiet for half an hour (stopped or not); another device has its own. Jumps, or stopping and
-- starting again a minute later, stay the same sitting. Each has its own parts played, pauses and time paused, and where it was last reported from. `plays` stays the latest state
-- per person and title (Trakt, For you, Recently Watched read it); titles, pictures and lengths are read from there.
-- Sittings not heard from in 180 days are dropped.
CREATE TABLE sittings (hub TEXT NOT NULL, person TEXT NOT NULL, item TEXT NOT NULL, started INTEGER NOT NULL, device TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, playing INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, since INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, place TEXT, net TEXT, parts TEXT NOT NULL DEFAULT '', pauses INTEGER NOT NULL DEFAULT 0, idle INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hub, person, item, started));
CREATE INDEX sittings_recent ON sittings (hub, updated);
-- What was watched before: one sitting per title, as last noted, so Activity keeps showing it.
INSERT INTO sittings (hub, person, item, started, device, position, playing, paused, since, updated, place, net, parts, pauses, idle)
  SELECT hub, person, item, CASE WHEN since > 0 THEN min(since, updated) ELSE updated END, device, position, playing, paused, since, updated, place, net, parts, pauses, idle FROM plays;
