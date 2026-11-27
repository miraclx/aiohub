-- A start now goes to Trakt as soon as a title starts (front.ts, scrobble), where it used to be held until two minutes had played.
-- A start sent over a title Trakt had counted as watched keeps when that was (`scrobbled_was`, else NULL): if the sitting ends
-- with too little played to count, the title is put back as watched then, so a tick straight after is still no second play.
ALTER TABLE plays ADD COLUMN scrobbled_was INTEGER;
