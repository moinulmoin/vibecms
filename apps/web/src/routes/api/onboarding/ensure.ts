import { createFileRoute } from '@tanstack/react-router'
import { ensureOnboarding } from '~/server/onboarding'
import { maybeRejectCrossOriginAppPost } from '~/server/auth-guards'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

export const Route = createFileRoute('/api/onboarding/ensure')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = maybeRejectCrossOriginAppPost(request)
        if (csrf) return csrf

        const ctx = await resolveAppRouterContext()
        if (!ctx.app) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })

        await ensureOnboarding(ctx.app.user)
        return Response.json({ ok: true })
      },
    },
  },
})