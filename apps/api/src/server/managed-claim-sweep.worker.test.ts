/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
 import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}
import { createDataAccess } from '@vc/db'
import { MANAGED_CLAIM_WINDOW } from '@vc/config'
import { runManagedClaimSweep } from './managed-claim-sweep'

const DAY = 24 * 60 * 60
const data = createDataAccess(env.DB)

interface SeedInput {
  suffix: string
  /** Days ago the revoke landed; null = active sponsorship. */
  revokedDaysAgo: number | null
  polarStatus?: 'active' | 'none'
}

interface SeededClaim {
  externalWorkspaceId: string
  workspaceId: string
  siteId: string
  ownerUserId: string
}

async function seedManagedSite(input: SeedInput): Promise<SeededClaim> {
  const suffix = input.suffix
  const now = Math.floor(Date.now() / 1000)
  const timestamp = now - 10_000
  const externalWorkspaceId = `external-sweep-${suffix}`
  const result = await data.managedSites.firstProvision({
    timestamp,
    owner: {
      id: `sweep-owner-${suffix}`,
      name: `Sweep Owner ${suffix}`,
      email: `sweep-${suffix}@example.test`,
    },
    workspace: {
      id: `sweep-ws-${suffix}`,
      name: `Sweep ${suffix}`,
      slug: `sweep-${suffix}`,
    },
    membership: { id: `sweep-membership-${suffix}` },
    site: {
      id: `sweep-site-${suffix}`,
      name: `Sweep Site ${suffix}`,
      slug: `sweep-site-${suffix}`,
      description: null,
    },
    defaultDomain: {
      id: `sweep-domain-${suffix}`,
      hostname: `sweep-${suffix}.example.test`,
    },
    apiKey: {
      id: `sweep-key-${suffix}`,
      name: 'AutoSEOPilot',
      tokenPrefix: `vc_test_sweep_${suffix}`,
      tokenHash: `hash-sweep-${suffix}`,
      scopesJson: '[]',
      actorName: 'AutoSEOPilot',
    },
    binding: {
      id: `sweep-binding-${suffix}`,
      externalWorkspaceId,
      credentialId: `sweep-credential-${suffix}`,
      credentialGeneration: 1,
      entitlementStatus: 'active',
      entitlementExpiresAt: null,
      lifecycleRevision: 1,
    },
  })
  if (input.revokedDaysAgo !== null) {
    await env.DB
      .prepare(
        `UPDATE autoseopilot_managed_sites
         SET entitlement_status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE site_id = ?`,
      )
      .bind(now - input.revokedDaysAgo * DAY, now, `sweep-site-${suffix}`)
      .run()
  }
  if (input.polarStatus === 'active') {
    await env.DB
      .prepare(
        `INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?)`,
      )
      .bind(`sweep-billing-${suffix}`, result.workspaceId, now + 30 * DAY, timestamp, timestamp)
      .run()
  }
  return {
    externalWorkspaceId,
    workspaceId: result.workspaceId,
    siteId: result.siteId,
    ownerUserId: result.ownerUserId,
  }
}

async function markersFor(externalWorkspaceId: string) {
  const row = await env.DB
    .prepare(
      `SELECT claim_day7_sent_at, claim_day14_sent_at, claim_day21_sent_at, claim_day28_sent_at
       FROM autoseopilot_managed_sites WHERE external_workspace_id = ?`,
    )
    .bind(externalWorkspaceId)
    .first<{
      claim_day7_sent_at: number | null
      claim_day14_sent_at: number | null
      claim_day21_sent_at: number | null
      claim_day28_sent_at: number | null
    }>()
  return row
}

async function rowExists(sql: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare(sql).bind(id).first()
  return row !== null
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

describe('managed claim sweep — reminders', () => {
  it('sends the day-7 reminder exactly once and never re-sends it', async () => {
    const seeded = await seedManagedSite({ suffix: 'r7', revokedDaysAgo: 8 })
    const first = await runManagedClaimSweep(env)
    expect(first.skipped).toBe(false)
    const afterFirst = await markersFor(seeded.externalWorkspaceId)
    expect(afterFirst?.claim_day7_sent_at).not.toBeNull()
    expect(afterFirst?.claim_day14_sent_at).toBeNull()

    const second = await runManagedClaimSweep(env)
    expect(second.remindersSent).toBe(0)
    const afterSecond = await markersFor(seeded.externalWorkspaceId)
    expect(afterSecond?.claim_day7_sent_at).toBe(afterFirst?.claim_day7_sent_at)
  })

  it('sends only the latest missed reminder when dates move forward, and never re-sends it', async () => {
    const seeded = await seedManagedSite({ suffix: 'rall', revokedDaysAgo: 29 })
    const result = await runManagedClaimSweep(env)
    // A missed cron tick must not stack four emails; the latest slot wins.
    expect(result.remindersSent).toBe(1)
    const markers = await markersFor(seeded.externalWorkspaceId)
    expect(markers?.claim_day28_sent_at).not.toBeNull()

    const again = await runManagedClaimSweep(env)
    expect(again.remindersSent).toBe(0)
  })

  it('stops all reminders once the blog is claimed with Cloud', async () => {
    const seeded = await seedManagedSite({ suffix: 'rclaimed', revokedDaysAgo: 10, polarStatus: 'active' })
    const result = await runManagedClaimSweep(env)
    const markers = await markersFor(seeded.externalWorkspaceId)
    expect(markers?.claim_day7_sent_at).toBeNull()
    expect(result.remindersSent).toBe(0)
  })
})

describe('managed claim sweep — purge', () => {
  it('purges an unclaimed blog past day 30: rows, R2 prefix, and a sole login', async () => {
    const seeded = await seedManagedSite({ suffix: 'p31', revokedDaysAgo: 31 })
    await env.ASSETS_BUCKET.put(`${seeded.siteId}/media-1.png`, new Uint8Array([1, 2, 3]))
    await env.ASSETS_BUCKET.put('unrelated-site/keep.png', new Uint8Array([9]))
    await env.DB
      .prepare(
        `INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
         VALUES ('sweep-post-p31', ?, 'Purge me', 'purge-me', '# x', 'published', 1, 'api_key', 'seed', 'api_key', 'seed', 1, 1)`,
      )
      .bind(seeded.siteId)
      .run()

    const result = await runManagedClaimSweep(env)
    expect(result.purged).toBeGreaterThanOrEqual(1)

    expect(await rowExists('SELECT id FROM autoseopilot_managed_sites WHERE external_workspace_id = ?', seeded.externalWorkspaceId)).toBe(false)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', seeded.siteId)).toBe(false)
    expect(await rowExists('SELECT id FROM posts WHERE site_id = ?', seeded.siteId)).toBe(false)
    expect(await rowExists('SELECT id FROM workspaces WHERE id = ?', seeded.workspaceId)).toBe(false)
    // Sole workspace: the login goes with it.
    expect(await rowExists('SELECT id FROM user WHERE id = ?', seeded.ownerUserId)).toBe(false)
    const r2Object = await env.ASSETS_BUCKET.get(`${seeded.siteId}/media-1.png`)
    expect(r2Object).toBeNull()
    expect(await env.ASSETS_BUCKET.get('unrelated-site/keep.png')).not.toBeNull()

    // Idempotent: a second run purges nothing and throws nothing.
    const again = await runManagedClaimSweep(env)
    expect(again.purged).toBe(0)
  })

  it('keeps the login when the owner belongs to another workspace', async () => {
    const sharedOwner = 'sweep-owner-shared'
    const now = Math.floor(Date.now() / 1000)
    const doomed = await seedManagedSite({ suffix: 'pshared', revokedDaysAgo: 32 })
    // Move the doomed site onto the shared owner, then give that owner a second workspace.
    await env.DB
      .prepare('UPDATE autoseopilot_managed_sites SET owner_user_id = ? WHERE external_workspace_id = ?')
      .bind(sharedOwner, doomed.externalWorkspaceId)
      .run()
    await env.DB
      .prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind(sharedOwner, 'Shared Owner', 'shared@sweep.example.test', now - 100, now - 100)
      .run()
    await env.DB
      .prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('sweep-ws-other', 'Other Workspace', 'sweep-other', now - 100, now - 100)
      .run()
    await env.DB
      .prepare('INSERT INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, \'owner\', ?, ?)')
      .bind('sweep-membership-other', 'sweep-ws-other', sharedOwner, now - 100, now - 100)
      .run()

    const result = await runManagedClaimSweep(env)
    expect(result.purged).toBeGreaterThanOrEqual(1)
    expect(await rowExists('SELECT id FROM workspaces WHERE id = ?', doomed.workspaceId)).toBe(false)
    expect(await rowExists('SELECT id FROM workspaces WHERE id = ?', 'sweep-ws-other')).toBe(true)
    expect(await rowExists('SELECT id FROM user WHERE id = ?', sharedOwner)).toBe(true)
  })

  it('keeps a claimed blog past day 30 and a blog still inside the window', async () => {
    const claimed = await seedManagedSite({ suffix: 'pclaim', revokedDaysAgo: 40, polarStatus: 'active' })
    const insideWindow = await seedManagedSite({ suffix: 'p29', revokedDaysAgo: MANAGED_CLAIM_WINDOW.windowSeconds / DAY - 1 })

    const result = await runManagedClaimSweep(env)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', claimed.siteId)).toBe(true)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', insideWindow.siteId)).toBe(true)
    expect(result.purged).toBe(0)
  })

  it('keeps a blog whose plan resumed (revoked_at cleared)', async () => {
    const resumed = await seedManagedSite({ suffix: 'presume', revokedDaysAgo: 31 })
    await env.DB
      .prepare(
        `UPDATE autoseopilot_managed_sites
         SET entitlement_status = 'active', revoked_at = NULL, updated_at = ?
         WHERE external_workspace_id = ?`,
      )
      .bind(Math.floor(Date.now() / 1000), resumed.externalWorkspaceId)
      .run()

    await runManagedClaimSweep(env)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', resumed.siteId)).toBe(true)
    expect(await rowExists('SELECT id FROM autoseopilot_managed_sites WHERE external_workspace_id = ?', resumed.externalWorkspaceId)).toBe(true)
  })
})
