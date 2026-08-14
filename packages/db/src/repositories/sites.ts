import { and, eq } from "drizzle-orm";
import { createDbClient } from "../client";
import { activityEvents, domains, memberships, sites, workspaces } from "../schema";

type ActorType = "human" | "agent" | "api_key" | "system";

// SELECT id, name, slug, description, created_at, updated_at FROM sites
export interface CurrentSite {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SiteSlugLookup {
  id: string;
  slug: string;
  status: "active" | "archived";
}

// SELECT name, slug, description, default_seo_title FROM sites (onboarding setup read)
export interface SiteSetup {
  name: string;
  slug: string;
  description: string | null;
  defaultSeoTitle: string | null;
  // Theme customizer (Layer 2) — nullable/resolver-default; available to the setup read.
  themeAccent: string | null;
  themeFont: string | null;
  themeMode: string;
}

// SELECT name, description, default_seo_title, default_seo_description, theme, slug FROM sites
export interface SiteSettings {
  name: string;
  description: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  defaultSocialAssetId: string | null;
  theme: string | null;
  slug: string;
  // Theme customizer (Layer 2) — nullable→resolver-default on read.
  themeAccent: string | null;
  themeFont: string | null;
  themeMode: string;
}

export type MembershipRole = "owner" | "editor" | "viewer";

// Activity row carried by the setup/settings write batches (entity is always the site itself).
export interface SiteActivityEntry {
  id: string;
  actorType: ActorType;
  actorId: string;
  actorName: string;
  action: string;
  summary: string;
}

// Five-statement idempotent onboarding batch; caller supplies every id/name/hostname/timestamp.
export interface EnsureOnboardingBaseInput {
  timestamp: number;
  workspace: { id: string; name: string; slug: string };
  membership: { id: string; workspaceId: string; userId: string };
  site: { id: string; workspaceId: string; name: string; slug: string; description: string };
  defaultDomain: { id: string; siteId: string; hostname: string };
  siteCreatedActivity: { id: string; siteId: string; summary: string };
}

export interface CompleteSiteSetupInput {
  timestamp: number;
  siteId: string;
  site: {
    name: string;
    slug: string;
    description: string | null;
    defaultSeoTitle: string;
    defaultSeoDescription: string | null;
  };
  defaultDomainHostname: string;
  activity: SiteActivityEntry;
}

export interface UpdateSiteSettingsInput {
  timestamp: number;
  siteId: string;
  site: {
    name: string;
    description: string | null;
    defaultSeoTitle: string;
    defaultSeoDescription: string | null;
    defaultSocialAssetId: string | null;
    theme: string;
    // Theme customizer (Layer 2) — null accent/font = use resolver default.
    themeAccent: string | null;
    themeFont: string | null;
    themeMode: string;
  };
  activity: SiteActivityEntry;
}

export interface RepairDefaultHostnameInput {
  siteId: string;
  currentHostname: string;
  newHostname: string;
}

export interface SitesRepository {
  getCurrentSite(siteId: string): Promise<CurrentSite | null>;
  getSiteSlug(siteId: string): Promise<string | null>;
  // Exact global slug lookup, including archived sites. Managed provisioning
  // must reserve a slug before its multi-row insert begins.
  getSiteBySlug(slug: string): Promise<SiteSlugLookup | null>;
  getSiteIdBySlug(slug: string): Promise<string | null>;
  getSiteTheme(siteId: string): Promise<string | null>;
  getSiteSetup(siteId: string): Promise<SiteSetup | null>;
  getSiteSettings(siteId: string): Promise<SiteSettings | null>;
  getMembershipRole(workspaceId: string, userId: string): Promise<MembershipRole | null>;
  ensureOnboardingBase(input: EnsureOnboardingBaseInput): Promise<void>;
  completeSiteSetup(input: CompleteSiteSetupInput): Promise<void>;
  updateSiteSettings(input: UpdateSiteSettingsInput): Promise<void>;
  getActiveDefaultHostname(siteId: string): Promise<string | null>;
  repairDefaultHostname(input: RepairDefaultHostnameInput): Promise<string>;
}

// Sites/workspaces/memberships/default-domain persistence extracted from onboarding, operations,
// and cms-dashboard. Takes a D1Database and builds its own Drizzle client; no env import.
export function createSitesRepository(db: D1Database): SitesRepository {
  const client = createDbClient(db);

  return {
    async getCurrentSite(siteId) {
      const rows = await client
        .select({
          id: sites.id,
          name: sites.name,
          slug: sites.slug,
          description: sites.description,
          createdAt: sites.createdAt,
          updatedAt: sites.updatedAt,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0] ?? null;
    },

    async getSiteSlug(siteId) {
      const rows = await client.select({ slug: sites.slug }).from(sites).where(eq(sites.id, siteId)).limit(1);
      return rows[0]?.slug ?? null;
    },

    async getSiteBySlug(slug) {
      const rows = await client
        .select({
          id: sites.id,
          slug: sites.slug,
          status: sites.status,
        })
        .from(sites)
        .where(eq(sites.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    // Resolve a site id from its slug, active sites only (subscribe.ts public flow).
    async getSiteIdBySlug(slug) {
      const rows = await client
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.slug, slug), eq(sites.status, "active")))
        .limit(1);
      return rows[0]?.id ?? null;
    },

    async getSiteTheme(siteId) {
      const rows = await client.select({ theme: sites.theme }).from(sites).where(eq(sites.id, siteId)).limit(1);
      return rows[0]?.theme ?? null;
    },

    async getSiteSetup(siteId) {
      const rows = await client
        .select({
          name: sites.name,
          slug: sites.slug,
          description: sites.description,
          defaultSeoTitle: sites.defaultSeoTitle,
          themeAccent: sites.themeAccent,
          themeFont: sites.themeFont,
          themeMode: sites.themeMode,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0] ?? null;
    },

    async getSiteSettings(siteId) {
      const rows = await client
        .select({
          name: sites.name,
          description: sites.description,
          defaultSeoTitle: sites.defaultSeoTitle,
          defaultSeoDescription: sites.defaultSeoDescription,
          defaultSocialAssetId: sites.defaultSocialAssetId,
          theme: sites.theme,
          slug: sites.slug,
          themeAccent: sites.themeAccent,
          themeFont: sites.themeFont,
          themeMode: sites.themeMode,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0] ?? null;
    },

    async getMembershipRole(workspaceId, userId) {
      const rows = await client
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
        .limit(1);
      return rows[0]?.role ?? null;
    },

    // Atomic 5-row onboarding insert (INSERT OR IGNORE workspace, membership, site, default
    // domain, site.created activity) preserving env.DB.batch transactionality via Drizzle batch.
    async ensureOnboardingBase(input) {
      await client.batch([
        client
          .insert(workspaces)
          .values({
            id: input.workspace.id,
            name: input.workspace.name,
            slug: input.workspace.slug,
            createdAt: input.timestamp,
            updatedAt: input.timestamp,
          })
          .onConflictDoNothing(),
        client
          .insert(memberships)
          .values({
            id: input.membership.id,
            workspaceId: input.membership.workspaceId,
            userId: input.membership.userId,
            role: "owner",
            createdAt: input.timestamp,
            updatedAt: input.timestamp,
          })
          .onConflictDoNothing(),
        client
          .insert(sites)
          .values({
            id: input.site.id,
            workspaceId: input.site.workspaceId,
            name: input.site.name,
            slug: input.site.slug,
            description: input.site.description,
            status: "active",
            createdAt: input.timestamp,
            updatedAt: input.timestamp,
          })
          .onConflictDoNothing(),
        client
          .insert(domains)
          .values({
            id: input.defaultDomain.id,
            siteId: input.defaultDomain.siteId,
            hostname: input.defaultDomain.hostname,
            type: "default",
            status: "active",
            createdAt: input.timestamp,
            updatedAt: input.timestamp,
          })
          .onConflictDoNothing(),
        client
          .insert(activityEvents)
          .values({
            id: input.siteCreatedActivity.id,
            siteId: input.siteCreatedActivity.siteId,
            actorType: "system",
            actorId: "system",
            actorName: "System",
            action: "site.created",
            entityType: "site",
            entityId: input.siteCreatedActivity.siteId,
            summary: input.siteCreatedActivity.summary,
            createdAt: input.timestamp,
          })
          .onConflictDoNothing(),
      ]);
    },

    // Atomic setup completion: UPDATE sites + UPDATE default domain hostname + INSERT activity.
    async completeSiteSetup(input) {
      await client.batch([
        client
          .update(sites)
          .set({
            name: input.site.name,
            slug: input.site.slug,
            description: input.site.description,
            defaultSeoTitle: input.site.defaultSeoTitle,
            defaultSeoDescription: input.site.defaultSeoDescription,
            updatedAt: input.timestamp,
          })
          .where(eq(sites.id, input.siteId)),
        client
          .update(domains)
          .set({ hostname: input.defaultDomainHostname, updatedAt: input.timestamp })
          .where(and(eq(domains.siteId, input.siteId), eq(domains.type, "default"))),
        client.insert(activityEvents).values({
          id: input.activity.id,
          siteId: input.siteId,
          actorType: input.activity.actorType,
          actorId: input.activity.actorId,
          actorName: input.activity.actorName,
          action: input.activity.action,
          entityType: "site",
          entityId: input.siteId,
          summary: input.activity.summary,
          createdAt: input.timestamp,
        }),
      ]);
    },

    // Settings update: two sequential statements (NOT batched) matching the original app path.
    async updateSiteSettings(input) {
      await client
        .update(sites)
        .set({
          name: input.site.name,
          description: input.site.description,
          defaultSeoTitle: input.site.defaultSeoTitle,
          defaultSeoDescription: input.site.defaultSeoDescription,
          defaultSocialAssetId: input.site.defaultSocialAssetId,
          theme: input.site.theme,
          themeAccent: input.site.themeAccent,
          themeFont: input.site.themeFont,
          themeMode: input.site.themeMode,
          updatedAt: input.timestamp,
        })
        .where(eq(sites.id, input.siteId))
        .run();

      await client.insert(activityEvents).values({
        id: input.activity.id,
        siteId: input.siteId,
        actorType: input.activity.actorType,
        actorId: input.activity.actorId,
        actorName: input.activity.actorName,
        action: input.activity.action,
        entityType: "site",
        entityId: input.siteId,
        summary: input.activity.summary,
        createdAt: input.timestamp,
      });
    },

    // Active default-domain hostname SELECT (type='default' AND status='active').
    async getActiveDefaultHostname(siteId) {
      const rows = await client
        .select({ hostname: domains.hostname })
        .from(domains)
        .where(and(eq(domains.siteId, siteId), eq(domains.type, "default"), eq(domains.status, "active")))
        .limit(1);
      return rows[0]?.hostname ?? null;
    },

    // Repair a stale local default hostname to the configured slug zone; returns the hostname to use.
    async repairDefaultHostname(input) {
      await client
        .update(domains)
        .set({ hostname: input.newHostname, updatedAt: Math.floor(Date.now() / 1000) })
        .where(
          and(
            eq(domains.siteId, input.siteId),
            eq(domains.type, "default"),
            eq(domains.hostname, input.currentHostname),
          ),
        )
        .run();
      return input.newHostname;
    },
  };
}
