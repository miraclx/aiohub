-- When counting the cron's runs began, so the Hub page can say "since". A row from before restarts its count at its next run.
ALTER TABLE runs ADD COLUMN since INTEGER;
