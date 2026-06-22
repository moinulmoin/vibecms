import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { loadPublicBlogIndex } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/blog/$siteSlug/')({
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