import { createFileRoute } from '@tanstack/react-router'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'
import { uploadAssetForApp } from '~/server/media'

export const Route = createFileRoute('/api/media/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await resolveAppRouterContext()
        if (!ctx.app) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) {
          return Response.json({ kind: 'error', code: 'upload_missing_file' })
        }
        const altText = typeof form.get('altText') === 'string' ? String(form.get('altText')) : undefined
        const result = await uploadAssetForApp(ctx.app, file, altText)
        return Response.json(result)
      },
    },
  },
})