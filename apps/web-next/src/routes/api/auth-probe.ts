import { createFileRoute } from '@tanstack/react-router'
import { authenticateBearerToken } from '~/server/api-keys'

export const Route = createFileRoute('/api/auth-probe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateBearerToken(request)
        return Response.json({ ok: Boolean(auth), siteId: auth?.siteId ?? null })
      },
    },
  },
})