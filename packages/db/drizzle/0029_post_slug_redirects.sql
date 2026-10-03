CREATE TABLE post_slug_redirects (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_slug TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_post_slug_redirects_site_slug ON post_slug_redirects(site_id, from_slug);
CREATE INDEX idx_post_slug_redirects_post_id ON post_slug_redirects(post_id);
