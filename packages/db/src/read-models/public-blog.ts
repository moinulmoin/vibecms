import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Presentation } from "@vc/config";
import { firstParagraph } from "@vc/core";
import { createDbClient } from "../client";
import { assets, billingCustomers, domains, postVersions, posts, sites } from "../schema";

/**
 * Shared public-blog read-model caps. Every public list query must pass a limit;
 * callers use these constants so routes stay bounded and consistent.
 */
export const PUBLIC_BLOG_LIMITS = {
  /** Index / tag / search summary listings (HTML cards). */
  listSummaries: 200,
  /** RSS items that include full Markdown bodies. */
  feedBodies: 50,
  /** sitemap.xml summary URL entries. */
  sitemapSummaries: 10_000,
  /** llms.txt summary links. */
  llmsSummaries: 200,
  /**
   * Newest published posts considered when matching public search.
   * Search is candidate-bound via a LIMIT subquery join (no ID bind list).
   */
  searchCandidates: 500,
} as const;

// Public site read model: site fields + LEFT-joined billing status/period + correlated published count.
export interface PublicSiteRow {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  theme: string;
  // Theme customizer (Layer 2) — nullable→resolver-default on render.
  themeAccent: string | null;
  themeFont: string | null;
  themeMode: string;
  // Template shape knobs — nullable→template default (resolveRadius/resolveWidth).
  themeRadius: string | null;
  themeWidth: string | null;
  // Public byline. Null name → site name at render; the account email is never read here.
  bylineName: string | null;
  showAgentCredit: boolean;
  description: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  defaultSocialAssetId: string | null;
  logoAssetId: string | null;
  faviconAssetId: string | null;
  navLinksJson: string | null;
  socialLinksJson: string | null;
  defaultSocialAssetMimeType: string | null;
  defaultSocialAssetWidth: number | null;
  defaultSocialAssetHeight: number | null;
  defaultSocialAssetAltText: string | null;
  newsletterSettings: string | null;
  billingStatus: string | null;
  currentPeriodEnd: number | null;
  publishedCount: number;
  resolvedDomainType?: "default" | "custom";
}

// Summary projection for index/tag/search/sitemap/llms — no Markdown body.
export interface PublicPostSummaryRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverAssetId: string | null;
  coverAssetMimeType: string | null;
  coverAssetWidth: number | null;
  coverAssetHeight: number | null;
  coverAssetAltText: string | null;
  publishedAt: number | null;
  updatedAt: number;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  tagsJson: string;
}

// Feed/body projection (RSS): summary fields + pinned Markdown body.
export interface PublicPostBodyRow extends PublicPostSummaryRow {
  contentMarkdown: string;
}


// Detail projection (getPublishedPost): body fields + raw presentation JSON + parsed presentation.
export interface PublicPostDetailRow extends PublicPostBodyRow {
  presentationJson: string | null;
  presentation: Presentation | null;
  /** The pinned published version was written by an agent (MCP/CLI/API key), not a human edit. */
  publishedByAgent: boolean;
}

const coverAssetMimeType = sql<string | null>`(
  select ${assets.mimeType} from ${assets}
  where ${assets.id} = ${postVersions.coverAssetId} and ${assets.siteId} = ${posts.siteId}
)`;
const coverAssetWidth = sql<number | null>`(
  select ${assets.width} from ${assets}
  where ${assets.id} = ${postVersions.coverAssetId} and ${assets.siteId} = ${posts.siteId}
)`.mapWith(Number);
const coverAssetHeight = sql<number | null>`(
  select ${assets.height} from ${assets}
  where ${assets.id} = ${postVersions.coverAssetId} and ${assets.siteId} = ${posts.siteId}
)`.mapWith(Number);
const coverAssetAltText = sql<string | null>`(
  select ${assets.altText} from ${assets}
  where ${assets.id} = ${postVersions.coverAssetId} and ${assets.siteId} = ${posts.siteId}
)`;

// Summary projection: content comes from the pinned post_versions row,
// not the mutable posts tip (draft edits stay private until publish).
const summaryColumns = {
  id: posts.id,
  title: postVersions.title,
  slug: postVersions.slug,
  excerpt: sql<string | null>`coalesce(nullif(trim(${postVersions.excerpt}), ''), nullif(${postVersions.fallbackExcerpt}, ''))`,
  // 1 only for a legacy version with no excerpt whose fallback was never
  // computed; '' means "computed, no prose", so it is never recomputed.
  excerptPending: sql<number>`(nullif(trim(${postVersions.excerpt}), '') is null and ${postVersions.fallbackExcerpt} is null)`.mapWith(Number),
  coverAssetId: postVersions.coverAssetId,
  publishedAt: posts.publishedAt,
  updatedAt: postVersions.createdAt,
  seoTitle: postVersions.seoTitle,
  seoDescription: postVersions.seoDescription,
  canonicalUrl: postVersions.canonicalUrl,
  coverAssetMimeType,
  coverAssetWidth,
  coverAssetHeight,
  coverAssetAltText,
  tagsJson: postVersions.tagsJson,
};

// Body projection = summary + pinned Markdown (RSS / article detail base).
const bodyColumns = {
  ...summaryColumns,
  contentMarkdown: postVersions.contentMarkdown,
};

function publishedWhere(siteId: string, now: number) {
  return and(
    eq(posts.siteId, siteId),
    eq(posts.status, "published"),
    isNotNull(posts.publishedAt),
    isNotNull(posts.publishedVersionId),
    lte(posts.publishedAt, now),
    eq(postVersions.id, posts.publishedVersionId),
  );
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  // Hard ceiling = largest legitimate public list (sitemap). Prevents unbounded SELECT.
  return Math.min(Math.floor(limit), PUBLIC_BLOG_LIMITS.sitemapSummaries);
}

// Site projection shared by host/slug resolution: billing fields come from the LEFT JOIN (nullable).
const siteResolveColumns = {
  id: sites.id,
  workspaceId: sites.workspaceId,
  name: sites.name,
  slug: sites.slug,
  theme: sites.theme,
  themeAccent: sites.themeAccent,
  themeFont: sites.themeFont,
  themeMode: sites.themeMode,
  themeRadius: sites.themeRadius,
  themeWidth: sites.themeWidth,
  bylineName: sites.bylineName,
  showAgentCredit: sites.showAgentCredit,
  description: sites.description,
  defaultSeoTitle: sites.defaultSeoTitle,
  defaultSeoDescription: sites.defaultSeoDescription,
  defaultSocialAssetId: sites.defaultSocialAssetId,
  logoAssetId: sites.logoAssetId,
  faviconAssetId: sites.faviconAssetId,
  navLinksJson: sites.navLinksJson,
  socialLinksJson: sites.socialLinksJson,
  defaultSocialAssetMimeType: sql<string | null>`(
    select ${assets.mimeType} from ${assets}
    where ${assets.id} = ${sites.defaultSocialAssetId} and ${assets.siteId} = ${sites.id}
  )`,
  defaultSocialAssetWidth: sql<number | null>`(
    select ${assets.width} from ${assets}
    where ${assets.id} = ${sites.defaultSocialAssetId} and ${assets.siteId} = ${sites.id}
  )`.mapWith(Number),
  defaultSocialAssetHeight: sql<number | null>`(
    select ${assets.height} from ${assets}
    where ${assets.id} = ${sites.defaultSocialAssetId} and ${assets.siteId} = ${sites.id}
  )`.mapWith(Number),
  defaultSocialAssetAltText: sql<string | null>`(
    select ${assets.altText} from ${assets}
    where ${assets.id} = ${sites.defaultSocialAssetId} and ${assets.siteId} = ${sites.id}
  )`,
  newsletterSettings: sites.newsletterSettings,
  billingStatus: billingCustomers.status,
  currentPeriodEnd: billingCustomers.currentPeriodEnd,
  publishedCount: sql<number>`(select count(*) from ${posts} where ${posts.siteId} = ${sites.id} and ${posts.status} = 'published')`.mapWith(Number),
};

export interface PublicBlogReadModel {
  resolveSiteByHost(host: string): Promise<PublicSiteRow | null>;
  resolveSingleSite(): Promise<PublicSiteRow | null>;
  getPublishedPost(siteId: string, slug: string, now: number): Promise<PublicPostDetailRow | null>;
  listPublishedPostSummaries(siteId: string, now: number, limit: number): Promise<PublicPostSummaryRow[]>;
  listPublishedPostSummariesByTag(siteId: string, tag: string, now: number, limit: number): Promise<PublicPostSummaryRow[]>;
  listPublishedPostPage(siteId: string, now: number, limit: number, requestedPage: number, tag?: string): Promise<{ posts: PublicPostSummaryRow[]; total: number; page: number }>;
  searchPublishedPostSummaries(
    siteId: string,
    query: string,
    now: number,
    limit: number,
    candidateLimit?: number,
  ): Promise<PublicPostSummaryRow[]>;
  listPublishedPostsForFeed(siteId: string, now: number, limit: number): Promise<PublicPostBodyRow[]>;
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

function searchMatchSql(pattern: string) {
  // Search the pinned published version only — draft tip fields stay private.
  return sql`(${postVersions.title} like ${pattern} escape '\\' or ${postVersions.excerpt} like ${pattern} escape '\\' or ${postVersions.contentMarkdown} like ${pattern} escape '\\' or exists (select 1 from json_each(${postVersions.tagsJson}) where value like ${pattern} escape '\\'))`;
}

// Public-blog read model: takes D1Database, builds its own Drizzle client; no env import.
// `now` (epoch seconds) is passed in by the app so the read model stays env-free.
export function createPublicBlogReadModel(db: D1Database): PublicBlogReadModel {
  const client = createDbClient(db);

  // Legacy published versions have NULL fallbacks after 0028. The summary
  // query flags them (excerptPending); fill only those, with chunked reads and
  // one batched write, so each version is computed exactly once and a normal
  // request costs nothing extra.
  async function fillMissingExcerpts<T extends PublicPostSummaryRow & { excerptPending?: number }>(siteId: string, rows: T[]): Promise<T[]> {
    const pending = rows.filter((row) => row.excerptPending);
    for (const row of rows) delete row.excerptPending;
    if (pending.length === 0) return rows;
    const byPost = new Map(pending.map((row) => [row.id, row]));
    const updates: D1PreparedStatement[] = [];
    const ids = [...byPost.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const versions = await client.select({
        postId: posts.id,
        versionId: postVersions.id,
        contentMarkdown: postVersions.contentMarkdown,
      }).from(posts).innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(and(eq(posts.siteId, siteId), inArray(posts.id, ids.slice(i, i + 50))));
      for (const version of versions) {
        const fallback = firstParagraph(version.contentMarkdown);
        byPost.get(version.postId)!.excerpt = fallback || null;
        updates.push(db.prepare("UPDATE post_versions SET fallback_excerpt = ? WHERE id = ? AND fallback_excerpt IS NULL").bind(fallback, version.versionId));
      }
    }
    if (updates.length) await db.batch(updates);
    return rows;
  }

  return {
    async resolveSiteByHost(host: string) {
      // domains INNER JOIN sites LEFT JOIN billing_customers; active domain + active site filters.
      const rows = await client
        .select({ ...siteResolveColumns, resolvedDomainType: domains.type })
        .from(domains)
        .innerJoin(sites, eq(sites.id, domains.siteId))
        .leftJoin(billingCustomers, eq(billingCustomers.workspaceId, sites.workspaceId))
        .where(and(eq(domains.hostname, host), eq(domains.status, "active"), eq(sites.status, "active")))
        .limit(1);
      return rows[0] ?? null;
    },

    async resolveSingleSite() {
      const rows = await client
        .select(siteResolveColumns)
        .from(sites)
        .leftJoin(billingCustomers, eq(billingCustomers.workspaceId, sites.workspaceId))
        .where(eq(sites.status, "active"))
        .limit(2);
      return rows.length === 1 ? rows[0] ?? null : null;
    },

    async getPublishedPost(siteId: string, slug: string, now: number) {
      const rows = await client
        .select({
          ...bodyColumns,
          presentationJson: postVersions.presentationJson,
          publishedVersionCreatedByType: postVersions.createdByType,
        })
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(
          and(
            publishedWhere(siteId, now),
            eq(postVersions.slug, slug),
          ),
        )
        .orderBy(posts.id)
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      await fillMissingExcerpts(siteId, [row]);
      const { presentationJson, publishedVersionCreatedByType, ...rest } = row;
      return {
        ...rest,
        presentationJson,
        presentation: parsePresentation(presentationJson),
        publishedByAgent: publishedVersionCreatedByType === "agent" || publishedVersionCreatedByType === "api_key",
      };
    },

    async listPublishedPostSummaries(siteId: string, now: number, limit: number) {
      const capped = clampLimit(limit);
      if (capped === 0) return [];
      const rows = await client
        .select(summaryColumns)
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(publishedWhere(siteId, now))
        .orderBy(desc(posts.publishedAt))
        .limit(capped);
      return fillMissingExcerpts(siteId, rows);
    },

    async listPublishedPostSummariesByTag(siteId: string, tag: string, now: number, limit: number) {
      if (!tag) return [];
      const capped = clampLimit(limit);
      if (capped === 0) return [];
      // json_each over pinned version tags; keep it as a typed sql fragment.
      const rows = await client
        .select(summaryColumns)
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(
          and(
            publishedWhere(siteId, now),
            sql`exists (select 1 from json_each(${postVersions.tagsJson}) where value = ${tag})`,
          ),
        )
        .orderBy(desc(posts.publishedAt))
        .limit(capped);
      return fillMissingExcerpts(siteId, rows);
    },

    async listPublishedPostPage(siteId: string, now: number, limit: number, requestedPage: number, tag?: string) {
      const size = clampLimit(limit);
      const where = tag === undefined
        ? publishedWhere(siteId, now)
        : and(publishedWhere(siteId, now), sql`exists (select 1 from json_each(${postVersions.tagsJson}) where value = ${tag})`);
      const [{ total }] = await client
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(where);
      const pageCount = Math.max(1, Math.ceil(total / Math.max(size, 1)));
      const page = Math.min(Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1), pageCount);
      if (!size || !total) return { posts: [], total, page };
      const pagePosts = await client
        .select(summaryColumns)
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(where)
        .orderBy(desc(posts.publishedAt), desc(posts.id))
        .limit(size)
        .offset((page - 1) * size);
      return { posts: await fillMissingExcerpts(siteId, pagePosts), total, page };
    },

    async searchPublishedPostSummaries(
      siteId: string,
      query: string,
      now: number,
      limit: number,
      candidateLimit: number = PUBLIC_BLOG_LIMITS.searchCandidates,
    ) {
      const trimmed = query.trim().slice(0, 100);
      const capped = clampLimit(limit);
      const candidateCap = clampLimit(candidateLimit);
      if (!trimmed || capped === 0 || candidateCap === 0) return [];
      const pattern = "%" + escapeLike(trimmed) + "%";

      // Candidate-bound search via subquery join — avoids materializing N ids into
      // an inArray bind list (D1/SQLite bind-variable limits break at scale).
      // Candidates are posts-only (publish filters); the outer query joins the
      // pinned version for summary projection + LIKE matching.
      const candidates = client
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
            isNotNull(posts.publishedVersionId),
            lte(posts.publishedAt, now),
          ),
        )
        .orderBy(desc(posts.publishedAt))
        .limit(candidateCap)
        .as("pb_search_candidates");

      const rows = await client
        .select(summaryColumns)
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .innerJoin(candidates, eq(candidates.id, posts.id))
        .where(and(publishedWhere(siteId, now), searchMatchSql(pattern)))
        .orderBy(desc(posts.publishedAt))
        .limit(capped);
      return fillMissingExcerpts(siteId, rows);
    },

    async listPublishedPostsForFeed(siteId: string, now: number, limit: number) {
      const capped = clampLimit(limit);
      if (capped === 0) return [];
      const rows = await client
        .select(bodyColumns)
        .from(posts)
        .innerJoin(postVersions, eq(postVersions.id, posts.publishedVersionId))
        .where(publishedWhere(siteId, now))
        .orderBy(desc(posts.publishedAt))
        .limit(capped);
      return fillMissingExcerpts(siteId, rows);
    },
  };
}
