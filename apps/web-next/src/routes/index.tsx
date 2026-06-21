import { createFileRoute } from '@tanstack/react-router'
import { BRAND } from '@vc/config'
import { LandingHome } from '~/components/landing/LandingHome'
import { PublicBlogIndexView } from '~/components/PublicBlogPages'
import { seo } from '~/utils/seo'
import { getOgOrigin } from '~/server/og'
import { loadPublicBlogIndexByHost } from '~/server/public-blog-page-fn'

export const Route = createFileRoute('/')({
  loader: async () => {
    const blog = await loadPublicBlogIndexByHost({ data: {} })
    if (blog) return { kind: 'blog' as const, ...blog }
    const ogOrigin = await getOgOrigin()
    return { kind: 'landing' as const, ogOrigin }
  },
  head: ({ loaderData }) => {
    if (!loaderData || loaderData.kind === 'blog') return {}
    return {
      meta: [
        ...seo({
          title: `${BRAND.name} | ${BRAND.tagline}`,
          description: BRAND.description,
          image: loaderData.ogOrigin ? `${loaderData.ogOrigin}/brand/og.png` : undefined,
        }),
      ],
    }
  },
  component: IndexPage,
})

function IndexPage() {
  const data = Route.useLoaderData()
  if (data.kind === 'blog') return <PublicBlogIndexView data={data.blog} />
  return <LandingHome />
}
