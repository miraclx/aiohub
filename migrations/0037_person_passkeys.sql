-- A passkey of an invited person's, for their own page on the site: the id the browser gives it, and the public key its
-- signatures are checked against. Kept by hub and person, apart from the manager's (passkeys), so one can never open the other's.
CREATE TABLE person_passkeys (id TEXT PRIMARY KEY, hub TEXT NOT NULL, person TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, alg INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX person_passkeys_person ON person_passkeys (hub, person);
