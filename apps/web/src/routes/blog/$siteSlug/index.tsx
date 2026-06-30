import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { loadPublicBlogIndex } from '~/server/public-blog-page-fn'
import { pathModeBlogRedirect } from '~/server/public-blog'

export const Route = createFileRoute('/blog/$siteSlug/')({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const redirected = await pathModeBlogRedirect(request, params.siteSlug, '/')
        return redirected ?? next()
      },
    },
  },
  validateSearch: (search: Record<string, unknown>) => {
    const raw = typeof search.q === 'string' ? search.q.trim().slice(0, 100) : undefined
    return { q: raw && raw.length > 0 ? raw : undefined }
  },
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ params, deps }) => {
    const result = await loadPublicBlogIndex({ data: { siteSlug: params.siteSlug, q: deps.q } })
    if (!result) throw notFound()
    return result
  },
  headers: ({ loaderData }) => loaderData?.headers ?? {},
  component: BlogIndexPage,
})

function BlogIndexPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogIndexView data={blog} />
}