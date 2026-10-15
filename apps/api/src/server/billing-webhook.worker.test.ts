/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { PAST_DUE_GRACE_DAYS } from '@vc/config'
import { createDataAccess } from '@vc/db'
import { ensureBillingRow, getBilling, handlePolarWebhook } from '@/server/billing'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'

const secret = 'polar-local-webhook-regression-secret'
const createdAt = '2026-10-01T00:00:00.000Z'
const periodEnd = '2026-11-01T00:00:00.000Z'
const DAY_MS = 86_400_000
const graceDeadline = (pastDueSince: string) => Date.parse(pastDueSince) + PAST_DUE_GRACE_DAYS * DAY_MS
const mutableEnv = env as unknown as Record<string, unknown>
const saved = { SELF_HOSTED: mutableEnv.SELF_HOSTED, POLAR_WEBHOOK_SECRET: mutableEnv.POLAR_WEBHOOK_SECRET }

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})
beforeEach(() => {
  mutableEnv.SELF_HOSTED = 'false'
  mutableEnv.POLAR_WEBHOOK_SECRET = secret
})
afterEach(() => {
  mutableEnv.SELF_HOSTED = saved.SELF_HOSTED
  mutableEnv.POLAR_WEBHOOK_SECRET = saved.POLAR_WEBHOOK_SECRET
  vi.restoreAllMocks()
})

async function seedWorkspace(id: string) {
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind(id, id, id).run()
}

function subscription(workspaceId: string, status: string, modifiedAt: string | null, cancelAtPeriodEnd = false) {
  return {
    id: `sub_${workspaceId}`, created_at: createdAt, modified_at: modifiedAt,
    amount: 1500, currency: 'usd', recurring_interval: 'month', recurring_interval_count: 1,
    status, current_period_start: createdAt, current_period_end: periodEnd,
    trial_start: null, trial_end: null, cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: cancelAtPeriodEnd || status === 'canceled' ? modifiedAt : null,
    started_at: createdAt, ends_at: cancelAtPeriodEnd ? periodEnd : null,
    ended_at: status === 'canceled' ? modifiedAt : null,
    customer_id: `cust_${workspaceId}`, product_id: 'prod_monthly', discount_id: null, checkout_id: null,
    customer_cancellation_reason: null, customer_cancellation_comment: null, metadata: { workspaceId },
    customer: {
      id: `cust_${workspaceId}`, created_at: createdAt, modified_at: null, metadata: { workspaceId },
      external_id: workspaceId, email: 'billing@example.test', email_verified: true, type: 'individual',
      name: 'Billing Tester', billing_address: null, tax_id: null, organization_id: 'org_test',
      deleted_at: null, avatar_url: 'https://example.test/avatar.png',
    },
    product: {
      id: 'prod_monthly', created_at: createdAt, modified_at: null, trial_interval: null, trial_interval_count: null,
      name: 'VibeCMS Monthly', description: null, visibility: 'public', recurring_interval: 'month',
      recurring_interval_count: 1, is_recurring: true, is_archived: false, organization_id: 'org_test',
      metadata: {}, prices: [], benefits: [], medias: [], attached_custom_fields: [],
    },
    discount: null, prices: [], meters: [], pending_update: null,
  }
}

function checkout(workspaceId: string, modifiedAt: string, subscriptionId = `sub_${workspaceId}`) {
  return {
    id: `checkout_${workspaceId}`, created_at: createdAt, modified_at: modifiedAt,
    payment_processor: 'stripe', status: 'succeeded', client_secret: 'local-test-client-secret',
    url: 'https://polar.example.test/checkout', expires_at: periodEnd,
    success_url: 'https://app.example.test/dashboard', return_url: 'https://app.example.test/dashboard/billing',
    embed_origin: null, amount: 1500, discount_amount: 0, net_amount: 1500, tax_amount: 0,
    tax_behavior: 'exclusive', total_amount: 1500, currency: 'usd', allow_trial: false,
    active_trial_interval: null, active_trial_interval_count: null, trial_end: null,
    organization_id: 'org_test', product_id: 'prod_monthly', product_price_id: null, discount_id: null,
    allow_discount_codes: false, require_billing_address: false, is_discount_applicable: true,
    is_free_product_price: false, is_payment_required: true, is_payment_setup_required: false,
    is_payment_form_required: true, customer_id: `cust_${workspaceId}`, is_business_customer: false,
    customer_name: 'Billing Tester', customer_email: 'billing@example.test', customer_ip_address: null,
    customer_billing_name: null, customer_billing_address: null, customer_tax_id: null,
    payment_processor_metadata: {},
    billing_address_fields: { country: 'required', state: 'optional', city: 'optional', postal_code: 'optional', line1: 'optional', line2: 'optional' },
    trial_interval: null, trial_interval_count: null, metadata: { workspaceId }, external_customer_id: workspaceId,
    products: [], product: null, product_price: null, prices: null, discount: null,
    subscription_id: subscriptionId, attached_custom_fields: null, customer_metadata: { workspaceId },
  }
}

// Standard Webhooks signs the exact JSON bytes and current delivery timestamp.
// Object modification/envelope timestamps deliberately differ from delivery time.
async function signedRequest(eventId: string, type: string, data: unknown, timestamp = '2026-10-15T12:00:00.000Z') {
  const payload = JSON.stringify({ type, timestamp, data })
  const deliveryTimestamp = String(Math.floor(Date.now() / 1000))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${eventId}.${deliveryTimestamp}.${payload}`))
  return new Request('https://app.example.test/api/webhooks/polar', {
    method: 'POST', body: payload,
    headers: {
      'webhook-id': eventId, 'webhook-timestamp': deliveryTimestamp,
      'webhook-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
    },
  })
}

async function deliver(eventId: string, type: string, data: unknown, timestamp?: string) {
  const response = await handlePolarWebhook(await signedRequest(eventId, type, data, timestamp))
  expect(response.status).toBe(200)
  return response.json()
}

async function record(workspaceId: string) {
  return createDataAccess(env.DB).billing.getBillingRecord(workspaceId)
}

async function entitlement(workspaceId: string) {
  return resolveEffectiveEntitlementForWorkspace(workspaceId, { selfHosted: false })
}

// Entitlement reads the clock via Date.now(); pin it so the 7-day past_due
// grace window is evaluated deterministically regardless of wall time.
async function entitledAt(workspaceId: string, iso: string) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(iso))
  try {
    return (await entitlement(workspaceId)).effective
  } finally {
    clock.mockRestore()
  }
}

// Whole billing row, column for column, so duplicates can be asserted as true no-ops.
async function rawRow(workspaceId: string) {
  return env.DB.prepare('SELECT * FROM billing_customers WHERE workspace_id = ?').bind(workspaceId).first()
}

// Post-0037 shape of a row written by the old handler: creation-time watermark
// scaled to milliseconds and copied into subscription_updated_at.
async function seedLegacyBilling(workspaceId: string, row: { status: string; pastDueSince: number | null; webhookEventId: string; watermark: number }) {
  await env.DB.prepare(
    `INSERT INTO billing_customers
       (id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end, cancel_at_period_end,
        past_due_since, webhook_event_id, webhook_updated_at, subscription_updated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, 1)`,
  ).bind(
    `billing_${workspaceId}`, workspaceId, `cust_${workspaceId}`, `sub_${workspaceId}`, row.status, Date.parse(periodEnd) / 1000,
    row.pastDueSince, row.webhookEventId, row.watermark, row.watermark,
  ).run()
}

// Legacy receipts predate apply_nonce and keep it NULL.
async function seedLegacyReceipt(workspaceId: string, eventId: string, eventType: string, appliedStatus: string, sourceTimestamp: number) {
  await env.DB.prepare(
    `INSERT INTO polar_webhook_receipts (event_id, workspace_id, event_type, source_timestamp, applied_status, created_at, apply_nonce)
     VALUES (?, ?, ?, ?, ?, 1, NULL)`,
  ).bind(eventId, workspaceId, eventType, sourceTimestamp, appliedStatus).run()
}

describe('handlePolarWebhook — signed SDK events with real D1', () => {
  it('applies a newer revocation and removes paid entitlement regardless of event ID order', async () => {
    const ws = 'ws-webhook-revoked'
    await seedWorkspace(ws)
    expect(await deliver('z-active', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect((await entitlement(ws)).effective).toBe(true)
    expect(await deliver('a-revoked', 'subscription.revoked', subscription(ws, 'canceled', '2026-10-15T11:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect(await getBilling(ws)).toMatchObject({ status: 'canceled' })
    expect((await entitlement(ws)).effective).toBe(false)
  })

  it('ignores a delayed older activation after revocation', async () => {
    const ws = 'ws-webhook-delayed'
    await seedWorkspace(ws)
    await deliver('a-canceled', 'subscription.revoked', subscription(ws, 'canceled', '2026-10-15T11:00:00.000Z'))
    expect(await deliver('z-delayed', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect((await record(ws))?.status).toBe('canceled')
    expect((await entitlement(ws)).effective).toBe(false)
  })

  it('keeps paid entitlement through the past-due grace, expires it after 7 days, and recovery clears the clock', async () => {
    const ws = 'ws-webhook-recovery'
    await seedWorkspace(ws)
    const failedAt = '2026-10-15T10:00:00.000Z'
    expect(await deliver('z-failed', 'subscription.past_due', subscription(ws, 'past_due', failedAt))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(failedAt) })
    expect(await entitledAt(ws, '2026-10-15T11:00:00.000Z')).toBe(true)
    expect(await entitledAt(ws, '2026-10-21T10:00:00.000Z')).toBe(true)
    expect(await entitledAt(ws, '2026-10-23T10:00:00.000Z')).toBe(false)
    expect(await deliver('a-recovered', 'subscription.active', subscription(ws, 'active', '2026-10-23T11:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({ status: 'active', pastDueSince: null })
    expect(await entitledAt(ws, '2026-10-23T12:00:00.000Z')).toBe(true)
  })

  it('preserves the original past-due start across repeated past_due events', async () => {
    const ws = 'ws-webhook-past-due-repeat'
    await seedWorkspace(ws)
    const firstFailure = '2026-10-15T10:00:00.000Z'
    await deliver('z-first-failure', 'subscription.past_due', subscription(ws, 'past_due', firstFailure))
    expect(await deliver('a-retry-failure', 'subscription.updated', subscription(ws, 'past_due', '2026-10-18T10:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: Date.parse(firstFailure),
      webhookUpdatedAt: Date.parse('2026-10-18T10:00:00.000Z'),
    })
    expect(await entitledAt(ws, '2026-10-21T10:00:00.000Z')).toBe(true)
    // Within 7 days of the retry but past 7 days of the first failure: expired.
    expect(await entitledAt(ws, '2026-10-23T10:00:00.000Z')).toBe(false)
  })

  it('starts a fresh grace clock on a new past_due transition after recovery', async () => {
    const ws = 'ws-webhook-past-due-again'
    await seedWorkspace(ws)
    await deliver('z-failure-one', 'subscription.past_due', subscription(ws, 'past_due', '2026-10-15T10:00:00.000Z'))
    await deliver('y-recovered', 'subscription.active', subscription(ws, 'active', '2026-10-16T10:00:00.000Z'))
    expect((await record(ws))?.pastDueSince).toBeNull()
    const secondFailure = '2026-10-20T10:00:00.000Z'
    expect(await deliver('a-failure-two', 'subscription.past_due', subscription(ws, 'past_due', secondFailure))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(secondFailure) })
    // Beyond 7 days of the first failure, inside 7 days of the second.
    expect(await entitledAt(ws, '2026-10-25T10:00:00.000Z')).toBe(true)
    expect(await entitledAt(ws, '2026-10-28T10:00:00.000Z')).toBe(false)
  })

  it('keeps the clock from the first applied past_due when the initial failure is delivered late (accepted limitation)', async () => {
    const ws = 'ws-webhook-past-due-out-of-order'
    await seedWorkspace(ws)
    const initialFailure = '2026-10-15T10:00:00.000Z'
    const retryFailure = '2026-10-18T10:00:00.000Z'
    expect(await deliver('a-retry-first', 'subscription.past_due', subscription(ws, 'past_due', retryFailure))).toEqual({ received: true, result: 'applied' })
    expect(await deliver('z-initial-late', 'subscription.past_due', subscription(ws, 'past_due', initialFailure))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: Date.parse(retryFailure),
      webhookUpdatedAt: Date.parse(retryFailure),
      subscriptionUpdatedAt: Date.parse(retryFailure),
      webhookEventId: 'a-retry-first',
    })
    const deadline = graceDeadline(retryFailure)
    expect(await getBilling(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(retryFailure), graceEndsAt: deadline })
    // Delayed delivery favours the customer: still paid past the Oct 22 deadline of the initial failure.
    expect(await entitledAt(ws, new Date(graceDeadline(initialFailure) + 60_000).toISOString())).toBe(true)
    expect(await entitledAt(ws, new Date(deadline + 60_000).toISOString())).toBe(false)
  })

  it('ignores late older failures and recoveries without recomputing the current clock', async () => {
    const ws = 'ws-webhook-episodes-out-of-order'
    await seedWorkspace(ws)
    const secondFailure = '2026-10-20T10:00:00.000Z'
    expect(await deliver('a-second-failure', 'subscription.past_due', subscription(ws, 'past_due', secondFailure))).toEqual({ received: true, result: 'applied' })
    expect(await deliver('b-first-failure-late', 'subscription.past_due', subscription(ws, 'past_due', '2026-10-15T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(secondFailure) })
    expect(await deliver('c-recovery-late', 'subscription.active', subscription(ws, 'active', '2026-10-16T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: Date.parse(secondFailure),
      webhookUpdatedAt: Date.parse(secondFailure),
    })
    const deadline = graceDeadline(secondFailure)
    expect((await getBilling(ws)).graceEndsAt).toBe(deadline)
    expect(await entitledAt(ws, '2026-10-25T10:00:00.000Z')).toBe(true)
    expect(await entitledAt(ws, new Date(deadline + 60_000).toISOString())).toBe(false)
  })

  it('neither clears past_due nor moves the clock for a late older active or failure', async () => {
    const ws = 'ws-webhook-late-active'
    await seedWorkspace(ws)
    const failure = '2026-10-18T10:00:00.000Z'
    await deliver('a-failure', 'subscription.past_due', subscription(ws, 'past_due', failure))
    expect(await deliver('b-older-active', 'subscription.active', subscription(ws, 'active', '2026-10-16T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(failure), webhookUpdatedAt: Date.parse(failure) })
    expect(await deliver('c-oldest-failure', 'subscription.past_due', subscription(ws, 'past_due', '2026-10-15T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(failure), webhookUpdatedAt: Date.parse(failure) })
    expect((await getBilling(ws)).graceEndsAt).toBe(graceDeadline(failure))
    expect(await entitledAt(ws, '2026-10-23T10:00:00.000Z')).toBe(true)
    expect(await entitledAt(ws, new Date(graceDeadline(failure) + 60_000).toISOString())).toBe(false)
  })

  it('ignores a late older checkout and failure without touching the current grace clock', async () => {
    const ws = 'ws-webhook-checkout-boundary'
    await seedWorkspace(ws)
    const secondFailure = '2026-10-20T10:00:00.000Z'
    await deliver('a-checkout-second-failure', 'subscription.past_due', subscription(ws, 'past_due', secondFailure))
    expect(await deliver('b-checkout-recovery-late', 'checkout.updated', checkout(ws, '2026-10-16T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await deliver('c-checkout-first-failure-late', 'subscription.past_due', subscription(ws, 'past_due', '2026-10-15T10:00:00.000Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: Date.parse(secondFailure),
      webhookUpdatedAt: Date.parse(secondFailure),
    })
    expect((await getBilling(ws)).graceEndsAt).toBe(graceDeadline(secondFailure))
  })

  it('rejects an equal-timestamp recovery as stale and preserves the grace clock', async () => {
    const ws = 'ws-webhook-equal-recovery'
    await seedWorkspace(ws)
    const failedAt = '2026-10-15T10:00:00.000Z'
    await deliver('a-equal-failure', 'subscription.past_due', subscription(ws, 'past_due', failedAt))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await deliver('z-equal-recovery', 'subscription.active', subscription(ws, 'active', failedAt))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: Date.parse(failedAt),
      webhookEventId: 'a-equal-failure',
      webhookUpdatedAt: Date.parse(failedAt),
    })
    expect((await getBilling(ws)).graceEndsAt).toBe(graceDeadline(failedAt))
    expect(await entitledAt(ws, '2026-10-16T10:00:00.000Z')).toBe(true)
    // A later retry continues the same episode instead of starting a fresh window.
    expect(await deliver('b-later-failure', 'subscription.updated', subscription(ws, 'past_due', '2026-10-17T10:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(failedAt) })
    expect(await entitledAt(ws, new Date(graceDeadline(failedAt) + 60_000).toISOString())).toBe(false)
  })

  it('never reapplies a pre-migration duplicate activation over a legacy creation-time watermark', async () => {
    const ws = 'ws-webhook-legacy-duplicate'
    await seedWorkspace(ws)
    const legacyKey = Date.parse(createdAt)
    await seedLegacyBilling(ws, { status: 'canceled', pastDueSince: null, webhookEventId: 'legacy-revoked', watermark: legacyKey })
    await seedLegacyReceipt(ws, 'legacy-activation', 'subscription.active', 'active', legacyKey)
    await seedLegacyReceipt(ws, 'legacy-revoked', 'subscription.revoked', 'canceled', legacyKey)
    const before = await rawRow(ws)
    // Redelivered with its real, later modified_at that beats the creation-time watermark.
    expect(await deliver('legacy-activation', 'subscription.active', subscription(ws, 'active', '2026-10-10T10:00:00.000Z'))).toEqual({ received: true, result: 'duplicate' })
    expect(await rawRow(ws)).toEqual(before)
    expect(await env.DB.prepare('SELECT apply_nonce FROM polar_webhook_receipts WHERE event_id = ?').bind('legacy-activation').first('apply_nonce')).toBeNull()
    expect((await entitlement(ws)).effective).toBe(false)
    // Only a genuinely new event with that timestamp may move the row.
    expect(await deliver('fresh-activation', 'subscription.active', subscription(ws, 'active', '2026-10-10T10:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect((await record(ws))?.status).toBe('active')
  })

  it('keeps a legacy past_due with unknown start ungraced through newer past_due updates', async () => {
    const ws = 'ws-webhook-legacy-past-due'
    await seedWorkspace(ws)
    const legacyKey = Date.parse(createdAt)
    await seedLegacyBilling(ws, { status: 'past_due', pastDueSince: null, webhookEventId: 'legacy-failure', watermark: legacyKey })
    // Old handler stamped both receipts with the subscription creation time.
    await seedLegacyReceipt(ws, 'legacy-active', 'subscription.active', 'active', legacyKey)
    await seedLegacyReceipt(ws, 'legacy-failure', 'subscription.past_due', 'past_due', legacyKey)
    expect(await deliver('legacy-retry', 'subscription.updated', subscription(ws, 'past_due', '2026-10-18T10:00:00.000Z'))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'past_due',
      pastDueSince: null,
      webhookUpdatedAt: Date.parse('2026-10-18T10:00:00.000Z'),
      subscriptionUpdatedAt: Date.parse('2026-10-18T10:00:00.000Z'),
    })
    expect((await getBilling(ws)).graceEndsAt).toBeNull()
    expect(await entitledAt(ws, '2026-10-18T11:00:00.000Z')).toBe(false)
    expect(await entitledAt(ws, '2026-10-23T10:00:00.000Z')).toBe(false)
    // A genuine recovery and new failure start a real clock.
    await deliver('legacy-recovered', 'subscription.active', subscription(ws, 'active', '2026-10-20T10:00:00.000Z'))
    const newFailure = '2026-10-21T10:00:00.000Z'
    await deliver('legacy-new-failure', 'subscription.past_due', subscription(ws, 'past_due', newFailure))
    expect(await record(ws)).toMatchObject({ status: 'past_due', pastDueSince: Date.parse(newFailure) })
    expect(await entitledAt(ws, '2026-10-25T10:00:00.000Z')).toBe(true)
  })

  it('populates subscription fields from an older subscription event delivered after a newer checkout', async () => {
    const ws = 'ws-webhook-checkout-first'
    await seedWorkspace(ws)
    await ensureBillingRow(ws)
    const checkoutAt = '2026-10-15T10:00:00.200Z'
    const subscriptionAt = '2026-10-15T10:00:00.100Z'
    expect(await deliver('cf-checkout', 'checkout.updated', checkout(ws, checkoutAt))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'active', polarSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: null,
      webhookUpdatedAt: Date.parse(checkoutAt), subscriptionUpdatedAt: null,
    })
    // Older subscription status (incomplete → unpaid) loses; its subscription-only fields still land.
    expect(await deliver('cf-subscription', 'subscription.created', subscription(ws, 'incomplete', subscriptionAt, true))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'active',
      webhookEventId: 'cf-checkout',
      webhookUpdatedAt: Date.parse(checkoutAt),
      polarSubscriptionId: `sub_${ws}`,
      currentPeriodEnd: Date.parse(periodEnd) / 1000,
      cancelAtPeriodEnd: true,
      subscriptionUpdatedAt: Date.parse(subscriptionAt),
    })
    expect(await getBilling(ws)).toMatchObject({ status: 'active', currentPeriodEnd: Date.parse(periodEnd) / 1000, cancelAtPeriodEnd: true })
    expect((await entitlement(ws)).effective).toBe(true)
    // Older than both watermarks: no group changes.
    const before = await rawRow(ws)
    expect(await deliver('cf-oldest', 'subscription.updated', subscription(ws, 'canceled', '2026-10-15T10:00:00.050Z'))).toEqual({ received: true, result: 'stale' })
    expect(await rawRow(ws)).toEqual(before)
    // Newer than both: status and subscription fields update together.
    const renewedAt = '2026-10-15T10:00:00.300Z'
    const renewed = { ...subscription(ws, 'active', renewedAt), id: `sub_replacement_${ws}`, current_period_end: '2026-12-01T00:00:00.000Z' }
    expect(await deliver('cf-newer-subscription', 'subscription.updated', renewed)).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'active',
      webhookEventId: 'cf-newer-subscription',
      webhookUpdatedAt: Date.parse(renewedAt),
      subscriptionUpdatedAt: Date.parse(renewedAt),
      polarSubscriptionId: renewed.id,
      currentPeriodEnd: Date.parse(renewed.current_period_end) / 1000,
      cancelAtPeriodEnd: false,
    })
  })

  it('advances the current period end on renewal without changing its seconds unit', async () => {
    const ws = 'ws-webhook-renewal'
    await seedWorkspace(ws)
    await deliver('z-first-period', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.000Z'))
    expect((await getBilling(ws)).currentPeriodEnd).toBe(Date.parse(periodEnd) / 1000)
    const renewed = { ...subscription(ws, 'active', '2026-11-01T00:00:00.500Z'), current_period_end: '2026-12-01T00:00:00.000Z' }
    expect(await deliver('a-renewal', 'subscription.updated', renewed)).toEqual({ received: true, result: 'applied' })
    expect((await getBilling(ws)).currentPeriodEnd).toBe(Date.parse(renewed.current_period_end) / 1000)
  })

  it('orders distinct changes within one second using milliseconds in both billing and receipts', async () => {
    const ws = 'ws-webhook-milliseconds'
    await seedWorkspace(ws)
    await deliver('z-ms-active', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.100Z'))
    expect(await deliver('a-ms-revoked', 'subscription.revoked', subscription(ws, 'canceled', '2026-10-15T10:00:00.900Z'))).toEqual({ received: true, result: 'applied' })
    expect(await deliver('zz-ms-delayed', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.500Z'))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({ status: 'canceled', webhookUpdatedAt: Date.parse('2026-10-15T10:00:00.900Z') })
    const rows = await env.DB.prepare('SELECT event_id, source_timestamp FROM polar_webhook_receipts WHERE workspace_id = ? ORDER BY source_timestamp').bind(ws).all()
    expect(rows.results).toEqual([
      { event_id: 'z-ms-active', source_timestamp: Date.parse('2026-10-15T10:00:00.100Z') },
      { event_id: 'zz-ms-delayed', source_timestamp: Date.parse('2026-10-15T10:00:00.500Z') },
      { event_id: 'a-ms-revoked', source_timestamp: Date.parse('2026-10-15T10:00:00.900Z') },
    ])
  })

  it('keeps the stored version when equal timestamps disagree on status and warns', async () => {
    const ws = 'ws-webhook-equal'
    await seedWorkspace(ws)
    const modifiedAt = '2026-10-15T10:00:00.123Z'
    await deliver('a-equal-revoked', 'subscription.revoked', subscription(ws, 'canceled', modifiedAt))
    const warnings: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((message) => { warnings.push(String(message)) })
    expect(await deliver('z-equal-active', 'subscription.active', subscription(ws, 'active', modifiedAt))).toEqual({ received: true, result: 'stale' })
    expect(await record(ws)).toMatchObject({ status: 'canceled', webhookEventId: 'a-equal-revoked' })
    expect((await entitlement(ws)).effective).toBe(false)
    expect(warnings.map((message) => JSON.parse(message))).toEqual([
      expect.objectContaining({
        event: 'polar_webhook_equal_timestamp_conflict',
        workspaceId: ws, sourceTimestamp: Date.parse(modifiedAt),
        storedStatus: 'canceled', incomingStatus: 'active',
      }),
    ])
  })

  it('retains paid access on scheduled cancellation, preserves subscription fields on a newer checkout, and clears the flag on uncancel', async () => {
    const ws = 'ws-webhook-cancel'
    await seedWorkspace(ws)
    await deliver('cancel-initial-active', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.000Z'))
    await deliver('cancel-scheduled', 'subscription.canceled', subscription(ws, 'active', '2026-10-15T10:00:00.100Z', true))
    expect(await getBilling(ws)).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    expect((await entitlement(ws)).effective).toBe(true)
    // Newer checkout naming a different subscription must not overwrite subscription-only fields.
    expect(await deliver('cancel-checkout', 'checkout.updated', checkout(ws, '2026-10-15T10:00:00.200Z', 'sub_from_checkout'))).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({
      status: 'active',
      polarSubscriptionId: `sub_${ws}`,
      currentPeriodEnd: Date.parse(periodEnd) / 1000,
      cancelAtPeriodEnd: true,
      webhookUpdatedAt: Date.parse('2026-10-15T10:00:00.200Z'),
    })
    expect(await getBilling(ws)).toMatchObject({ currentPeriodEnd: Date.parse(periodEnd) / 1000, cancelAtPeriodEnd: true })
    await deliver('cancel-undone', 'subscription.uncanceled', subscription(ws, 'active', '2026-10-15T10:00:00.300Z'))
    expect(await getBilling(ws)).toMatchObject({ status: 'active', cancelAtPeriodEnd: false })
    expect((await entitlement(ws)).effective).toBe(true)
  })

  it('returns duplicate on exact replay without altering billing', async () => {
    const ws = 'ws-webhook-replay'
    await seedWorkspace(ws)
    const request = await signedRequest('replay-event', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.123Z'))
    expect(await (await handlePolarWebhook(request.clone())).json()).toEqual({ received: true, result: 'applied' })
    const original = await rawRow(ws)
    expect(await (await handlePolarWebhook(request.clone())).json()).toEqual({ received: true, result: 'duplicate' })
    expect(await rawRow(ws)).toEqual(original)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM polar_webhook_receipts WHERE event_id = ?').bind('replay-event').first('count')).toBe(1)
    await deliver('replay-newer-revoked', 'subscription.revoked', subscription(ws, 'canceled', '2026-10-15T10:00:00.900Z'))
    const canceled = await rawRow(ws)
    // Duplicate older activation after cancel: no group may move, not even updated_at.
    expect(await (await handlePolarWebhook(request.clone())).json()).toEqual({ received: true, result: 'duplicate' })
    expect(await rawRow(ws)).toEqual(canceled)
    expect(canceled).toMatchObject({ status: 'canceled', webhook_event_id: 'replay-newer-revoked' })
    expect((await entitlement(ws)).effective).toBe(false)
  })

  it('uses the envelope timestamp before creation time when modified_at is null', async () => {
    const ws = 'ws-webhook-envelope'
    await seedWorkspace(ws)
    await deliver('z-envelope-active', 'subscription.active', subscription(ws, 'active', null), '2026-10-15T10:00:00.100Z')
    expect(await deliver('a-envelope-revoked', 'subscription.revoked', subscription(ws, 'canceled', null), '2026-10-15T10:00:00.900Z')).toEqual({ received: true, result: 'applied' })
    expect(await record(ws)).toMatchObject({ status: 'canceled', webhookUpdatedAt: Date.parse('2026-10-15T10:00:00.900Z') })
  })

  it('rejects a tampered signature without writing a receipt or granting access', async () => {
    const ws = 'ws-webhook-bad-signature'
    await seedWorkspace(ws)
    const request = await signedRequest('bad-signature', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.123Z'))
    request.headers.set('webhook-signature', 'v1,invalid')
    expect((await handlePolarWebhook(request)).status).toBe(401)
    expect(await record(ws)).toBeUndefined()
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM polar_webhook_receipts WHERE workspace_id = ?').bind(ws).first('count')).toBe(0)
    expect((await entitlement(ws)).effective).toBe(false)
  })

  it('rolls back the receipt when billing fails so a later retry can apply', async () => {
    const ws = 'ws-webhook-atomic-retry'
    const request = await signedRequest('atomic-retry', 'subscription.active', subscription(ws, 'active', '2026-10-15T10:00:00.123Z'))
    await expect(handlePolarWebhook(request.clone())).rejects.toThrow()
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM polar_webhook_receipts WHERE event_id = ?').bind('atomic-retry').first('count')).toBe(0)
    expect(await record(ws)).toBeUndefined()
    await seedWorkspace(ws)
    expect(await (await handlePolarWebhook(request.clone())).json()).toEqual({ received: true, result: 'applied' })
    expect((await entitlement(ws)).effective).toBe(true)
  })
})
