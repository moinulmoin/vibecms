import { env } from "cloudflare:workers";
import type { Presentation } from "@vc/config";
import { createDataAccess, type PublicPostDetailRow, type PublicPostRow, type PublicSiteRow } from "@vc/db";
import { isLocalDefaultHostname, publicBlogBaseDomain } from "./public-url";

export type SiteRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  theme: string;
  description: string | null;
  default_seo_title: string | null;
  default_seo_description: string | null;
  billing_status: string | null;
  current_period_end: number | null;
  published_count: number | null;
};

export type PostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_markdown: string;
  cover_asset_id: string | null;
  published_at: number | null;
  updated_at: number;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  tags_json: string;
  presentation_json: string | null;
};

/** PostRow extended with parsed presentation intent. Returned by getPublishedPost. */
export type PostDetailRow = PostRow & { presentation: Presentation | null };

// Map the read model's camelCase rows back to this module's long-exported snake_case shapes,
// so public-blog.ts / public-feeds.ts / worker tests keep working unchanged.
function toSiteRow(row: PublicSiteRow): SiteRow {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    slug: row.slug,
    theme: row.theme,
    description: row.description,
    default_seo_title: row.defaultSeoTitle,
    default_seo_description: row.defaultSeoDescription,
    billing_status: row.billingStatus,
    current_period_end: row.currentPeriodEnd,
    published_count: row.publishedCount,
  };
}

function toPostRow(row: PublicPostRow): PostRow {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content_markdown: row.contentMarkdown,
    cover_asset_id: row.coverAssetId,
    published_at: row.publishedAt,
    updated_at: row.updatedAt,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    canonical_url: row.canonicalUrl,
    tags_json: row.tagsJson,
    presentation_json: null,
  };
}

function toPostDetailRow(row: PublicPostDetailRow): PostDetailRow {
  return { ...toPostRow(row), presentation_json: row.presentationJson, presentation: row.presentation };
}

function normalizeHost(request: Request) {
  return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

function appHost() {
  try {
    return new URL(env.APP_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Product hosts (localhost, APP_URL host, apex zone, app.<zone>) never serve a tenant blog.
export function isMarketingHost(request: Request): boolean {
  const host = normalizeHost(request);
  if (!host || isLocalDefaultHostname(host)) return true;
  if (host === appHost()) return true;
  const zone = publicBlogBaseDomain();
  if (zone && (host === zone || host === `app.${zone}`)) return true;
  return false;
}

export async function resolveSite(request: Request): Promise<SiteRow | null> {
  if (isMarketingHost(request)) return null;
  const host = normalizeHost(request);
  const db = createDataAccess(env.DB);
  const row = await db.publicBlog.resolveSiteByHost(host);
  return row ? toSiteRow(row) : null;
}

export async function resolveSiteBySlug(slug: string | undefined): Promise<SiteRow | null> {
  if (!slug) return null;
  const db = createDataAccess(env.DB);
  const row = await db.publicBlog.resolveSiteBySlug(slug);
  return row ? toSiteRow(row) : null;
}

export async function getPublishedPost(siteId: string, slug: string): Promise<PostDetailRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const db = createDataAccess(env.DB);
  const row = await db.publicBlog.getPublishedPost(siteId, slug, now);
  return row ? toPostDetailRow(row) : null;
}

export async function listPublishedPosts(siteId: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const db = createDataAccess(env.DB);
  const rows = await db.publicBlog.listPublishedPosts(siteId, now);
  return rows.map(toPostRow);
}

export function isPublicBlogIndexable(site: SiteRow) {
  return String(env.SELF_HOSTED) === "true" || site.billing_status === "active";
}

export async function listPublishedPostsByTag(siteId: string, tag: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const db = createDataAccess(env.DB);
  const rows = await db.publicBlog.listPublishedPostsByTag(siteId, tag, now);
  return rows.map(toPostRow);
}

export async function searchPublishedPosts(siteId: string, q: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const db = createDataAccess(env.DB);
  const rows = await db.publicBlog.searchPublishedPosts(siteId, q, now);
  return rows.map(toPostRow);
}
