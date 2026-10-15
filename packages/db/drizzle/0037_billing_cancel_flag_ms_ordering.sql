-- Custom SQL migration file, put your code below! --
-- Billing launch correctness:
--   * cancel_at_period_end mirrors Polar's subscription flag. NULL = unknown
--     (no subscription webhook yet); checkout events never overwrite it.
--   * Webhook ordering keys move from epoch seconds to epoch milliseconds so
--     Polar's modified_at keeps its sub-second precision. Rows already in ms
--     (>= 1e11, i.e. after 1973 in ms / year 5138 in seconds) are left as-is,
--     so re-running the conversion is a no-op.
--   * past_due_since (epoch ms) starts only on an accepted status transition
--     into past_due. Repeated past_due preserves it, even when NULL.
--     No migration backfill: legacy timestamps may be subscription creation
--     times, not failure times. Unknown legacy starts grant no retroactive grace.
--   * subscription_updated_at separately orders subscription-only fields.
--     Existing rows inherit the converted status watermark.
--   * apply_nonce gates all billing writes on insertion of a new receipt.
--     Legacy receipts retain NULL, so redelivery cannot reapply billing.
-- current_period_end stays in epoch seconds.
ALTER TABLE billing_customers ADD COLUMN cancel_at_period_end INTEGER;

UPDATE billing_customers
  SET webhook_updated_at = webhook_updated_at * 1000
  WHERE webhook_updated_at IS NOT NULL AND webhook_updated_at < 100000000000;

UPDATE polar_webhook_receipts
  SET source_timestamp = source_timestamp * 1000
  WHERE source_timestamp < 100000000000;

ALTER TABLE billing_customers ADD COLUMN past_due_since INTEGER;
ALTER TABLE billing_customers ADD COLUMN subscription_updated_at INTEGER;
UPDATE billing_customers SET subscription_updated_at = webhook_updated_at;

ALTER TABLE polar_webhook_receipts ADD COLUMN apply_nonce TEXT;
