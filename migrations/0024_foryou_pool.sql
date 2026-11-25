-- For you (foryou.ts): the day's other options for each person, kept by the daily pick so a For you row can change to one at
-- once without asking TMDB again, with the kinds that had nothing today and why (`pool`). And the titles they asked never to
-- be picked from again (`never`, a short list, newest first), written only from their Home, never by the daily pick.
ALTER TABLE foryou ADD COLUMN pool TEXT NOT NULL DEFAULT '{}';
ALTER TABLE foryou ADD COLUMN never TEXT NOT NULL DEFAULT '[]';
