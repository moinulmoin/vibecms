import { env } from 'cloudflare:workers'
import { createDataAccess } from '@vc/db'
import {
  appPublicBlogUrl,
  defaultHostname,
  isLocalDefaultHostname,
  publicBlogBaseDomain,
  publicBlogUsesAppPath,
  publicUrlForHostname,
} from './public-url'

// DB-backed public base URL for a site (app-path short-circuit, else active default hostname with one-time local->slug.zone repair); isolated here so './public-url' stays DB-free.
export async function getSitePublicBaseUrl(siteId: string, siteSlug: string): Promise<string | null> {
  if (publicBlogUsesAppPath()) return appPublicBlogUrl(siteSlug)
  const db = createDataAccess(env.DB)
  let hostname = await db.sites.getActiveDefaultHostname(siteId)
  if (hostname && isLocalDefaultHostname(hostname) && publicBlogBaseDomain()) {
    const newHostname = defaultHostname(siteSlug)
    hostname = await db.sites.repairDefaultHostname({ siteId, currentHostname: hostname, newHostname })
  }
  return publicUrlForHostname(hostname)
}
