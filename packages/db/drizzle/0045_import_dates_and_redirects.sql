ALTER TABLE posts ADD COLUMN original_published_at INTEGER;

CREATE TABLE site_redirects (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_site_redirects_site_from ON site_redirects(site_id, from_path);
