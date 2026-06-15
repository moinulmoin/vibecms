import { createFileRoute } from '@tanstack/react-router'
import { listPosts } from '@vc/core'
import { createD1PostRepository } from '@vc/db'
import { env } from 'cloudflare:workers'

const QA_SITE = 'site_XSRAJIxVWot6QuZIQIeu9ubsGINteU5L'

export const Route = createFileRoute('/api/d1-probe')({
  server: {
    handlers: {
      GET: async () => {
        const repo = createD1PostRepository(env.DB)
        const posts = await listPosts(repo, { type: 'api_key', id: 'probe', name: 'probe', scopes: ['posts:read'] }, {
          siteId: QA_SITE,
          limit: 3,
          offset: 0,
        })
        return Response.json({ ok: true, siteId: QA_SITE, count: posts.length, titles: posts.map((p) => p.title) })
      },
    },
  },
})