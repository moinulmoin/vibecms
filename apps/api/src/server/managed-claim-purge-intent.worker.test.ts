/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { createDataAccess, type ManagedClaimSweepCandidate } from '@vc/db'
import { SUPPORT_EMAIL } from '@vc/config'
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
const savedEnv = {
  SELF_HOSTED: mutableEnv.SELF_HOSTED,
  POLAR_WEBHOOK_SECRET: mutableEnv.POLAR_WEBHOOK_SECRET,
  EMAIL: mutableEnv.EMAIL,
  APP_ENV: mutableEnv.APP_ENV,
  APP_URL: mutableEnv.APP_URL,
  POLAR_MONTHLY_PRODUCT_ID: mutableEnv.POLAR_MONTHLY_PRODUCT_ID,
  POLAR_LAUNCH_DISCOUNT_MONTHLY_ID: mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID,
}

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
  mutableEnv.EMAIL = undefined
  mutableEnv.APP_ENV = 'development'
  mutableEnv.APP_URL = 'https://app.example.test'
  mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
  mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = ''
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
    const sent: { to?: string; subject?: string; text?: string }[] = []
    mutableEnv.EMAIL = {
      send: async (message: { to: string; subject: string; text: string }) => {
        sent.push(message)
        return { messageId: 'm1' }
      },
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

    // And the support address hears about it, because a log line only
    // reaches someone who goes looking.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(SUPPORT_EMAIL)
    expect(sent[0]?.text).toContain(`sub_${blog.workspaceId}`)
    expect(sent[0]?.text).toContain(blog.siteId)
    expect(sent[0]?.text?.toLowerCase()).toContain('refund it by hand')
  })
})

describe('claim window — the claim', () => {
  it('sells VibeCMS Cloud to a revoked managed blog and guards the purge for 48 hours', async () => {
    const blog = await seedRevokedBlog('claim', 10)
    const createCheckout = vi.fn().mockResolvedValue({
      url: 'https://polar.example/claim',
      productId: 'prod_monthly',
      currency: 'usd',
      netAmount: 1500,
    })

    const result = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })

    expect(result).toEqual({ kind: 'ok', url: 'https://polar.example/claim' })
    expect(createCheckout).toHaveBeenCalledTimes(1)
    // The attempt is recorded before the checkout is handed out, and it
    // guards the purge for 48 hours.
    const attempt = await env.DB.prepare(
      'SELECT created_at, guard_until FROM autoseopilot_claim_checkouts WHERE workspace_id = ?',
    )
      .bind(blog.workspaceId)
      .first<{ created_at: number; guard_until: number }>()
    expect(attempt).not.toBeNull()
    expect(attempt!.guard_until - attempt!.created_at).toBe(48 * 60 * 60)
  })

  it('completes the claim: the paid webhook makes the workspace paid and the purge impossible', async () => {
    const blog = await seedRevokedBlog('claimpaid', 10)
    await seedMedia(blog.siteId)

    // The customer buys VibeCMS Cloud.
    const checkout = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout: vi.fn().mockResolvedValue({
        url: 'https://polar.example/claim',
        productId: 'prod_monthly',
        currency: 'usd',
        netAmount: 1500,
      }),
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })
    expect(checkout).toEqual({ kind: 'ok', url: 'https://polar.example/claim' })

    // Polar says the customer paid.
    const response = await handlePolarWebhook(await signedWebhook('evt-claim', blog.workspaceId))
    expect(response.status).toBe(200)

    // The workspace is the owner's paid VibeCMS workspace.
    const billing = await env.DB.prepare('SELECT status FROM billing_customers WHERE workspace_id = ?')
      .bind(blog.workspaceId)
      .first<{ status: string }>()
    expect(billing?.status).toBe('active')

    // The purge is impossible: the sweep leaves the blog, its media and its
    // hostname alone.
    const sweep = await runManagedClaimSweep(env)
    expect(sweep.purged).toBe(0)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).not.toBeNull()
    expect(deletedHostnames).not.toContain(blog.hostnameId)
  })

  it('refuses the writes that would compete with a running purge', async () => {
    const blog = await seedRevokedBlog('compete', 31)
    expect(await acquireIntent(blog)).not.toBeNull()

    // The claim checkout: the attempt write carries the exclusion itself.
    const createCheckout = vi.fn()
    const checkout = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })
    expect(checkout).toEqual({ kind: 'error', code: 'purge_in_progress' })
    expect(createCheckout).not.toHaveBeenCalled()

    // The plan resumption: the rotation batch carries the exclusion, so
    // nothing is written.
    await expect(
      data.managedSites.rotateOrReactivate({
        externalWorkspaceId: blog.externalWorkspaceId,
        credentialId: blog.credentialId,
        currentGeneration: 1,
        newGeneration: 2,
        expectedLifecycleRevision: 1,
        newApiKey: {
          id: 'intent-key-2-compete',
          name: 'AutoSEOPilot',
          tokenPrefix: 'vc_test_intent_compete',
          tokenHash: 'hash-intent-compete',
          scopesJson: '[]',
          actorName: 'AutoSEOPilot',
        },
        entitlementExpiresAt: null,
        timestamp: now(),
      }),
    ).rejects.toThrow('managed_purge_in_progress')
    const binding = await env.DB.prepare(
      'SELECT credential_generation FROM autoseopilot_managed_sites WHERE site_id = ?',
    )
      .bind(blog.siteId)
      .first<{ credential_generation: number }>()
    expect(binding?.credential_generation).toBe(1)

    // The re-provision: the provision batch carries the exclusion, so no row
    // is created.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM autoseopilot_managed_sites WHERE site_id = ?').bind(blog.siteId),
      env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(blog.siteId),
      env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(blog.workspaceId),
    ])
    await expect(
      data.managedSites.firstProvision({
        timestamp: now(),
        owner: {
          id: 'intent-owner-compete',
          name: 'Intent Owner compete',
          email: 'intent-compete@example.test',
        },
        workspace: { id: 'intent-ws-compete', name: 'Intent compete', slug: 'intent-compete' },
        membership: { id: 'intent-membership-compete' },
        site: {
          id: 'intent-site-compete',
          name: 'Intent Site compete',
          slug: 'intent-site-compete',
          description: null,
        },
        defaultDomain: { id: 'intent-domain-compete', hostname: 'intent-compete.example.test' },
        apiKey: {
          id: 'intent-key-compete',
          name: 'AutoSEOPilot',
          tokenPrefix: 'vc_test_intent_compete',
          tokenHash: 'hash-intent-compete',
          scopesJson: '[]',
          actorName: 'AutoSEOPilot',
        },
        binding: {
          id: 'intent-binding-compete',
          externalWorkspaceId: 'external-intent-compete',
          credentialId: 'intent-credential-compete',
          credentialGeneration: 1,
          entitlementStatus: 'active',
          entitlementExpiresAt: null,
          lifecycleRevision: 1,
        },
      }),
    ).rejects.toThrow('managed_purge_in_progress')
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', 'intent-site-compete')).toBe(false)
    expect(await rowExists('SELECT id FROM workspaces WHERE id = ?', 'intent-ws-compete')).toBe(false)
    expect(await rowExists('SELECT id FROM api_keys WHERE id = ?', 'intent-key-compete')).toBe(false)
  })

  it('never hands back the finished intent of a deleted blog', async () => {
    const blog = await seedRevokedBlog('reprovision', 31)
    expect(await acquireIntent(blog)).not.toBeNull()

    // The purge runs: the blog is gone, the intent stays as its trace.
    const purged = await runManagedClaimSweep(env)
    expect(purged.purged).toBe(1)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)

    // The blog comes back with the same derived ids.
    await data.managedSites.firstProvision({
      timestamp: now(),
      owner: {
        id: 'intent-owner-reprovision',
        name: 'Intent Owner reprovision',
        email: 'intent-reprovision@example.test',
      },
      workspace: { id: 'intent-ws-reprovision', name: 'Intent reprovision', slug: 'intent-reprovision' },
      membership: { id: 'intent-membership-reprovision' },
      site: {
        id: 'intent-site-reprovision',
        name: 'Intent Site reprovision',
        slug: 'intent-site-reprovision',
        description: null,
      },
      defaultDomain: {
        id: 'intent-domain-reprovision',
        hostname: 'intent-reprovision.example.test',
      },
      apiKey: {
        id: 'intent-key-reprovision-2',
        name: 'AutoSEOPilot',
        tokenPrefix: 'vc_test_intent_reprovision',
        tokenHash: 'hash-intent-reprovision',
        scopesJson: '[]',
        actorName: 'AutoSEOPilot',
      },
      binding: {
        id: 'intent-binding-reprovision',
        externalWorkspaceId: 'external-intent-reprovision',
        credentialId: 'intent-credential-reprovision',
        credentialGeneration: 1,
        entitlementStatus: 'active',
        entitlementExpiresAt: null,
        lifecycleRevision: 1,
      },
    })
    await env.DB.prepare(
      `UPDATE autoseopilot_managed_sites
       SET entitlement_status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE site_id = ?`,
    )
      .bind(now() - 31 * DAY, now(), blog.siteId)
      .run()
    await seedMedia(blog.siteId)

    // A claim checkout is in flight, so the purge may not start.
    await data.managedSites.recordClaimCheckoutAttempt(blog.workspaceId, now(), now() + 3600)
    const candidate = await candidateFor(blog.siteId)
    expect(await acquireIntent(blog, candidate)).toBeNull()

    // The sweep must not delete the media of the blog that came back.
    const sweep = await runManagedClaimSweep(env)
    expect(sweep.purged).toBe(0)
    expect(await env.ASSETS_BUCKET.get(`${blog.siteId}/media-1.png`)).not.toBeNull()
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(true)
  })

  it('only visits the blogs that have something due', async () => {
    // A blog that was reminded on every slot and is not due for the purge
    // yet must not take a slot: a later blog has to be reached.
    const reminded = await seedRevokedBlog('reminded', 10)
    await env.DB.prepare(
      `UPDATE autoseopilot_managed_sites
       SET claim_day7_sent_at = ?, claim_day14_sent_at = ?, claim_day21_sent_at = ?,
           claim_day28_sent_at = ?, updated_at = ?
       WHERE site_id = ?`,
    )
      .bind(now(), now(), now(), now(), now(), reminded.siteId)
      .run()
    // A blog whose day-14 reminder is due.
    const due = await seedRevokedBlog('due', 15)

    const page = await data.managedSites.listClaimSweepCandidates({ now: now() })
    const siteIds = page.candidates.map((candidate) => candidate.siteId)
    expect(siteIds).toContain(due.siteId)
    expect(siteIds).not.toContain(reminded.siteId)
  })

  it('lets an owner who cancelled the claim subscribe again', async () => {
    const blog = await seedRevokedBlog('resubscribe', 10)
    // The owner claimed the blog: the workspace is a paid VibeCMS workspace.
    await claimWorkspace(blog.workspaceId)
    // Then the subscription ended.
    await env.DB.prepare('UPDATE billing_customers SET status = ? WHERE workspace_id = ?')
      .bind('canceled', blog.workspaceId)
      .run()

    const createCheckout = vi.fn().mockResolvedValue({
      url: 'https://polar.example/resubscribe',
      productId: 'prod_monthly',
      currency: 'usd',
      netAmount: 1500,
    })
    const result = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })

    expect(result).toEqual({ kind: 'ok', url: 'https://polar.example/resubscribe' })
    expect(createCheckout).toHaveBeenCalledTimes(1)
  })

  it('refuses the claim checkout after the blog was purged', async () => {
    const blog = await seedRevokedBlog('purgedclaim', 31)
    expect(await acquireIntent(blog)).not.toBeNull()
    const purged = await runManagedClaimSweep(env)
    expect(purged.purged).toBe(1)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blog.siteId)).toBe(false)

    // The blog is gone: Polar must not be asked to sell it.
    const createCheckout = vi.fn()
    const result = await createCheckoutSessionForApp(ownerApp(blog.workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts: vi.fn().mockResolvedValue([]),
    })
    expect(result).toEqual({ kind: 'error', code: 'purge_in_progress' })
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('rotates the blogs it cannot delete, so a later blog still gets its reminder', async () => {
    // Two blogs past the deadline whose purge is blocked by a claim checkout.
    const blockedA = await seedRevokedBlog('blockeda', 31)
    const blockedB = await seedRevokedBlog('blockedb', 32)
    for (const blog of [blockedA, blockedB]) {
      await data.managedSites.recordClaimCheckoutAttempt(blog.workspaceId, now(), now() + 3600)
    }
    // A blog whose day-7 reminder is due.
    const later = await seedRevokedBlog('later', 8)

    // Each run may act on one blog. The two blocked ones are older, so
    // without a rotation they would take every slot for ever.
    await runManagedClaimSweep(env, { maxCandidates: 1 })

    // The blog the sweep could not delete rotated to the back: the attempt
    // is recorded, so the next run starts with a blog it can act on.
    const attempt = await env.DB.prepare(
      'SELECT last_sweep_attempt_at FROM autoseopilot_managed_sites WHERE site_id = ?',
    )
      .bind(blockedB.siteId)
      .first<{ last_sweep_attempt_at: number | null }>()
    expect(attempt?.last_sweep_attempt_at).not.toBeNull()
    const next = await data.managedSites.listClaimSweepCandidates({ now: now(), limit: 1 })
    expect(next.candidates[0]?.siteId).toBe(blockedA.siteId)

    await runManagedClaimSweep(env, { maxCandidates: 1 })
    await runManagedClaimSweep(env, { maxCandidates: 1 })

    // The later blog's reminder went out, even though two older blogs were
    // in front of it.
    const reminded = await env.DB.prepare(
      'SELECT claim_day7_sent_at FROM autoseopilot_managed_sites WHERE site_id = ?',
    )
      .bind(later.siteId)
      .first<{ claim_day7_sent_at: number | null }>()
    expect(reminded?.claim_day7_sent_at).not.toBeNull()
    // The blocked blogs are still there, waiting for their turn.
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blockedA.siteId)).toBe(true)
    expect(await rowExists('SELECT id FROM sites WHERE id = ?', blockedB.siteId)).toBe(true)
  })

  it('keeps the refund notice owed until the mail is accepted', async () => {
    const blog = await seedRevokedBlog('notice', 31)
    expect(await acquireIntent(blog)).not.toBeNull()
    const purged = await runManagedClaimSweep(env)
    expect(purged.purged).toBe(1)

    // The mail cannot be delivered: the notice stays owed.
    mutableEnv.APP_ENV = 'production'
    mutableEnv.EMAIL = {
      send: async () => {
        throw new Error('mailbox unavailable')
      },
    }
    const response = await handlePolarWebhook(await signedWebhook('evt-notice', blog.workspaceId))
    expect(response.status).toBe(200)
    const conflicts = await data.managedSites.listPurgeConflicts(blog.workspaceId)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].notifiedAt).toBeNull()

    // The next sweep sends it again, and only then is it marked as sent.
    const sent: unknown[] = []
    mutableEnv.EMAIL = {
      send: async (message: unknown) => {
        sent.push(message)
        return { messageId: 'm1' }
      },
    }
    const sweep = await runManagedClaimSweep(env)
    expect(sweep.refundNotices).toBe(1)
    expect(sent).toHaveLength(1)
    const after = await data.managedSites.listPurgeConflicts(blog.workspaceId)
    expect(after[0].notifiedAt).toBeTypeOf('number')
  })
})
