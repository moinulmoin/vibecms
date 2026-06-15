import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { loadPublicBlogIndex } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/blog/$siteSlug/')({
  loader: async ({ params }) => {
    const result = await loadPublicBlogIndex({ data: { siteSlug: params.siteSlug } })
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