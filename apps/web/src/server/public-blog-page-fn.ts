import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import {
  loadPublicIndexBySlug,
  loadPublicIndexByHost,
  loadPublicPostBySlug,
  loadPublicTagBySlug,
  loadPublicTagByHost,
  publicHtmlResponseHeaders,
} from '~/server/public-blog'

export const loadPublicBlogIndex = createServerFn({ method: 'GET' })
  .validator((data: { siteSlug: string; q?: string }) => data)
  .handler(async ({ data }) => {
    const blog = await loadPublicIndexBySlug(data.siteSlug, data.q)
    if (!blog) return null
    const headers =
      blog.listing.kind === 'search'
        ? ({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } as Record<string, string>)
        : publicHtmlResponseHeaders(blog.site)
    return { blog, headers }
  })

export const loadPublicBlogTag = createServerFn({ method: 'GET' })
  .validator((data: { siteSlug: string; tag: string }) => data)
  .handler(async ({ data }) => {
    const blog = await loadPublicTagBySlug(data.siteSlug, data.tag)
    if (!blog) return null
    return { blog, headers: publicHtmlResponseHeaders(blog.site) }
  })

export const loadPublicBlogPost = createServerFn({ method: 'GET' })
  .validator((data: { siteSlug: string; postSlug: string }) => data)
  .handler(async ({ data }) => {
    const blog = await loadPublicPostBySlug(data.siteSlug, data.postSlug)
    if (!blog) return null
    return { blog, headers: publicHtmlResponseHeaders(blog.site, blog.cacheTag) }
  })

export const loadPublicBlogIndexByHost = createServerFn({ method: 'GET' })
  .validator((data: Record<string, never>) => data)
  .handler(async () => {
    const request = getRequest()
    const rawQ = new URL(request.url).searchParams.get('q')?.trim().slice(0, 100)
    const q = rawQ && rawQ.length > 0 ? rawQ : undefined
    const blog = await loadPublicIndexByHost(request, q)
    if (!blog) return null
    const headers =
      blog.listing.kind === 'search'
        ? ({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } as Record<string, string>)
        : publicHtmlResponseHeaders(blog.site)
    return { blog, headers }
  })

export const loadPublicBlogTagByHost = createServerFn({ method: 'GET' })
  .validator((data: { tag: string }) => data)
  .handler(async ({ data }) => {
    const request = getRequest()
    const blog = await loadPublicTagByHost(request, data.tag)
    if (!blog) return null
    return { blog, headers: publicHtmlResponseHeaders(blog.site) }
  })