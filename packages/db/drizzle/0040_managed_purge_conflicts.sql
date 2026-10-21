-- Money safety for the claim window ("keep your blog").
--
-- Two edges are closed here:
--
-- 1. A claim checkout blocks the purge of its blog for 48 hours, counted
--    from the moment the checkout was opened, whether the checkout is still
--    open or already resolved. Polar's checkout expiry plus a delayed
--    webhook can land anywhere in that window, and a customer charged for a
--    deleted blog is far worse than a purge that runs two days late.
--    guard_until carries that horizon; resolved_at records that the webhook
--    landed without releasing the guard.
--
-- 2. A paid Polar event for a blog that is being purged, or has already been
--    purged, is recorded and alerted instead of being dropped. The finished
--    purge keeps its intent row (completed_at) as the durable trace that the
--    blog is gone, so a late webhook is recognised rather than turning a
--    deleted blog into a paid workspace with no notice.

ALTER TABLE autoseopilot_claim_checkouts
  ADD COLUMN guard_until INTEGER NOT NULL DEFAULT 0;

ALTER TABLE autoseopilot_claim_checkouts
  ADD COLUMN resolved_at INTEGER;

-- The attempts that already existed get the same 48-hour guard as the new
-- ones, counted from the moment they were opened.
UPDATE autoseopilot_claim_checkouts
  SET guard_until = created_at + 172800
  WHERE guard_until = 0;

ALTER TABLE autoseopilot_purge_intents
  ADD COLUMN completed_at INTEGER;

-- When the daily sweep last tried to act on a blog. A blog it cannot delete
-- yet rotates to the back of the queue, so it never takes the slot of a blog
-- that is still waiting for its reminder.
ALTER TABLE autoseopilot_managed_sites
  ADD COLUMN last_sweep_attempt_at INTEGER;

-- The operator record of a paid event that arrived too late. The founder
-- refunds by hand from the Polar ids here. notified_at stays NULL until the
-- mail that asks for the refund was accepted, so a lost notice is retried.
CREATE TABLE autoseopilot_purge_conflicts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT,
  polar_customer_id TEXT,
  polar_subscription_id TEXT,
  polar_order_id TEXT,
  polar_checkout_id TEXT,
  event_id TEXT,
  event_type TEXT,
  applied_status TEXT,
  notified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_autoseopilot_purge_conflicts_workspace
  ON autoseopilot_purge_conflicts(workspace_id);

CREATE INDEX idx_autoseopilot_purge_conflicts_created
  ON autoseopilot_purge_conflicts(created_at);
