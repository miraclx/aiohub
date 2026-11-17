-- A passkey for a manager account: the credential id the browser gives, and the public key its signatures are checked against.
CREATE TABLE passkeys (id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, alg INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX passkeys_account ON passkeys (account);
