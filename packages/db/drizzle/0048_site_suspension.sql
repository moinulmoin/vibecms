-- Operator abuse suspension (docs/blog-suspension.md). NULL = not suspended.
-- While set, every public address serves the paused page and publish,
-- schedule and upload are refused. Nothing is deleted; clearing it restores
-- the blog. Unrelated to the AutoSEOPilot managed claim clock.
ALTER TABLE sites ADD COLUMN suspended_at INTEGER;
-- Why, in words the owner reads in the suspension email (the terms promise
-- to say why).
ALTER TABLE sites ADD COLUMN suspension_reason TEXT;
-- When the owner's one suspension email went out; cleared with the suspension.
ALTER TABLE sites ADD COLUMN suspension_notified_at INTEGER;
