import { createServerFn } from '@tanstack/react-start'
import type { Post } from '@vc/core'
import { getPostVersion, listPostVersions } from '@vc/core'
import { resolvePresetId } from '@vc/config'
import { createD1PostRepository } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getMedia } from '~/server/media'
import { getPosts } from '~/server/cms'
import {
  archivePostForApp,
  createPostForApp,
  publishPostForApp,
  restorePostVersionForApp,
  updatePostForApp,
  type PostFormPayload,
} from '~/server/post-mutations'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

async function requireApp() {
  const ctx = await resolveAppRouterContext()
  if (!ctx.app) throw new Error('UNAUTHORIZED')
  return ctx.app
}

function parseTags(raw: string | undefined) {
  if (!raw) return []
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function parsePostPayload(data: {
  title: string
  slug: string
  excerpt?: string
  contentMarkdown: string
  coverAssetId?: string | null
  seoTitle?: string
  seoDescription?: string
  tags?: string
  presentation?: { layout?: string; toc?: boolean } | null
}): PostFormPayload {
  return {
    title: data.title.trim(),
    slug: data.slug.trim(),
    excerpt: data.excerpt?.trim() || undefined,
    contentMarkdown: data.contentMarkdown,
    coverAssetId: data.coverAssetId && data.coverAssetId.length > 0 ? data.coverAssetId : null,
    seoTitle: data.seoTitle?.trim() || undefined,
    seoDescription: data.seoDescription?.trim() || undefined,
    tags: typeof data.tags === 'string' ? parseTags(data.tags) : [],
    presentation: data.presentation,
  }
}

const POSTS_PAGE_SIZE = 24

export const loadPostsPage = createServerFn({ method: 'GET' })
  .validator((data: { status?: string; search?: string; offset?: number }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    const status =
      data.status === 'draft' || data.status === 'published' || data.status === 'archived'
        ? data.status
        : undefined
    const offset = Math.max(data.offset ?? 0, 0)
    // Fetch one extra to know whether another page exists, without a count query.
    const fetched = await getPosts(app, status, data.search?.trim() || undefined, POSTS_PAGE_SIZE + 1, offset)
    const hasMore = fetched.length > POSTS_PAGE_SIZE
    return { posts: hasMore ? fetched.slice(0, POSTS_PAGE_SIZE) : fetched, hasMore }
  })

export const loadPostEditorPage = createServerFn({ method: 'GET' })
  .validator((data: { postId?: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    const assets = await getMedia(app)
    const themeRow = await env.DB.prepare('SELECT theme FROM sites WHERE id = ? LIMIT 1')
      .bind(app.siteId)
      .first<{ theme: string | null }>()
    const presetId = resolvePresetId(themeRow?.theme)
    if (!data.postId) {
      return { mode: 'new' as const, post: null, assets, missing: false, presetId }
    }
    const repo = createD1PostRepository(env.DB)
    const post = await repo.getPost(app.siteId, data.postId)
    return {
      mode: 'edit' as const,
      post: post as Post | null,
      assets,
      missing: !post,
      presetId,
    }
  })

export const createPostMutation = createServerFn({ method: 'POST' })
  .validator((data: {
    title: string
    slug: string
    excerpt?: string
    contentMarkdown: string
    coverAssetId?: string | null
    seoTitle?: string
    seoDescription?: string
    tags?: string
    presentation?: { layout?: string; toc?: boolean } | null
  }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return createPostForApp(app, parsePostPayload(data))
  })

export const updatePostMutation = createServerFn({ method: 'POST' })
  .validator((data: {
    postId: string
    title: string
    slug: string
    excerpt?: string
    contentMarkdown: string
    coverAssetId?: string | null
    seoTitle?: string
    seoDescription?: string
    tags?: string
    presentation?: { layout?: string; toc?: boolean } | null
  }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    const { postId, ...rest } = data
    return updatePostForApp(app, postId, parsePostPayload(rest))
  })

export const publishPostMutation = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return publishPostForApp(app, data.postId)
  })

export const archivePostMutation = createServerFn({ method: 'POST' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return archivePostForApp(app, data.postId)
  })

export const listPostVersionsFn = createServerFn({ method: 'GET' })
  .validator((data: { postId: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return listPostVersions(createD1PostRepository(env.DB), app.actor, {
      siteId: app.siteId,
      postId: data.postId,
    })
  })

export const getPostVersionFn = createServerFn({ method: 'GET' })
  .validator((data: { postId: string; versionNumber: number }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return getPostVersion(createD1PostRepository(env.DB), app.actor, {
      siteId: app.siteId,
      postId: data.postId,
      versionNumber: data.versionNumber,
    })
  })

export const restorePostVersionFn = createServerFn({ method: 'POST' })
  .validator((data: { postId: string; versionNumber: number }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return restorePostVersionForApp(app, data.postId, data.versionNumber)
  })