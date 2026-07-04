import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogPostView } from '~/components/PublicBlogPages'
import { handlePublicPostBySlugGet, pathModeBlogRedirect } from '~/server/public-blog'
import { loadPublicBlogPost } from '~/server/public-blog-page-fn'
import { buildPostHeadContent } from '~/lib/seo-meta'

export const Route = createFileRoute('/blog/$siteSlug/$postSlug')({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const redirected = await pathModeBlogRedirect(request, params.siteSlug, `/${encodeURIComponent(params.postSlug)}`)
        if (redirected) return redirected
        const early = await handlePublicPostBySlugGet(request, params.siteSlug, params.postSlug)
        if (early) return early
        return next()
      },
    },
  },
  loader: async ({ params }) => {
    const result = await loadPublicBlogPost({
      data: { siteSlug: params.siteSlug, postSlug: params.postSlug },
    })
    if (!result) throw notFound()
    return result
  },
  headers: ({ loaderData }) => loaderData?.headers ?? {},
  head: ({ loaderData }) => {
    const blog = loaderData?.blog
    if (!blog) return {}
    return buildPostHeadContent({
      post: blog.post,
      site: blog.site,
      canonicalUrl: blog.canonicalUrl,
      origin: blog.origin,
      indexable: blog.indexable,
    })
  },
  component: BlogPostPage,
})

function BlogPostPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogPostView data={blog} />
}