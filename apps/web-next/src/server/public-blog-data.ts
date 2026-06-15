import { env } from "cloudflare:workers";
import { isLocalDefaultHostname, publicBlogBaseDomain } from "./onboarding";

export type SiteRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
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
  seo_title: string | null;
  seo_description: string | null;
  tags_json: string;
};

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

function canRenderPublic(site: SiteRow) {
  return env.SELF_HOSTED === "true" || site.billing_status === "active" || (site.published_count ?? 0) > 0;
}

export async function resolveSite(request: Request) {
  const host = normalizeHost(request);
  if (!host || host === "localhost" || host === appHost() || host.startsWith("app.") || (isLocalDefaultHostname(host) && publicBlogBaseDomain()))
    return null;

  const site = await env.DB.prepare(
    `SELECT sites.id, sites.workspace_id, sites.name, sites.slug, sites.description,
      sites.default_seo_title, sites.default_seo_description,
      billing_customers.status AS billing_status, billing_customers.current_period_end,
      (SELECT COUNT(*) FROM posts WHERE posts.site_id = sites.id AND posts.status = 'published') AS published_count
     FROM domains
     INNER JOIN sites ON sites.id = domains.site_id
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE domains.hostname = ? AND domains.status = 'active' AND sites.status = 'active'
     LIMIT 1`,
  )
    .bind(host)
    .first<SiteRow>();
  if (!site || !canRenderPublic(site)) return null;
  return site;
}

export async function resolveSiteBySlug(slug: string | undefined) {
  if (!slug) return null;
  const site = await env.DB.prepare(
    `SELECT sites.id, sites.workspace_id, sites.name, sites.slug, sites.description,
      sites.default_seo_title, sites.default_seo_description,
      billing_customers.status AS billing_status, billing_customers.current_period_end,
      (SELECT COUNT(*) FROM posts WHERE posts.site_id = sites.id AND posts.status = 'published') AS published_count
     FROM sites
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE sites.slug = ? AND sites.status = 'active'
     LIMIT 1`,
  )
    .bind(slug)
    .first<SiteRow>();
  if (!site || !canRenderPublic(site)) return null;
  return site;
}

export async function listPublishedPosts(siteId: string) {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, content_markdown, cover_asset_id, published_at, seo_title, seo_description, tags_json
     FROM posts
     WHERE site_id = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?
     ORDER BY published_at DESC`,
  )
    .bind(siteId, now)
    .all<PostRow>();
  return result.results;
}

export function isPublicBlogIndexable(site: SiteRow) {
  return env.SELF_HOSTED === "true" || site.billing_status === "active";
}