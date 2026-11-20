-- Plays a person marked as not right in the Trakt/MDBList note (drift.ts): left out of the note and of Fix from then on.
ALTER TABLE drift ADD COLUMN skipped TEXT;
