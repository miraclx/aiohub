-- A title marked unwatched in an app (worker/front.ts, unmarked): when, for this person on this hub; 0 while it is not. From then
-- the hub's own record no longer counts it as watched (Recently Watched, the earlier plays offered for Trakt, For you), until it
-- is played or ticked here again, which sets it back to 0. The sittings stay as they were: Activity still says what was played.
ALTER TABLE plays ADD COLUMN unwatched INTEGER NOT NULL DEFAULT 0;
