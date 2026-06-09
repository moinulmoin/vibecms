import { createD1PostRepository } from "@vc/db";
import {
  AppError,
  BillingRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  archivePost,
  createPost,
  listPosts,
  publishPost,
  updatePost,
  type Post,
} from "@vc/core";
import { env } from "cloudflare:workers";
import { getBillingStatus } from "./billing";
import type { AppUserContext } from "./onboarding";

export const DEMO_SITE_ID = "demo_site";

type SiteRow = { id: string; name: string; slug: string; description: string | null };
type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number };
type CountRow = { count: number };
type AssetSiteRow = { id: string };

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
  if (error instanceof ValidationError) return "unknown";
  if (error instanceof AppError && error.code === "INVALID_COVER_ASSET") return "invalid_cover_asset";
  if (error instanceof AppError && error.code === "BILLING_REQUIRED") return "billing_required";
  if (error instanceof AppError && error.code === "NOT_FOUND") return "not_found";
  if (error instanceof AppError && error.code === "FORBIDDEN") return "owner_required";
  return "unknown";
}

async function coverAssetIdForSite(app: AppUserContext, form: FormData) {
  const coverAssetId = optionalField(form, "coverAssetId");
  if (!coverAssetId) return null;
  const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ? AND site_id = ? LIMIT 1").bind(coverAssetId, app.siteId).first<AssetSiteRow>();
  if (!asset) throw new AppError("INVALID_COVER_ASSET", "Cover image must belong to this site", 400);
  return coverAssetId;
}

export async function getDashboardData(app: AppUserContext) {
  const site = await env.DB.prepare(
    "SELECT id, name, slug, description FROM sites WHERE id = ? LIMIT 1",
  ).bind(app.siteId).first<SiteRow>();
  const posts = await listPosts(repository(), app.actor, { siteId: app.siteId });
  const activity = await env.DB.prepare(
    `SELECT action, summary, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT 5`,
  ).bind(app.siteId).all<ActivityRow>();
  const versions = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM post_versions WHERE site_id = ?",
  ).bind(app.siteId).first<CountRow>();
  return {
    site,
    posts: posts.slice(0, 5),
    activity: activity.results,
    versionCount: versions?.count ?? 0,
  };
}

export async function getActivity(app: AppUserContext, limit = 50) {
  const activity = await env.DB.prepare(
    `SELECT action, summary, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(app.siteId, Math.min(Math.max(limit, 1), 100)).all<ActivityRow>();
  return activity.results;
}

export async function getPosts(app: AppUserContext, status?: Post["status"], search?: string) {
  return listPosts(repository(), app.actor, { siteId: app.siteId, status, search });
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
