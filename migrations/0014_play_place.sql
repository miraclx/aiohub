-- Roughly where the device was (city and country, and the network) when it last reported each play, as Cloudflare places it.
-- Filled on the writes note() already makes; rows from before stay empty. Shown on request under Activity. The address is not kept.
ALTER TABLE plays ADD COLUMN place TEXT;
ALTER TABLE plays ADD COLUMN net TEXT;
