CREATE TABLE IF NOT EXISTS polar_webhook_receipts (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_timestamp INTEGER NOT NULL,
  applied_status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_polar_webhook_receipts_workspace_ts
  ON polar_webhook_receipts (workspace_id, source_timestamp DESC);
