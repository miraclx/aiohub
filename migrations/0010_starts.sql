-- One line each time a player reports that it started playing something: who, what, on which device, when. Small on purpose;
-- it is what lets Activity say how often and at what time of day people watch. Lines older than 180 days are dropped.
CREATE TABLE starts (hub TEXT NOT NULL, person TEXT NOT NULL, item TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
CREATE INDEX starts_recent ON starts (hub, at);
