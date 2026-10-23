-- Commit each day's data and its continuation cursor in one D1 batch.
ALTER TABLE analytics_rollup_state ADD COLUMN next_source_date TEXT;
ALTER TABLE analytics_rollup_state ADD COLUMN refreshed_through TEXT;
