-- Favorites in step with the Trakt watchlist (worker/hearts.ts). `seen`: the hub itself saw this title on their Trakt watchlist
-- (it hearted it from there, or found it hearted while Trakt listed it). Only such a heart is taken away when the title leaves the
-- watchlist: one that was never seen there is never touched. A heart the hub made was on the list by definition.
ALTER TABLE hearts ADD COLUMN seen INTEGER NOT NULL DEFAULT 0;
UPDATE hearts SET seen = 1 WHERE state = 'hub';
-- Hearts on their own server that their Trakt watchlist lacks and the hub never dealt with, counted by the cron step now and then
-- (`found`: a short list of them as JSON, `found_at`: when it was last counted), so their own page can offer once to add them.
ALTER TABLE favs ADD COLUMN found TEXT;
ALTER TABLE favs ADD COLUMN found_at INTEGER NOT NULL DEFAULT 0;
-- What they watched here before turning Trakt sync on, offered once on their own page: "Not now" is kept as the moment sync was
-- turned on that it was said for (trakt.ts, `on`), so the same plays are not offered again; turned on anew later, they are.
ALTER TABLE sync ADD COLUMN passed INTEGER;
