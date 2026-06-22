import { createFileRoute } from '@tanstack/react-router'
import { rejectCrossOriginBrowserPost } from '~/server/csrf'
import { deleteAssetForApp } from '~/server/media'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

export const Route = createFileRoute('/api/media/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = rejectCrossOriginBrowserPost(request)
        if (csrf) return csrf
        const ctx = await resolveAppRouterContext()
        if (!ctx.app) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
        let assetId: string | undefined
        try {
          const body = (await request.json()) as { assetId?: unknown }
          assetId = typeof body.assetId === 'string' ? body.assetId : undefined
        } catch {
          // malformed body
        }
        if (!assetId) return Response.json({ kind: 'error', code: 'unknown' })
        const result = await deleteAssetForApp(ctx.app, assetId)
        return Response.json(result)
      },
    },
  },
})
