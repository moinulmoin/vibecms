CREATE TABLE post_preview_tokens (
  post_id text PRIMARY KEY NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at integer NOT NULL
);
CREATE INDEX idx_post_preview_tokens_site_hash ON post_preview_tokens(site_id, token_hash);

CREATE TABLE post_schedules (
  post_id text PRIMARY KEY NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  publish_at integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  scheduled_by_type text NOT NULL,
  scheduled_by_id text NOT NULL,
  scheduled_by_name text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX idx_post_schedules_due ON post_schedules(status, publish_at);
