import { createFileRoute } from '@tanstack/react-router'
import { can } from '@vc/core'
import { authenticateBearerToken } from '~/server/api-keys'
import { apiError, boundedIntegerParam, forceQuotaForSmoke, postStatusParam } from '~/server/api-params'
import { getPosts } from '~/server/cms'
import { enforceApiBudget } from '~/server/usage'

export const Route = createFileRoute('/api/posts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authResult = await authenticateBearerToken(request)
        if (!authResult) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
        if (!can(authResult.actor, 'posts:read')) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        try {
          await enforceApiBudget({
            workspaceId: authResult.workspaceId,
            siteId: authResult.siteId,
            tokenId: authResult.tokenId,
            kind: 'read',
            force: forceQuotaForSmoke(request),
          })
          const url = new URL(request.url)
          const limit = boundedIntegerParam(url.searchParams.get('limit'), 20, 1, 100)
          const offset = boundedIntegerParam(url.searchParams.get('offset'), 0, 0, 10_000)
          const posts = await getPosts(
            {
              user: { id: 'api', name: authResult.actor.name, email: 'api' },
              workspaceId: authResult.workspaceId,
              siteId: authResult.siteId,
              actor: authResult.actor,
            },
            postStatusParam(url.searchParams.get('status')),
            url.searchParams.get('search') || undefined,
            limit,
            offset,
          )
          return Response.json({ posts, pagination: { limit, offset, count: posts.length } })
        } catch (error) {
          return apiError(error)
        }
      },
    },
  },
})