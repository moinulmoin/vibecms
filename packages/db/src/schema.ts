import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_memberships_workspace_user").on(table.workspaceId, table.userId),
  index("idx_memberships_user_id").on(table.userId),
]);

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoAssetId: text("logo_asset_id"),
  faviconAssetId: text("favicon_asset_id"),
  navLinksJson: text("nav_links_json"),
  socialLinksJson: text("social_links_json"),
  defaultSeoTitle: text("default_seo_title"),
  defaultSeoDescription: text("default_seo_description"),
  defaultSocialAssetId: text("default_social_asset_id"),
  mediaPendingBytes: integer("media_pending_bytes").notNull().default(0),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  theme: text("theme").notNull().default("minimal"),
  // Theme customizer (Layer 2) — additive, nullable→resolver-default.
  // accent/font are nullable so existing rows (and the resolver) fall back to
  // the curated defaults; mode defaults to 'system' (light/dark follows OS).
  themeAccent: text("theme_accent"),
  themeFont: text("theme_font"),
  themeMode: text("theme_mode").notNull().default("system"),
  // Template shape knobs; NULL = the template's default (see @vc/config TEMPLATES).
  themeRadius: text("theme_radius"),
  themeWidth: text("theme_width"),
  themeChrome: text("theme_chrome"),
  themeIndex: text("theme_index"),
  themeHeader: text("theme_header"),
  // Public byline. NULL name falls back to the site name (never the email).
  bylineName: text("byline_name"),
  showAgentCredit: integer("show_agent_credit", { mode: "boolean" }).notNull().default(true),
  // Personalized onboarding (Layer 3) — nullable so pre-personalization rows
  // simply read as "not answered yet". voice_seed_json holds up to 3 writing
  // sample URLs the owner shared so an agent can build the voice profile.
  agentPreference: text("agent_preference"),
  voiceSeedJson: text("voice_seed_json").notNull().default("[]"),
  onboardingNote: text("onboarding_note"),
  // Newsletter copy and visibility are nullable for backwards-compatible defaults.
  newsletterSettings: text("newsletter_settings"),
  ...timestamps,
}, (table) => [index("idx_sites_workspace_id").on(table.workspaceId)]);

export const siteVoiceProfiles = sqliteTable("site_voice_profiles", {
  siteId: text("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }),
  audience: text("audience"),
  voiceSummary: text("voice_summary"),
  guidelinesJson: text("guidelines_json").notNull().default("[]"),
  representativePostIdsJson: text("representative_post_ids_json").notNull().default("[]"),
  updatedByType: text("updated_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  updatedById: text("updated_by_id").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  ...timestamps,
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull(),
  type: text("type", { enum: ["default", "custom", "subpath"] }).notNull(),
  status: text("status", { enum: ["pending", "active", "failed", "disabled"] }).notNull().default("pending"),
  cloudflareCustomHostnameId: text("cloudflare_custom_hostname_id"),
  // Subpath hosting only: the public base path ("/blog") and the rotatable
  // non-guessable id embedded in the proxy target URL. NULL on default/custom.
  basePath: text("base_path"),
  proxyId: text("proxy_id"),
  // First time a subpath row verified live; NULL = never-active claim.
  activatedAt: integer("activated_at"),
  verificationErrorsJson: text("verification_errors_json"),
  ...timestamps,
}, (table) => [
  index("idx_domains_site_id").on(table.siteId),
  index("idx_domains_hostname").on(table.hostname),
  uniqueIndex("idx_domains_proxy_id").on(table.proxyId),
  // default/custom rows still own a hostname exclusively; subpath claims do
  // not (a pending claim proves nothing — see migration 0036).
  uniqueIndex("idx_domains_hostname_exclusive").on(table.hostname).where(sql`type != 'subpath'`),
  // At most one VERIFIED subpath location per hostname.
  uniqueIndex("idx_domains_subpath_active").on(table.hostname).where(sql`type = 'subpath' AND status = 'active'`),
]);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt"),
  contentMarkdown: text("content_markdown").notNull(),
  coverAssetId: text("cover_asset_id"),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  publishedAt: integer("published_at"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  canonicalUrl: text("canonical_url"),
  tagsJson: text("tags_json").notNull().default("[]"),
  presentationJson: text("presentation_json"),
  // Nullable pointer to the immutable version currently live on the public blog.
  publishedVersionId: text("published_version_id"),
  createdByType: text("created_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  createdById: text("created_by_id").notNull(),
  updatedByType: text("updated_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  updatedById: text("updated_by_id").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_posts_site_slug_unique").on(table.siteId, table.slug),
  index("idx_posts_site_status_updated").on(table.siteId, table.status, table.updatedAt),
  index("idx_posts_site_published").on(table.siteId, table.status, table.publishedAt),
  index("idx_posts_published_version_id").on(table.publishedVersionId),
]);

export const postVersions = sqliteTable("post_versions", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt"),
  fallbackExcerpt: text("fallback_excerpt"),
  contentMarkdown: text("content_markdown").notNull(),
  coverAssetId: text("cover_asset_id"),
  status: text("status").notNull(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  canonicalUrl: text("canonical_url"),
  tagsJson: text("tags_json").notNull().default("[]"),
  presentationJson: text("presentation_json"),
  createdByType: text("created_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  createdById: text("created_by_id").notNull(),
  changeSummary: text("change_summary"),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_post_versions_post_number").on(table.postId, table.versionNumber)]);

export const postPreviewTokens = sqliteTable("post_preview_tokens", {
  postId: text("post_id").primaryKey().references(() => posts.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  nonce: text("nonce").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_post_preview_tokens_site_hash").on(table.siteId, table.tokenHash)]);

export const postSchedules = sqliteTable("post_schedules", {
  postId: text("post_id").primaryKey().references(() => posts.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  publishAt: integer("publish_at").notNull(),
  status: text("status", { enum: ["pending", "processing", "published", "failed"] }).notNull(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  scheduledByType: text("scheduled_by_type").notNull(),
  scheduledById: text("scheduled_by_id").notNull(),
  scheduledByName: text("scheduled_by_name").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_post_schedules_due").on(table.status, table.publishAt)]);

export const postSlugRedirects = sqliteTable("post_slug_redirects", {
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  fromSlug: text("from_slug").notNull(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_post_slug_redirects_site_slug").on(table.siteId, table.fromSlug),
  index("idx_post_slug_redirects_post_id").on(table.postId),
]);

export const postSeoReviews = sqliteTable("post_seo_reviews", {
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  model: text("model").notNull(),
  resultJson: text("result_json").notNull(),
  neuronsEstimate: integer("neurons_estimate"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_post_seo_reviews_post_version_model").on(table.postId, table.versionNumber, table.model),
]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull().unique(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  altText: text("alt_text"),
  createdByType: text("created_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  createdById: text("created_by_id").notNull(),
  ...timestamps,
}, (table) => [index("idx_assets_site_id").on(table.siteId)]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopesJson: text("scopes_json").notNull(),
  actorName: text("actor_name").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  createdByUserId: text("created_by_user_id").notNull(),
  ...timestamps,
}, (table) => [index("idx_api_keys_site_id").on(table.siteId), index("idx_api_keys_token_hash").on(table.tokenHash)]);

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  actorType: text("actor_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_activity_site_created").on(table.siteId, table.createdAt)]);

export const billingCustomers = sqliteTable("billing_customers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().unique().references(() => workspaces.id, { onDelete: "cascade" }),
  polarCustomerId: text("polar_customer_id").unique(),
  polarSubscriptionId: text("polar_subscription_id").unique(),
  status: text("status", { enum: ["active", "past_due", "canceled", "unpaid", "none"] }).notNull().default("none"),
  // Polar's current_period_end, epoch SECONDS (shared with entitlement checks).
  currentPeriodEnd: integer("current_period_end"),
  // NULL = unknown (no subscription webhook yet); checkout events leave it unchanged.
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }),
  // Epoch MILLISECONDS of the accepted transition into past_due.
  // NULL for other statuses or an unknown legacy episode (no retroactive grace).
  pastDueSince: integer("past_due_since"),
  webhookEventId: text("webhook_event_id"),
  // Status/customer ordering key, epoch MILLISECONDS (strictly-newer wins).
  webhookUpdatedAt: integer("webhook_updated_at"),
  // Subscription-only fields use a separate strictly-newer millisecond watermark.
  subscriptionUpdatedAt: integer("subscription_updated_at"),
  ...timestamps,
});

export const analyticsRollups = sqliteTable("analytics_rollups", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  granularity: text("granularity", { enum: ["day", "month"] }).notNull(),
  periodStart: text("period_start").notNull(),
  kind: text("kind", { enum: ["page", "post", "referrer", "crawler", "agent", "agent_category", "agent_post", "agent_resource"] }).notNull(),
  dimension: text("dimension").notNull().default(""),
  label: text("label"),
  value: integer("value").notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_analytics_rollups_unique").on(
    table.siteId,
    table.granularity,
    table.periodStart,
    table.kind,
    table.dimension,
  ),
  index("idx_analytics_rollups_site_period").on(table.siteId, table.granularity, table.periodStart),
  index("idx_analytics_rollups_site_kind").on(table.siteId, table.kind, table.granularity, table.periodStart),
]);

export const analyticsRollupState = sqliteTable("analytics_rollup_state", {
  siteId: text("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }),
  lastRolledDate: text("last_rolled_date"),
  ...timestamps,
});

export const usageCounters = sqliteTable("usage_counters", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  siteId: text("site_id").references(() => sites.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  metric: text("metric").notNull(),
  value: integer("value").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("idx_usage_unique").on(table.workspaceId, table.siteId, table.period, table.metric)]);

export const rateLimits = sqliteTable("rate_limits", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  ...timestamps,
}, (table) => [index("idx_rate_limits_expires").on(table.expiresAt)]);

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("idx_user_email_canonical").on(sql`lower(${table.email})`),
]);

export type AuthUser = typeof user.$inferSelect;

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const autoseopilotManagedSites = sqliteTable("autoseopilot_managed_sites", {
  id: text("id").primaryKey(),
  externalWorkspaceId: text("external_workspace_id").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  credentialId: text("credential_id").notNull(),
  credentialGeneration: integer("credential_generation").notNull(),
  apiKeyId: text("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "restrict" }),
  entitlementStatus: text("entitlement_status", { enum: ["active", "revoked"] }).notNull(),
  entitlementExpiresAt: integer("entitlement_expires_at"),
  lifecycleRevision: integer("lifecycle_revision").notNull(),
  createdAt: integer("created_at").notNull(),
  /** Durable sent markers for the claim reminders (epoch seconds). */
  claimDay7SentAt: integer("claim_day7_sent_at"),
  claimDay14SentAt: integer("claim_day14_sent_at"),
  claimDay21SentAt: integer("claim_day21_sent_at"),
  claimDay28SentAt: integer("claim_day28_sent_at"),
  revokedAt: integer("revoked_at"),
  /**
   * When the claim sweep last tried to act on this blog (epoch seconds).
   * A blog the sweep cannot delete yet rotates to the back of the queue,
   * so it can never take the slot of a blog that is still waiting.
   */
  lastSweepAttemptAt: integer("last_sweep_attempt_at"),
}, (table) => [
  uniqueIndex("idx_autoseopilot_managed_external_workspace").on(table.externalWorkspaceId),
  uniqueIndex("idx_autoseopilot_managed_workspace").on(table.workspaceId),
  uniqueIndex("idx_autoseopilot_managed_site").on(table.siteId),
  uniqueIndex("idx_autoseopilot_managed_api_key").on(table.apiKeyId),
  uniqueIndex("idx_autoseopilot_managed_credential_generation").on(
    table.credentialId,
    table.credentialGeneration,
  ),
  index("idx_autoseopilot_managed_owner_user").on(table.ownerUserId),
  index("idx_autoseopilot_managed_claim_sweep").on(table.entitlementStatus, table.revokedAt),
  check(
    "ck_autoseopilot_managed_credential_generation_positive",
    sql`${table.credentialGeneration} > 0`,
  ),
  check(
    "ck_autoseopilot_managed_lifecycle_revision_positive",
    sql`${table.lifecycleRevision} > 0`,
  ),
  check(
    "ck_autoseopilot_managed_status_revoked_at",
    sql`(
      (${table.entitlementStatus} = 'active' AND ${table.revokedAt} IS NULL)
      OR (${table.entitlementStatus} = 'revoked' AND ${table.revokedAt} IS NOT NULL)
    )`,
  ),
]);

/**
 * The durable decision to delete an unclaimed managed blog (claim window).
 * Written in one atomic statement while the blog is still revoked, still past
 * its own deadline and still never claimed; it records the external resources
 * the purge deletes so a crashed run can resume the same cleanup. No foreign
 * key: the purge deletes the site, workspace and user rows, and the intent
 * must outlive them.
 */
export const autoseopilotPurgeIntents = sqliteTable("autoseopilot_purge_intents", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().unique(),
  workspaceId: text("workspace_id").notNull(),
  externalWorkspaceId: text("external_workspace_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  /** JSON array of the Cloudflare custom hostname ids the purge deletes. */
  hostnameIdsJson: text("hostname_ids_json").notNull().default("[]"),
  /** JSON array of the R2 prefixes the purge empties. */
  r2PrefixesJson: text("r2_prefixes_json").notNull().default("[]"),
  /** The revoke the intent was taken for (epoch seconds). */
  revokedAt: integer("revoked_at").notNull(),
  /** The claim-window deadline that had elapsed (epoch seconds). */
  deadline: integer("deadline").notNull(),
  /** The lifecycle revision the intent was taken for. */
  lifecycleRevision: integer("lifecycle_revision").notNull(),
  /**
   * When the purge finished (epoch seconds). A finished intent stays as the
   * durable trace that this blog was deleted, so a late paid webhook is
   * recognised instead of turning a deleted blog into a paid workspace.
   */
  completedAt: integer("completed_at"),
  ...timestamps,
}, (table) => [
  index("idx_autoseopilot_purge_intents_external_workspace").on(table.externalWorkspaceId),
]);

/**
 * A claim checkout in flight. The customer can have paid at Polar before the
 * webhook arrives, so the sweep defers the purge of that workspace while the
 * attempt is unresolved. The attempt expires; it never blocks the purge
 * forever.
 */
export const autoseopilotClaimCheckouts = sqliteTable("autoseopilot_claim_checkouts", {
  workspaceId: text("workspace_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  /**
   * Until when the attempt blocks the purge of the blog (epoch seconds). The
   * guard outlives the checkout itself: a checkout that expired without a
   * webhook may still be paid at Polar days later.
   */
  guardUntil: integer("guard_until").notNull().default(0),
  /** When the attempt was resolved by a webhook (epoch seconds). */
  resolvedAt: integer("resolved_at"),
}, (table) => [index("idx_autoseopilot_claim_checkouts_expires").on(table.expiresAt)]);

/**
 * A paid Polar event that arrived for a blog the purge is deleting, or has
 * already deleted. The row is the operator's record: the customer paid, so
 * the money has to be refunded by hand. It survives the blog's own rows.
 */
export const autoseopilotPurgeConflicts = sqliteTable("autoseopilot_purge_conflicts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  siteId: text("site_id"),
  polarCustomerId: text("polar_customer_id"),
  polarSubscriptionId: text("polar_subscription_id"),
  polarOrderId: text("polar_order_id"),
  polarCheckoutId: text("polar_checkout_id"),
  eventId: text("event_id"),
  eventType: text("event_type"),
  appliedStatus: text("applied_status"),
  /**
   * When the refund notice was accepted (epoch seconds). NULL means the
   * notice is still owed, so it is sent again.
   */
  notifiedAt: integer("notified_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_autoseopilot_purge_conflicts_workspace").on(table.workspaceId),
  index("idx_autoseopilot_purge_conflicts_created").on(table.createdAt),
]);

export const pendingMediaOperations = sqliteTable("pending_media_operations", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["upload_cleanup", "delete"] }).notNull(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  claimedAt: integer("claimed_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (table) => [
  index("idx_pending_media_ops_created").on(table.createdAt),
  index("idx_pending_media_ops_claimed").on(table.claimedAt),
]);

export const subscribers = sqliteTable("subscribers", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "unsubscribed"] }).notNull().default("pending"),
  sourceUrl: text("source_url"),
  consentText: text("consent_text").notNull(),
  consentVersion: text("consent_version").notNull(),
  confirmedAt: integer("confirmed_at"),
  providerId: text("provider_id"),
  ipHash: text("ip_hash"),
  uaHash: text("ua_hash"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_subscribers_site_email").on(table.siteId, table.email),
  index("idx_subscribers_site_id").on(table.siteId),
]);

// Row + insert type aliases for app tables.
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type MembershipRow = typeof memberships.$inferSelect;
export type MembershipInsert = typeof memberships.$inferInsert;
export type SiteRow = typeof sites.$inferSelect;
export type SiteInsert = typeof sites.$inferInsert;
export type SiteVoiceProfileRow = typeof siteVoiceProfiles.$inferSelect;
export type SiteVoiceProfileInsert = typeof siteVoiceProfiles.$inferInsert;
export type DomainRow = typeof domains.$inferSelect;
export type DomainInsert = typeof domains.$inferInsert;
export type PostRow = typeof posts.$inferSelect;
export type PostInsert = typeof posts.$inferInsert;
export type PostVersionRow = typeof postVersions.$inferSelect;
export type PostVersionInsert = typeof postVersions.$inferInsert;
export type AssetRow = typeof assets.$inferSelect;
export type AssetInsert = typeof assets.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type ApiKeyInsert = typeof apiKeys.$inferInsert;
export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type ActivityEventInsert = typeof activityEvents.$inferInsert;
export type BillingCustomerRow = typeof billingCustomers.$inferSelect;
export type BillingCustomerInsert = typeof billingCustomers.$inferInsert;
export type AnalyticsRollupRow = typeof analyticsRollups.$inferSelect;
export type AnalyticsRollupInsert = typeof analyticsRollups.$inferInsert;
export type AnalyticsRollupStateRow = typeof analyticsRollupState.$inferSelect;
export type AnalyticsRollupStateInsert = typeof analyticsRollupState.$inferInsert;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type UsageCounterInsert = typeof usageCounters.$inferInsert;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type RateLimitInsert = typeof rateLimits.$inferInsert;
export type PendingMediaOperationRow = typeof pendingMediaOperations.$inferSelect;
export type PendingMediaOperationInsert = typeof pendingMediaOperations.$inferInsert;
export type SubscriberRow = typeof subscribers.$inferSelect;
export type SubscriberInsert = typeof subscribers.$inferInsert;
export type PostSeoReviewRow = typeof postSeoReviews.$inferSelect;
export type PostSeoReviewInsert = typeof postSeoReviews.$inferInsert;
export type AutoseopilotManagedSiteRow = typeof autoseopilotManagedSites.$inferSelect;
export type AutoseopilotManagedSiteInsert = typeof autoseopilotManagedSites.$inferInsert;
export type AutoseopilotPurgeIntentRow = typeof autoseopilotPurgeIntents.$inferSelect;
export type AutoseopilotPurgeIntentInsert = typeof autoseopilotPurgeIntents.$inferInsert;
export type AutoseopilotClaimCheckoutRow = typeof autoseopilotClaimCheckouts.$inferSelect;
export type AutoseopilotClaimCheckoutInsert = typeof autoseopilotClaimCheckouts.$inferInsert;
