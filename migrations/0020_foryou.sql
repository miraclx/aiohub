-- "For you": what the daily job picked for each person's For you places on Home (foryou.ts). One row per person: the day it
-- last picked, what the picks were worked out from (`sig`: content limit, muted kinds, places on), the picks by place, and the
-- day before's picks, so the same one is not picked two days running.
CREATE TABLE foryou (hub TEXT NOT NULL, person TEXT NOT NULL, day TEXT NOT NULL, sig TEXT NOT NULL DEFAULT '', picks TEXT NOT NULL DEFAULT '{}', before TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hub, person));
-- A hub whose people's picks changed and whose player setups still need bringing in step, by a cron run of its own.
CREATE TABLE foryou_sync (hub TEXT PRIMARY KEY, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
