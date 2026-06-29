import { createFileRoute } from '@tanstack/react-router'
import { handleExport } from '~/server/export'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

export const Route = createFileRoute('/api/export.json')({
  server: {
    handlers: {
      GET: async () => {
        const ctx = await resolveAppRouterContext()
        if (!ctx.app) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
        return handleExport(ctx.app)
      },
    },
  },
})