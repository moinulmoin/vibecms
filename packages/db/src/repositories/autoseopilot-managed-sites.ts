import {
  MANAGED_CLAIM_CHECKOUT_GUARD_SECONDS,
  MANAGED_CLAIM_WINDOW,
  isPaidBilling,
  pastDueGraceEndsAt,
} from "@vc/config";
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
  /** Epoch seconds. */
  currentPeriodEnd: number | null;
  /** Epoch MILLISECONDS of the first failed payment; drives the past_due grace window. */
  pastDueSince?: number | null;
}

export interface ManagedSponsorshipInput {
  status: ManagedEntitlementStatus | null;
  expiresAt: number | null;
  /** Epoch seconds; set the moment a revoke landed (claim-window day 0). */
  revokedAt?: number | null;
}

export interface EffectiveHostedEntitlementInput {
  selfHosted: boolean;
  polar?: PolarEntitlementInput | null;
  managedSponsorship?: ManagedSponsorshipInput | null;
}

export interface EffectiveHostedEntitlement {
  effective: boolean;
  access: ManagedAccess;
  activeSources: EffectiveEntitlementSource[];
  effectiveUntil: number | null;
  polar: {
    status: BillingStatus | null;
    /** Epoch seconds. */
    currentPeriodEnd: number | null;
    /** True while Polar billing is paid: `active`, or `past_due` inside its grace window. */
    active: boolean;
    /** Epoch MILLISECONDS; null unless past_due with a known start. */
    pastDueSince?: number | null;
    /** Epoch MILLISECONDS past_due grace deadline; null unless past_due with a known start. */
    graceEndsAt?: number | null;
  };
  managedSponsorship: {
    status: ManagedEntitlementStatus | null;
    expiresAt: number | null;
    active: boolean;
    /** Epoch seconds of the revoke, when the sponsorship is revoked. */
    revokedAt: number | null;
  };
  /**
   * The post-revoke claim window ("keep your blog"). Present only while the
   * managed sponsorship is revoked; claiming (paid Polar on the same
   * workspace) or the AutoSEOPilot plan resuming supersedes it.
   */
  claim: {
    state: "grace" | "paused";
    /** Epoch seconds when public traffic flips to the paused page. */
    pausedAt: number;
    /** Epoch seconds when an unclaimed blog is deleted. */
    deadline: number;
  } | null;
  /**
   * Public-traffic gate: paid-effective, self-hosted, or inside the claim
   * grace (days 0-7 after a managed revoke, every address serves normally).
   */
  servingAllowed: boolean;
  /** Managed-revoked past its grace with no other source: paused page everywhere. */
  servingPaused: boolean;
}

/**
 * Pure entitlement policy shared by site/workspace resolvers and analytics.
 * `now` and every returned horizon are epoch seconds; the Polar paid rule is
 * `isPaidBilling` from `@vc/config` (millisecond clock), converted only here.
 *
 * A managed expiry is strictly future-facing: an expiry equal to `now` is no
 * longer effective. Polar status remains the source of truth for an active
 * subscription; its period end is returned as detail and as the effective
 * horizon, but is not independently used as a gate. A past_due subscription
 * stays paid until its grace deadline (exclusive), which is its horizon.
 *
 * Serving is gated separately from paid effectiveness: for `graceSeconds`
 * after a managed revoke the claim grace keeps public traffic serving on
 * every address (`servingAllowed`), so a just-ended AutoSEOPilot plan never
 * drops its blog mid-flight; past that, with no other source,
 * `servingPaused` flips every ingress to the paused page.
 */
export function evaluateEffectiveHostedEntitlement(
  input: EffectiveHostedEntitlementInput,
  now: number,
): EffectiveHostedEntitlement {
  const selfHosted = input.selfHosted;
  const polar: PolarEntitlementInput = input.polar ?? { status: null, currentPeriodEnd: null };
  const managed: ManagedSponsorshipInput = input.managedSponsorship ?? { status: null, expiresAt: null };

  const polarBilling = { status: polar.status, pastDueSince: polar.pastDueSince ?? null };
  // `now` is fractional seconds from Date.now() / 1000; rounding recovers the
  // exact integer milliseconds lost to floating-point division.
  const polarActive = isPaidBilling(polarBilling, Math.round(now * 1000));
  const graceEndsAt = pastDueGraceEndsAt(polarBilling);
  // Exact deadline as fractional epoch seconds; seconds consumers compare fractionally.
  const polarHorizon = graceEndsAt !== null ? graceEndsAt / 1000 : polar.currentPeriodEnd;
  const managedActive =
    managed.status === "active" && (managed.expiresAt === null || managed.expiresAt > now);
  const activeSources: EffectiveEntitlementSource[] = [];

  if (selfHosted) activeSources.push("self_hosted");
  if (polarActive) activeSources.push("polar");
  if (managedActive) activeSources.push("managed_sponsorship");

  const horizons = [
    ...(polarActive && polarHorizon !== null ? [polarHorizon] : []),
    ...(managedActive && managed.expiresAt !== null ? [managed.expiresAt] : []),
  ];

  // Claim window ("keep your blog"): runs from the managed revoke. While no
  // other source is active, days 0-7 keep every public ingress serving and
  // indexed as normal; afterwards traffic sees the paused page.
  const managedRevokedAt = managed.status === "revoked" ? managed.revokedAt ?? null : null;
  const claim =
    managedRevokedAt !== null
      ? {
          pausedAt: managedRevokedAt + MANAGED_CLAIM_WINDOW.graceSeconds,
          deadline: managedRevokedAt + MANAGED_CLAIM_WINDOW.windowSeconds,
        }
      : null;
  const claimState = claim ? (now < claim.pausedAt ? "grace" : "paused") : null;
  const coveredByActiveSource = activeSources.length > 0;
  const servingAllowed = coveredByActiveSource || claimState === "grace";
  const servingPaused = !coveredByActiveSource && claimState === "paused";

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
      pastDueSince: graceEndsAt === null ? null : polarBilling.pastDueSince,
      graceEndsAt,
    },
    managedSponsorship: {
      status: managed.status,
      expiresAt: managed.expiresAt,
      active: managedActive,
      revokedAt: managedRevokedAt,
    },
    claim:
      claim && claimState
        ? { state: claimState, pausedAt: claim.pausedAt, deadline: claim.deadline }
        : null,
    servingAllowed,
    servingPaused,
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
  /** Epoch MILLISECONDS of the first failed payment (past_due grace start). */
  polarPastDueSince: number | null;
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
  /**
   * Epoch seconds, fractional allowed (`Date.now() / 1000`). Pass it unfloored:
   * the past_due grace deadline is compared at millisecond precision.
   */
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
  polar_past_due_since: number | null;
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
    polarPastDueSince: row.polar_past_due_since,
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
    b.past_due_since AS polar_past_due_since,
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

function claimReminderColumn(day: ManagedClaimReminderDay): string {
  const columns: Record<ManagedClaimReminderDay, string> = {
    7: "claim_day7_sent_at",
    14: "claim_day14_sent_at",
    21: "claim_day21_sent_at",
    28: "claim_day28_sent_at",
  };
  return columns[day];
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

/** Canonical email storage and lookup for the managed owner path. */
export function normalizeManagedOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Reminder days inside the claim window; each has a durable sent marker. */
export type ManagedClaimReminderDay = 7 | 14 | 21 | 28;

/** One revoked, unclaimed managed blog the daily sweep must act on. */
export interface ManagedClaimSweepCandidate {
  id: string;
  externalWorkspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
  workspaceId: string;
  workspaceName: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  revokedAt: number;
  /** The lifecycle revision the candidate was selected at. */
  lifecycleRevision: number;
  claimDay7SentAt: number | null;
  claimDay14SentAt: number | null;
  claimDay21SentAt: number | null;
  claimDay28SentAt: number | null;
}

/** One page of sweep candidates, plus the cursor for the next page. */
export interface ManagedClaimSweepPage {
  candidates: ManagedClaimSweepCandidate[];
  /** The last (revokedAt, id) of this page; null when the list is exhausted. */
  cursor: { revokedAt: number; id: string } | null;
}

export interface ManagedClaimSweepPurgeInput {
  externalWorkspaceId: string;
  workspaceId: string;
  siteId: string;
  ownerUserId: string;
  /** The intent that authorizes this deletion. */
  intentId: string;
  /** Epoch seconds; the purge re-checks the CURRENT revoke is past its deadline. */
  now: number;
}

/**
 * The durable, irreversible decision to delete an unclaimed managed blog.
 *
 * It is written in one atomic statement while the blog is still revoked, still
 * past its own claim-window deadline and its workspace still never claimed
 * VibeCMS Cloud, and it records the external resources the purge deletes (the
 * Cloudflare custom hostname ids and the R2 prefixes). While an intent exists,
 * claiming, plan resumption and re-provisioning are refused, so a resurrection
 * cannot race a running purge. The intent never expires: a crashed run leaves
 * it behind and the next sweep resumes the same cleanup from it.
 */
export interface ManagedPurgeIntent {
  id: string;
  siteId: string;
  workspaceId: string;
  externalWorkspaceId: string;
  ownerUserId: string;
  /** Cloudflare custom hostname ids the purge deletes. */
  hostnameIds: string[];
  /** R2 prefixes the purge empties. */
  r2Prefixes: string[];
  /** The revoke the intent was taken for (epoch seconds). */
  revokedAt: number;
  /** The claim-window deadline that had elapsed (epoch seconds). */
  deadline: number;
  /** The lifecycle revision the intent was taken for. */
  lifecycleRevision: number;
  /**
   * When the purge finished (epoch seconds). A finished intent stays behind as
   * the durable trace that the blog is gone.
   */
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A paid Polar event that arrived for a blog the purge is deleting or has deleted. */
export interface ManagedPurgeConflictInput {
  workspaceId: string;
  siteId?: string | null;
  polarCustomerId?: string | null;
  polarSubscriptionId?: string | null;
  polarOrderId?: string | null;
  polarCheckoutId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  appliedStatus?: string | null;
  /** Epoch seconds. */
  now: number;
}

/** The operator record of a paid event that arrived too late. */
export interface ManagedPurgeConflict {
  id: string;
  workspaceId: string;
  siteId: string | null;
  polarCustomerId: string | null;
  polarSubscriptionId: string | null;
  polarOrderId: string | null;
  polarCheckoutId: string | null;
  eventId: string | null;
  eventType: string | null;
  appliedStatus: string | null;
  createdAt: number;
}

/**
 * The candidate the intent is taken for. The binding identity, its revoke and
 * its lifecycle revision must still match, so a candidate selected in an
 * earlier lifecycle can never delete a newly revoked one.
 */
export interface ManagedPurgeIntentRequest {
  externalWorkspaceId: string;
  workspaceId: string;
  siteId: string;
  ownerUserId: string;
  /** The binding row the candidate was selected from. */
  bindingId: string;
  /** The lifecycle revision the candidate was selected at. */
  lifecycleRevision: number;
  /** The revoke the candidate was selected at (epoch seconds). */
  revokedAt: number;
  /** The R2 prefixes the purge will empty. */
  r2Prefixes: string[];
  /** Epoch seconds; the current time of the sweep run. */
  now: number;
}

export interface AutoseopilotManagedSitesClaimSweep {
  /**
   * Revoked managed sites whose workspace has never claimed VibeCMS Cloud
   * (no billing row, or status 'none') AND whose window has something due
   * (the first reminder, or the purge). A resumed plan clears revoked_at and
   * leaves this set; a claim flips billing away from 'none'. Only due rows
   * are returned, paged by (revoked_at, id), so a long queue of old blogs
   * cannot starve the newer ones.
   */
  listClaimSweepCandidates(page: {
    now: number;
    limit?: number;
    cursor?: { revokedAt: number; id: string } | null;
  }): Promise<ManagedClaimSweepPage>;
  /** Claims a reminder send; false when already sent (or no longer revoked). */
  markClaimReminderSent(
    externalWorkspaceId: string,
    day: ManagedClaimReminderDay,
    timestamp: number,
  ): Promise<boolean>;
  /** Releases a claimed send whose dispatch definitively failed. */
  clearClaimReminderSent(
    externalWorkspaceId: string,
    day: ManagedClaimReminderDay,
    timestamp: number,
  ): Promise<void>;
  /**
   * Deletes an unclaimed blog past its deadline: binding, site (cascades
   * posts, versions, media, domains, subscribers, activity), workspace
   * (cascades billing and memberships), and — only when the login belongs to
   * no other workspace — the user row. Every statement re-checks the sweep
   * state inside the single D1 batch and requires the purge intent, so a
   * racing claim or resume selects no rows and nothing is deleted.
   */
  purgeRevokedManagedSite(input: ManagedClaimSweepPurgeInput): Promise<boolean>;
}

/**
 * The durable purge intents of the claim window. An intent is written before
 * any external resource is touched, so a claim, a resumed plan or a
 * re-provision can never resurrect a blog whose deletion is under way.
 */
export interface AutoseopilotManagedPurgeIntents {
  /**
   * Writes the purge intent in ONE atomic statement, but only while the
   * binding is still revoked, still past ITS OWN claim-window deadline, still
   * the same lifecycle the candidate was selected at, its workspace still
   * never claimed VibeCMS Cloud and no claim checkout blocked the purge
   * inside its guard window. Returns the intent (the new one, or the one an
   * earlier run left behind) or null when the guard did not hold and nothing
   * is deleted.
   */
  acquirePurgeIntent(request: ManagedPurgeIntentRequest): Promise<ManagedPurgeIntent | null>;
  /** The intents left behind by earlier runs, so a crashed purge can resume. */
  listPurgeIntents(page: { limit?: number; cursor?: string | null }): Promise<ManagedPurgeIntent[]>;
  getPurgeIntentBySiteId(siteId: string): Promise<ManagedPurgeIntent | null>;
  getPurgeIntentByWorkspaceId(workspaceId: string): Promise<ManagedPurgeIntent | null>;
  /**
   * The intent of a purge that is still under way. A finished intent is only
   * the trace of a deleted blog, so it must not block a new purchase.
   */
  getActivePurgeIntentByWorkspaceId(workspaceId: string): Promise<ManagedPurgeIntent | null>;
  getPurgeIntentByExternalWorkspaceId(externalWorkspaceId: string): Promise<ManagedPurgeIntent | null>;
  /**
   * Removes the intent of a blog that is still alive: the purge was refused
   * (the blog was claimed after all), so the intent must never block it
   * again.
   */
  deletePurgeIntent(siteId: string): Promise<void>;
  /**
   * Marks the intent as finished: the blog is gone. The row stays behind as
   * the durable trace, so a paid webhook that arrives late is recognised
   * instead of turning a deleted blog into a paid workspace with no notice.
   */
  completePurgeIntent(siteId: string, now: number): Promise<void>;
  /** Records a claim checkout that may still turn into a paid claim. */
  recordClaimCheckoutAttempt(workspaceId: string, now: number, expiresAt: number): Promise<void>;
  /**
   * Marks the attempt as resolved (the webhook landed). The row stays: the
   * attempt still blocks the purge until its guard window ends.
   */
  resolveClaimCheckoutAttempt(workspaceId: string, now: number): Promise<void>;
  /** Drops the attempts whose guard window ended, so the ledger stays small. */
  deleteExpiredClaimCheckoutAttempts(now: number): Promise<void>;
  /** True while a recorded claim checkout could still become a paid claim. */
  hasUnresolvedClaimCheckout(workspaceId: string, now: number): Promise<boolean>;
  /** Records a paid Polar event for a blog that is purged or being purged. */
  recordPurgeConflict(conflict: ManagedPurgeConflictInput): Promise<ManagedPurgeConflict>;
  /** The recorded conflicts, newest first. */
  listPurgeConflicts(workspaceId?: string): Promise<ManagedPurgeConflict[]>;
}
export interface AutoseopilotManagedSitesRepository
  extends AutoseopilotManagedSitesClaimSweep,
    AutoseopilotManagedPurgeIntents {
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
  /** Reports whether this invocation inserted the binding or replayed it. */
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
         b.past_due_since AS polar_past_due_since,
         m.entitlement_status AS managed_status,
         m.entitlement_expires_at AS managed_expires_at,
         m.revoked_at AS managed_revoked_at
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
      polar_past_due_since: number | null;
      managed_status: ManagedEntitlementStatus | null;
      managed_expires_at: number | null;
      managed_revoked_at: number | null;
    }>();
  if (!row) return null;
  return evaluateEffectiveHostedEntitlement(
    {
      selfHosted: options.selfHosted,
      polar: {
        status: row.polar_status,
        currentPeriodEnd: row.polar_current_period_end,
        pastDueSince: row.polar_past_due_since,
      },
      managedSponsorship: {
        status: row.managed_status,
        expiresAt: row.managed_expires_at,
        revokedAt: row.managed_revoked_at,
      },
    },
    options.now,
  );
}

interface ManagedPurgeIntentRaw {
  id: string;
  site_id: string;
  workspace_id: string;
  external_workspace_id: string;
  owner_user_id: string;
  hostname_ids_json: string;
  r2_prefixes_json: string;
  revoked_at: number;
  deadline: number;
  lifecycle_revision: number;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** The recorded resources are JSON arrays; a broken one must not crash a sweep. */
function parseJsonStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function mapPurgeIntent(row: ManagedPurgeIntentRaw): ManagedPurgeIntent {
  return {
    id: row.id,
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    externalWorkspaceId: row.external_workspace_id,
    ownerUserId: row.owner_user_id,
    hostnameIds: parseJsonStringArray(row.hostname_ids_json),
    r2Prefixes: parseJsonStringArray(row.r2_prefixes_json),
    revokedAt: Number(row.revoked_at),
    deadline: Number(row.deadline),
    lifecycleRevision: Number(row.lifecycle_revision),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : Number(row.completed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Reads a purge intent. `activeOnly` skips the finished ones: a finished
 * intent is the trace of a deleted blog, not a purge in flight, so it must
 * never block a claim, a resumed plan or a re-provision.
 */
async function readPurgeIntentBy(
  db: D1Database,
  column: "site_id" | "workspace_id" | "external_workspace_id",
  value: string,
  options?: { activeOnly?: boolean },
): Promise<ManagedPurgeIntent | null> {
  const row = await db
    .prepare(
      `SELECT * FROM autoseopilot_purge_intents
       WHERE ${column} = ?${options?.activeOnly ? " AND completed_at IS NULL" : ""}
       LIMIT 1`,
    )
    .bind(value)
    .first<ManagedPurgeIntentRaw>();
  return row ? mapPurgeIntent(row) : null;
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
             b.past_due_since AS polar_past_due_since,
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
          polar_past_due_since: number | null;
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
                pastDueSince: row.polar_past_due_since,
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

      // The managed ids are derived from the external workspace, so a
      // provision while a purge is under way would rebuild the same site and
      // the same R2 namespace the cleanup is still emptying. A finished
      // intent is only the trace of a deleted blog: it must not block a
      // re-provision, or the customer could never get their blog back.
      const purgeIntent = await readPurgeIntentBy(
        db,
        "external_workspace_id",
        input.binding.externalWorkspaceId,
        { activeOnly: true },
      );
      if (purgeIntent) throw new Error("managed_purge_in_progress");

      // Recovery/read-after-timeout path: the unique external workspace
      // identity is checked before any dependent insert. Exact replay
      // classification (HTTP 200 vs conflict/stale) remains an app concern,
      // but the repository never creates a second site/key for a replay.
      const existing = await readSnapshot(db, input.binding.externalWorkspaceId);

      if (existing) {
        const error = replayError(existing, input, email);
        if (error) throw error;
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
        db
          .prepare(
            `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
             SELECT ?, ?, ?, 0, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM user WHERE email = ?)`,
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
             WHERE EXISTS (SELECT 1 FROM user WHERE email = ?)`,
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
             WHERE owner.email = ?`,
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
             WHERE owner.email = ?`,
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
             WHERE owner.email = ?`,
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
      // A blog whose purge is under way must not come back: the intent is the
      // irreversible decision to delete it, and its domain and media may
      // already be gone. The caller turns this into a retryable failure. A
      // finished intent is only the trace of a deleted blog, so a plan that
      // resumes afterwards may bring the blog back.
      if (beforeRotation) {
        const intent = await readPurgeIntentBy(db, "site_id", beforeRotation.siteId, {
          activeOnly: true,
        });
        if (intent) throw new Error("managed_purge_in_progress");
      }
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

      const applied = (results[2]?.meta.changes ?? 0) > 0;
      if (!applied && beforeRotation) {
        // The intent can land between the guard above and this batch; a
        // rotation that did not apply because of it is a retryable refusal,
        // not a stale generation.
        const intent = await readPurgeIntentBy(db, "site_id", beforeRotation.siteId, {
          activeOnly: true,
        });
        if (intent) throw new Error("managed_purge_in_progress");
      }
      const snapshot = await readSnapshot(db, input.externalWorkspaceId);
      return { applied, snapshot };
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

    async listClaimSweepCandidates(page) {
      const limit = Math.min(Math.max(page.limit ?? 200, 1), 500);
      // Only rows with something due: the first reminder day, or the purge.
      // Everything else is left alone until its day comes.
      const dueBefore = page.now - MANAGED_CLAIM_WINDOW.graceSeconds;
      const cursor = page.cursor ?? null;
      const { results } = await db
        .prepare(
          `SELECT
             m.id,
             m.external_workspace_id,
             m.owner_user_id,
             lower(u.email) AS owner_email,
             m.workspace_id,
             w.name AS workspace_name,
             m.site_id,
             s.name AS site_name,
             s.slug AS site_slug,
             m.revoked_at,
             m.lifecycle_revision,
             m.claim_day7_sent_at,
             m.claim_day14_sent_at,
             m.claim_day21_sent_at,
             m.claim_day28_sent_at
           FROM autoseopilot_managed_sites m
           INNER JOIN user u ON u.id = m.owner_user_id
           INNER JOIN workspaces w ON w.id = m.workspace_id
           INNER JOIN sites s ON s.id = m.site_id
           LEFT JOIN billing_customers b ON b.workspace_id = m.workspace_id
           WHERE m.entitlement_status = 'revoked'
             AND m.revoked_at IS NOT NULL
             AND m.revoked_at <= ?
             AND (b.status IS NULL OR b.status = 'none')
             AND (m.revoked_at > ? OR (m.revoked_at = ? AND m.id > ?))
           ORDER BY m.revoked_at ASC, m.id ASC
           LIMIT ?`,
        )
        .bind(
          dueBefore,
          cursor?.revokedAt ?? -1,
          cursor?.revokedAt ?? -1,
          cursor?.id ?? "",
          limit + 1,
        )
        .all<{
          id: string;
          external_workspace_id: string;
          owner_user_id: string;
          owner_email: string;
          workspace_id: string;
          workspace_name: string;
          site_id: string;
          site_name: string;
          site_slug: string;
          revoked_at: number;
          lifecycle_revision: number;
          claim_day7_sent_at: number | null;
          claim_day14_sent_at: number | null;
          claim_day21_sent_at: number | null;
          claim_day28_sent_at: number | null;
        }>();
      const rows = results ?? [];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];
      return {
        candidates: pageRows.map((row) => ({
          id: row.id,
          externalWorkspaceId: row.external_workspace_id,
          ownerUserId: row.owner_user_id,
          ownerEmail: row.owner_email,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          siteId: row.site_id,
          siteName: row.site_name,
          siteSlug: row.site_slug,
          revokedAt: Number(row.revoked_at),
          lifecycleRevision: Number(row.lifecycle_revision),
          claimDay7SentAt: row.claim_day7_sent_at,
          claimDay14SentAt: row.claim_day14_sent_at,
          claimDay21SentAt: row.claim_day21_sent_at,
          claimDay28SentAt: row.claim_day28_sent_at,
        })),
        cursor: hasMore && last ? { revokedAt: Number(last.revoked_at), id: last.id } : null,
      };
    },

    async markClaimReminderSent(externalWorkspaceId, day, timestamp) {
      const column = claimReminderColumn(day);
      const result = await db
        .prepare(
          `UPDATE autoseopilot_managed_sites
           SET ${column} = ?
           WHERE external_workspace_id = ?
             AND entitlement_status = 'revoked'
             AND ${column} IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM billing_customers b
               WHERE b.workspace_id = autoseopilot_managed_sites.workspace_id
                 AND b.status IS NOT NULL
                 AND b.status != 'none'
             )`,
        )
        .bind(timestamp, externalWorkspaceId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async clearClaimReminderSent(externalWorkspaceId, day, timestamp) {
      const column = claimReminderColumn(day);
      await db
        .prepare(
          `UPDATE autoseopilot_managed_sites
           SET ${column} = NULL
           WHERE external_workspace_id = ?
             AND ${column} = ?`,
        )
        .bind(externalWorkspaceId, timestamp)
        .run();
    },

    async acquirePurgeIntent(request) {
      // ONE atomic statement. The intent appears only while the binding is
      // still revoked, still past ITS OWN claim-window deadline, still the
      // same lifecycle the candidate was selected at, its workspace still
      // never claimed VibeCMS Cloud, and no claim checkout blocked the purge
      // inside its guard window. The hostname ids are read from the site's
      // own domain rows in the same statement, so the recorded resources are
      // the ones the purge deletes.
      //
      // A finished intent (a blog that was purged before) is replaced by the
      // new one: the blog may have been provisioned again, and the new
      // lifecycle must be able to purge its own blog.
      await db
        .prepare(
          `INSERT INTO autoseopilot_purge_intents (
             id, site_id, workspace_id, external_workspace_id, owner_user_id,
             hostname_ids_json, r2_prefixes_json, revoked_at, deadline,
             lifecycle_revision, created_at, updated_at
           )
           SELECT
             'purge-' || m.site_id,
             m.site_id,
             m.workspace_id,
             m.external_workspace_id,
             m.owner_user_id,
             (
               SELECT COALESCE(json_group_array(d.cloudflare_custom_hostname_id), '[]')
               FROM domains d
               WHERE d.site_id = m.site_id AND d.cloudflare_custom_hostname_id IS NOT NULL
             ),
             ?,
             m.revoked_at,
             m.revoked_at + ?,
             m.lifecycle_revision,
             ?,
             ?
           FROM autoseopilot_managed_sites m
           WHERE m.id = ?
             AND m.external_workspace_id = ?
             AND m.workspace_id = ?
             AND m.site_id = ?
             AND m.owner_user_id = ?
             AND m.entitlement_status = 'revoked'
             AND m.revoked_at IS NOT NULL
             AND m.revoked_at = ?
             AND m.lifecycle_revision = ?
             AND m.revoked_at + ? <= ?
             AND NOT EXISTS (
               SELECT 1 FROM billing_customers b
               WHERE b.workspace_id = m.workspace_id
                 AND b.status IS NOT NULL AND b.status != 'none'
             )
             AND NOT EXISTS (
               SELECT 1 FROM autoseopilot_claim_checkouts c
               WHERE c.workspace_id = m.workspace_id AND c.guard_until > ?
             )
           ON CONFLICT(site_id) DO UPDATE SET
             id = excluded.id,
             external_workspace_id = excluded.external_workspace_id,
             owner_user_id = excluded.owner_user_id,
             hostname_ids_json = excluded.hostname_ids_json,
             r2_prefixes_json = excluded.r2_prefixes_json,
             revoked_at = excluded.revoked_at,
             deadline = excluded.deadline,
             lifecycle_revision = excluded.lifecycle_revision,
             completed_at = NULL,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at
           WHERE autoseopilot_purge_intents.completed_at IS NOT NULL`,
        )
        .bind(
          JSON.stringify(request.r2Prefixes),
          MANAGED_CLAIM_WINDOW.windowSeconds,
          request.now,
          request.now,
          request.bindingId,
          request.externalWorkspaceId,
          request.workspaceId,
          request.siteId,
          request.ownerUserId,
          request.revokedAt,
          request.lifecycleRevision,
          MANAGED_CLAIM_WINDOW.windowSeconds,
          request.now,
          request.now,
        )
        .run();
      // The intent of this site: the one just written, or the one an earlier
      // run left behind (a crashed purge resumes from it).
      return readPurgeIntentBy(db, "site_id", request.siteId);
    },

    async listPurgeIntents(page) {
      const limit = Math.min(Math.max(page.limit ?? 100, 1), 500);
      const { results } = await db
        .prepare(
          `SELECT * FROM autoseopilot_purge_intents
           WHERE site_id > ? AND completed_at IS NULL
           ORDER BY site_id ASC
           LIMIT ?`,
        )
        .bind(page.cursor ?? "", limit)
        .all<ManagedPurgeIntentRaw>();
      return (results ?? []).map(mapPurgeIntent);
    },

    async getPurgeIntentBySiteId(siteId) {
      return readPurgeIntentBy(db, "site_id", siteId);
    },

    async getPurgeIntentByWorkspaceId(workspaceId) {
      return readPurgeIntentBy(db, "workspace_id", workspaceId);
    },

    async getActivePurgeIntentByWorkspaceId(workspaceId) {
      return readPurgeIntentBy(db, "workspace_id", workspaceId, { activeOnly: true });
    },

    async getPurgeIntentByExternalWorkspaceId(externalWorkspaceId) {
      return readPurgeIntentBy(db, "external_workspace_id", externalWorkspaceId);
    },

    async deletePurgeIntent(siteId) {
      await db.prepare(`DELETE FROM autoseopilot_purge_intents WHERE site_id = ?`).bind(siteId).run();
    },

    async completePurgeIntent(siteId, now) {
      // The blog is gone, so the intent stays as its trace. A late paid
      // webhook finds it and is escalated instead of silently making a
      // deleted blog a paid workspace.
      await db
        .prepare(
          `UPDATE autoseopilot_purge_intents
           SET completed_at = ?, updated_at = ?
           WHERE site_id = ?`,
        )
        .bind(now, now, siteId)
        .run();
    },

    async recordClaimCheckoutAttempt(workspaceId, now, expiresAt) {
      await db
        .prepare(
          `INSERT INTO autoseopilot_claim_checkouts (workspace_id, created_at, expires_at, guard_until)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             created_at = excluded.created_at,
             expires_at = excluded.expires_at,
             guard_until = excluded.guard_until,
             resolved_at = NULL`,
        )
        .bind(workspaceId, now, expiresAt, now + MANAGED_CLAIM_CHECKOUT_GUARD_SECONDS)
        .run();
    },

    async resolveClaimCheckoutAttempt(workspaceId, now) {
      // The attempt is resolved, not deleted: it still blocks the purge until
      // its guard window ends. Polar's checkout expiry and a delayed webhook
      // can land anywhere in that window.
      await db
        .prepare(
          `UPDATE autoseopilot_claim_checkouts
           SET resolved_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(now, workspaceId)
        .run();
    },

    async deleteExpiredClaimCheckoutAttempts(now) {
      await db
        .prepare(`DELETE FROM autoseopilot_claim_checkouts WHERE guard_until <= ?`)
        .bind(now)
        .run();
    },

    async hasUnresolvedClaimCheckout(workspaceId, now) {
      const row = await db
        .prepare(
          `SELECT 1 AS ok
           FROM autoseopilot_claim_checkouts
           WHERE workspace_id = ? AND resolved_at IS NULL AND expires_at > ?
           LIMIT 1`,
        )
        .bind(workspaceId, now)
        .first<{ ok: number }>();
      return row !== null;
    },

    async recordPurgeConflict(conflict) {
      const id = `purge-conflict-${conflict.workspaceId}-${conflict.eventId ?? conflict.now}`;
      await db
        .prepare(
          `INSERT INTO autoseopilot_purge_conflicts (
             id, workspace_id, site_id, polar_customer_id, polar_subscription_id,
             polar_order_id, polar_checkout_id, event_id, event_type,
             applied_status, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             site_id = excluded.site_id,
             polar_customer_id = excluded.polar_customer_id,
             polar_subscription_id = excluded.polar_subscription_id,
             polar_order_id = excluded.polar_order_id,
             polar_checkout_id = excluded.polar_checkout_id,
             applied_status = excluded.applied_status`,
        )
        .bind(
          id,
          conflict.workspaceId,
          conflict.siteId ?? null,
          conflict.polarCustomerId ?? null,
          conflict.polarSubscriptionId ?? null,
          conflict.polarOrderId ?? null,
          conflict.polarCheckoutId ?? null,
          conflict.eventId ?? null,
          conflict.eventType ?? null,
          conflict.appliedStatus ?? null,
          conflict.now,
        )
        .run();
      return {
        id,
        workspaceId: conflict.workspaceId,
        siteId: conflict.siteId ?? null,
        polarCustomerId: conflict.polarCustomerId ?? null,
        polarSubscriptionId: conflict.polarSubscriptionId ?? null,
        polarOrderId: conflict.polarOrderId ?? null,
        polarCheckoutId: conflict.polarCheckoutId ?? null,
        eventId: conflict.eventId ?? null,
        eventType: conflict.eventType ?? null,
        appliedStatus: conflict.appliedStatus ?? null,
        createdAt: conflict.now,
      };
    },

    async listPurgeConflicts(workspaceId) {
      const { results } = await db
        .prepare(
          `SELECT * FROM autoseopilot_purge_conflicts
           ${workspaceId ? "WHERE workspace_id = ?" : ""}
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .bind(...(workspaceId ? [workspaceId] : []))
        .all<Record<string, unknown>>();
      return (results ?? []).map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        siteId: row.site_id === null ? null : String(row.site_id),
        polarCustomerId: row.polar_customer_id === null ? null : String(row.polar_customer_id),
        polarSubscriptionId: row.polar_subscription_id === null ? null : String(row.polar_subscription_id),
        polarOrderId: row.polar_order_id === null ? null : String(row.polar_order_id),
        polarCheckoutId: row.polar_checkout_id === null ? null : String(row.polar_checkout_id),
        eventId: row.event_id === null ? null : String(row.event_id),
        eventType: row.event_type === null ? null : String(row.event_type),
        appliedStatus: row.applied_status === null ? null : String(row.applied_status),
        createdAt: Number(row.created_at),
      }));
    },

    async purgeRevokedManagedSite(input) {
      // One transactional batch. The first statement is the guard: it deletes
      // the binding only while the site is still revoked past its own
      // deadline, the workspace still has never claimed Cloud, and the purge
      // intent that authorized the cleanup is still there. Every later
      // statement is conditioned on the binding (or dependent rows) already
      // being gone, so a racing claim/resume leaves the whole batch a no-op.
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM autoseopilot_managed_sites
             WHERE external_workspace_id = ?
               AND workspace_id = ?
               AND site_id = ?
               AND entitlement_status = 'revoked'
               AND revoked_at IS NOT NULL
               AND revoked_at + ? <= ?
               AND EXISTS (
                 SELECT 1 FROM autoseopilot_purge_intents p
                 WHERE p.id = ? AND p.site_id = ? AND p.external_workspace_id = ?
               )
               AND NOT EXISTS (
                 SELECT 1 FROM billing_customers b
                 WHERE b.workspace_id = ? AND b.status IS NOT NULL AND b.status != 'none'
               )`,
          )
          .bind(
            input.externalWorkspaceId,
            input.workspaceId,
            input.siteId,
            MANAGED_CLAIM_WINDOW.windowSeconds,
            input.now,
            input.intentId,
            input.siteId,
            input.externalWorkspaceId,
            input.workspaceId,
          ),
        db
          .prepare(
            `DELETE FROM sites
             WHERE id = ?
               AND EXISTS (
                 SELECT 1 FROM autoseopilot_purge_intents p
                 WHERE p.id = ? AND p.site_id = sites.id
               )
               AND NOT EXISTS (SELECT 1 FROM autoseopilot_managed_sites m WHERE m.site_id = sites.id)`,
          )
          .bind(input.siteId, input.intentId),
        db
          .prepare(
            `DELETE FROM workspaces
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.workspace_id = workspaces.id)
               AND NOT EXISTS (
                 SELECT 1 FROM autoseopilot_managed_sites m WHERE m.workspace_id = workspaces.id
               )`,
          )
          .bind(input.workspaceId),
        db
          .prepare(
            `DELETE FROM user
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM memberships ms WHERE ms.user_id = user.id)`,
          )
          .bind(input.ownerUserId),
      ]);
      return (results[0]?.meta.changes ?? 0) > 0;
    },
   };

  return repository;
}
