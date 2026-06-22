import { createFileRoute } from '@tanstack/react-router'
import { handleSubscribe } from '~/server/subscribe'

// Public endpoint - no CSRF check (same-origin is not required; this is
// intentionally open so any page embedding the widget can POST here).
export const Route = createFileRoute('/api/subscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handleSubscribe(request)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
