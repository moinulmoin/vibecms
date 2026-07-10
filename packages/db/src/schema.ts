import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  defaultSeoTitle: text("default_seo_title"),
  defaultSeoDescription: text("default_seo_description"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  theme: text("theme").notNull().default("minimal"),
  // Theme customizer (Layer 2) — additive, nullable→resolver-default.
  // accent/font are nullable so existing rows (and the resolver) fall back to
  // the curated defaults; mode defaults to 'system' (light/dark follows OS).
  themeAccent: text("theme_accent"),
  themeFont: text("theme_font"),
  themeMode: text("theme_mode").notNull().default("system"),
  ...timestamps,
}, (table) => [index("idx_sites_workspace_id").on(table.workspaceId)]);

export const siteVoiceProfiles = sqliteTable("site_voice_profiles", {
  siteId: text("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }),
  audience: text("audience"),
  voiceSummary: text("voice_summary"),
  guidelinesJson: text("guidelines_json").notNull().default("[]"),
  representativePostIdsJson: text("representative_post_ids_json").notNull().default("[]"),
  updatedByType: text("updated_by_type", { enum: ["human"] }).notNull(),
  updatedById: text("updated_by_id").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  ...timestamps,
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  type: text("type", { enum: ["default", "custom"] }).notNull(),
  status: text("status", { enum: ["pending", "active", "failed", "disabled"] }).notNull().default("pending"),
  cloudflareCustomHostnameId: text("cloudflare_custom_hostname_id"),
  verificationErrorsJson: text("verification_errors_json"),
  ...timestamps,
}, (table) => [index("idx_domains_site_id").on(table.siteId), index("idx_domains_hostname").on(table.hostname)]);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt"),
  contentMarkdown: text("content_markdown").notNull(),
  coverAssetId: text("cover_asset_id"),
  status: text("status", { enum: ["draft", "published", "scheduled", "archived"] }).notNull().default("draft"),
  publishedAt: integer("published_at"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  canonicalUrl: text("canonical_url"),
  tagsJson: text("tags_json").notNull().default("[]"),
  presentationJson: text("presentation_json"),
  createdByType: text("created_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  createdById: text("created_by_id").notNull(),
  updatedByType: text("updated_by_type", { enum: ["human", "agent", "api_key", "system"] }).notNull(),
  updatedById: text("updated_by_id").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_posts_site_slug_unique").on(table.siteId, table.slug),
  index("idx_posts_site_status_updated").on(table.siteId, table.status, table.updatedAt),
  index("idx_posts_site_published").on(table.siteId, table.status, table.publishedAt),
]);

export const postVersions = sqliteTable("post_versions", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt"),
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
  currentPeriodEnd: integer("current_period_end"),
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
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

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
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type UsageCounterInsert = typeof usageCounters.$inferInsert;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type RateLimitInsert = typeof rateLimits.$inferInsert;
export type SubscriberRow = typeof subscribers.$inferSelect;
export type SubscriberInsert = typeof subscribers.$inferInsert;
