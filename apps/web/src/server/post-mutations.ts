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
import { getBillingStatus } from '~/server/billing'
import type { AppUserContext } from '~/server/onboarding'
import { purgeArticleCache } from '~/server/public-blog-cache'

export type MutationResult = { kind: 'ok' | 'error'; code: string; postId?: string }

function repository() {
  return createD1PostRepository(env.DB)
}

export function postMutationErrorCode(error: unknown): string {
  if (error instanceof BillingRequiredError) return 'billing_required'
  if (error instanceof NotFoundError) return 'not_found'
  if (error instanceof ForbiddenError) return 'owner_required'
  if (error instanceof ConflictError) return 'slug_conflict'
  if (error instanceof ValidationError) return 'unknown'
  if (error instanceof AppError && error.code === 'INVALID_COVER_ASSET') return 'invalid_cover_asset'
  if (error instanceof AppError && error.code === 'BILLING_REQUIRED') return 'billing_required'
  if (error instanceof AppError && error.code === 'NOT_FOUND') return 'not_found'
  if (error instanceof AppError && error.code === 'FORBIDDEN') return 'owner_required'
  if (error instanceof AppError && error.code === 'CONFLICT') return 'slug_conflict'
  return 'unknown'
}

async function coverAssetIdForSite(app: AppUserContext, coverAssetId: string | null | undefined) {
  if (!coverAssetId) return null
  if (!(await createDataAccess(env.DB).assets.existsForSite(app.siteId, coverAssetId))) {
    throw new AppError('INVALID_COVER_ASSET', 'Cover image must belong to this site', 400)
  }
  return coverAssetId
}

async function purgeIfPublished(app: AppUserContext, slug: string, status: string) {
  if (status !== 'published') return
  const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(app.siteId)
  if (siteSlug) void purgeArticleCache(app.siteId, siteSlug, slug)
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
): Promise<MutationResult> {
  try {
    const coverAssetId = await coverAssetIdForSite(app, payload.coverAssetId || null)
    const post = await updatePost(repository(), app.actor, {
      siteId: app.siteId,
      postId,
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
    await purgeIfPublished(app, post.slug, post.status)
    return { kind: 'ok', code: 'post_saved', postId }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function publishPostForApp(app: AppUserContext, postId: string): Promise<MutationResult> {
  try {
    const published = await publishPost(repository(), app.actor, {
      siteId: app.siteId,
      postId,
      billingStatus: await getBillingStatus(app.workspaceId),
    })
    const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(app.siteId)
    if (siteSlug) void purgeArticleCache(app.siteId, siteSlug, published.slug)
    return { kind: 'ok', code: 'post_published', postId }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function archivePostForApp(app: AppUserContext, postId: string): Promise<MutationResult> {
  try {
    const archived = await archivePost(repository(), app.actor, { siteId: app.siteId, postId })
    const siteSlug = await createDataAccess(env.DB).sites.getSiteSlug(app.siteId)
    if (siteSlug) void purgeArticleCache(app.siteId, siteSlug, archived.slug)
    return { kind: 'ok', code: 'post_archived', postId }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}

export async function restorePostVersionForApp(
  app: AppUserContext,
  postId: string,
  versionNumber: number,
): Promise<MutationResult> {
  try {
    await restorePostVersion(repository(), app.actor, { siteId: app.siteId, postId, versionNumber })
    return { kind: 'ok', code: 'post_restored', postId }
  } catch (error) {
    return { kind: 'error', code: postMutationErrorCode(error), postId }
  }
}