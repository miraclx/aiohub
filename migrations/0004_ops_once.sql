-- One setup step per hub and target at a time: the row is claimed before anything is created on the streaming server,
-- so two requests can never both create, and a step that never answered stays visible instead of being retried blindly.
CREATE UNIQUE INDEX ops_once ON ops (hub, kind, target);
