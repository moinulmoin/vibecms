/**
 * Operator abuse suspension (docs/blog-suspension.md). The operator sets and
 * clears `sites.suspended_at` with `pnpm blog:suspend`; this module enforces
 * it on writes and sends the owner's one email from the 15-minute cron.
 * Public serving (the paused page) lives in the public Worker. Suspension
 * never touches the AutoSEOPilot managed claim clock.
 */
import { SiteSuspendedError } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'
import { sendSuspensionEmail } from '@/server/email'
import { scheduleManagedSitePurge } from '@/server/purge-scheduler'
import { getSitePublicBaseUrl } from '@/server/site-public-url'

/** Publish, schedule and upload call this first: a suspended blog refuses them. */
export async function assertSiteNotSuspended(siteId: string, db: D1Database = env.DB): Promise<void> {
  if ((await createDataAccess(db).sites.getSuspension(siteId)) !== null) throw new SiteSuspendedError()
}

/** Owner emails per cron tick; suspensions are rare, the rest wait for the next tick. */
const NOTICES_PER_RUN = 20

/**
 * Sends each newly suspended blog's owner one email and purges the blog's
 * public cache so cached pages stop serving. The notice is claimed before the
 * send and given back if the send fails, so a later tick retries it and no
 * tick sends it twice.
 */
export async function runSuspensionNotices(workerEnv: Cloudflare.Env): Promise<{ sent: number }> {
  const sites = createDataAccess(workerEnv.DB).sites
  let sent = 0
  for (const suspension of await sites.listUnnotifiedSuspensions(NOTICES_PER_RUN)) {
    const now = Math.floor(Date.now() / 1000)
    if (!(await sites.claimSuspensionNotice(suspension.siteId, suspension.suspendedAt, now))) continue
    scheduleManagedSitePurge(workerEnv.DB, suspension.siteId, suspension.siteSlug)
    if (!suspension.ownerEmail) {
      console.warn(JSON.stringify({ level: 'warn', event: 'suspension_notice_no_owner', siteId: suspension.siteId }))
      continue
    }
    try {
      await sendSuspensionEmail({
        to: suspension.ownerEmail,
        siteName: suspension.siteName,
        address: (await getSitePublicBaseUrl(suspension.siteId, suspension.siteSlug)) ?? suspension.siteSlug,
        reason: suspension.reason,
      })
      sent += 1
    } catch (error) {
      await sites.releaseSuspensionNotice(suspension.siteId, now)
      console.error(JSON.stringify({ level: 'error', event: 'suspension_notice_failed', siteId: suspension.siteId, error: String(error) }))
    }
  }
  return { sent }
}
