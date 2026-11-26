-- For you after a finished watch (foryou.ts, finished): the titles a person finished lately, each counted once (`seen`), since when
-- one waits to be picked from (`due`), and when a row was picked again for one (`at`), so it happens only a few times a day.
ALTER TABLE foryou ADD COLUMN fresh TEXT NOT NULL DEFAULT '{}';
