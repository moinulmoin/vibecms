import { hasActiveSubscription, type Presentation } from "@vc/config";
import {
  createDataAccess,
  PUBLIC_BLOG_LIMITS,
  type PublicPostBodyRow,
  type PublicPostDetailRow,
  type PublicPostSummaryRow,
  type PublicSiteRow,
} from "@vc/db";
import type { PublicRuntimeEnv } from "../env";
import { isLocalDefaultHostname, publicBlogBaseDomain } from "./public-url";

export { PUBLIC_BLOG_LIMITS };

export type SiteRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  theme: string;
  theme_accent: string | null;
  theme_font: string | null;
  theme_mode: string;
  description: string | null;
  default_seo_title: string | null;
  default_seo_description: string | null;
  default_social_asset_id: string | null;
  default_social_asset_mime_type: string | null;
  default_social_asset_width: number | null;
  default_social_asset_height: number | null;
  default_social_asset_alt_text: string | null;
  billing_status: string | null;
  current_period_end: number | null;
  published_count: number | null;
  resolved_domain_type?: "default" | "custom" | null;
};

/** List/card/sitemap/llms summary — no Markdown body. */
export type PostSummaryRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_asset_id: string | null;
  published_at: number | null;
  updated_at: number;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  cover_asset_mime_type: string | null;
  cover_asset_width: number | null;
  cover_asset_height: number | null;
  cover_asset_alt_text: string | null;
  tags_json: string;
};

/** Feed/article body row — summary fields + Markdown. */
export type PostBodyRow = PostSummaryRow & {
  content_markdown: string;
};

export type PostDetailRow = PostBodyRow & {
  presentation_json: string | null;
  presentation: Presentation | null;
};

function toSiteRow(row: PublicSiteRow): SiteRow {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    slug: row.slug,
    theme: row.theme,
    theme_accent: row.themeAccent,
    theme_font: row.themeFont,
    theme_mode: row.themeMode,
    description: row.description,
    default_seo_title: row.defaultSeoTitle,
    default_seo_description: row.defaultSeoDescription,
    default_social_asset_id: row.defaultSocialAssetId,
    default_social_asset_mime_type: row.defaultSocialAssetMimeType,
    default_social_asset_width: row.defaultSocialAssetWidth,
    default_social_asset_height: row.defaultSocialAssetHeight,
    default_social_asset_alt_text: row.defaultSocialAssetAltText,
    billing_status: row.billingStatus,
    current_period_end: row.currentPeriodEnd,
    published_count: row.publishedCount,
    resolved_domain_type: row.resolvedDomainType ?? null,
  };
}

function toPostSummaryRow(row: PublicPostSummaryRow): PostSummaryRow {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    cover_asset_id: row.coverAssetId,
    published_at: row.publishedAt,
    updated_at: row.updatedAt,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    cover_asset_mime_type: row.coverAssetMimeType,
    cover_asset_width: row.coverAssetWidth,
    cover_asset_height: row.coverAssetHeight,
    cover_asset_alt_text: row.coverAssetAltText,
    canonical_url: row.canonicalUrl,
    tags_json: row.tagsJson,
  };
}

function toPostBodyRow(row: PublicPostBodyRow): PostBodyRow {
  return {
    ...toPostSummaryRow(row),
    content_markdown: row.contentMarkdown,
  };
}

function toPostDetailRow(row: PublicPostDetailRow): PostDetailRow {
  return {
    ...toPostBodyRow(row),
    presentation_json: row.presentationJson,
    presentation: row.presentation,
  };
}

function normalizeHost(request: Request) {
  return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

function appHost(env: PublicRuntimeEnv) {
  try {
    return new URL(env.appUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isMarketingHost(request: Request, env: PublicRuntimeEnv): boolean {
  const host = normalizeHost(request);
  if (!host || isLocalDefaultHostname(host)) return true;
  if (host === appHost(env)) return true;
  const zone = publicBlogBaseDomain(env);
  if (zone && (host === zone || host === `app.${zone}`)) return true;
  return false;
}

export async function resolveSite(request: Request, db: D1Database, env: PublicRuntimeEnv): Promise<SiteRow | null> {
  const readModel = createDataAccess(db).publicBlog;
  if (env.selfHosted) {
    const row = await readModel.resolveSingleSite();
    return row ? toSiteRow(row) : null;
  }
  if (isMarketingHost(request, env)) return null;
  const row = await readModel.resolveSiteByHost(normalizeHost(request));
  if (!row || (row.resolvedDomainType === "custom" && !hasActiveSubscription(row.billingStatus))) return null;
  return toSiteRow(row);
}

export async function getPublishedPost(db: D1Database, siteId: string, slug: string): Promise<PostDetailRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await createDataAccess(db).publicBlog.getPublishedPost(siteId, slug, now);
  return row ? toPostDetailRow(row) : null;
}

export async function listPublishedPostSummaries(
  db: D1Database,
  siteId: string,
  limit: number = PUBLIC_BLOG_LIMITS.listSummaries,
): Promise<PostSummaryRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.listPublishedPostSummaries(siteId, now, limit);
  return rows.map(toPostSummaryRow);
}

export async function listPublishedPostsForFeed(
  db: D1Database,
  siteId: string,
  limit: number = PUBLIC_BLOG_LIMITS.feedBodies,
): Promise<PostBodyRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.listPublishedPostsForFeed(siteId, now, limit);
  return rows.map(toPostBodyRow);
}

export function isPublicBlogIndexable(site: SiteRow, env: PublicRuntimeEnv) {
  return env.selfHosted || hasActiveSubscription(site.billing_status);
}

export async function listPublishedPostSummariesByTag(
  db: D1Database,
  siteId: string,
  tag: string,
  limit: number = PUBLIC_BLOG_LIMITS.listSummaries,
): Promise<PostSummaryRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.listPublishedPostSummariesByTag(siteId, tag, now, limit);
  return rows.map(toPostSummaryRow);
}

export async function searchPublishedPostSummaries(
  db: D1Database,
  siteId: string,
  q: string,
  limit: number = PUBLIC_BLOG_LIMITS.listSummaries,
): Promise<PostSummaryRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.searchPublishedPostSummaries(siteId, q, now, limit);
  return rows.map(toPostSummaryRow);
}
