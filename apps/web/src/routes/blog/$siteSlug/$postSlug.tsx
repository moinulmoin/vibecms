import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogPostView } from '~/components/PublicBlogPages'
import { handlePublicPostBySlugGet } from '~/server/public-blog'
import { loadPublicBlogPost } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/blog/$siteSlug/$postSlug')({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
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
  component: BlogPostPage,
})

function BlogPostPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogPostView data={blog} />
}