-- The Polar organization is shared with other products, and Polar keeps one
-- customer per email. One person may therefore pay for several blogs (each
-- blog its own subscription), so the column-level UNIQUE on polar_customer_id
-- is dropped. SQLite cannot drop a column constraint, so the table is rebuilt
-- with every column, default, check and foreign key unchanged. workspace_id
-- and polar_subscription_id stay unique: one billing row per workspace, and
-- one subscription pays for one blog.
CREATE TABLE billing_customers_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  polar_customer_id TEXT,
  polar_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'none')) DEFAULT 'none',
  current_period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  webhook_event_id TEXT,
  webhook_updated_at INTEGER,
  cancel_at_period_end INTEGER,
  past_due_since INTEGER,
  subscription_updated_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
INSERT INTO billing_customers_new (
  id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end,
  created_at, updated_at, webhook_event_id, webhook_updated_at, cancel_at_period_end,
  past_due_since, subscription_updated_at
)
  SELECT id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end,
         created_at, updated_at, webhook_event_id, webhook_updated_at, cancel_at_period_end,
         past_due_since, subscription_updated_at
  FROM billing_customers;
DROP TABLE billing_customers;
ALTER TABLE billing_customers_new RENAME TO billing_customers;

-- A second vibecms subscription for a blog that already has a live one (two
-- checkouts paid, for example monthly and yearly in two tabs). It is not
-- applied: the blog stays on the kept subscription, and the founder refunds
-- and revokes the duplicate by hand from these Polar ids. payment_evidence is
-- 1 once an event proved it was paid; only those rows owe the refund notice.
-- notified_at stays NULL until that notice mail was accepted, so a lost notice
-- is sent again. The record survives the blog's own rows.
CREATE TABLE polar_duplicate_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kept_subscription_id TEXT NOT NULL,
  polar_customer_id TEXT,
  polar_checkout_id TEXT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_evidence INTEGER NOT NULL DEFAULT 0,
  notified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_polar_duplicate_subscriptions_workspace
  ON polar_duplicate_subscriptions(workspace_id);

CREATE INDEX idx_polar_duplicate_subscriptions_created
  ON polar_duplicate_subscriptions(created_at);
