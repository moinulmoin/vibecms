import { createFileRoute } from '@tanstack/react-router'
import { handleLlmsTxtBySlug } from '~/server/public-feeds'

export const Route = createFileRoute('/blog/$siteSlug/llms.txt')({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleLlmsTxtBySlug(request, params.siteSlug),
    },
  },
})