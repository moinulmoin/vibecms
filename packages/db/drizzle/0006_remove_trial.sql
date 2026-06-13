-- Remove the hosted free trial: hosted billing is now subscribe-to-publish only.
-- Normalize any legacy trialing rows to none so they must subscribe. The status
-- CHECK constraint keeps 'trialing' as a harmless superset value (never written
-- again) to avoid a SQLite table-recreate migration before launch.
UPDATE billing_customers SET status = 'none', updated_at = unixepoch() WHERE status = 'trialing';
