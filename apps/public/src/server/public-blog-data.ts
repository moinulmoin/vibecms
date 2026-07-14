import type { Presentation } from "@vc/config";
import { createDataAccess, type PublicPostDetailRow, type PublicPostRow, type PublicSiteRow } from "@vc/db";
import type { PublicRuntimeEnv } from "../env";
import { isLocalDefaultHostname, publicBlogBaseDomain } from "./public-url";

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

export type PostDetailRow = PostRow & { presentation: Presentation | null };

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
  return row ? toSiteRow(row) : null;
}

export async function getPublishedPost(db: D1Database, siteId: string, slug: string): Promise<PostDetailRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await createDataAccess(db).publicBlog.getPublishedPost(siteId, slug, now);
  return row ? toPostDetailRow(row) : null;
}

export async function listPublishedPosts(db: D1Database, siteId: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.listPublishedPosts(siteId, now);
  return rows.map(toPostRow);
}

export function isPublicBlogIndexable(site: SiteRow, env: PublicRuntimeEnv) {
  return env.selfHosted || site.billing_status === "active";
}

export async function listPublishedPostsByTag(db: D1Database, siteId: string, tag: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.listPublishedPostsByTag(siteId, tag, now);
  return rows.map(toPostRow);
}

export async function searchPublishedPosts(db: D1Database, siteId: string, q: string): Promise<PostRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await createDataAccess(db).publicBlog.searchPublishedPosts(siteId, q, now);
  return rows.map(toPostRow);
}