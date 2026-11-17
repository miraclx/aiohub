-- A person signs in to player apps with their own name. `login` is that name with capitals, spaces and punctuation flattened,
-- so "Mary Jane", "mary jane" and "MARY-JANE" are the same person, and no two people in a hub can share it.
ALTER TABLE people ADD COLUMN login TEXT NOT NULL DEFAULT '';
UPDATE people SET login = id;
CREATE UNIQUE INDEX people_login ON people (hub, login);
