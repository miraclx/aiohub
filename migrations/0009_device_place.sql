-- Roughly where each signed-in app was last seen from (city and country) and on which network, as Cloudflare reports it.
-- Kept so a manager can tell when one profile is used from places it should not be. The address itself is not kept.
ALTER TABLE devices ADD COLUMN place TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN net TEXT NOT NULL DEFAULT '';
