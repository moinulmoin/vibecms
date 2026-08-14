import type { BillingStatus } from "@vc/core";

/**
 * The managed integration deliberately accepts only the already-derived API
 * key material. Raw credentials are not represented by any input in this
 * repository.
 */
export type ManagedEntitlementStatus = "active" | "revoked";
export type ManagedAccess = "self_hosted" | "hosted_paid" | "hosted_free";
export type EffectiveEntitlementSource = "self_hosted" | "polar" | "managed_sponsorship";

export interface PolarEntitlementInput {
  status: BillingStatus | null;
  currentPeriodEnd: number | null;
}

export interface ManagedSponsorshipInput {
  status: ManagedEntitlementStatus | null;
  expiresAt: number | null;
}

export interface EffectiveHostedEntitlementInput {
  selfHosted?: boolean;
  site?: {
    selfHosted?: boolean;
  } | null;
  polar?: PolarEntitlementInput | null;
  managedSponsorship?: ManagedSponsorshipInput | null;
  /**
   * `managed` and the flattened fields are accepted as compatibility aliases
   * for callers that already have a site billing snapshot in one of those
   * shapes. The returned shape is always the canonical one below.
   */
  managed?: ManagedSponsorshipInput | null;
  polarStatus?: BillingStatus | null;
  polarCurrentPeriodEnd?: number | null;
  managedStatus?: ManagedEntitlementStatus | null;
  managedExpiresAt?: number | null;
}

export interface EffectiveHostedEntitlement {
  effective: boolean;
  access: ManagedAccess;
  activeSources: EffectiveEntitlementSource[];
  effectiveUntil: number | null;
  polar: {
    status: BillingStatus | null;
    currentPeriodEnd: number | null;
    active: boolean;
  };
  managedSponsorship: {
    status: ManagedEntitlementStatus | null;
    expiresAt: number | null;
    active: boolean;
  };
}

/**
 * Pure entitlement policy shared by site/workspace resolvers and analytics.
 *
 * A managed expiry is strictly future-facing: an expiry equal to `now` is no
 * longer effective. Polar status remains the source of truth for an active
 * subscription; its period end is returned as detail and as the effective
 * horizon, but is not independently used as a gate.
 */
export function evaluateEffectiveHostedEntitlement(
  input: EffectiveHostedEntitlementInput,
  now: number,
): EffectiveHostedEntitlement {
  const selfHosted = input.selfHosted ?? input.site?.selfHosted ?? false;
  const polar: PolarEntitlementInput = input.polar ?? {
    status: input.polarStatus ?? null,
    currentPeriodEnd: input.polarCurrentPeriodEnd ?? null,
  };
  const managed: ManagedSponsorshipInput = input.managedSponsorship ?? input.managed ?? {
    status: input.managedStatus ?? null,
    expiresAt: input.managedExpiresAt ?? null,
  };

  const polarActive = polar.status === "active";
  const managedActive =
    managed.status === "active" && (managed.expiresAt === null || managed.expiresAt > now);
  const activeSources: EffectiveEntitlementSource[] = [];

  if (selfHosted) activeSources.push("self_hosted");
  if (polarActive) activeSources.push("polar");
  if (managedActive) activeSources.push("managed_sponsorship");

  const horizons = [
    ...(polarActive && polar.currentPeriodEnd !== null ? [polar.currentPeriodEnd] : []),
    ...(managedActive && managed.expiresAt !== null ? [managed.expiresAt] : []),
  ];

  let access: ManagedAccess;
  if (selfHosted) access = "self_hosted";
  else if (polarActive || managedActive) access = "hosted_paid";
  else access = "hosted_free";

  return {
    effective: activeSources.length > 0,
    access,
    activeSources,
    effectiveUntil: selfHosted || horizons.length === 0 ? null : Math.min(...horizons),
    polar: {
      status: polar.status,
      currentPeriodEnd: polar.currentPeriodEnd,
      active: polarActive,
    },
    managedSponsorship: {
      status: managed.status,
      expiresAt: managed.expiresAt,
      active: managedActive,
    },
  };
}

export interface ManagedSiteSnapshot {
  id: string;
  externalWorkspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  siteStatus: "active" | "archived";
  defaultDomainHostname: string | null;
  defaultDomainStatus: "pending" | "active" | "failed" | "disabled" | null;
  apiKeyId: string;
  apiKeyPrefix: string;
  apiKeyHash: string;
  apiKeyRevokedAt: number | null;
  polarCustomerId: string | null;
  polarSubscriptionId: string | null;
  polarStatus: BillingStatus | null;
  polarCurrentPeriodEnd: number | null;
  credentialId: string;
  credentialGeneration: number;
  entitlementStatus: ManagedEntitlementStatus;
  entitlementExpiresAt: number | null;
  lifecycleRevision: number;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

export interface ManagedEntitlementResolutionOptions {
  selfHosted: boolean;
  now: number;
}

export interface ManagedAnalyticsSite {
  id: string;
  slug: string;
  workspaceId: string;
  entitlement: EffectiveHostedEntitlement;
}

export interface ManagedOwnerInput {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface ManagedFirstProvisionInput {
  timestamp: number;
  owner: ManagedOwnerInput;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
  };
  site: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
  };
  siteSlugProvided?: boolean;
  defaultDomain: {
    id: string;
    hostname: string;
  };
  apiKey: {
    id: string;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopesJson: string;
    actorName: string;
  };
  binding: {
    id: string;
    externalWorkspaceId: string;
    credentialId: string;
    credentialGeneration: number;
    entitlementStatus: "active";
    entitlementExpiresAt?: number | null;
    lifecycleRevision?: number;
  };
  activity?: ManagedActivityInput;
}

export interface ManagedActivityInput {
  requestId?: string | null;
}

export interface ManagedReconcileInput {
  externalWorkspaceId: string;
  credentialId: string;
  credentialGeneration: number;
  expectedLifecycleRevision: number;
  entitlementStatus: "active";
  entitlementExpiresAt: number | null;
  timestamp: number;
  activity?: ManagedActivityInput;
}

export interface ManagedRotateInput {
  externalWorkspaceId: string;
  credentialId: string;
  currentGeneration: number;
  newGeneration: number;
  expectedLifecycleRevision: number;
  newApiKey: {
    id: string;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopesJson: string;
    actorName: string;
  };
  entitlementExpiresAt: number | null;
  timestamp: number;
  activity?: ManagedActivityInput;
}

export interface ManagedRevokeInput {
  externalWorkspaceId: string;
  credentialId: string;
  credentialGeneration: number;
  expectedLifecycleRevision: number;
  timestamp: number;
  reason?: string | null;
  activity?: ManagedActivityInput;
}

export interface ManagedMutationResult {
  applied: boolean;
  snapshot: ManagedSiteSnapshot | null;
}

export interface ManagedFirstProvisionResult {
  created: boolean;
  snapshot: ManagedSiteSnapshot;
}

type ManagedRawSnapshot = {
  id: string;
  external_workspace_id: string;
  owner_user_id: string;
  owner_email: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  site_id: string;
  site_name: string;
  site_slug: string;
  site_status: "active" | "archived";
  default_domain_hostname: string | null;
  default_domain_status: "pending" | "active" | "failed" | "disabled" | null;
  api_key_id: string;
  api_key_prefix: string;
  api_key_hash: string;
  api_key_revoked_at: number | null;
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  polar_status: BillingStatus | null;
  polar_current_period_end: number | null;
  credential_id: string;
  credential_generation: number;
  entitlement_status: ManagedEntitlementStatus;
  entitlement_expires_at: number | null;
  lifecycle_revision: number;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
};

function mapSnapshot(row: ManagedRawSnapshot): ManagedSiteSnapshot {
  return {
    id: row.id,
    externalWorkspaceId: row.external_workspace_id,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    siteId: row.site_id,
    siteName: row.site_name,
    siteSlug: row.site_slug,
    siteStatus: row.site_status,
    defaultDomainHostname: row.default_domain_hostname,
    defaultDomainStatus: row.default_domain_status,
    apiKeyId: row.api_key_id,
    apiKeyPrefix: row.api_key_prefix,
    apiKeyHash: row.api_key_hash,
    apiKeyRevokedAt: row.api_key_revoked_at,
    polarCustomerId: row.polar_customer_id,
    polarSubscriptionId: row.polar_subscription_id,
    polarStatus: row.polar_status,
    polarCurrentPeriodEnd: row.polar_current_period_end,
    credentialId: row.credential_id,
    credentialGeneration: Number(row.credential_generation),
    entitlementStatus: row.entitlement_status,
    entitlementExpiresAt: row.entitlement_expires_at,
    lifecycleRevision: Number(row.lifecycle_revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    revokedAt: row.revoked_at,
  };
}

const SNAPSHOT_SQL = `
  SELECT
    m.id,
    m.external_workspace_id,
    m.owner_user_id,
    lower(u.email) AS owner_email,
    m.workspace_id,
    w.name AS workspace_name,
    w.slug AS workspace_slug,
    m.site_id,
    s.name AS site_name,
    s.slug AS site_slug,
    s.status AS site_status,
    (
      SELECT d.hostname
      FROM domains d
      WHERE d.site_id = m.site_id AND d.type = 'default'
      ORDER BY CASE WHEN d.status = 'active' THEN 0 ELSE 1 END, d.created_at DESC
      LIMIT 1
    ) AS default_domain_hostname,
    (
      SELECT d.status
      FROM domains d
      WHERE d.site_id = m.site_id AND d.type = 'default'
      ORDER BY CASE WHEN d.status = 'active' THEN 0 ELSE 1 END, d.created_at DESC
      LIMIT 1
    ) AS default_domain_status,
    k.id AS api_key_id,
    k.token_prefix AS api_key_prefix,
    k.token_hash AS api_key_hash,
    k.revoked_at AS api_key_revoked_at,
    b.polar_customer_id,
    b.polar_subscription_id,
    b.status AS polar_status,
    b.current_period_end AS polar_current_period_end,
    m.credential_id,
    m.credential_generation,
    m.entitlement_status,
    m.entitlement_expires_at,
    m.lifecycle_revision,
    m.created_at,
    m.updated_at,
    m.revoked_at
  FROM autoseopilot_managed_sites m
  INNER JOIN user u ON u.id = m.owner_user_id
  INNER JOIN workspaces w ON w.id = m.workspace_id
  INNER JOIN sites s ON s.id = m.site_id
  INNER JOIN api_keys k ON k.id = m.api_key_id
  LEFT JOIN billing_customers b ON b.workspace_id = m.workspace_id
  WHERE m.external_workspace_id = ?
  LIMIT 1
`;

function bound(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.slice(0, max);
}

function lifecycleAfterJson(input: {
  externalWorkspaceId: string;
  lifecycleRevision: number;
  credentialGeneration: number;
  result: string;
  entitlementStatus: ManagedEntitlementStatus;
  activity?: ManagedActivityInput;
}): string {
  const required = {
    externalWorkspaceId: input.externalWorkspaceId,
    lifecycleRevision: input.lifecycleRevision,
    credentialGeneration: input.credentialGeneration,
    result: input.result,
    entitlementStatus: input.entitlementStatus,
  };
  return JSON.stringify(required);
}

function replayError(
  existing: ManagedSiteSnapshot,
  input: ManagedFirstProvisionInput,
  normalizedEmail: string,
): Error | null {
  if (
    existing.entitlementStatus === "revoked" ||
    existing.revokedAt !== null ||
    existing.apiKeyRevokedAt !== null
  ) {
    return new Error("managed_replay_revoked");
  }
  if (existing.ownerEmail !== normalizedEmail) {
    return new Error("managed_owner_conflict");
  }
  if (existing.credentialId !== input.binding.credentialId) {
    return new Error("managed_credential_conflict");
  }
  if (existing.credentialGeneration !== input.binding.credentialGeneration) {
    return new Error("managed_stale_generation");
  }
  if (existing.apiKeyHash !== input.apiKey.tokenHash) {
    return new Error("managed_credential_conflict");
  }
  if (input.siteSlugProvided !== false && input.site.slug.trim() !== existing.siteSlug) {
    return new Error("managed_site_slug_conflict");
  }
  return null;
}

function activityStatement(
  db: D1Database,
  input: {
    externalWorkspaceId: string;
    lifecycleRevision: number;
    credentialGeneration: number;
    result: string;
    entitlementStatus: ManagedEntitlementStatus;
    action: string;
    summary: string;
    activity?: ManagedActivityInput;
  },
  bindingCondition: string,
  conditionBindings: unknown[],
  createdAt: number,
) {
  const activityId = `autoseopilot:${input.externalWorkspaceId}:${input.lifecycleRevision}`;
  return db
    .prepare(
      `INSERT OR IGNORE INTO activity_events (
         id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
         summary, before_json, after_json, request_id, created_at
       )
       SELECT ?, m.site_id, 'system', 'autoseopilot', 'AutoSEOPilot', ?, 'managed_site', m.site_id,
         ?, ?, ?, ?, ?
       FROM autoseopilot_managed_sites m
       WHERE EXISTS (
         SELECT 1
         WHERE ${bindingCondition}
       )`,
    )
    .bind(
      activityId,
      input.action,
      input.summary,
      null,
      lifecycleAfterJson(input),
      bound(input.activity?.requestId, 128),
      createdAt,
      ...conditionBindings,
    );
}

/**
 * Canonical email storage/lookup for the managed owner path. No migration adds
 * a NOCASE index because legacy mixed-case duplicates must be handled before
 * such an index can be safely introduced.
 */
export function normalizeManagedOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AutoseopilotManagedSitesRepository {
  getSnapshotByExternalWorkspaceId(externalWorkspaceId: string): Promise<ManagedSiteSnapshot | null>;
  getSnapshotBySiteId(siteId: string): Promise<ManagedSiteSnapshot | null>;
  getSnapshotByWorkspaceId(workspaceId: string): Promise<ManagedSiteSnapshot | null>;
  resolveSite(
    siteId: string,
    options: ManagedEntitlementResolutionOptions,
  ): Promise<EffectiveHostedEntitlement | null>;
  resolveWorkspace(
    workspaceId: string,
    options: ManagedEntitlementResolutionOptions,
  ): Promise<EffectiveHostedEntitlement | null>;
  listEffectiveEntitledActiveSites(
    options: ManagedEntitlementResolutionOptions,
  ): Promise<ManagedAnalyticsSite[]>;
  firstProvision(input: ManagedFirstProvisionInput): Promise<ManagedSiteSnapshot>;
  /**
   * Backward-compatible first-provision variant that tells the app whether
   * this invocation inserted the binding. A false result is a replay or a
   * recovery read after another writer committed the unique winner.
   */
  firstProvisionWithOutcome(input: ManagedFirstProvisionInput): Promise<ManagedFirstProvisionResult>;
  reconcile(input: ManagedReconcileInput): Promise<ManagedMutationResult>;
  rotateOrReactivate(input: ManagedRotateInput): Promise<ManagedMutationResult>;
  revoke(input: ManagedRevokeInput): Promise<ManagedMutationResult>;
}

async function readSnapshot(db: D1Database, externalWorkspaceId: string): Promise<ManagedSiteSnapshot | null> {
  const row = await db.prepare(SNAPSHOT_SQL).bind(externalWorkspaceId).first<ManagedRawSnapshot>();
  return row ? mapSnapshot(row) : null;
}

async function readSnapshotBy(
  db: D1Database,
  column: "site_id" | "workspace_id",
  id: string,
): Promise<ManagedSiteSnapshot | null> {
  const row = await db
    .prepare(SNAPSHOT_SQL.replace("WHERE m.external_workspace_id = ?", `WHERE m.${column} = ?`))
    .bind(id)
    .first<ManagedRawSnapshot>();
  return row ? mapSnapshot(row) : null;
}

async function readEntitlement(
  db: D1Database,
  column: "site_id" | "workspace_id",
  id: string,
  options: ManagedEntitlementResolutionOptions,
): Promise<EffectiveHostedEntitlement | null> {
  const row = await db
    .prepare(
      `SELECT
         x.id AS entity_id,
         b.status AS polar_status,
         b.current_period_end AS polar_current_period_end,
         m.entitlement_status AS managed_status,
         m.entitlement_expires_at AS managed_expires_at
       FROM ${column === "site_id" ? "sites" : "workspaces"} x
       LEFT JOIN billing_customers b ON b.workspace_id = ${
         column === "site_id" ? "x.workspace_id" : "x.id"
       }
       LEFT JOIN autoseopilot_managed_sites m ON m.${column} = x.id
       WHERE x.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{
      entity_id: string;
      polar_status: BillingStatus | null;
      polar_current_period_end: number | null;
      managed_status: ManagedEntitlementStatus | null;
      managed_expires_at: number | null;
    }>();
  if (!row) return null;
  return evaluateEffectiveHostedEntitlement(
    {
      selfHosted: options.selfHosted,
      polar: {
        status: row.polar_status,
        currentPeriodEnd: row.polar_current_period_end,
      },
      managedSponsorship: {
        status: row.managed_status,
        expiresAt: row.managed_expires_at,
      },
    },
    options.now,
  );
}

export function createManagedSitesRepository(db: D1Database): AutoseopilotManagedSitesRepository {
  const repository: AutoseopilotManagedSitesRepository = {
    async getSnapshotByExternalWorkspaceId(externalWorkspaceId) {
      return readSnapshot(db, externalWorkspaceId);
    },

    async getSnapshotBySiteId(siteId) {
      return readSnapshotBy(db, "site_id", siteId);
    },

    async getSnapshotByWorkspaceId(workspaceId) {
      return readSnapshotBy(db, "workspace_id", workspaceId);
    },

    async resolveSite(siteId, options) {
      return readEntitlement(db, "site_id", siteId, options);
    },

    async resolveWorkspace(workspaceId, options) {
      return readEntitlement(db, "workspace_id", workspaceId, options);
    },

    async listEffectiveEntitledActiveSites(options) {
      const result = await db
        .prepare(
          `SELECT
             s.id,
             s.slug,
             s.workspace_id,
             b.status AS polar_status,
             b.current_period_end AS polar_current_period_end,
             m.entitlement_status AS managed_status,
             m.entitlement_expires_at AS managed_expires_at
           FROM sites s
           LEFT JOIN billing_customers b ON b.workspace_id = s.workspace_id
           LEFT JOIN autoseopilot_managed_sites m ON m.site_id = s.id
           WHERE s.status = 'active'
           ORDER BY s.id`,
        )
        .all<{
          id: string;
          slug: string;
          workspace_id: string;
          polar_status: BillingStatus | null;
          polar_current_period_end: number | null;
          managed_status: ManagedEntitlementStatus | null;
          managed_expires_at: number | null;
        }>();

      return (result.results ?? [])
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          workspaceId: row.workspace_id,
          entitlement: evaluateEffectiveHostedEntitlement(
            {
              selfHosted: options.selfHosted,
              polar: {
                status: row.polar_status,
                currentPeriodEnd: row.polar_current_period_end,
              },
              managedSponsorship: {
                status: row.managed_status,
                expiresAt: row.managed_expires_at,
              },
            },
            options.now,
          ),
        }))
        .filter((row) => row.entitlement.effective);
    },

    async firstProvision(input) {
      return (await repository.firstProvisionWithOutcome(input)).snapshot;
    },

    async firstProvisionWithOutcome(input) {
      const email = normalizeManagedOwnerEmail(input.owner.email);
      if (!email) throw new Error("managed_owner_email_required");
      if (input.binding.credentialGeneration < 1) throw new Error("managed_credential_generation_invalid");

      // Recovery/read-after-timeout path: the unique external workspace
      // identity is checked before any dependent insert. Exact replay
      // classification (HTTP 200 vs conflict/stale) remains an app concern,
      // but the repository never creates a second site/key for a replay.
      const existing = await readSnapshot(db, input.binding.externalWorkspaceId);

      // A legacy database may contain mixed-case rows that compare equal under
      // the repository's canonical lookup. Refuse an ambiguous owner instead
      // of silently attaching a managed site to an arbitrary identity.
      const ownerMatches = await db
        .prepare("SELECT id, email FROM user WHERE lower(email) = ? ORDER BY created_at ASC, id ASC LIMIT 2")
        .bind(email)
        .all<{ id: string; email: string }>();
      if ((ownerMatches.results ?? []).length > 1) {
        throw new Error("managed_owner_email_ambiguous");
      }

      if (existing) {
        const error = replayError(existing, input, email);
        if (error) throw error;
        await db
          .prepare(
            `UPDATE user
             SET email = ?, updated_at = ?
             WHERE id = ? AND lower(email) = ? AND email <> ?`,
          )
          .bind(email, input.timestamp, existing.ownerUserId, email, email)
          .run();
        return { created: false, snapshot: existing };
      }

      const revision = input.binding.lifecycleRevision ?? 1;
      if (revision < 1) throw new Error("managed_lifecycle_revision_invalid");
      const siteSlug = input.site.slug.trim();
      if (!siteSlug) throw new Error("managed_site_slug_required");

      // Each dependent statement selects the owner/workspace/site/key created
      // earlier in this same D1 transaction. A conflict anywhere rolls back
      // the whole batch, preventing orphan rows on retries or collisions.
      const statements = [
        // Better Auth performs an exact canonical-email lookup after OTP
        // verification. Normalize a unique reused legacy row in the same
        // transaction so login resolves the managed owner instead of creating
        // a second lowercase user.
        db
          .prepare(
            `UPDATE user
             SET email = ?, updated_at = ?
             WHERE lower(email) = ? AND email <> ?`,
          )
          .bind(email, input.timestamp, email, email),
        db
          .prepare(
            `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
             SELECT ?, ?, ?, 0, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM user WHERE lower(email) = ?)`,
          )
          .bind(
            input.owner.id,
            input.owner.name,
            email,
            input.owner.image ?? null,
            input.timestamp,
            input.timestamp,
            email,
          ),
        db
          .prepare(
            `INSERT INTO workspaces (id, name, slug, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM user WHERE lower(email) = ?)`,
          )
          .bind(
            input.workspace.id,
            input.workspace.name,
            input.workspace.slug,
            input.timestamp,
            input.timestamp,
            email,
          ),
        db
          .prepare(
            `INSERT INTO memberships (id, workspace_id, user_id, role, created_at, updated_at)
             SELECT ?, ?, owner.id, 'owner', ?, ?
             FROM user owner
             WHERE lower(owner.email) = ?
             ORDER BY owner.created_at ASC, owner.id ASC
             LIMIT 1`,
          )
          .bind(input.membership.id, input.workspace.id, input.timestamp, input.timestamp, email),
        db
          .prepare(
            `INSERT INTO sites (id, workspace_id, name, slug, description, status, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, 'active', ?, ?
             FROM workspaces
             WHERE id = ?`,
          )
          .bind(
            input.site.id,
            input.workspace.id,
            input.site.name,
            siteSlug,
            input.site.description ?? null,
            input.timestamp,
            input.timestamp,
            input.workspace.id,
          ),
        db
          .prepare(
            `INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at)
             SELECT ?, ?, ?, 'default', 'active', ?, ?
             FROM sites
             WHERE id = ? AND workspace_id = ?`,
          )
          .bind(
            input.defaultDomain.id,
            input.site.id,
            input.defaultDomain.hostname,
            input.timestamp,
            input.timestamp,
            input.site.id,
            input.workspace.id,
          ),
        db
          .prepare(
            `INSERT INTO api_keys (
               id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
               revoked_at, created_by_user_id, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, NULL, owner.id, ?, ?
             FROM user owner
             INNER JOIN sites s ON s.id = ?
             WHERE lower(owner.email) = ?
             ORDER BY owner.created_at ASC, owner.id ASC
             LIMIT 1`,
          )
          .bind(
            input.apiKey.id,
            input.site.id,
            input.apiKey.name,
            input.apiKey.tokenPrefix,
            input.apiKey.tokenHash,
            input.apiKey.scopesJson,
            input.apiKey.actorName,
            input.timestamp,
            input.timestamp,
            input.site.id,
            email,
          ),
        db
          .prepare(
            `INSERT INTO autoseopilot_managed_sites (
               id, external_workspace_id, owner_user_id, workspace_id, site_id,
               credential_id, credential_generation, api_key_id, entitlement_status,
               entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
             )
             SELECT ?, ?, owner.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
             FROM user owner
             INNER JOIN workspaces w ON w.id = ?
             INNER JOIN sites s ON s.id = ? AND s.workspace_id = w.id
             INNER JOIN api_keys k ON k.id = ?
             WHERE lower(owner.email) = ?
             ORDER BY owner.created_at ASC, owner.id ASC
             LIMIT 1`,
          )
          .bind(
            input.binding.id,
            input.binding.externalWorkspaceId,
            input.workspace.id,
            input.site.id,
            input.binding.credentialId,
            input.binding.credentialGeneration,
            input.apiKey.id,
            input.binding.entitlementStatus,
            input.binding.entitlementExpiresAt ?? null,
            revision,
            input.timestamp,
            input.timestamp,
            input.workspace.id,
            input.site.id,
            input.apiKey.id,
            email,
          ),
        activityStatement(
          db,
          {
            externalWorkspaceId: input.binding.externalWorkspaceId,
            lifecycleRevision: revision,
            credentialGeneration: input.binding.credentialGeneration,
            result: "provisioned",
            entitlementStatus: "active",
            action: "autoseopilot.managed.provisioned",
            summary: "Managed site provisioned",
            activity: input.activity,
          },
          "m.id = ? AND m.lifecycle_revision = ? AND m.external_workspace_id = ?",
          [input.binding.id, revision, input.binding.externalWorkspaceId],
          input.timestamp,
        ),
      ];
      let results: D1Result<unknown>[];
      try {
        results = await db.batch(statements);
      } catch (error) {
        const winner = await readSnapshot(db, input.binding.externalWorkspaceId);
        if (winner) {
          const replay = replayError(winner, input, email);
          if (!replay) return { created: false, snapshot: winner };
          throw replay;
        }
        throw error;
      }

      const snapshot = await readSnapshot(db, input.binding.externalWorkspaceId);
      if (!snapshot) throw new Error("managed_first_provision_not_created");
      return {
        created: (results[6]?.meta.changes ?? 0) > 0,
        snapshot,
      };
    },

    async reconcile(input) {
      const nextRevision = input.expectedLifecycleRevision + 1;
      const [updateResult] = await db.batch([
        db
          .prepare(
            `UPDATE autoseopilot_managed_sites
             SET entitlement_status = 'active',
                 entitlement_expires_at = ?,
                 lifecycle_revision = lifecycle_revision + 1,
                 revoked_at = NULL,
                 updated_at = ?
             WHERE external_workspace_id = ?
               AND credential_id = ?
               AND credential_generation = ?
               AND lifecycle_revision = ?
               AND entitlement_status = 'active'`,
          )
          .bind(
            input.entitlementExpiresAt,
            input.timestamp,
            input.externalWorkspaceId,
            input.credentialId,
            input.credentialGeneration,
            input.expectedLifecycleRevision,
          ),
        activityStatement(
          db,
          {
            externalWorkspaceId: input.externalWorkspaceId,
            lifecycleRevision: nextRevision,
            credentialGeneration: input.credentialGeneration,
            result: "reconciled",
            entitlementStatus: "active",
            action: "autoseopilot.managed.reconciled",
            summary: "Managed entitlement reconciled",
            activity: input.activity,
          },
          "m.external_workspace_id = ? AND m.lifecycle_revision = ? AND m.entitlement_status = 'active' AND m.updated_at = ?",
          [input.externalWorkspaceId, nextRevision, input.timestamp],
          input.timestamp,
        ),
      ]);

      const snapshot = await readSnapshot(db, input.externalWorkspaceId);
      return {
        applied: (updateResult?.meta.changes ?? 0) > 0,
        snapshot,
      };
    },

    async rotateOrReactivate(input) {
      if (input.currentGeneration < 1 || input.newGeneration < 1) {
        throw new Error("managed_credential_generation_invalid");
      }
      const nextRevision = input.expectedLifecycleRevision + 1;
      const beforeRotation = await readSnapshot(db, input.externalWorkspaceId);
      const rotationResult = beforeRotation?.entitlementStatus === "revoked" ? "reactivated" : "rotated";

      // Every write is guarded by the old generation/revision. A stale request
      // therefore selects no row in any statement, even when its proposed key
      // id already exists from a previous successful rotation. If a key
      // conflict occurs, D1 rolls the whole batch back.
      let results: D1Result<unknown>[];
      try {
        results = await db.batch([
          db
            .prepare(
              `INSERT INTO api_keys (
               id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
               revoked_at, created_by_user_id, created_at, updated_at
             )
             SELECT ?, m.site_id, ?, ?, ?, ?, ?, NULL, m.owner_user_id, ?, ?
             FROM autoseopilot_managed_sites m
             WHERE m.external_workspace_id = ?
               AND m.credential_id = ?
               AND m.credential_generation = ?
               AND m.lifecycle_revision = ?
               AND ? = m.credential_generation + 1`,
          )
            .bind(
              input.newApiKey.id,
              input.newApiKey.name,
              input.newApiKey.tokenPrefix,
              input.newApiKey.tokenHash,
              input.newApiKey.scopesJson,
              input.newApiKey.actorName,
              input.timestamp,
              input.timestamp,
              input.externalWorkspaceId,
              input.credentialId,
              input.currentGeneration,
              input.expectedLifecycleRevision,
              input.newGeneration,
            ),
          db
            .prepare(
              `UPDATE api_keys
             SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
             WHERE id = (
               SELECT api_key_id
               FROM autoseopilot_managed_sites
               WHERE external_workspace_id = ?
                 AND credential_id = ?
                 AND credential_generation = ?
                 AND lifecycle_revision = ?
                 AND ? = credential_generation + 1
             )`,
            )
            .bind(
              input.timestamp,
              input.timestamp,
              input.externalWorkspaceId,
              input.credentialId,
              input.currentGeneration,
              input.expectedLifecycleRevision,
              input.newGeneration,
            ),
          db
            .prepare(
              `UPDATE autoseopilot_managed_sites
             SET api_key_id = ?,
                 credential_generation = ?,
                 entitlement_status = 'active',
                 entitlement_expires_at = ?,
                 revoked_at = NULL,
                 lifecycle_revision = lifecycle_revision + 1,
                 updated_at = ?
             WHERE external_workspace_id = ?
               AND credential_id = ?
               AND credential_generation = ?
               AND lifecycle_revision = ?
               AND ? = credential_generation + 1
               AND EXISTS (SELECT 1 FROM api_keys WHERE id = ?)`,
            )
            .bind(
              input.newApiKey.id,
              input.newGeneration,
              input.entitlementExpiresAt,
              input.timestamp,
              input.externalWorkspaceId,
              input.credentialId,
              input.currentGeneration,
              input.expectedLifecycleRevision,
              input.newGeneration,
              input.newApiKey.id,
            ),
          activityStatement(
            db,
            {
              externalWorkspaceId: input.externalWorkspaceId,
              lifecycleRevision: nextRevision,
              credentialGeneration: input.newGeneration,
              result: rotationResult,
              entitlementStatus: "active",
              action: "autoseopilot.managed.credential.rotated",
              summary: "Managed credential rotated",
              activity: input.activity,
            },
            "m.external_workspace_id = ? AND m.api_key_id = ? AND m.credential_generation = ? AND m.lifecycle_revision = ? AND m.updated_at = ?",
            [input.externalWorkspaceId, input.newApiKey.id, input.newGeneration, nextRevision, input.timestamp],
            input.timestamp,
          ),
        ]);
      } catch (error) {
        const snapshot = await readSnapshot(db, input.externalWorkspaceId);
        if (
          snapshot &&
          snapshot.credentialId === input.credentialId &&
          snapshot.credentialGeneration === input.newGeneration &&
          snapshot.apiKeyId === input.newApiKey.id &&
          snapshot.apiKeyHash === input.newApiKey.tokenHash &&
          snapshot.entitlementStatus === "active" &&
          snapshot.entitlementExpiresAt === input.entitlementExpiresAt
        ) {
          return { applied: false, snapshot };
        }
        throw error;
      }

      const snapshot = await readSnapshot(db, input.externalWorkspaceId);
      return {
        applied: (results[2]?.meta.changes ?? 0) > 0,
        snapshot,
      };
    },

    async revoke(input) {
      const nextRevision = input.expectedLifecycleRevision + 1;
      const [updateResult] = await db.batch([
        db
          .prepare(
            `UPDATE autoseopilot_managed_sites
             SET entitlement_status = 'revoked',
                 entitlement_expires_at = NULL,
                 revoked_at = COALESCE(revoked_at, ?),
                 lifecycle_revision = lifecycle_revision + 1,
                 updated_at = ?
             WHERE external_workspace_id = ?
               AND credential_id = ?
               AND credential_generation = ?
               AND lifecycle_revision = ?
               AND entitlement_status = 'active'`,
          )
          .bind(
            input.timestamp,
            input.timestamp,
            input.externalWorkspaceId,
            input.credentialId,
            input.credentialGeneration,
            input.expectedLifecycleRevision,
          ),
        db
          .prepare(
            `UPDATE api_keys
             SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
             WHERE id = (
               SELECT api_key_id
               FROM autoseopilot_managed_sites
               WHERE external_workspace_id = ?
                 AND credential_id = ?
                 AND credential_generation = ?
               AND lifecycle_revision = ?
                 AND entitlement_status = 'revoked'
             )
               AND revoked_at IS NULL`,
          )
          .bind(
            input.timestamp,
            input.timestamp,
            input.externalWorkspaceId,
            input.credentialId,
            input.credentialGeneration,
            nextRevision,
          ),
        activityStatement(
          db,
          {
            externalWorkspaceId: input.externalWorkspaceId,
            lifecycleRevision: nextRevision,
            credentialGeneration: input.credentialGeneration,
            result: "revoked",
            entitlementStatus: "revoked",
            action: "autoseopilot.managed.revoked",
            summary: "Managed entitlement revoked",
            activity: input.activity,
          },
          "m.external_workspace_id = ? AND m.credential_id = ? AND m.credential_generation = ? AND m.lifecycle_revision = ? AND m.entitlement_status = 'revoked' AND m.updated_at = ?",
          [
            input.externalWorkspaceId,
            input.credentialId,
            input.credentialGeneration,
            nextRevision,
            input.timestamp,
          ],
          input.timestamp,
        ),
      ]);

      const snapshot = await readSnapshot(db, input.externalWorkspaceId);
      return {
        applied: (updateResult?.meta.changes ?? 0) > 0,
        snapshot,
      };
    },
  };

  return repository;
}

// Compatibility export for callers that used the initial explicit integration
// name. createDataAccess intentionally constructs only the canonical
// `managedSites` entry.
export const createAutoseopilotManagedSitesRepository = createManagedSitesRepository;
