/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { createDataAccess, type ManagedClaimSweepCandidate } from '@vc/db'
import { createCheckoutSessionForApp, handlePolarWebhook } from '@/server/billing'
import type { AppUserContext } from '@/server/onboarding'
import { runManagedClaimSweep } from './managed-claim-sweep'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

// The Cloudflare hostname lives outside D1, so the purge's hostname deletion
// is observed through this seam instead of a real Cloudflare account.
const deletedHostnames = vi.hoisted(() => [] as string[])
vi.mock('@/server/custom-hostnames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/custom-hostnames')>()
  return {
    ...actual,
    deleteCustomHostname: async (id: string) => {
      deletedHostnames.push(id)
    },
  }
})

const DAY = 24 * 60 * 60
const data = createDataAccess(env.DB)
const now = () => Math.floor(Date.now() / 1000)

const webhookSecret = 'managed-claim-purge-intent-webhook-secret'
const mutableEnv = env as unknown as Record<string, unknown>
const savedEnv = { SELF_HOSTED: mutableEnv.SELF_HOSTED, POLAR_WEBHOOK_SECRET: mutableEnv.POLAR_WEBHOOK_SECRET }

interface SeededBlog {
  externalWorkspaceId: string
  workspaceId: string
  siteId: string
  ownerUserId: string
  bindingId: string
  credentialId: string
  hostnameId: string
}

async function seedRevokedBlog(suffix: string, revokedDaysAgo: number): Promise<SeededBlog> {
  const timestamp = now() - 10_000
  const externalWorkspaceId = `external-intent-${suffix}`
  const bindingId = `intent-binding-${suffix}`
  const credentialId = `intent-credential-${suffix}`
  const result = await data.managedSites.firstProvision({
    timestamp,
    owner: {
      id: `intent-owner-${suffix}`,
      name: `Intent Owner ${suffix}`,
      email: `intent-${suffix}@example.test`,
    },
    workspace: { id: `intent-ws-${suffix}`, name: `Intent ${suffix}`, slug: `intent-${suffix}` },
    membership: { id: `intent-membership-${suffix}` },
    site: {
      id: `intent-site-${suffix}`,
      name: `Intent Site ${suffix}`,
      slug: `intent-site-${suffix}`,
      description: null,
    },
    defaultDomain: { id: `intent-domain-${suffix}`, hostname: `intent-${suffix}.example.test` },
    apiKey: {
      id: `intent-key-${suffix}`,
      name: 'AutoSEOPilot',
      tokenPrefix: `vc_test_intent_${suffix}`,
      tokenHash: `hash-intent-${suffix}`,
      scopesJson: '[]',
      actorName: 'AutoSEOPilot',
    },
    binding: {
      id: bindingId,
      externalWorkspaceId,
      credentialId,
      credentialGeneration: 1,
      entitlementStatus: 'active',
      entitlementExpiresAt: null,
      lifecycleRevision: 1,
    },
  })
  const hostnameId = `cf-hostname-${suffix}`
  await env.DB.prepare('UPDATE domains SET cloudflare_custom_hostname_id = ? WHERE site_id = ?')
    .bind(hostnameId, result.siteId)
    .run()
  await env.DB.prepare(
    `UPDATE autoseopilot_managed_sites
     SET entitlement_status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE site_id = ?`,
  )
    .bind(now() - revokedDaysAgo * DAY, now(), result.siteId)
    .run()
  return {
    externalWorkspaceId,
    workspaceId: result.workspaceId,
    siteId: result.siteId,
    ownerUserId: result.ownerUserId,
    bindingId,
    credentialId,
    hostnameId,
  }
}

async function seedMedia(siteId: string): Promise<void> {
  await env.ASSETS_BUCKET.put(`${siteId}/media-1.png`, new Uint8Array([1, 2, 3]))
  await env.ASSETS_BUCKET.put(`og/${siteId}/card.png`, new Uint8Array([4, 5, 6]))
}

/** The claim: VibeCMS Cloud on the managed workspace. */
async function claimWorkspace(workspaceId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?, ?)`,
  )
    .bind(`intent-billing-${workspaceId}`, workspaceId, now() + 30 * DAY, now(), now())
    .run()
}

async function rowExists(sql: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare(sql).bind(id).first()
  return row !== null
}

async function candidateFor(siteId: string): Promise<ManagedClaimSweepCandidate> {
  const page = await data.managedSites.listClaimSweepCandidates({ now: now() })
  const candidate = page.candidates.find((entry) => entry.siteId === siteId)
  if (!candidate) throw new Error(`no sweep candidate for ${siteId}`)
  return candidate
}

async function acquireIntent(blog: SeededBlog, candidate?: ManagedClaimSweepCandidate) {
  const selected = candidate ?? (await candidateFor(blog.siteId))
  return data.managedSites.acquirePurgeIntent({
    externalWorkspaceId: blog.externalWorkspaceId,
    workspaceId: blog.workspaceId,
    siteId: blog.siteId,
    ownerUserId: blog.ownerUserId,
    bindingId: selected.id,
    lifecycleRevision: selected.lifecycleRevision,
    revokedAt: selected.revokedAt,
    r2Prefixes: [`${blog.siteId}/`, `og/${blog.siteId}/`],
    now: now(),
  })
}

function ownerApp(workspaceId: string): AppUserContext {
  return {
    workspaceId,
    siteId: `site_${workspaceId}`,
    user: {
      id: 'user_intent_claim',
      email: 'intent-claim@example.test',
      name: 'Intent Claim Tester',
    },
    actor: {
      type: 'human',
      id: 'user_intent_claim',
      name: 'Intent Claim Tester',
      role: 'owner',
    },
  }
}

/** The Polar subscription payload the webhook contract expects. */
function subscriptionPayload(workspaceId: string) {
  const createdAt = '2026-10-01T00:00:00.000Z'
  const periodEnd = '2026-11-01T00:00:00.000Z'
  return {
    id: `sub_${workspaceId}`,
    created_at: createdAt,
    modified_at: createdAt,
    amount: 1500,
    currency: 'usd',
    recurring_interval: 'month',
    recurring_interval_count: 1,
    status: 'active',
    current_period_start: createdAt,
    current_period_end: periodEnd,
    trial_start: null,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: createdAt,
    ends_at: null,
    ended_at: null,
    customer_id: `cust_${workspaceId}`,
    product_id: 'prod_monthly',
    discount_id: null,
    checkout_id: null,
    customer_cancellation_reason: null,
    customer_cancellation_comment: null,
    metadata: { workspaceId },
    customer: {
      id: `cust_${workspaceId}`,
      created_at: createdAt,
      modified_at: null,
      metadata: { workspaceId },
      external_id: workspaceId,
      email: 'billing@example.test',
      email_verified: true,
      type: 'individual',
      name: 'Billing Tester',
      billing_address: null,
      tax_id: null,
      organization_id: 'org_test',
      deleted_at: null,
      avatar_url: 'https://example.test/avatar.png',
    },
    product: {
      id: 'prod_monthly',
      created_at: createdAt,
      modified_at: null,
      trial_interval: null,
      trial_interval_count: null,
      name: 'VibeCMS Monthly',
      description: null,
      visibility: 'public',
      recurring_interval: 'month',
      recurring_interval_count: 1,
      is_recurring: true,
      is_archived: false,
      organization_id: 'org_test',
      metadata: {},
      prices: [],
      benefits: [],
      medias: [],
      attached_custom_fields: [],
    },
    discount: null,
    prices: [],
    meters: [],
    pending_update: null,
  }
}

async function signedWebhook(eventId: string, workspaceId: string) {
  const payload = JSON.stringify({
    type: 'subscription.active',
    timestamp: '2026-10-15T12:00:00.000Z',
    data: subscriptionPayload(workspaceId),
  })
  const deliveryTimestamp = String(now())
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${eventId}.${deliveryTimestamp}.${payload}`),
  )
  return new Request('https://app.example.test/api/webhooks/polar', {
    method: 'POST',
    body: payload,
    headers: {
      'webhook-id': eventId,
      'webhook-timestamp': deliveryTimestamp,
      'webhook-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
    },
  })
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

beforeEach(async () => {
  deletedHostnames.length = 0
  mutableEnv.SELF_HOSTED = 'false'
  mutableEnv.POLAR_WEBHOOK_SECRET = webhookSecret
  // The sweep works on every managed binding in the database, so each test
  // starts with none of its own.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM autoseopilot_purge_intents'),
    env.DB.prepare('DELETE FROM autoseopilot_claim_checkouts'),
    env.DB.prepare('DELETE FROM autoseopilot_purge_conflicts'),
    env.DB.prepare('DELETE FROM autoseopilot_managed_sites'),
  ])
})

describe('claim window — the purge intent', () => {
  it('keeps a claimed blog, its hostname and its media', async () => {
    const blog = await seedRevokedBlog('claimed', 31)
    await seedMedia(blog.siteId)
    await claimWorkspace(blog.workspaceId)

    const result = await runManagedClaimSweep(env)

    expect(result.purged).toBe(0)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
    expect(deletedHostnames).not.toContain(blog.hostnameId)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).not.toBeNull()
    expect(await env.ASSETS_BUCKET.get(`og/${blog.siteId}/card.png`)).not.toBeNull()
  })

  it('keeps the blog when the claim lands between the sweep selection and the purge decision', async () => {
    const blog = await seedRevokedBlog('race', 31)
    await seedMedia(blog.siteId)
    // The sweep selection sees the blog as purgeable...
    const candidate = await candidateFor(blog.siteId)
    // ...and the claim lands right there.
    await claimWorkspace(blog.workspaceId)

    // The purge decision sees the claim: no intent, so nothing is deleted.
    expect(await acquireIntent(blog, candidate)).toBeNull()
    await runManagedClaimSweep(env)

    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
    expect(deletedHostnames).not.toContain(blog.hostnameId)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).not.toBeNull()
    expect(await env.ASSETS_BUCKET.get(`og/${blog.siteId}/card.png`)).not.toBeNull()
  })

  it('refuses the claim and the plan resumption while the purge is in flight', async () => {
    const blog = await seedRevokedBlog('inflight', 31)
    await seedMedia(blog.siteId)
    expect(await acquireIntent(blog)).not.toBeNull()

    // The checkout must not take the customer's money for a doomed blog.
    const createCheckout = vi.fn()
    const checkout = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })
    expect(checkout).toEqual({ kind: 'error', code: 'purge_in_progress' })
    expect(createCheckout).not.toHaveBeenCalled()

    // An in-flight webhook must not resurrect the blog either. The customer
    // may have paid for the claim, so the event is recorded for a refund
    // instead of being dropped, and the workspace stays unpaid.
    const response = await handlePolarWebhook(await signedWebhook('evt-intent', blog.workspaceId))
    expect(response.status).toBe(200)
    const billing = await env.DB.prepare('SELECT status FROM billing_customers WHERE workspace_id = ?')
      .bind(blog.workspaceId)
      .first<{ status: string }>()
    expect(billing?.status).not.toBe('active')
    const conflicts = await data.managedSites.listPurgeConflicts(blog.workspaceId)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].polarSubscriptionId).toBe(`sub_${blog.workspaceId}`)

    // The plan resumption is refused, and the refusal stays retryable.
    await expect(
      data.managedSites.rotateOrReactivate({
        externalWorkspaceId: blog.externalWorkspaceId,
        credentialId: blog.credentialId,
        currentGeneration: 1,
        newGeneration: 2,
        expectedLifecycleRevision: 1,
        newApiKey: {
          id: `intent-key-2-inflight`,
          name: 'AutoSEOPilot',
          tokenPrefix: 'vc_test_intent_rotated',
          tokenHash: 'hash-intent-rotated',
          scopesJson: '[]',
          actorName: 'AutoSEOPilot',
        },
        entitlementExpiresAt: null,
        timestamp: now(),
      }),
    ).rejects.toThrow('managed_purge_in_progress')
  })

  it('resumes a purge that died after taking the intent', async () => {
    const blog = await seedRevokedBlog('resume', 31)
    await seedMedia(blog.siteId)
    const intent = await acquireIntent(blog)
    expect(intent).not.toBeNull()

    // The run died here: the intent is there, nothing was deleted yet.
    expect(deletedHostnames).not.toContain(blog.hostnameId)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).not.toBeNull()
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)

    // The next run resumes the same operation.
    const result = await runManagedClaimSweep(env)

    expect(result.purged).toBe(1)
    expect(deletedHostnames).toContain(blog.hostnameId)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).toBeNull()
    expect(await env.ASSETS_BUCKET.get(`og/${blog.siteId}/card.png`)).toBeNull()
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)
    // The intent stays as the trace of the deleted blog: a paid webhook that
    // arrives late must be recognised, not turned into a paid workspace.
    const finished = await env.DB.prepare('SELECT completed_at FROM autoseopilot_purge_intents WHERE site_id = ?')
      .bind(blog.siteId)
      .first<{ completed_at: number | null }>()
    expect(finished?.completed_at).toBeTypeOf('number')
  })

  it('finishes the cleanup of a purge that died after the rows were deleted', async () => {
    const blog = await seedRevokedBlog('halfgone', 31)
    await seedMedia(blog.siteId)
    const intent = await acquireIntent(blog)
    expect(intent).not.toBeNull()

    // The rows go, the intent stays: the run died right here.
    const purged = await data.managedSites.purgeRevokedManagedSite({
      externalWorkspaceId: blog.externalWorkspaceId,
      workspaceId: blog.workspaceId,
      siteId: blog.siteId,
      ownerUserId: blog.ownerUserId,
      intentId: intent!.id,
      now: now(),
    })
    expect(purged).toBe(true)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)
    expect(await rowExists('SELECT id FROM autoseopilot_purge_intents WHERE site_id = ?', blog.siteId)).toBe(true)

    // The next run finishes the same cleanup from the saved intent.
    await runManagedClaimSweep(env)

    expect(deletedHostnames).toContain(blog.hostnameId)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).toBeNull()
    expect(await env.ASSETS_BUCKET.get(`og/${blog.siteId}/card.png`)).toBeNull()
    const finished = await env.DB.prepare('SELECT completed_at FROM autoseopilot_purge_intents WHERE site_id = ?')
      .bind(blog.siteId)
      .first<{ completed_at: number | null }>()
    expect(finished?.completed_at).toBeTypeOf('number')
  })

  it('never deletes a lifecycle whose own revoke is younger than the window', async () => {
    const blog = await seedRevokedBlog('relifecycle', 31)
    const candidate = await candidateFor(blog.siteId)

    // The plan resumes and the sponsorship is revoked again: a new lifecycle.
    const revokedAgain = now() - DAY
    await env.DB.prepare(
      `UPDATE autoseopilot_managed_sites
       SET revoked_at = ?, lifecycle_revision = lifecycle_revision + 1, updated_at = ?
       WHERE site_id = ?`,
    )
      .bind(revokedAgain, now(), blog.siteId)
      .run()

    // The stale candidate must not delete the new lifecycle...
    expect(await acquireIntent(blog, candidate)).toBeNull()
    // ...and the new lifecycle is not past its own deadline either.
    expect(
      await acquireIntent(blog, {
        ...candidate,
        revokedAt: revokedAgain,
        lifecycleRevision: candidate.lifecycleRevision + 1,
      }),
    ).toBeNull()

    await runManagedClaimSweep(env)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
  })

  it('defers the purge while a claim checkout is still open', async () => {
    const blog = await seedRevokedBlog('checkout', 31)
    await seedMedia(blog.siteId)
    await data.managedSites.recordClaimCheckoutAttempt(blog.workspaceId, now(), now() + 3600)

    const deferred = await runManagedClaimSweep(env)
    expect(deferred.purged).toBe(0)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)

    // The checkout expired without a claim, but the attempt still guards the
    // purge: Polar's checkout expiry and a late webhook can land anywhere in
    // the guard window.
    await data.managedSites.recordClaimCheckoutAttempt(blog.workspaceId, now() - 7200, now() - 3600)
    const stillDeferred = await runManagedClaimSweep(env)
    expect(stillDeferred.purged).toBe(0)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
  })

  it('defers the purge for 48 hours after a claim checkout was opened', async () => {
    const blog = await seedRevokedBlog('guard', 31)
    await seedMedia(blog.siteId)
    // A checkout that was opened 30 hours ago and has been resolved since:
    // the money can still arrive at Polar, so the blog must not go.
    await data.managedSites.recordClaimCheckoutAttempt(blog.workspaceId, now() - 30 * 3600, now() - 29 * 3600)
    await data.managedSites.resolveClaimCheckoutAttempt(blog.workspaceId, now() - 29 * 3600)

    const deferred = await runManagedClaimSweep(env)
    expect(deferred.purged).toBe(0)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)

    // 72 hours after the checkout was opened, the guard window is over and
    // the purge goes through.
    await env.DB.prepare(
      'UPDATE autoseopilot_claim_checkouts SET created_at = ?, guard_until = ? WHERE workspace_id = ?',
    )
      .bind(now() - 72 * 3600, now() - 24 * 3600, blog.workspaceId)
      .run()
    const purges = await runManagedClaimSweep(env)
    expect(purges.purged).toBe(1)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)
  })

  it('records and alerts when a paid claim webhook arrives for a purged blog', async () => {
    const blog = await seedRevokedBlog('paidlate', 31)
    await seedMedia(blog.siteId)
    expect(await acquireIntent(blog)).not.toBeNull()

    // The purge runs: the blog is gone.
    const purged = await runManagedClaimSweep(env)
    expect(purged.purged).toBe(1)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)

    // The customer paid at Polar and the webhook arrives late. The webhook
    // is answered (so Polar stops retrying) and the payment is escalated.
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    }
    try {
      const response = await handlePolarWebhook(await signedWebhook('evt-late-paid', blog.workspaceId))
      expect(response.status).toBe(200)
    } finally {
      console.warn = warn
    }

    // The workspace did not quietly become a paid workspace with no blog.
    const billing = await env.DB.prepare('SELECT status FROM billing_customers WHERE workspace_id = ?')
      .bind(blog.workspaceId)
      .first<{ status: string }>()
    expect(billing?.status).not.toBe('active')

    // The payment is recorded with the Polar ids, so the founder can refund
    // it by hand.
    const conflicts = await data.managedSites.listPurgeConflicts(blog.workspaceId)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].siteId).toBe(blog.siteId)
    expect(conflicts[0].polarCustomerId).toBe(`cust_${blog.workspaceId}`)
    expect(conflicts[0].polarSubscriptionId).toBe(`sub_${blog.workspaceId}`)
    expect(conflicts[0].eventId).toBe('evt-late-paid')

    // The operator is told: this one needs a human.
    const alert = warnings.find((line) => line.includes('polar_webhook_purge_conflict'))
    expect(alert).toBeDefined()
    expect(alert).toContain(`sub_${blog.workspaceId}`)
  })
})
