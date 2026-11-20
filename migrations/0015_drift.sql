-- The daily look at whether a person's Trakt and MDBList agree on the last two weeks of watching (drift.ts). One row per person:
-- the day it last ran, the reading in hand while it runs over a few cron runs, and what differed (titles and dates only).
CREATE TABLE drift (hub TEXT NOT NULL, person TEXT NOT NULL, day TEXT NOT NULL, work TEXT, result TEXT, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hub, person));
