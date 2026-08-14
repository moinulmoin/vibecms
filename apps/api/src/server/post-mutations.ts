import {
  AppError,
  BillingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  archivePost,
  createPost,
  publishPost,
  restorePostVersion,
  updatePost,
} from '@vc/core'
import { createDataAccess, createD1PostRepository } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getCoreBillingStatusForSite } from '@/server/effective-entitlement'
import type { AppUserContext } from '@/server/onboarding'
import { resolvePublishedVersionSlug, scheduleLiveArticlePurges } from '@/server/post-live-purge'
import { assertPostImagesPublishable } from '@/server/publishing-images'

export type MutationResult = { kind: 'ok' | 'error'; code: string; postId?: string; versionNumber?: number }

function repository() {
  return createD1PostRepository(env.DB)
}

export function postMutationErrorCode(error: unknown): string {
  if (error instanceof BillingRequiredError) return 'billing_required'
  if (error instanceof NotFoundError) return 'not_found'
  if (error instanceof ForbiddenError) return 'owner_required'
  if (error instanceof ConflictError) {
    return /changed|concurrent/i.test(error.message) ? 'version_conflict' : 'slug_conflict'
  }
  if (error instanceof ValidationError) return 'unknown'
  if (error instanceof AppError && error.code === 'IMAGE_ALT_REQUIRED') return 'image_alt_required'
  if (error instanceof AppError && error.code === 'INVALID_COVER_ASSET') return 'invalid_cover_asset'
  if (error instanceof AppError && error.code === 'BILLING_REQUIRED') return 'billing_required'
  if (error instanceof AppError && error.code === 'NOT_FOUND') return 'not_found'
  if (error instanceof AppError && error.code === 'FORBIDDEN') return 'owner_required'
  if (error instanceof AppError && error.code === 'CONFLICT') {
    return /changed|concurrent/i.test(error.message) ? 'version_conflict' : 'slug_conflict'
  }
  return 'unknown'
}

async function coverAssetIdForSite(app: AppUserContext, coverAssetId: string | null | undefined) {
  if (!coverAssetId) return null
  if (!(await createDataAccess(env.DB).assets.existsForSite(app.siteId, coverAssetId))) {
    throw new AppError('INVALID_COVER_ASSET', 'Cover image must belong to this site', 400)
  }
  return coverAssetId
}


export type PostFormPayload = {
  title: string
  slug: string
  excerpt?: string
  contentMarkdown: string
  coverAssetId?: string | null
  canonicalUrl?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  tags: string[]
  presentation?: { layout?: string; toc?: boolean } | null
}

export async function createPostForApp(app: AppUserContext, payload: PostFormPayload): Promise<MutationResult> {
  try {
    const coverAssetId = await coverAssetIdForSite(app, payload.coverAssetId || null)
    const post = await createPost(repository(), app.actor, {
      siteId: app.siteId,
      title: payload.title,
      slug: payload.slug,
      excerpt: payload.excerpt,
      contentMarkdown: payload.contentMarkdown,
      coverAssetId: coverAssetId ?? undefined,
      canonicalUrl: payload.canonicalUrl ?? undefined,
      seoTitle: payload.seoTitle ?? undefined,
      seoDescription: payload.seoDescription ?? undefined,
      tags: payload.tags,
      presentation: payload.presentation ?? null,
    })
    return { kind: 'ok', code: 'post_created', postId: post.id }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error) }
  }
}

export async function updatePostForApp(
  app: AppUserContext,
  postId: string,
  payload: PostFormPayload,
  expectedVersionNumber: number,
): Promise<MutationResult> {
  try {
    const coverAssetId = await coverAssetIdForSite(app, payload.coverAssetId || null)
    const { versionNumber } = await updatePost(repository(), app.actor, {
      siteId: app.siteId,
      postId,
      expectedVersionNumber,
      title: payload.title,
      slug: payload.slug,
      excerpt: payload.excerpt,
      contentMarkdown: payload.contentMarkdown,
      coverAssetId: coverAssetId ?? undefined,
      canonicalUrl: payload.canonicalUrl,
      seoTitle: payload.seoTitle ?? undefined,
      seoDescription: payload.seoDescription ?? undefined,
      tags: payload.tags,
      presentation: payload.presentation,
    })
    // Live public content is pinned; draft saves do not need a public purge.
    return { kind: 'ok', code: 'post_saved', postId, versionNumber }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function publishPostForApp(
  app: AppUserContext,
  postId: string,
  expectedVersionNumber: number,
): Promise<MutationResult> {
  try {
    await assertPostImagesPublishable(app.siteId, postId)
    const previousLiveSlug = await resolvePublishedVersionSlug(repository(), app.siteId, postId)
    const published = await publishPost(repository(), app.actor, {
      siteId: app.siteId,
      postId,
      expectedVersionNumber,
      billingStatus: await getCoreBillingStatusForSite(app.siteId),
    })
    const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(app.siteId)
    if (siteSlug) scheduleLiveArticlePurges(app.siteId, siteSlug, previousLiveSlug, published.slug)
    return { kind: 'ok', code: 'post_published', postId }
  } catch (error) {
    if (error instanceof ConflictError) return { kind: 'error', code: 'version_conflict', postId }
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function archivePostForApp(app: AppUserContext, postId: string): Promise<MutationResult> {
  try {
    const previousLiveSlug = await resolvePublishedVersionSlug(repository(), app.siteId, postId)
    const archived = await archivePost(repository(), app.actor, { siteId: app.siteId, postId })
    const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(app.siteId)
    if (siteSlug) scheduleLiveArticlePurges(app.siteId, siteSlug, previousLiveSlug, archived.slug)
    return { kind: 'ok', code: 'post_archived', postId }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function restorePostVersionForApp(
  app: AppUserContext,
  postId: string,
  versionNumber: number,
  expectedVersionNumber: number,
): Promise<MutationResult> {
  try {
    const post = await restorePostVersion(repository(), app.actor, {
      siteId: app.siteId,
      postId,
      versionNumber,
      expectedVersionNumber,
    })
    return { kind: 'ok', code: 'post_restored', postId, versionNumber: post.currentVersionNumber }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}