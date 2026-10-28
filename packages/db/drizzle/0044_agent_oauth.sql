CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY NOT NULL,
  registration TEXT NOT NULL CHECK (registration IN ('dcr', 'cimd')),
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  metadata_fetched_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE api_keys ADD COLUMN oauth_client_id TEXT REFERENCES oauth_clients(id) ON DELETE CASCADE;
CREATE INDEX idx_api_keys_oauth_client ON api_keys(oauth_client_id);

CREATE TABLE oauth_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'exchanged')),
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  api_key_id TEXT REFERENCES api_keys(id) ON DELETE CASCADE,
  code_hash TEXT UNIQUE,
  code_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_authorizations_expires ON oauth_authorizations(expires_at);
CREATE INDEX idx_oauth_authorizations_api_key ON oauth_authorizations(api_key_id);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_tokens_family ON oauth_tokens(family_id);
CREATE INDEX idx_oauth_tokens_api_key ON oauth_tokens(api_key_id);
CREATE INDEX idx_oauth_tokens_expires ON oauth_tokens(expires_at);
