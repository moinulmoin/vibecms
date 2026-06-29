import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { loadPublicBlogTagByHost } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/tag/$tag')({
  loader: async ({ params }) => {
    const result = await loadPublicBlogTagByHost({ data: { tag: params.tag } })
    if (!result) throw notFound()
    return result
  },
  headers: ({ loaderData }) => loaderData?.headers ?? {},
  component: BlogTagByHostPage,
})

function BlogTagByHostPage() {
  const { blog } = Route.useLoaderData()
  return <PublicBlogIndexView data={blog} />
}
