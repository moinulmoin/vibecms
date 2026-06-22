import { env } from 'cloudflare:workers'
import type { AppUserContext } from '~/server/onboarding'

type SiteExportRow = {
  id: string
  name: string
  slug: string
  description: string | null
  default_seo_title: string | null
  default_seo_description: string | null
}

type PostExportRow = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content_markdown: string
  status: string
  published_at: number | null
  tags_json: string
  seo_title: string | null
  seo_description: string | null
  canonical_url: string | null
  cover_asset_id: string | null
  created_at: number
  updated_at: number
}

/** Owner-only JSON export of the whole blog (all posts incl. drafts/archived). Backup + portability, no lock-in. */
export async function handleExport(app: AppUserContext): Promise<Response> {
  if (app.actor.type !== 'human' || app.actor.role !== 'owner') {
    return Response.json({ error: 'owner_required' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  }
  const site = await env.DB.prepare(
    'SELECT id, name, slug, description, default_seo_title, default_seo_description FROM sites WHERE id = ? LIMIT 1',
  )
    .bind(app.siteId)
    .first<SiteExportRow>()
  if (!site) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } })

  const rows = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, content_markdown, status, published_at, tags_json,
      seo_title, seo_description, canonical_url, cover_asset_id, created_at, updated_at
     FROM posts WHERE site_id = ? ORDER BY updated_at DESC, id DESC`,
  )
    .bind(app.siteId)
    .all<PostExportRow>()

  const posts = rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentMarkdown: row.content_markdown,
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json || '[]') as string[],
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    canonicalUrl: row.canonical_url,
    coverAssetId: row.cover_asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    site: {
      id: site.id,
      name: site.name,
      slug: site.slug,
      description: site.description,
      defaultSeoTitle: site.default_seo_title,
      defaultSeoDescription: site.default_seo_description,
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