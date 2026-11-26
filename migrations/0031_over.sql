-- A file that runs longer than its listing (worker/front.ts, note): a cartoon episode listed at 11 minutes whose file holds two
-- segments. `over`: the furthest second any report of this title reached, for this person on this hub, kept from the first report
-- that passed the listed length by more than a margin (util.ts, pastListed) and moved on as later reports go further; 0 while no
-- report has (the listing is taken as right). The listed `duration` stays as it was: Trakt's idea of the episode rests on it.
ALTER TABLE plays ADD COLUMN over INTEGER NOT NULL DEFAULT 0;
-- `reached`: the title's `over` as it stood when this sitting began, so only what EARLIER sittings reached says where the end is
-- (the first sitting to pass the listed length cannot know). 0 for a title not known to run longer then.
ALTER TABLE sittings ADD COLUMN reached INTEGER NOT NULL DEFAULT 0;
