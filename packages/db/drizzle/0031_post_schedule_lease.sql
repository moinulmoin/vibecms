-- 0030 is already applied on dev; the scheduler's lease token (which fences
-- stale workers out of publishing) arrives as its own migration.
ALTER TABLE post_schedules ADD COLUMN lease_token TEXT;
