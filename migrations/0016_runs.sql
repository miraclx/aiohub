-- When the five-minute cron last ran and how many times it has, for the Hub page (index.ts). One row per job.
CREATE TABLE runs (job TEXT PRIMARY KEY, at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0);
