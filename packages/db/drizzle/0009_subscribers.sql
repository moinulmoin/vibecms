-- Subscriber capture table for audience building. Stores pending and confirmed
-- email subscribers per site with consent provenance and idempotency on (site_id, email).
CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  confirmed_at INTEGER,
  provider_id TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_subscribers_site_email ON subscribers(site_id, email);
CREATE INDEX idx_subscribers_site_id ON subscribers(site_id);
