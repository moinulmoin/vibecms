-- The failed-payment emails of one past-due episode: days 1, 3 and 6 of the
-- 7-day grace, because Polar's own failed-payment email is off for the whole
-- organization. One row per email, keyed by the episode's past_due_since, is
-- claimed before the send, so a repeated sweep never sends it twice and a new
-- episode starts its own rows.
CREATE TABLE billing_payment_reminders (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  past_due_since INTEGER NOT NULL,
  day INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, past_due_since, day)
);
