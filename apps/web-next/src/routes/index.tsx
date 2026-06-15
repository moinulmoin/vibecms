import { createFileRoute } from '@tanstack/react-router'
import { BRAND } from '@vc/config'
import { LandingHome } from '~/components/landing/LandingHome'
import { seo } from '~/utils/seo'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      ...seo({
        title: `${BRAND.name} | ${BRAND.tagline}`,
        description: BRAND.description,
      }),
    ],
  }),
  component: Home,
})

function Home() {
  return <LandingHome />
}