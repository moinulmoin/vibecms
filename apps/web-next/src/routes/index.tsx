import { createFileRoute } from '@tanstack/react-router'
import { BRAND } from '@vc/config'
import { LandingHome } from '~/components/landing/LandingHome'
import { seo } from '~/utils/seo'
import { getOgOrigin } from '~/server/og'

export const Route = createFileRoute('/')({
  loader: () => getOgOrigin(),
  head: ({ loaderData }) => ({
    meta: [
      ...seo({
        title: `${BRAND.name} | ${BRAND.tagline}`,
        description: BRAND.description,
        image: loaderData ? `${loaderData}/brand/og.png` : undefined,
      }),
    ],
  }),
  component: Home,
})

function Home() {
  return <LandingHome />
}