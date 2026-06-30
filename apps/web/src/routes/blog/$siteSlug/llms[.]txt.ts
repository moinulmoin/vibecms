import { createFileRoute } from '@tanstack/react-router'
import { handleLlmsTxtBySlug } from '~/server/public-feeds'
import { pathModeBlogRedirect } from '~/server/public-blog'

export const Route = createFileRoute('/blog/$siteSlug/llms.txt')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const redirected = await pathModeBlogRedirect(request, params.siteSlug, '/llms.txt')
        return redirected ?? handleLlmsTxtBySlug(request, params.siteSlug)
      },
    },
  },
})