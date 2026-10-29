-- Per-key minute counters share workspace/site/period/metric but have distinct
-- ids. The original composite UNIQUE rejects a second agent key on the same
-- site in the same minute, even though all counter upserts target id.
-- Rebuild without that constraint, preserving every column and cascade; retain
-- a non-unique composite index for workspace/site lookups and workspace cleanup.
CREATE TABLE usage_counters_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
INSERT INTO usage_counters_new (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
  SELECT id, workspace_id, site_id, period, metric, value, created_at, updated_at FROM usage_counters;
DROP TABLE usage_counters;
ALTER TABLE usage_counters_new RENAME TO usage_counters;
CREATE INDEX idx_usage_workspace_site_period_metric ON usage_counters(workspace_id, site_id, period, metric);
