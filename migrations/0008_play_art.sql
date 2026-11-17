-- Which item's picture stands for a play: the show's for an episode, the title's own otherwise. Shown through the hub's address.
ALTER TABLE plays ADD COLUMN art TEXT NOT NULL DEFAULT '';
