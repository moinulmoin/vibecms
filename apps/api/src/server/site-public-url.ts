import { env } from 'cloudflare:workers'
import { createDataAccess } from '@vc/db'
import {
  defaultHostname,
  publicBlogBaseDomain,
  publicUrlForHostname,
} from './public-url'

// DB-backed public base URL for a site (active default hostname with one-time local->slug.zone repair); isolated here so './public-url' stays DB-free.
export async function getSitePublicBaseUrl(siteId: string, siteSlug: string): Promise<string | null> {
  const db = createDataAccess(env.DB)
  const baseDomain = publicBlogBaseDomain()
  const newHostname = baseDomain ? defaultHostname(siteSlug) : null
  let hostname = await db.sites.getActiveDefaultHostname(siteId, newHostname ?? undefined)
  if (hostname && newHostname && hostname !== newHostname) {
    hostname = await db.sites.repairDefaultHostname({ siteId, currentHostname: hostname, newHostname })
  }
  return publicUrlForHostname(hostname)
}
