import { createFileRoute } from '@tanstack/react-router'
import { handleLlmsTxt } from '~/server/public-feeds'

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: async ({ request }) => handleLlmsTxt(request),
    },
  },
})