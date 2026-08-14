-- Remove the hosted free trial: hosted billing is now subscribe-to-publish only.
-- Normalize trialing rows to none so they must subscribe.
UPDATE billing_customers SET status = 'none', updated_at = unixepoch() WHERE status = 'trialing';
