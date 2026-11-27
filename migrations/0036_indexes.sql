-- The Hub page and the cron ask for cached rows and stored keys by what they are (kind) across a hub or the whole site. The
-- primary keys lead with (hub, person) and (hub, owner), so each of those questions read every row the hub had.
-- Neither index holds a column that changes when a row is refreshed, so only a new or removed row writes to it.
CREATE INDEX IF NOT EXISTS rows_cache_kind ON rows_cache (kind, hub);
CREATE INDEX IF NOT EXISTS secrets_kind ON secrets (kind, hub, owner);
