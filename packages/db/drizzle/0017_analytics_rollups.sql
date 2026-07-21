CREATE TABLE analytics_rollups (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granularity TEXT NOT NULL CHECK (granularity IN ('day', 'month')),
  period_start TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'post', 'referrer', 'crawler')),
  dimension TEXT NOT NULL DEFAULT '',
  label TEXT,
  value INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_analytics_rollups_unique
  ON analytics_rollups(site_id, granularity, period_start, kind, dimension);
CREATE INDEX idx_analytics_rollups_site_period
  ON analytics_rollups(site_id, granularity, period_start);
CREATE INDEX idx_analytics_rollups_site_kind
  ON analytics_rollups(site_id, kind, granularity, period_start);

CREATE TABLE analytics_rollup_state (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  last_rolled_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
