-- Durable purge intents for the claim window ("keep your blog").
--
-- The intent is the irreversible decision to delete an unclaimed blog. It is
-- written in ONE atomic statement that only fires while the binding is still
-- revoked, still past ITS OWN 30-day deadline and its workspace still never
-- claimed VibeCMS Cloud, and it records the external resources the purge will
-- delete (the Cloudflare custom hostname ids and the R2 prefixes). While an
-- intent exists, claiming, plan resumption and re-provisioning are refused, so
-- a resurrection cannot race a running purge. A crash in the middle of the
-- cleanup leaves the intent in place and the next sweep resumes the same
-- operation; the intent never expires and is never auto-cleared.
--
-- No foreign key on purpose: the purge deletes the site, workspace and user
-- rows, and the intent must outlive them to finish the cleanup.

CREATE TABLE autoseopilot_purge_intents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  external_workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  hostname_ids_json TEXT NOT NULL DEFAULT '[]',
  r2_prefixes_json TEXT NOT NULL DEFAULT '[]',
  revoked_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_autoseopilot_purge_intents_external_workspace
  ON autoseopilot_purge_intents(external_workspace_id);

-- A claim checkout in flight: the customer can have paid at Polar before the
-- webhook arrives, so the sweep must not delete the blog under a live
-- checkout. An unresolved attempt only DEFERS the purge (it expires), it never
-- blocks it forever.

CREATE TABLE autoseopilot_claim_checkouts (
  workspace_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_autoseopilot_claim_checkouts_expires
  ON autoseopilot_claim_checkouts(expires_at);
