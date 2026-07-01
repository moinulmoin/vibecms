import { AppError, archivePost, createPost, deleteAsset, getAsset, getPost, getPostVersion, listAssets, listPostVersions, listPosts, publishPost, requireScope, restorePostVersion, updatePost, ValidationError, type Actor } from "@vc/core";
import { MEDIA, resolvePresetId, resolvePresentation, type Presentation } from "@vc/config";
import { createDataAccess, createD1AssetRepository, createD1PostRepository } from "@vc/db";
import type { ListPostsRequest } from "@vc/api-contract";
import {
  mapActivityRow,
  mapAsset,
  mapPost,
  mapPostSummary,
  mapPostVersion,
  mapPostVersionSummary,
  mapSiteRow,
  type ActivityRow,
  type SiteRow,
} from "@vc/api-contract";
import { allowedImageMimeTypes } from "@vc/validators";
import { env } from "cloudflare:workers";
import { getBillingStatusForSite } from "./billing";
import { uploadAsset } from "./media";
import { purgeArticleCache } from "./public-blog-cache";
import { getSitePublicBaseUrl } from "./site-public-url";
import { formatGuideForPreset } from "./format-guide";
import { renderRichContent, validateRichContent, RENDERER_VERSION } from "../lib/markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PresentedPostArticle } from "../components/PresentedPostArticle";

export type OperationContext = {
  actor: Actor;
  siteId: string;
  workspaceId: string;
  tokenId: string;
};

function repository() {
  return createD1PostRepository(env.DB);
}

function appUser(ctx: OperationContext) {
  return {
    user: { id: ctx.actor.id, name: ctx.actor.name, email: "api" },
    workspaceId: ctx.workspaceId,
    siteId: ctx.siteId,
    actor: ctx.actor,
  };
}

async function currentSiteRow(siteId: string): Promise<SiteRow | null> {
  const site = await createDataAccess(env.DB).sites.getCurrentSite(siteId);
  if (!site) return null;
  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    description: site.description,
    created_at: site.createdAt,
    updated_at: site.updatedAt,
  };
}

async function siteBaseUrl(siteId: string) {
  const row = await currentSiteRow(siteId);
  return row ? getSitePublicBaseUrl(siteId, row.slug) : null;
}

function postPublicUrl(base: string | null, post: { status: string; slug: string }) {
  return base && post.status === "published" ? `${base}/${post.slug}` : null;
}

async function recentActivity(siteId: string, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT id, action, entity_type, entity_id, summary, actor_type, actor_id, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(siteId, Math.min(Math.max(limit, 1), 50))
    .all<ActivityRow>();
  return rows.results;
}

async function requireBillableSite(siteId: string) {
  const billingStatus = await getBillingStatusForSite(siteId);
  if (billingStatus !== "active") {
    throw new AppError("BILLING_REQUIRED", "An active subscription is required for MCP writes", 402);
  }
  return billingStatus;
}

// Cover asset ownership: an agent-supplied coverAssetId must reference an asset
// already uploaded to THIS site, otherwise the API must reject (not silently drop).
async function assertCoverAssetOwnedBySite(siteId: string, coverAssetId: string | null | undefined) {
  if (!coverAssetId) return;
  const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ? AND site_id = ? LIMIT 1")
    .bind(coverAssetId, siteId)
    .first<{ id: string }>();
  if (!asset) throw new ValidationError("Cover image must belong to this site");
}

function decodedBase64Length(dataBase64: string) {
  const normalized = dataBase64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function isAllowedMimeType(type: string): type is (typeof allowedImageMimeTypes)[number] {
  return allowedImageMimeTypes.includes(type as (typeof allowedImageMimeTypes)[number]);
}

function base64File(input: { filename: string; mimeType: string; dataBase64: string }) {
  if (!isAllowedMimeType(input.mimeType)) throw new AppError("VALIDATION_ERROR", "Unsupported image MIME type", 400);
  if (decodedBase64Length(input.dataBase64) > MEDIA.maxImageBytes) {
    throw new AppError("VALIDATION_ERROR", "Asset payload exceeds 10 MB", 400);
  }
  try {
    const bytes = Uint8Array.from(atob(input.dataBase64), (char) => char.charCodeAt(0));
    return new File([bytes], input.filename, { type: input.mimeType });
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid base64 asset payload", 400);
  }
}

export async function getSiteOp(ctx: OperationContext) {
  requireScope(ctx.actor, "sites:read");
  const row = await currentSiteRow(ctx.siteId);
  const url = row ? await getSitePublicBaseUrl(ctx.siteId, row.slug) : null;
  return mapSiteRow(row, url);
}

export async function listPostsOp(ctx: OperationContext, input: ListPostsRequest) {
  const rows = await listPosts(repository(), ctx.actor, { siteId: ctx.siteId, ...input });
  const base = rows.length ? await siteBaseUrl(ctx.siteId) : null;
  return rows.map((post) => mapPostSummary(post, postPublicUrl(base, post)));
}

export async function searchPostsOp(
  ctx: OperationContext,
  input: { search: string; limit?: number; offset?: number },
) {
  const rows = await listPosts(repository(), ctx.actor, {
    siteId: ctx.siteId,
    search: input.search,
    limit: input.limit,
    offset: input.offset,
  });
  const base = rows.length ? await siteBaseUrl(ctx.siteId) : null;
  return rows.map((post) => mapPostSummary(post, postPublicUrl(base, post)));
}

export async function getPostOp(ctx: OperationContext, input: { postId: string }) {
  const post = await getPost(repository(), ctx.actor, ctx.siteId, input.postId);
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPost(post, postPublicUrl(base, post));
}

export async function createPostOp(
  ctx: OperationContext,
  input: {
    title: string;
    slug: string;
    excerpt?: string;
    contentMarkdown: string;
    coverAssetId?: string | null;
    canonicalUrl?: string | null;
    seoTitle?: string;
    seoDescription?: string;
    tags?: string[];
    presentation?: Presentation | null;
  },
) {
  await assertCoverAssetOwnedBySite(ctx.siteId, input.coverAssetId);
  return mapPost(
    await createPost(repository(), ctx.actor, {
      siteId: ctx.siteId,
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt,
      contentMarkdown: input.contentMarkdown,
      coverAssetId: input.coverAssetId,
      canonicalUrl: input.canonicalUrl,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      tags: input.tags,
      presentation: input.presentation,
    }),
    null,
  );
}

export async function updatePostOp(
  ctx: OperationContext,
  input: {
    postId: string;
    title?: string;
    slug?: string;
    excerpt?: string;
    contentMarkdown?: string;
    coverAssetId?: string | null;
    canonicalUrl?: string | null;
    seoTitle?: string;
    seoDescription?: string;
    tags?: string[];
    presentation?: Presentation | null;
  },
) {
  await assertCoverAssetOwnedBySite(ctx.siteId, input.coverAssetId);
  const post = await updatePost(repository(), ctx.actor, {
      siteId: ctx.siteId,
      postId: input.postId,
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt,
      contentMarkdown: input.contentMarkdown,
      coverAssetId: input.coverAssetId,
      canonicalUrl: input.canonicalUrl,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      tags: input.tags,
      presentation: input.presentation,
  });
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPost(post, postPublicUrl(base, post));
}

export async function publishPostOp(ctx: OperationContext, input: { postId: string }) {
  const published = await publishPost(repository(), ctx.actor, {
    siteId: ctx.siteId,
    postId: input.postId,
    billingStatus: await getBillingStatusForSite(ctx.siteId),
  });
  const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(ctx.siteId);
  if (siteSlug) void purgeArticleCache(ctx.siteId, siteSlug, published.slug);
  const base = siteSlug ? await getSitePublicBaseUrl(ctx.siteId, siteSlug) : null;
  return mapPost(published, postPublicUrl(base, published));
}

export async function archivePostOp(ctx: OperationContext, input: { postId: string }) {
  const archived = await archivePost(repository(), ctx.actor, {
    siteId: ctx.siteId,
    postId: input.postId,
  });
  const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(ctx.siteId);
  if (siteSlug) void purgeArticleCache(ctx.siteId, siteSlug, archived.slug);
  return mapPost(archived, null);
}

export async function uploadAssetOp(
  ctx: OperationContext,
  input: { filename: string; mimeType: string; dataBase64: string; altText?: string },
) {
  await requireBillableSite(ctx.siteId);
  const asset = await uploadAsset(appUser(ctx), base64File(input), input.altText);
  return mapAsset(asset, `/media-assets/${asset.id}`);
}

function assetRepository() {
  return createD1AssetRepository(env.DB);
}

export async function listAssetsOp(ctx: OperationContext) {
  const assets = await listAssets(assetRepository(), ctx.actor, ctx.siteId);
  return assets.map((a) => mapAsset(a, `/media-assets/${a.id}`));
}

export async function getAssetOp(ctx: OperationContext, input: { assetId: string }) {
  const a = await getAsset(assetRepository(), ctx.actor, ctx.siteId, input.assetId);
  return mapAsset(a, `/media-assets/${a.id}`);
}

export async function deleteAssetOp(ctx: OperationContext, input: { assetId: string }) {
  const a = await deleteAsset(assetRepository(), ctx.actor, ctx.siteId, input.assetId);
  try {
    await env.ASSETS_BUCKET.delete(a.r2Key);
  } catch (err) {
    console.error("R2 delete failed for asset", a.id, err);
  }
  return mapAsset(a, `/media-assets/${a.id}`);
}

export async function listActivityOp(ctx: OperationContext, input: { limit?: number }) {
  requireScope(ctx.actor, "activity:read");
  const rows = await recentActivity(ctx.siteId, input.limit ?? 20);
  return rows.map(mapActivityRow);
}

export async function listPostVersionsOp(ctx: OperationContext, input: { postId: string }) {
  const versions = await listPostVersions(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId });
  return versions.map(mapPostVersionSummary);
}

export async function getPostVersionOp(ctx: OperationContext, input: { postId: string; versionNumber: number }) {
  return mapPostVersion(await getPostVersion(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId, versionNumber: input.versionNumber }));
}

export async function restorePostVersionOp(ctx: OperationContext, input: { postId: string; versionNumber: number }) {
  const post = await restorePostVersion(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId, versionNumber: input.versionNumber });
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPost(post, postPublicUrl(base, post));
}

export async function getFormatGuideOp(ctx: OperationContext, _input: { presetId?: string }) {
  requireScope(ctx.actor, "posts:read");
  const theme = await createDataAccess(env.DB).sites.getSiteTheme(ctx.siteId);
  const presetId = resolvePresetId(_input.presetId ?? theme);
  return formatGuideForPreset(presetId);
}

export async function previewPostOp(
  ctx: OperationContext,
  input: { contentMarkdown: string; presetId?: string; presentation?: Presentation | null },
) {
  requireScope(ctx.actor, "posts:read");
  let resolvedPresetId: string;
  if (input.presetId) {
    resolvedPresetId = resolvePresetId(input.presetId);
  } else {
    const theme = await createDataAccess(env.DB).sites.getSiteTheme(ctx.siteId);
    resolvedPresetId = resolvePresetId(theme);
  }

  // Single parse: node + outline + render warnings in one pass
  const { node, outline, warnings: renderWarnings } = renderRichContent(input.contentMarkdown, {
    presetId: resolvedPresetId,
  });

  const r = resolvePresentation(resolvedPresetId, input.presentation);
  const validateWarnings = validateRichContent(input.contentMarkdown, { renderWarnings, hasPageToc: r.resolved.toc });

  // Duplicate-TOC warning: page-level TOC block AND [[toc]] marker both present
  const dupTocWarnings: string[] =
    r.resolved.toc && /\[\[toc\]\]/.test(input.contentMarkdown)
      ? ["[[toc]] marker found in content but presentation.toc is true - the page-level TOC block already covers this; remove [[toc]] from content to avoid a duplicate"]
      : [];

  const html = renderToStaticMarkup(
    createElement(PresentedPostArticle, {
      renderResult: { node, outline, warnings: renderWarnings },
      presetId: resolvedPresetId,
      presentation: r.resolved,
    }),
  );

  const warnings = [...new Set([...renderWarnings, ...validateWarnings, ...dupTocWarnings])];

  return {
    html,
    outline,
    warnings,
    rendererVersion: RENDERER_VERSION,
    requestedPresentation: r.requested,
    resolvedPresentation: r.resolved,
    presentationWarnings: r.warnings,
  };
}