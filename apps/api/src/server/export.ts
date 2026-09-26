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

  const [rows, versions, assets] = await Promise.all([
    db.exports.listAllPostsForExport(app.siteId),
    db.exports.listVersionsForExport(app.siteId),
    db.exports.listAssetsForExport(app.siteId),
  ])
  const versionsByPost = new Map<string, typeof versions>()
  for (const version of versions) {
    const existing = versionsByPost.get(version.postId) ?? []
    existing.push(version)
    versionsByPost.set(version.postId, existing)
  }
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))

  const snapshot = (version: typeof versions[number], publishedAt: number | null) => ({
    versionNumber: version.versionNumber,
    title: version.title,
    slug: version.slug,
    excerpt: version.excerpt,
    contentMarkdown: version.contentMarkdown,
    coverAssetId: version.coverAssetId,
    seoTitle: version.seoTitle,
    seoDescription: version.seoDescription,
    canonicalUrl: version.canonicalUrl,
    tags: JSON.parse(version.tagsJson || '[]') as string[],
    presentation: version.presentationJson ? JSON.parse(version.presentationJson) : null,
    publishedAt,
  })

  const posts = rows.map((row) => {
    const postVersions = versionsByPost.get(row.id) ?? []
    const published = postVersions.find((version) => version.id === row.publishedVersionId)
    const tip = postVersions.reduce<typeof versions[number] | null>((latest, version) =>
      !latest || version.versionNumber > latest.versionNumber ? version : latest, null)
    const referencedIds = new Set<string>()
    for (const version of [published, tip]) {
      if (!version) continue
      if (version.coverAssetId) referencedIds.add(version.coverAssetId)
      for (const match of version.contentMarkdown.matchAll(/\/media-assets\/([a-zA-Z0-9-]+)/g)) referencedIds.add(match[1])
    }
    return {
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
      presentation: row.presentationJson ? JSON.parse(row.presentationJson) : null,
      publishedVersion: published ? snapshot(published, row.publishedAt) : null,
      draftTip: tip && tip.id !== published?.id ? snapshot(tip, null) : null,
      mediaAssets: [...referencedIds].map((id) => ({
        id,
        url: `/media-assets/${id}`,
        ...(assetsById.get(id) ?? {}),
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  })

  const payload = {
    schemaVersion: 2,
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
