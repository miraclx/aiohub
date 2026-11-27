-- The address a hub calls after a Home change has reached the apps (worker/notice.ts): optional, one a hub, set by its manager.
-- The address itself is in the vault (secrets, kind 'key:notice'); here, per hub, only its host name (shown to the manager), when
-- it was last called, how that went ('ok', 'none' for no answer, or the status class: '3xx', '4xx', '5xx'), and whether a call
-- is wanted: 1 once a setup changed in a resend that has yet to finish, 2 once it finished and the call waits for its turn (at
-- most one every five minutes a hub). `retry` 1: the wanted call is the one second try after a call that failed.
CREATE TABLE notices (hub TEXT PRIMARY KEY, host TEXT NOT NULL, called INTEGER NOT NULL DEFAULT 0, result TEXT, wanted INTEGER NOT NULL DEFAULT 0, retry INTEGER NOT NULL DEFAULT 0);
