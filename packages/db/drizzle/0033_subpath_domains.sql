-- Subpath hosting (plans/022): a blog served at a path on the customer's own
-- site (customer.com/blog). The domains.type CHECK must widen to include
-- 'subpath', and SQLite can't alter a CHECK — so rebuild the table like
-- 0030's site_voice_profiles rebuild. proxy_id is rotatable and non-guessable;
-- NULLs are exempt from the UNIQUE index, so default/custom rows are unaffected.
CREATE TABLE domains_new (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('default', 'custom', 'subpath')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'disabled')) DEFAULT 'pending',
  cloudflare_custom_hostname_id TEXT,
  base_path TEXT,
  proxy_id TEXT,
  verification_errors_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
INSERT INTO domains_new (id, site_id, hostname, type, status, cloudflare_custom_hostname_id, base_path, proxy_id, verification_errors_json, created_at, updated_at)
  SELECT id, site_id, hostname, type, status, cloudflare_custom_hostname_id, NULL, NULL, verification_errors_json, created_at, updated_at FROM domains;
DROP TABLE domains;
ALTER TABLE domains_new RENAME TO domains;
CREATE INDEX idx_domains_hostname ON domains(hostname);
-- idx_domains_site_id was declared in the Drizzle schema since 0001 but never
-- shipped in a migration; recreate it here so the schema and the database agree.
CREATE INDEX idx_domains_site_id ON domains(site_id);
CREATE UNIQUE INDEX idx_domains_proxy_id ON domains(proxy_id);
