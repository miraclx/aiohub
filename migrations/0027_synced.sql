-- What a play the hub synced is called, so a person's own page can list what was synced ("Dune · Movie · added to Trakt"): the
-- `sent` ledger kept only a key and a time. Left empty for rows from before this, and for a play only noted as never to be sent
-- (one the other side already had, or could not take): those are not listed.
ALTER TABLE sent ADD COLUMN title TEXT;
ALTER TABLE sent ADD COLUMN detail TEXT;
-- For a play here that was sent to Trakt or MDBList: its id here (the `plays` row it came from), so the consent box can leave out
-- what was already sent when it lists what was watched here before connecting.
ALTER TABLE sent ADD COLUMN item TEXT;
-- The daily step that sends what was watched here and their MDBList lacks, for someone whose progress is kept in MDBList
-- (sync.ts, leftovers): the day it last looked (`lists_day`) and when it last finished a look (`lists_at`).
ALTER TABLE drift ADD COLUMN lists_day TEXT;
ALTER TABLE drift ADD COLUMN lists_at INTEGER;
