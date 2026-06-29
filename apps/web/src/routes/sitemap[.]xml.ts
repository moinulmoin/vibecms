import { createFileRoute } from '@tanstack/react-router'
import { handleSitemap } from '~/server/public-feeds'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => handleSitemap(request),
    },
  },
})