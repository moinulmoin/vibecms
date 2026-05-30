import { createD1PostRepository } from "@vc/db";
import {
  AppError,
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

function repository() {
  return createD1PostRepository(env.DB);
}

function redirect(to: string) {
  return new Response(null, { status: 303, headers: { Location: to } });
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
  return redirect(`/app/posts/${post.id}/edit`);
}

export async function updatePostFromRequest(app: AppUserContext, request: Request, postId: string) {
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
  return redirect(`/app/posts/${postId}/edit`);
}

export async function publishPostFromRequest(app: AppUserContext, postId: string) {
  try {
    await publishPost(repository(), app.actor, { siteId: app.siteId, postId, billingStatus: await getBillingStatus(app.workspaceId) });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: error.status });
    throw error;
  }
  return redirect("/app/posts");
}

export async function archivePostFromRequest(app: AppUserContext, postId: string) {
  await archivePost(repository(), app.actor, { siteId: app.siteId, postId });
  return redirect("/app/posts");
}
