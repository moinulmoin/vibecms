import { createFileRoute } from '@tanstack/react-router'
import { handleFeed } from '~/server/public-feeds'

export const Route = createFileRoute('/feed.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => handleFeed(request),
    },
  },
})