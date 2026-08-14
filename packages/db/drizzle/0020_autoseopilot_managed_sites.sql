CREATE TABLE autoseopilot_managed_sites (
  id TEXT PRIMARY KEY,
  external_workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  credential_generation INTEGER NOT NULL CHECK (credential_generation > 0),
  api_key_id TEXT NOT NULL,
  entitlement_status TEXT NOT NULL CHECK (entitlement_status IN ('active', 'revoked')),
  entitlement_expires_at INTEGER,
  lifecycle_revision INTEGER NOT NULL CHECK (lifecycle_revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (
    (entitlement_status = 'active' AND revoked_at IS NULL)
    OR (entitlement_status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE RESTRICT,
  UNIQUE (external_workspace_id),
  UNIQUE (workspace_id),
  UNIQUE (site_id),
  UNIQUE (api_key_id),
  UNIQUE (credential_id, credential_generation)
);

CREATE INDEX idx_autoseopilot_managed_owner_user
  ON autoseopilot_managed_sites(owner_user_id);
