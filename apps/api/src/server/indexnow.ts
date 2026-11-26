import { env } from 'cloudflare:workers'
import { changedPostFields, parseIndexNowKey, type PostVersion } from '@vc/core'
import { createD1PostRepository, createDataAccess } from '@vc/db'
import { resolveEffectiveEntitlementForSite } from '@/server/effective-entitlement'
import { scheduleBackground } from '@/server/execution-scope'
import { getSitePublicBaseUrl, postPublicUrl } from '@/server/site-public-url'

/**
 * Optional IndexNow pings (Bing, and the engines that share its submissions):
 * off unless the Worker setting `INDEXNOW_KEY` holds a valid key. The public
 * Worker serves that key at `<blog base>/<key>.txt`; after a publish or archive
 * changes what readers see, one POST names the post's public URL(s). The ping
 * runs after the response, times out quickly, is never retried, and never
 * fails the mutation that triggered it.
 */
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_TIMEOUT_MS = 4_000

/** The version readers see right now: published, publish time reached, pinned. */
async function liveVersion(db: D1Database, siteId: string, postId: string): Promise<PostVersion | null> {
  const repo = createD1PostRepository(db)
  const post = await repo.getPost(siteId, postId)
  if (post?.status !== 'published' || !post.publishedVersionNumber) return null
  if (post.publishedAt === null || post.publishedAt > Date.now() / 1000) return null
  return repo.getPostVersion(siteId, postId, post.publishedVersionNumber)
}

/** Capture the live version before a publish or archive; reads nothing when IndexNow is off. */
export async function captureLiveVersionForIndexNow(siteId: string, postId: string, db: D1Database = env.DB) {
  return parseIndexNowKey(env.INDEXNOW_KEY) ? liveVersion(db, siteId, postId) : null
}

function log(level: 'info' | 'warn', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields })
  if (level === 'warn') console.warn(line)
  else console.info(line)
}

async function submitLiveChange(db: D1Database, key: string, siteId: string, postId: string, before: PostVersion | null) {
  const after = await liveVersion(db, siteId, postId)
  if (!before && !after) return
  if (before && after && changedPostFields(before, after).length === 0) return
  const data = createDataAccess(db)
  const [site, suspension, entitlement] = await Promise.all([
    data.sites.getCurrentSite(siteId),
    data.sites.getSuspension(siteId),
    resolveEffectiveEntitlementForSite(siteId),
  ])
  // Same serving rule as the public Worker: a suspended or paused blog shows the paused page.
  if (!site || suspension || entitlement.servingPaused) return
  const base = await getSitePublicBaseUrl(siteId, site.slug)
  if (!base?.startsWith('https://')) return
  const slugs = new Set([before?.slug, after?.slug].filter((slug): slug is string => Boolean(slug)))
  const urlList = [...slugs].map((slug) => postPublicUrl(base, { status: 'published', slug })!)
  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(base).hostname, key, keyLocation: `${base}/${key}.txt`, urlList }),
    signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
  })
  await response.body?.cancel()
  log(response.ok ? 'info' : 'warn', 'indexnow_submitted', { siteId, postId, status: response.status, urls: urlList.length })
}

/** After a publish or archive: tell IndexNow when the post's public page changed. */
export function scheduleIndexNowSubmission(siteId: string, postId: string, before: PostVersion | null, db: D1Database = env.DB) {
  const key = parseIndexNowKey(env.INDEXNOW_KEY)
  if (!key) return
  scheduleBackground(
    submitLiveChange(db, key, siteId, postId, before).catch((error: unknown) => {
      log('warn', 'indexnow_failed', { siteId, postId, error: error instanceof Error ? error.name : 'unknown' })
    }),
  )
}
