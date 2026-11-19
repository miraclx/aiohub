-- Each person whose Trakt is connected to the hub gets their own rows address, which their AIOMetadata setup reads their Trakt
-- rows from. The address carries a random token, kept in the vault ('rows'); this table holds only its hash, to find whose it is.
CREATE TABLE rows_keys (id TEXT PRIMARY KEY, hub TEXT NOT NULL, person TEXT NOT NULL);
CREATE INDEX rows_keys_person ON rows_keys (hub, person);
