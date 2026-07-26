CREATE TABLE pending_media_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('upload_cleanup', 'delete')),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_pending_media_ops_created ON pending_media_operations(created_at);
CREATE INDEX idx_pending_media_ops_claimed ON pending_media_operations(claimed_at);
