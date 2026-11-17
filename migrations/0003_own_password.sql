-- Two passwords per person. `pass` is the one they choose for their page on this site: stored only as a hash, nobody can read it.
-- The player-app password stays in the vault: made by the hub, easy to type on a TV, shown under Devices, and replaceable at any time.
ALTER TABLE people ADD COLUMN pass TEXT NOT NULL DEFAULT '';
