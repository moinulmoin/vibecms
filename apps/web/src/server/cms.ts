import { createD1PostRepository } from "@vc/db";
import {
  AppError,
  BillingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  archivePost,
  createPost,
  listPosts,
  publishPost,
  updatePost,
  type BillingStatus,
  type Post,
} from "@vc/core";
import { env } from "cloudflare:workers";
import { getBillingStatus } from "./billing";
import { defaultHostname, isLocalDefaultHostname, publicBlogBaseDomain, type AppUserContext } from "./onboarding";

export const DEMO_SITE_ID = "demo_site";

type SiteRow = { id: string; name: string; slug: string; description: string | null };
type DomainRow = { hostname: string };
type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number };
type CountRow = { count: number };
type AssetSiteRow = { id: string };

export type DashboardData = {
  site: { name: string; slug: string } | null;
  publicUrl: string | null;
  publicUrlLocal: boolean;
  billing: { status: BillingStatus; trialing: boolean };
  counts: { published: number; draft: number; archived: number };
  media: { bytes: number; count: number };
  tokenCount: number;
  versionCount: number;
  recentPosts: Array<{ id: string; title: string; slug: string; status: Post["status"]; updatedAt: number; publishedAt: number | null }>;
  recentActivity: ActivityRow[];
};
type StatusKind = "ok" | "error";

function repository() {
  return createD1PostRepository(env.DB);
}

function redirect(to: string) {
  return new Response(null, { status: 303, headers: { Location: to } });
}

function redirectWithStatus(to: string, kind: StatusKind, code: string) {
  const url = new URL(to, env.APP_URL || "http://localhost");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  url.searchParams.set(kind, code);
  return redirect(`${url.pathname}${url.search}`);
}

function redirectBack(request: Request | undefined, fallback: string, kind: StatusKind, code: string) {
  if (!request) return redirectWithStatus(fallback, kind, code);
  const referrer = request.headers.get("referer");
  if (!referrer) return redirectWithStatus(fallback, kind, code);
  const currentOrigin = new URL(request.url).origin;
  const url = new URL(referrer);
  if (url.origin !== currentOrigin || !url.pathname.startsWith("/app")) return redirectWithStatus(fallback, kind, code);
  return redirectWithStatus(`${url.pathname}${url.search}`, kind, code);
}

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalField(form: FormData, name: string) {
  const value = field(form, name);
  return value.length > 0 ? value : undefined;
}

function tagsFromForm(form: FormData) {
  return field(form, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function errorCode(error: unknown) {
  if (error instanceof BillingRequiredError) return "billing_required";
  if (error instanceof NotFoundError) return "not_found";
  if (error instanceof ForbiddenError) return "owner_required";
  if (error instanceof ConflictError) return "slug_conflict";
  if (error instanceof ValidationError) return "unknown";
  if (error instanceof AppError && error.code === "INVALID_COVER_ASSET") return "invalid_cover_asset";
  if (error instanceof AppError && error.code === "BILLING_REQUIRED") return "billing_required";
  if (error instanceof AppError && error.code === "NOT_FOUND") return "not_found";
  if (error instanceof AppError && error.code === "FORBIDDEN") return "owner_required";
  if (error instanceof AppError && error.code === "CONFLICT") return "slug_conflict";
  return "unknown";
}

async function coverAssetIdForSite(app: AppUserContext, form: FormData) {
  const coverAssetId = optionalField(form, "coverAssetId");
  if (!coverAssetId) return null;
  const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ? AND site_id = ? LIMIT 1").bind(coverAssetId, app.siteId).first<AssetSiteRow>();
  if (!asset) throw new AppError("INVALID_COVER_ASSET", "Cover image must belong to this site", 400);
  return coverAssetId;
}

async function activeDefaultHostname(site: SiteRow | undefined, domain: DomainRow | undefined, siteId: string) {
  if (!site || !domain) return null;
  if (!isLocalDefaultHostname(domain.hostname) || !publicBlogBaseDomain()) return domain.hostname;
  const hostname = defaultHostname(site.slug);
  await env.DB.prepare("UPDATE domains SET hostname = ?, updated_at = ? WHERE site_id = ? AND type = 'default' AND hostname = ?")
    .bind(hostname, Math.floor(Date.now() / 1000), siteId, domain.hostname)
    .run();
  return hostname;
}

function publicUrlForHostname(hostname: string | null) {
  if (!hostname) return null;
  if (publicBlogUsesAppPath()) return null;
  return `${isLocalDefaultHostname(hostname) ? "http" : "https"}://${hostname}`;
}

function publicBlogUsesAppPath() {
  const baseDomain = publicBlogBaseDomain();
  if (!baseDomain) return false;
  try {
    return baseDomain === new URL(env.APP_URL).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function appPublicBlogUrl(slug: string) {
  const appUrl = env.APP_URL || "http://localhost:5173";
  return new URL(`/blog/${slug}`, appUrl).href;
}


export async function getDashboardData(app: AppUserContext): Promise<DashboardData> {
  type StatusCountRow = { status: Post["status"] | "scheduled"; count: number };
  type RecentPostRow = { id: string; title: string; slug: string; status: Post["status"] | "scheduled"; updated_at: number; published_at: number | null };
  type MediaAggregateRow = { bytes: number; count: number };
  const [siteResult, statusResult, recentPostsResult, mediaResult, tokensResult, versionsResult, activityResult, domainResult] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, slug, description FROM sites WHERE id = ? LIMIT 1").bind(app.siteId),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM posts WHERE site_id = ? GROUP BY status").bind(app.siteId),
    env.DB.prepare("SELECT id, title, slug, status, updated_at, published_at FROM posts WHERE site_id = ? ORDER BY updated_at DESC LIMIT 5").bind(app.siteId),
    env.DB.prepare("SELECT COALESCE(SUM(size_bytes),0) AS bytes, COUNT(*) AS count FROM assets WHERE site_id = ?").bind(app.siteId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE site_id = ? AND revoked_at IS NULL").bind(app.siteId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM post_versions WHERE site_id = ?").bind(app.siteId),
    env.DB.prepare(
      `SELECT action, summary, actor_name, created_at
       FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT 5`,
    ).bind(app.siteId),
    env.DB.prepare("SELECT hostname FROM domains WHERE site_id = ? AND type='default' AND status='active' LIMIT 1").bind(app.siteId),
  ]) as [
    D1Result<SiteRow>,
    D1Result<StatusCountRow>,
    D1Result<RecentPostRow>,
    D1Result<MediaAggregateRow>,
    D1Result<CountRow>,
    D1Result<CountRow>,
    D1Result<ActivityRow>,
    D1Result<DomainRow>,
  ];
  const billingStatus = await getBillingStatus(app.workspaceId);
  const counts: DashboardData["counts"] = { published: 0, draft: 0, archived: 0 };
  for (const row of statusResult.results ?? []) {
    const status = row.status === "scheduled" ? "draft" : row.status;
    if (status === "published" || status === "draft" || status === "archived") counts[status] += row.count;
  }
  const site = siteResult.results?.[0];
  const domain = domainResult.results?.[0];
  const hostname = await activeDefaultHostname(site, domain, app.siteId);
  const media = mediaResult.results?.[0];
  return {
    site: site ? { name: site.name, slug: site.slug } : null,
    publicUrl: site && publicBlogUsesAppPath() ? appPublicBlogUrl(site.slug) : publicUrlForHostname(hostname),
    publicUrlLocal: hostname ? isLocalDefaultHostname(hostname) : false,
    billing: { status: billingStatus, trialing: billingStatus === "trialing" },
    counts,
    media: { bytes: media?.bytes ?? 0, count: media?.count ?? 0 },
    tokenCount: tokensResult.results?.[0]?.count ?? 0,
    versionCount: versionsResult.results?.[0]?.count ?? 0,
    recentPosts: (recentPostsResult.results ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status === "scheduled" ? "draft" : post.status,
      updatedAt: post.updated_at,
      publishedAt: post.published_at,
    })),
    recentActivity: activityResult.results ?? [],
  };
}

export async function getActivity(app: AppUserContext, limit = 50) {
  const activity = await env.DB.prepare(
    `SELECT action, summary, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(app.siteId, Math.min(Math.max(limit, 1), 100)).all<ActivityRow>();
  return activity.results;
}

export async function getPosts(app: AppUserContext, status?: Post["status"], search?: string, limit = 100, offset = 0) {
  return listPosts(repository(), app.actor, { siteId: app.siteId, status, search, limit, offset });
}

export async function getPostForEditing(app: AppUserContext, postId: string) {
  return repository().getPost(app.siteId, postId);
}

export async function createPostFromRequest(app: AppUserContext, request: Request) {
  try {
    const form = await request.formData();
    const coverAssetId = await coverAssetIdForSite(app, form);
    const post = await createPost(repository(), app.actor, {
      siteId: app.siteId,
      title: field(form, "title"),
      slug: field(form, "slug"),
      excerpt: optionalField(form, "excerpt"),
      contentMarkdown: field(form, "contentMarkdown"),
      coverAssetId,
      tags: tagsFromForm(form),
    });
    return redirectWithStatus(`/app/posts/${post.id}/edit`, "ok", "post_created");
  } catch (error) {
    return redirectWithStatus("/app/posts/new", "error", errorCode(error));
  }
}

export async function updatePostFromRequest(app: AppUserContext, request: Request, postId: string) {
  try {
    const form = await request.formData();
    const coverAssetId = await coverAssetIdForSite(app, form);
    await updatePost(repository(), app.actor, {
      siteId: app.siteId,
      postId,
      title: field(form, "title"),
      slug: field(form, "slug"),
      excerpt: optionalField(form, "excerpt"),
      contentMarkdown: field(form, "contentMarkdown"),
      coverAssetId,
      tags: tagsFromForm(form),
    });
    return redirectWithStatus(`/app/posts/${postId}/edit`, "ok", "post_saved");
  } catch (error) {
    return redirectWithStatus(`/app/posts/${postId}/edit`, "error", errorCode(error));
  }
}

export async function publishPostFromRequest(app: AppUserContext, postId: string, request?: Request) {
  try {
    await publishPost(repository(), app.actor, { siteId: app.siteId, postId, billingStatus: await getBillingStatus(app.workspaceId) });
  } catch (error) {
    return redirectBack(request, "/app/posts", "error", errorCode(error));
  }
  return redirectBack(request, "/app/posts", "ok", "post_published");
}

export async function archivePostFromRequest(app: AppUserContext, postId: string, request?: Request) {
  try {
    await archivePost(repository(), app.actor, { siteId: app.siteId, postId });
  } catch (error) {
    return redirectBack(request, "/app/posts", "error", errorCode(error));
  }
  return redirectBack(request, "/app/posts", "ok", "post_archived");
}
