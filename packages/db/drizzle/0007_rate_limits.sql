-- Durable, workspace-independent rate limiting for pre-auth actions (e.g. OTP email
-- sends). Keyed by an opaque id such as "otp-send:<email>:<hour>". expires_at lets us
-- prune old buckets so the table does not grow unbounded. Lives outside usage_counters
-- because that table's workspace_id is a NOT NULL FK and OTP sends happen pre-auth.
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_expires ON rate_limits (expires_at);
