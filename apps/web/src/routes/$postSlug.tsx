import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogPostView } from '~/components/PublicBlogPages'
import { handlePublicPostByHostGet } from '~/server/public-blog'
import { loadPublicBlogPostByHost } from '~/server/public-blog-page-fn'

// Root-level individual post served by Host header (custom domains + per-user subdomains).
// RESERVED_ROOT_SLUGS inside loadPublicPostByHost/handlePublicPostByHostGet guards /app, /api,
// /blog, etc., and TanStack ranks the static root routes above this dynamic one. On a host
// that does not resolve to a site (e.g. the app apex), resolveSite returns null and this 404s.
export const Route = createFileRoute('/$postSlug')({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const early = await handlePublicPostByHostGet(request, params.postSlug)
        if (early) return early
        return next()
      },
    },
  },
  loader: async ({ params }) => {
    const result = await loadPublicBlogPostByHost({ data: { postSlug: params.postSlug } })
    if (!result) throw notFound()
    return result
  },
  headers: ({ loaderData }) => loaderData?.headers ?? {},
  head: ({ loaderData }) => {
    const blog = loaderData?.blog
    if (!blog) return {}
    const seoTitle = blog.post.seo_title || `${blog.post.title} - ${blog.site.name}`
    const seoDescription = blog.post.seo_description || blog.post.excerpt || undefined
    return {
      meta: [
        { title: seoTitle },
        ...(seoDescription ? [{ name: 'description', content: seoDescription }] : []),
        { property: 'og:title', content: seoTitle },
        ...(seoDescription ? [{ property: 'og:description', content: seoDescription }] : []),
        { property: 'og:type', content: 'article' },
        ...(!blog.indexable ? [{ name: 'robots', content: 'noindex,nofollow' }] : []),
      ],
      links: [{ rel: 'canonical', href: blog.canonicalUrl }],
    }
  },
  component: HostPostPage,
})

function HostPostPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogPostView data={blog} />
}
