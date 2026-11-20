-- What was watched here and is not in MDBList yet (carry.ts's plan), kept a few hours per person so opening the page again does
-- not ask MDBList again. Filled when the person's own Accounts page asks for it.
ALTER TABLE drift ADD COLUMN here TEXT;
ALTER TABLE drift ADD COLUMN here_at INTEGER;
