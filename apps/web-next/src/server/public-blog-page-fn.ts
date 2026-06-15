import { createServerFn } from '@tanstack/react-start'
import { loadPublicIndexBySlug, loadPublicPostBySlug, publicHtmlResponseHeaders } from '~/server/public-blog'

export const loadPublicBlogIndex = createServerFn({ method: 'GET' })
  .validator((data: { siteSlug: string }) => data)
  .handler(async ({ data }) => {
    const blog = await loadPublicIndexBySlug(data.siteSlug)
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