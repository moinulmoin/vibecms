import { createFileRoute } from '@tanstack/react-router'
import { handleRobots } from '~/server/public-feeds'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async ({ request }) => handleRobots(request),
    },
  },
})