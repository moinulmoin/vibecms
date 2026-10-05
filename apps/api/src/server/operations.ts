import { AppError, archivePost, ConflictError, createPost, getAsset, getPost, getPostBySlug, getPostVersion, listAssets, listPostVersions, listPosts, NotFoundError, publishPost, requireScope, restorePostVersion, unarchivePost, updateAssetAltText, updatePost, ValidationError, type Actor } from "@vc/core";
import { ACCENTS, FONTS, MEDIA, THEME_MODES, THEME_PRESETS, THEME_RADII, THEME_WIDTHS, resolvePresetId, resolvePresentation, type Presentation } from "@vc/config";
import { createDataAccess, createD1AssetRepository, createD1PostRepository, schedulePost, unschedulePost } from "@vc/db";
import type { ListPostsRequest, UpdateSiteRequest, UpdateThemeRequest, UpdateVoiceRequest } from "@vc/api-contract";
import { normalizeThemeChoice } from "@vc/api-contract";
import {
  mapActivityRow,
  mapAsset,
  mapPost,
  mapPostSummary,
  mapPostVersion,
  mapPostVersionSummary,
  mapSiteRow,
} from "@vc/api-contract";
import { allowedImageMimeTypes } from "@vc/validators";
import { env } from "cloudflare:workers";
import {
  billingStatusForCore,
  getCoreBillingStatusForSite,
  resolveEffectiveEntitlementForSite,
} from "./effective-entitlement";
import { deleteAssetTracked, uploadAsset } from "./media";
import { resolvePublishedVersionSlug, scheduleLiveArticlePurges } from "./post-live-purge";
import { assertPostImagesPublishable } from "./publishing-images";
import { getSitePublicBaseUrl } from "./site-public-url";
import { previewUrlForPost } from "./post-preview";
import { formatGuideForPreset } from "./format-guide";
import { getVoiceProfileForSite } from "./voice-profile";
import { RENDERER_VERSION } from "@vc/content/constants";
import { getNewsletterSettingsForApp, getSiteSettings, updateNewsletterSettingsForApp, updateSiteSettingsForApp, type SiteSettingsPayload } from "./onboarding";
import { getVoiceProfileSettings, updateVoiceProfileForApp } from "./voice-profile";
import { loadAnalyticsForApp, type AnalyticsRange } from "./analytics";

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

async function siteBaseUrl(siteId: string) {
  const row = await createDataAccess(env.DB).sites.getCurrentSite(siteId);
  return row ? getSitePublicBaseUrl(siteId, row.slug) : null;
}

function postPublicUrl(base: string | null, post: { status: string; slug: string; publishedSlug?: string | null }) {
  return base && post.status === "published" ? `${base}/${post.publishedSlug ?? post.slug}` : null;
}

async function mapPostWithPreview(post: Parameters<typeof mapPost>[0], url: string | null) {
  return mapPost(post, url, await previewUrlForPost(post.siteId, post.id));
}

// Cover asset ownership: an agent-supplied coverAssetId must reference an asset
// already uploaded to THIS site, otherwise the API must reject (not silently drop).
async function assertCoverAssetOwnedBySite(siteId: string, coverAssetId: string | null | undefined) {
  if (!coverAssetId) return;
  const exists = await createDataAccess(env.DB).assets.existsForSite(siteId, coverAssetId);
  if (!exists) throw new ValidationError("Cover image must belong to this site");
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
  const [row, voiceProfile, form] = await Promise.all([
    createDataAccess(env.DB).sites.getCurrentSite(ctx.siteId),
    getVoiceProfileForSite(ctx.siteId),
    getNewsletterSettingsForApp(appUser(ctx)),
  ]);
  const url = row ? await getSitePublicBaseUrl(ctx.siteId, row.slug) : null;
  const site = mapSiteRow(row, url, voiceProfile);
  return site && { ...site, signupForm: { enabled: form.enabled, heading: form.heading,
    description: form.subtext, button: form.buttonLabel } };
}

function mutationResult(result: { kind: 'ok' | 'error'; code: string }) {
  if (result.kind === 'ok') return;
  if (result.code === 'settings_conflict') throw new ConflictError('Site settings changed. Read the current site and retry with its updatedAt.');
  if (result.code === 'site_not_found') throw new NotFoundError('Site not found');
  if (result.code === 'owner_required') throw new AppError('FORBIDDEN', 'Manage access required', 403);
  throw new ValidationError(result.code);
}

export async function updateSiteOp(ctx: OperationContext, input: UpdateSiteRequest) {
  requireScope(ctx.actor, 'site:write');
  mutationResult(await updateSiteSettingsForApp(appUser(ctx), input));
  const [row, voiceProfile, settings] = await Promise.all([
    createDataAccess(env.DB).sites.getCurrentSite(ctx.siteId), getVoiceProfileForSite(ctx.siteId), getSiteSettings(appUser(ctx)),
  ]);
  if (!row) throw new NotFoundError('Site not found');
  const site = mapSiteRow(row, await getSitePublicBaseUrl(ctx.siteId, row.slug), voiceProfile);
  if (!site) throw new NotFoundError('Site not found');
  const { newsletterSettings: _newsletterSettings, ...publicSettings } = settings;
  return { ...site, settings: publicSettings };
}

type ThemeLook = Pick<SiteSettingsPayload, 'theme' | 'themeAccent' | 'themeFont' | 'themeRadius' | 'themeWidth' | 'themeMode'>;

function rawLook(row: NonNullable<Awaited<ReturnType<ReturnType<typeof createDataAccess>['sites']['getSiteSettings']>>>) : ThemeLook {
  return { theme: row.theme ?? 'minimal', themeAccent: row.themeAccent, themeFont: row.themeFont,
    themeRadius: row.themeRadius, themeWidth: row.themeWidth, themeMode: row.themeMode };
}

async function previousLook(siteId: string) {
  return env.DB.prepare('SELECT look_json AS lookJson, saved_at AS savedAt FROM site_theme_previous_look WHERE site_id = ?')
    .bind(siteId).first<{ lookJson: string; savedAt: number }>();
}

export async function getThemeOp(ctx: OperationContext) {
  requireScope(ctx.actor, 'site:write');
  const app = appUser(ctx);
  const [site, saved] = await Promise.all([getSiteSettings(app), previousLook(ctx.siteId)]);
  const options = {
    templates: Object.entries(THEME_PRESETS).map(([id, value]) => ({ id, name: value.name })),
    accents: ACCENTS.map(({ id, name }) => ({ id, name })), fonts: FONTS.map(({ id, name }) => ({ id, name })),
    radii: THEME_RADII.map((id) => ({ id, name: ({ none: 'Square', sm: 'Soft', md: 'Round', lg: 'Rounder' })[id] })),
    widths: THEME_WIDTHS.map((id) => ({ id, name: ({ narrow: 'Narrow', normal: 'Normal', wide: 'Wide' })[id] })),
    modes: THEME_MODES.map((id) => ({ id, name: ({ light: 'Light', dark: 'Dark', system: 'System' })[id] })),
  };
  return { template: site.theme, accent: site.themeAccent, font: site.themeFont, radius: site.themeRadius,
    width: site.themeWidth, mode: site.themeMode, updatedAt: site.updatedAt,
    url: await siteBaseUrl(ctx.siteId), canRevert: saved?.savedAt === site.updatedAt, options };
}

export async function updateThemeOp(ctx: OperationContext, input: UpdateThemeRequest) {
  requireScope(ctx.actor, 'site:write');
  const current = await createDataAccess(env.DB).sites.getSiteSettings(ctx.siteId);
  if (!current) throw new NotFoundError('Site not found');
  if (current.updatedAt !== input.expectedUpdatedAt) {
    throw new ConflictError('Site settings changed since your read. Call sites.theme.get and retry with its updatedAt.');
  }
  input = { ...input, template: normalizeThemeChoice('template', input.template), font: normalizeThemeChoice('font', input.font) };
  const change: SiteSettingsPayload = { expectedUpdatedAt: input.expectedUpdatedAt };
  if (input.template !== undefined) {
    change.theme = input.template;
    if (input.keepLook) {
      const resolved = await getSiteSettings(appUser(ctx));
      Object.assign(change, { themeAccent: resolved.themeAccent, themeFont: resolved.themeFont,
        themeRadius: resolved.themeRadius, themeWidth: resolved.themeWidth, themeMode: resolved.themeMode });
    } else {
      const defaults = THEME_PRESETS[resolvePresetId(input.template)].template.defaults;
      Object.assign(change, { themeAccent: defaults.accent, themeFont: defaults.font,
        themeRadius: defaults.radius, themeWidth: defaults.width, themeMode: defaults.mode });
    }
  }
  if (input.accent !== undefined) change.themeAccent = input.accent;
  if (input.font !== undefined) change.themeFont = input.font;
  if (input.radius !== undefined) change.themeRadius = input.radius;
  if (input.width !== undefined) change.themeWidth = input.width;
  if (input.mode !== undefined) change.themeMode = input.mode;
  mutationResult(await updateSiteSettingsForApp(appUser(ctx), change, { previousLookJson: JSON.stringify(rawLook(current)) }));
  return getThemeOp(ctx);
}

export async function revertThemeOp(ctx: OperationContext, input: { expectedUpdatedAt: number }) {
  requireScope(ctx.actor, 'site:write');
  const saved = await previousLook(ctx.siteId);
  if (!saved || saved.savedAt !== input.expectedUpdatedAt) throw new ConflictError('No revert is available for this revision. Call sites.theme.get; only retry when canRevert is true, using its updatedAt.');
  const look = JSON.parse(saved.lookJson) as ThemeLook;
  mutationResult(await updateSiteSettingsForApp(appUser(ctx), { ...look, expectedUpdatedAt: input.expectedUpdatedAt }));
  await env.DB.prepare('DELETE FROM site_theme_previous_look WHERE site_id = ? AND saved_at = ?')
    .bind(ctx.siteId, saved.savedAt).run();
  return getThemeOp(ctx);
}

export async function updateVoiceOp(ctx: OperationContext, input: UpdateVoiceRequest) {
  requireScope(ctx.actor, 'site:write');
  mutationResult(await updateVoiceProfileForApp(appUser(ctx), { audience: input.audience, voiceSummary: input.tone,
    preferRules: input.doRules, avoidRules: input.dontRules, representativePostIds: input.representativePostIds },
    { expectedUpdatedAt: input.expectedUpdatedAt }));
  return getVoiceProfileSettings(appUser(ctx));
}

export async function updateSignupFormOp(ctx: OperationContext, input: { expectedUpdatedAt: number; enabled?: boolean; heading?: string; description?: string; button?: string }) {
  requireScope(ctx.actor, 'site:write');
  mutationResult(await updateNewsletterSettingsForApp(appUser(ctx), {
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.heading === undefined ? {} : { heading: input.heading }),
    ...(input.description === undefined ? {} : { subtext: input.description }),
    ...(input.button === undefined ? {} : { buttonLabel: input.button }),
  }, { expectedUpdatedAt: input.expectedUpdatedAt }));
  const updated = await getNewsletterSettingsForApp(appUser(ctx));
  // Echo the new revision so a follow-up edit doesn't need another sites.get.
  const site = await createDataAccess(env.DB).sites.getSiteSettings(ctx.siteId);
  return { enabled: updated.enabled, heading: updated.heading, description: updated.subtext, button: updated.buttonLabel,
    updatedAt: site?.updatedAt ?? input.expectedUpdatedAt };
}

export async function listTagsOp(ctx: OperationContext) {
  requireScope(ctx.actor, 'site:write');
  const rows = await env.DB.prepare(`SELECT json_each.value AS name, COUNT(DISTINCT posts.id) AS postCount
    FROM posts, json_each(posts.tags_json) WHERE posts.site_id = ? AND posts.status != 'archived'
    GROUP BY json_each.value ORDER BY postCount DESC, name COLLATE NOCASE`).bind(ctx.siteId)
    .all<{ name: string; postCount: number }>();
  return rows.results;
}

export async function getAnalyticsOp(ctx: OperationContext, input: { range: string }) {
  requireScope(ctx.actor, 'analytics:read');
  const range = input.range === 'all' ? 'all' : Number(input.range) as AnalyticsRange;
  const result = await loadAnalyticsForApp(appUser(ctx), range);
  if (result.status === 'locked') throw new AppError('ANALYTICS_PAID_PLAN', 'Analytics are on the paid plan.', 402);
  return result;
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
  return mapPostWithPreview(post, postPublicUrl(base, post));
}

export async function getPostBySlugOp(ctx: OperationContext, input: { slug: string }) {
  const post = await getPostBySlug(repository(), ctx.actor, ctx.siteId, input.slug);
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPostWithPreview(post, postPublicUrl(base, post));
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
  return mapPostWithPreview(
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
    }, await getCoreBillingStatusForSite(ctx.siteId)),
    null,
  );
}

export async function updatePostOp(
  ctx: OperationContext,
  input: {
    postId: string;
    expectedVersionNumber: number;
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
  const { post } = await updatePost(repository(), ctx.actor, {
      siteId: ctx.siteId,
      postId: input.postId,
      expectedVersionNumber: input.expectedVersionNumber,
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
  // Draft edits on a live post do not change the public projection; no purge here.
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPostWithPreview(post, postPublicUrl(base, post));
}

export async function publishPostOp(
  ctx: OperationContext,
  input: { postId: string; expectedVersionNumber: number },
) {
  await assertPostImagesPublishable(ctx.siteId, input.postId);
  const previousLiveSlug = await resolvePublishedVersionSlug(repository(), ctx.siteId, input.postId);
  const entitlement = await resolveEffectiveEntitlementForSite(ctx.siteId);
  const published = await publishPost(repository(), ctx.actor, {
    siteId: ctx.siteId,
    postId: input.postId,
    expectedVersionNumber: input.expectedVersionNumber,
    billingStatus: billingStatusForCore(entitlement),
  });
  const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(ctx.siteId);
  if (siteSlug) scheduleLiveArticlePurges(ctx.siteId, siteSlug, previousLiveSlug, published.slug);
  const base = siteSlug ? await getSitePublicBaseUrl(ctx.siteId, siteSlug) : null;
  return mapPostWithPreview(published, postPublicUrl(base, published));
}

export async function schedulePostOp(ctx: OperationContext, input: { postId: string; versionNumber: number; publishAt: number }) {
  requireScope(ctx.actor, 'posts:publish');
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(input.publishAt) || input.publishAt <= now) throw new ValidationError('publishAt must be a future Unix timestamp in seconds. Confirm a new UTC time with the owner before rescheduling.');
  const post = await repository().getPost(ctx.siteId, input.postId);
  if (!post) throw new NotFoundError('Post not found');
  if (post.status === 'archived') throw new ValidationError('Post is archived. If the owner intends to restore it, call posts.unarchive, inspect the draft, then obtain approval for a saved version and future time.');
  if (post.scheduledPublish?.status === 'processing') throw new AppError('CONFLICT', 'Schedule is already publishing', 409);
  const saved = await schedulePost(env.DB, ctx.siteId, input.postId, input.versionNumber, input.publishAt, ctx.actor, now);
  if (!saved) {
    const current = await repository().getPost(ctx.siteId, input.postId);
    if (current?.scheduledPublish?.status === 'processing') throw new AppError('CONFLICT', 'Schedule is already publishing', 409);
    throw new ValidationError('Saved post version not found');
  }
  const updated = await repository().getPost(ctx.siteId, input.postId);
  if (!updated) throw new NotFoundError('Post not found');
  const base = updated.status === 'published' ? await siteBaseUrl(ctx.siteId) : null;
  return mapPostWithPreview(updated, postPublicUrl(base, updated));
}

export async function unschedulePostOp(ctx: OperationContext, input: { postId: string }) {
  requireScope(ctx.actor, 'posts:publish');
  const post = await repository().getPost(ctx.siteId, input.postId);
  if (!post) throw new NotFoundError('Post not found');
  if (post.scheduledPublish?.status === 'processing') throw new AppError('CONFLICT', 'Already publishing', 409);
  const canceled = await unschedulePost(env.DB, ctx.siteId, input.postId);
  if (!canceled) {
    const current = await repository().getPost(ctx.siteId, input.postId);
    if (current?.scheduledPublish?.status === 'processing') throw new AppError('CONFLICT', 'Already publishing', 409);
  }
  const updated = await repository().getPost(ctx.siteId, input.postId);
  if (!updated) throw new NotFoundError('Post not found');
  const base = updated.status === 'published' ? await siteBaseUrl(ctx.siteId) : null;
  return mapPostWithPreview(updated, postPublicUrl(base, updated));
}

export async function rotatePostPreviewOp(ctx: OperationContext, input: { postId: string }) {
  requireScope(ctx.actor, 'posts:update');
  const post = await repository().getPost(ctx.siteId, input.postId);
  if (!post) throw new NotFoundError('Post not found');
  const previewUrl = await previewUrlForPost(ctx.siteId, input.postId, true);
  const base = post.status === 'published' ? await siteBaseUrl(ctx.siteId) : null;
  return mapPost(post, postPublicUrl(base, post), previewUrl);
}

export async function archivePostOp(ctx: OperationContext, input: { postId: string; expectedVersionNumber?: number }) {
  const previousLiveSlug = await resolvePublishedVersionSlug(repository(), ctx.siteId, input.postId);
  const archived = await archivePost(repository(), ctx.actor, {
    siteId: ctx.siteId,
    postId: input.postId,
    expectedVersionNumber: input.expectedVersionNumber,
  });
  const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(ctx.siteId);
  if (siteSlug) scheduleLiveArticlePurges(ctx.siteId, siteSlug, previousLiveSlug, archived.slug);
  return mapPost(archived, null);
}

export async function unarchivePostOp(ctx: OperationContext, input: { postId: string }) {
  const post = await unarchivePost(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId, billingStatus: await getCoreBillingStatusForSite(ctx.siteId) });
  return mapPost(post, null);
}

export async function uploadAssetOp(
  ctx: OperationContext,
  input: { filename: string; mimeType: string; dataBase64: string; altText?: string },
) {
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

export async function updateAssetOp(ctx: OperationContext, input: { assetId: string; altText: string }) {
  const asset = await updateAssetAltText(assetRepository(), ctx.actor, ctx.siteId, input.assetId, input.altText);
  return mapAsset(asset, `/media-assets/${asset.id}`);
}

export async function deleteAssetOp(ctx: OperationContext, input: { assetId: string }) {
  const a = await deleteAssetTracked(appUser(ctx), input.assetId);
  return mapAsset(a, `/media-assets/${a.id}`);
}

export async function listActivityOp(ctx: OperationContext, input: { limit?: number; offset?: number }) {
  requireScope(ctx.actor, "activity:read");
  const rows = await createDataAccess(env.DB).activity.listBySite(
    ctx.siteId,
    Math.min(Math.max(input.limit ?? 20, 1), 50),
    Math.max(input.offset ?? 0, 0),
  );
  return rows.map(mapActivityRow);
}

export async function listPostVersionsOp(ctx: OperationContext, input: { postId: string }) {
  const versions = await listPostVersions(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId });
  return versions.map(mapPostVersionSummary);
}

export async function getPostVersionOp(ctx: OperationContext, input: { postId: string; versionNumber: number }) {
  return mapPostVersion(await getPostVersion(repository(), ctx.actor, { siteId: ctx.siteId, postId: input.postId, versionNumber: input.versionNumber }));
}

export async function restorePostVersionOp(ctx: OperationContext, input: { postId: string; versionNumber: number; expectedVersionNumber: number }) {
  const post = await restorePostVersion(repository(), ctx.actor, {
    siteId: ctx.siteId,
    postId: input.postId,
    versionNumber: input.versionNumber,
    expectedVersionNumber: input.expectedVersionNumber,
  });
  const base = post.status === "published" ? await siteBaseUrl(ctx.siteId) : null;
  return mapPost(post, postPublicUrl(base, post));
}

export async function getFormatGuideOp(ctx: OperationContext, _input: { presetId?: string }) {
  requireScope(ctx.actor, "posts:read");
  const theme = await createDataAccess(env.DB).sites.getSiteTheme(ctx.siteId);
  const presetId = resolvePresetId(_input.presetId ?? theme);
  return formatGuideForPreset(presetId);
}

function escapePreviewText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escaped[char] ?? char;
  });
}

function renderPresentedPreviewHtml(
  contentHtml: string,
  outline: Array<{ depth: number; text: string; id: string }>,
  presentation: { layout: string; toc: boolean },
): string {
  const hasPageToc = presentation.toc && outline.length >= 3;
  const tocItems = outline
    .map(
      (entry) =>
        `<li data-vc-toc-depth="${entry.depth}"><a href="#${escapePreviewText(entry.id)}">${escapePreviewText(entry.text)}</a></li>`,
    )
    .join("");
  const compactToc = hasPageToc
    ? `<details data-vc-page-toc><summary>On this page</summary><ul>${tocItems}</ul></details>`
    : "";
  const railToc = hasPageToc
    ? `<nav data-vc-page-toc-rail aria-label="On this page"><p>On this page</p><ul>${tocItems}</ul></nav>`
    : "";
  return `<article data-vc-layout="${escapePreviewText(presentation.layout)}">${compactToc}<div data-vc-article-body>${contentHtml}${railToc}</div></article>`;
}
export async function previewPostOp(
  ctx: OperationContext,
  input: { contentMarkdown?: string; postId?: string; presetId?: string; presentation?: Presentation | null },
) {
  requireScope(ctx.actor, "posts:read");
  if (input.postId !== undefined && input.contentMarkdown !== undefined) throw new ValidationError('Send either postId or contentMarkdown, not both.');
  const saved = input.postId ? await getPost(repository(), ctx.actor, ctx.siteId, input.postId) : null;
  const contentMarkdown = saved?.contentMarkdown ?? input.contentMarkdown;
  if (contentMarkdown === undefined) throw new ValidationError('postId or contentMarkdown is required');
  const requestedPresentation = saved?.presentation ?? input.presentation;
  let resolvedPresetId: string;
  if (input.presetId) {
    resolvedPresetId = resolvePresetId(input.presetId);
  } else {
    const theme = await createDataAccess(env.DB).sites.getSiteTheme(ctx.siteId);
    resolvedPresetId = resolvePresetId(theme);
  }

  // Loaded on first preview so Worker startup doesn't pay for the Markdown pipeline.
  const [{ renderRichContent, renderRichContentResultToHtml, validateRichContent }, { createMathRenderer }] =
    await Promise.all([import("@vc/content"), import("@vc/content/math")]);
  const renderResult = renderRichContent(contentMarkdown, {
    presetId: resolvedPresetId,
    math: createMathRenderer(),
  });
  const { outline, warnings: renderWarnings } = renderResult;
  const r = resolvePresentation(resolvedPresetId, requestedPresentation);
  const validateWarnings = validateRichContent(contentMarkdown, { renderWarnings, hasPageToc: r.resolved.toc });

  // Duplicate-TOC warning: page-level TOC block AND [[toc]] marker both present
  const dupTocWarnings: string[] =
    r.resolved.toc && /\[\[toc\]\]/.test(contentMarkdown)
      ? ["[[toc]] marker found in content but presentation.toc is true - the page-level TOC block already covers this; remove [[toc]] from content to avoid a duplicate"]
      : [];

  const contentHtml = renderRichContentResultToHtml(renderResult, { presetId: resolvedPresetId });

  const warnings = [...new Set([...renderWarnings, ...validateWarnings, ...dupTocWarnings])];

  return {
    previewUrl: input.postId ? await previewUrlForPost(ctx.siteId, input.postId) : null,
    html: renderPresentedPreviewHtml(contentHtml, outline, r.resolved),
    outline,
    warnings,
    rendererVersion: RENDERER_VERSION,
    requestedPresentation: r.requested,
    resolvedPresentation: r.resolved,
    presentationWarnings: r.warnings,
  };
}
