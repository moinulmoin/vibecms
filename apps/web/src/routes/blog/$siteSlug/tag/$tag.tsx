import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { loadPublicBlogTag } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/blog/$siteSlug/tag/$tag')({
  loader: async ({ params }) => {
    const result = await loadPublicBlogTag({ data: { siteSlug: params.siteSlug, tag: params.tag } })
    if (!result) throw notFound()
    return result
  },
  headers: ({ loaderData }) => loaderData?.headers ?? {},
  component: BlogTagPage,
})

function BlogTagPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogIndexView data={blog} />
}
