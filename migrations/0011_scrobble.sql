-- Sending plays to a person's own Trakt as they happen. ids: what Trakt knows the title by, looked up once ('' when it has
-- nothing usable). scrobbled: what Trakt was last told ('playing', 'paused' or 'stopped'), so a player that goes quiet without
-- saying stop can be stopped for it later.
ALTER TABLE plays ADD COLUMN ids TEXT;
ALTER TABLE plays ADD COLUMN scrobbled TEXT;
ALTER TABLE plays ADD COLUMN scrobbled_at INTEGER;
CREATE INDEX plays_scrobbled ON plays (scrobbled, updated) WHERE scrobbled IN ('playing', 'paused');
