-- Domain claims (plans/022 squatting fix): a pending subpath claim must not
-- squat a hostname forever. The column-level UNIQUE on hostname is dropped and
-- replaced by two PARTIAL unique indexes:
--   * non-subpath rows (default/custom) still own their hostname exclusively
--   * at most one ACTIVE subpath row per hostname — one verified path blog
-- Pending/failed subpath claims for the same hostname may coexist across sites;
-- only a passing setup check (proof of proxy control) activates one.
-- activated_at records when a subpath row first verified; NULL means the row
-- was never live, which is what the cron's stale-claim pruning keys on.
CREATE TABLE domains_new (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('default', 'custom', 'subpath')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'disabled')) DEFAULT 'pending',
  cloudflare_custom_hostname_id TEXT,
  base_path TEXT,
  proxy_id TEXT,
  activated_at INTEGER,
  verification_errors_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
INSERT INTO domains_new (id, site_id, hostname, type, status, cloudflare_custom_hostname_id, base_path, proxy_id, activated_at, verification_errors_json, created_at, updated_at)
  SELECT id, site_id, hostname, type, status, cloudflare_custom_hostname_id, base_path, proxy_id,
         CASE WHEN type = 'subpath' AND status = 'active' THEN updated_at ELSE NULL END,
         verification_errors_json, created_at, updated_at FROM domains;
DROP TABLE domains;
ALTER TABLE domains_new RENAME TO domains;
CREATE INDEX idx_domains_hostname ON domains(hostname);
CREATE INDEX idx_domains_site_id ON domains(site_id);
CREATE UNIQUE INDEX idx_domains_proxy_id ON domains(proxy_id);
CREATE UNIQUE INDEX idx_domains_hostname_exclusive ON domains(hostname) WHERE type != 'subpath';
CREATE UNIQUE INDEX idx_domains_subpath_active ON domains(hostname) WHERE type = 'subpath' AND status = 'active';
