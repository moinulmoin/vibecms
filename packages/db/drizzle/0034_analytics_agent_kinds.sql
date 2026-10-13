-- Agent fetch analytics (plans/023): agent_fetch Analytics Engine points roll
-- up into four new kinds. SQLite can't alter a CHECK, so rebuild the table
-- like 0033's domains rebuild and copy every existing row (page/post/referrer/
-- crawler rows stay readable for days before agent collection shipped).
CREATE TABLE analytics_rollups_new (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granularity TEXT NOT NULL CHECK (granularity IN ('day', 'month')),
  period_start TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'post', 'referrer', 'crawler', 'agent', 'agent_category', 'agent_post', 'agent_resource')),
  dimension TEXT NOT NULL DEFAULT '',
  label TEXT,
  value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO analytics_rollups_new (id, site_id, granularity, period_start, kind, dimension, label, value, created_at, updated_at)
  SELECT id, site_id, granularity, period_start, kind, dimension, label, value, created_at, updated_at FROM analytics_rollups;
DROP TABLE analytics_rollups;
ALTER TABLE analytics_rollups_new RENAME TO analytics_rollups;
CREATE UNIQUE INDEX idx_analytics_rollups_unique
  ON analytics_rollups(site_id, granularity, period_start, kind, dimension);
CREATE INDEX idx_analytics_rollups_site_period
  ON analytics_rollups(site_id, granularity, period_start);
CREATE INDEX idx_analytics_rollups_site_kind
  ON analytics_rollups(site_id, kind, granularity, period_start);
