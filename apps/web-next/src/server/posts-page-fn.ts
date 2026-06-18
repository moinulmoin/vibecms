import { createServerFn } from '@tanstack/react-start'
import type { Post } from '@vc/core'
import { createD1PostRepository } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getMedia } from '~/server/media'
import { getPosts } from '~/server/cms'
import {
  archivePostForApp,
  createPostForApp,
  publishPostForApp,
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
  }
}

export const loadPostsPage = createServerFn({ method: 'GET' })
  .validator((data: { status?: string; search?: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    const status =
      data.status === 'draft' || data.status === 'published' || data.status === 'archived'
        ? data.status
        : undefined
    const posts = await getPosts(app, status, data.search?.trim() || undefined)
    return { posts }
  })

export const loadPostEditorPage = createServerFn({ method: 'GET' })
  .validator((data: { postId?: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    const assets = await getMedia(app)
    if (!data.postId) {
      return { mode: 'new' as const, post: null, assets, missing: false }
    }
    const repo = createD1PostRepository(env.DB)
    const post = await repo.getPost(app.siteId, data.postId)
    return {
      mode: 'edit' as const,
      post: post as Post | null,
      assets,
      missing: !post,
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