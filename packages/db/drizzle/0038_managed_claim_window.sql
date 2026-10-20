-- Claim window ("keep your blog") for AutoSEOPilot-managed sites.
-- Day 0 = revoked_at. Reminders fire on the daily sweep at days 7/14/21/28,
-- each guarded by its own durable sent marker; the sweep purges unclaimed
-- blogs at day 30. Never edit 0020; this only adds columns and an index.

ALTER TABLE autoseopilot_managed_sites ADD COLUMN claim_day7_sent_at INTEGER;
ALTER TABLE autoseopilot_managed_sites ADD COLUMN claim_day14_sent_at INTEGER;
ALTER TABLE autoseopilot_managed_sites ADD COLUMN claim_day21_sent_at INTEGER;
ALTER TABLE autoseopilot_managed_sites ADD COLUMN claim_day28_sent_at INTEGER;

CREATE INDEX idx_autoseopilot_managed_claim_sweep
  ON autoseopilot_managed_sites(entitlement_status, revoked_at);
