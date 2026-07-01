import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Presentation } from "@vc/config";
import { createDbClient } from "../client";
import { billingCustomers, domains, posts, sites } from "../schema";

// Public site read model: site fields + LEFT-joined billing status/period + correlated published count.
export interface PublicSiteRow {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  theme: string;
  description: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  billingStatus: string | null;
  currentPeriodEnd: number | null;
  publishedCount: number;
}

// Published-post list projection (detail adds presentation_json + parsed presentation).
export interface PublicPostRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverAssetId: string | null;
  publishedAt: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  tagsJson: string;
}

// Detail projection (getPublishedPost): list fields + raw presentation JSON + parsed presentation.
export interface PublicPostDetailRow extends PublicPostRow {
  presentationJson: string | null;
  presentation: Presentation | null;
}

// Published-post column projection shared by list/detail/tag/search reads.
const publishedColumns = {
  id: posts.id,
  title: posts.title,
  slug: posts.slug,
  excerpt: posts.excerpt,
  contentMarkdown: posts.contentMarkdown,
  coverAssetId: posts.coverAssetId,
  publishedAt: posts.publishedAt,
  seoTitle: posts.seoTitle,
  seoDescription: posts.seoDescription,
  tagsJson: posts.tagsJson,
};

// Site projection shared by host/slug resolution: billing fields come from the LEFT JOIN (nullable).
const siteResolveColumns = {
  id: sites.id,
  workspaceId: sites.workspaceId,
  name: sites.name,
  slug: sites.slug,
  theme: sites.theme,
  description: sites.description,
  defaultSeoTitle: sites.defaultSeoTitle,
  defaultSeoDescription: sites.defaultSeoDescription,
  billingStatus: billingCustomers.status,
  currentPeriodEnd: billingCustomers.currentPeriodEnd,
  publishedCount: sql<number>`(select count(*) from ${posts} where ${posts.siteId} = ${sites.id} and ${posts.status} = 'published')`.mapWith(Number),
};

export interface PublicBlogReadModel {
  resolveSiteByHost(host: string): Promise<PublicSiteRow | null>;
  resolveSiteBySlug(slug: string): Promise<PublicSiteRow | null>;
  getPublishedPost(siteId: string, slug: string, now: number): Promise<PublicPostDetailRow | null>;
  listPublishedPosts(siteId: string, now: number): Promise<PublicPostRow[]>;
  listPublishedPostsByTag(siteId: string, tag: string, now: number): Promise<PublicPostRow[]>;
  searchPublishedPosts(siteId: string, query: string, now: number): Promise<PublicPostRow[]>;
}

// Escape LIKE pattern metacharacters (\, %, _) so user input matches literally under ESCAPE '\'.
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Parse presentation JSON the way the prior app layer did: bad JSON falls back to null.
function parsePresentation(json: string | null): Presentation | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Presentation;
  } catch {
    return null;
  }
}

// Public-blog read model: takes D1Database, builds its own Drizzle client; no env import.
// `now` (epoch seconds) is passed in by the app so the read model stays env-free.
export function createPublicBlogReadModel(db: D1Database): PublicBlogReadModel {
  const client = createDbClient(db);

  return {
    async resolveSiteByHost(host: string) {
      // domains INNER JOIN sites LEFT JOIN billing_customers; active domain + active site filters.
      const rows = await client
        .select(siteResolveColumns)
        .from(domains)
        .innerJoin(sites, eq(sites.id, domains.siteId))
        .leftJoin(billingCustomers, eq(billingCustomers.workspaceId, sites.workspaceId))
        .where(and(eq(domains.hostname, host), eq(domains.status, "active"), eq(sites.status, "active")))
        .limit(1);
      return rows[0] ?? null;
    },

    async resolveSiteBySlug(slug: string) {
      const rows = await client
        .select(siteResolveColumns)
        .from(sites)
        .leftJoin(billingCustomers, eq(billingCustomers.workspaceId, sites.workspaceId))
        .where(and(eq(sites.slug, slug), eq(sites.status, "active")))
        .limit(1);
      return rows[0] ?? null;
    },

    async getPublishedPost(siteId: string, slug: string, now: number) {
      const rows = await client
        .select({ ...publishedColumns, presentationJson: posts.presentationJson })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.slug, slug),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
            lte(posts.publishedAt, now),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const { presentationJson, ...rest } = row;
      return { ...rest, presentationJson, presentation: parsePresentation(presentationJson) };
    },

    async listPublishedPosts(siteId: string, now: number) {
      return client
        .select(publishedColumns)
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
            lte(posts.publishedAt, now),
          ),
        )
        .orderBy(desc(posts.publishedAt));
    },

    async listPublishedPostsByTag(siteId: string, tag: string, now: number) {
      if (!tag) return [];
      // json_each over tags_json is not modeled as a table by Drizzle; keep it as a typed sql fragment.
      return client
        .select(publishedColumns)
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
            lte(posts.publishedAt, now),
            sql`exists (select 1 from json_each(${posts.tagsJson}) where value = ${tag})`,
          ),
        )
        .orderBy(desc(posts.publishedAt));
    },

    async searchPublishedPosts(siteId: string, query: string, now: number) {
      const trimmed = query.trim().slice(0, 100);
      if (!trimmed) return [];
      const pattern = "%" + escapeLike(trimmed) + "%";
      // One parenthesized OR group: title/excerpt/content LIKE plus tags json_each LIKE, all ESCAPE '\'.
      return client
        .select(publishedColumns)
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
            lte(posts.publishedAt, now),
            sql`(${posts.title} like ${pattern} escape '\\' or ${posts.excerpt} like ${pattern} escape '\\' or ${posts.contentMarkdown} like ${pattern} escape '\\' or exists (select 1 from json_each(${posts.tagsJson}) where value like ${pattern} escape '\\'))`,
          ),
        )
        .orderBy(desc(posts.publishedAt));
    },
  };
}
