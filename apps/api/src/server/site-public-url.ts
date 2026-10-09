import { env } from 'cloudflare:workers'
import { createDataAccess, type DataAccess } from '@vc/db'
import {
  defaultHostname,
  publicBlogBaseDomain,
  publicUrlForHostname,
} from './public-url'
import { resolveEffectiveEntitlementForSite } from './effective-entitlement'

// Active default host (slug.<zone>) with one-time local->slug.zone repair.
// Assets and preview links stay on our host: media/preview paths are not
// proxied through customer domains.
async function defaultHostBaseUrl(
  db: DataAccess,
  siteId: string,
  siteSlug: string,
): Promise<string | null> {
  const baseDomain = publicBlogBaseDomain()
  const newHostname = baseDomain ? defaultHostname(siteSlug) : null
  let hostname = await db.sites.getActiveDefaultHostname(siteId, newHostname ?? undefined)
  if (hostname && newHostname && hostname !== newHostname) {
    hostname = await db.sites.repairDefaultHostname({ siteId, currentHostname: hostname, newHostname })
  }
  return publicUrlForHostname(hostname)
}

// DB-backed public base URL for a site: its PRIMARY location
// (active subpath > custom > default) while the site's effective entitlement
// is active — the same `managedSites.resolveSite` rule the public worker
// applies before serving or redirecting to a paid mount. An unentitled site
// falls back to the active default host so dashboard links never point at a
// location the public worker 404s. Isolated here so './public-url' stays
// DB-free.
export async function getSitePublicBaseUrl(siteId: string, siteSlug: string): Promise<string | null> {
  const db = createDataAccess(env.DB)
  const primary = await db.domains.getPrimaryPublicLocation(siteId)
  if (!primary || primary.type === 'default') {
    return defaultHostBaseUrl(db, siteId, siteSlug)
  }
  if ((await resolveEffectiveEntitlementForSite(siteId)).effective) {
    const base = publicUrlForHostname(primary.hostname)
    return base ? `${base}${primary.basePath}` : null
  }
  return defaultHostBaseUrl(db, siteId, siteSlug)
}

// Media, logos, favicons and preview links are served only from our default
// host; always the slug.<zone> origin regardless of the site's primary location.
export async function getSiteAssetBaseUrl(siteId: string, siteSlug: string): Promise<string | null> {
  return defaultHostBaseUrl(createDataAccess(env.DB), siteId, siteSlug)
}
