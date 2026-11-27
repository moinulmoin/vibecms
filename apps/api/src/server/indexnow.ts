import { env } from 'cloudflare:workers'
import { changedPostFields, parseIndexNowKey, type PostVersion } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { resolveEffectiveEntitlementForSite } from '@/server/effective-entitlement'
import { scheduleBackground } from '@/server/execution-scope'
import { readLiveVersion } from '@/server/live-post-version'
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

/** What was live before a publish or archive; null = IndexNow off or the read failed, so nothing is sent. */
export type LiveSnapshot = { live: PostVersion | null } | null

function log(level: 'info' | 'warn', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields })
  if (level === 'warn') console.warn(line)
  else console.info(line)
}

/**
 * Capture the live version before a publish or archive. Reads nothing when
 * IndexNow is off, and never throws: a failed read skips the ping instead of
 * failing the mutation.
 */
export async function captureLiveVersionForIndexNow(siteId: string, postId: string, db: D1Database = env.DB): Promise<LiveSnapshot> {
  if (!parseIndexNowKey(env.INDEXNOW_KEY)) return null
  try {
    return { live: await readLiveVersion(db, siteId, postId) }
  } catch (error) {
    log('warn', 'indexnow_snapshot_failed', { siteId, postId, error: error instanceof Error ? error.name : 'unknown' })
    return null
  }
}

async function submitLiveChange(db: D1Database, key: string, siteId: string, postId: string, before: PostVersion | null) {
  const after = await readLiveVersion(db, siteId, postId)
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
export function scheduleIndexNowSubmission(siteId: string, postId: string, before: LiveSnapshot, db: D1Database = env.DB) {
  const key = parseIndexNowKey(env.INDEXNOW_KEY)
  if (!key || !before) return
  scheduleBackground(
    submitLiveChange(db, key, siteId, postId, before.live).catch((error: unknown) => {
      log('warn', 'indexnow_failed', { siteId, postId, error: error instanceof Error ? error.name : 'unknown' })
    }),
  )
}
