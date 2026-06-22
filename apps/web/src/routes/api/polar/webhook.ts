import { createFileRoute } from '@tanstack/react-router'
import { handlePolarWebhook } from '~/server/billing'

export const Route = createFileRoute('/api/polar/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePolarWebhook(request),
    },
  },
})