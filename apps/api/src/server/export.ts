import { createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from '@/server/onboarding'

/** Owner-only JSON export of the whole blog (all posts incl. drafts/archived). Backup + portability, no lock-in. */
export async function handleExport(app: AppUserContext): Promise<Response> {
  if (app.actor.type !== 'human' || app.actor.role !== 'owner') {
    return Response.json({ error: 'owner_required' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  }
  const db = createDataAccess(env.DB)
  const site = await db.exports.getExportSite(app.siteId)
  if (!site) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } })

  const rows = await db.exports.listAllPostsForExport(app.siteId)

  const posts = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentMarkdown: row.contentMarkdown,
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    publishedAt: row.publishedAt,
    tags: JSON.parse(row.tagsJson || '[]') as string[],
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    canonicalUrl: row.canonicalUrl,
    coverAssetId: row.coverAssetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    site: {
      id: site.id,
      name: site.name,
      slug: site.slug,
      description: site.description,
      defaultSeoTitle: site.defaultSeoTitle,
      defaultSeoDescription: site.defaultSeoDescription,
    },
    posts,
  }

  const date = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="vibecms-export-${date}.json"`,
      'cache-control': 'no-store',
    },
  })
}