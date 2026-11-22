/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { createDataAccess } from '@vc/db'
import {
  checkoutIdempotencyKey,
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  pickReusableOpenCheckoutUrl,
  isDiscountRefusal,
  isOfferPrice,
  isRedeemableDiscount,
  pinnedPolarHttpClient,
} from '@/server/billing'
import { HTTPValidationError } from '@polar-sh/sdk/models/errors/httpvalidationerror.js'
import type { AppUserContext } from '@/server/onboarding'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const mutableEnv = env as unknown as Record<string, unknown>
const MONTHLY = { recurringInterval: 'month', recurringIntervalCount: 1 }
const saved = {
  SELF_HOSTED: mutableEnv.SELF_HOSTED,
  POLAR_ACCESS_TOKEN: mutableEnv.POLAR_ACCESS_TOKEN,
  POLAR_MONTHLY_PRODUCT_ID: mutableEnv.POLAR_MONTHLY_PRODUCT_ID,
  APP_URL: mutableEnv.APP_URL,
  POLAR_LAUNCH_DISCOUNT_MONTHLY_ID: mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID,
}

beforeAll(async () => {
  const migrations = inject('migrations') as D1Migration[]
  await applyD1Migrations(env.DB, migrations)
})

afterEach(() => {
  mutableEnv.SELF_HOSTED = saved.SELF_HOSTED
  mutableEnv.POLAR_ACCESS_TOKEN = saved.POLAR_ACCESS_TOKEN
  mutableEnv.POLAR_MONTHLY_PRODUCT_ID = saved.POLAR_MONTHLY_PRODUCT_ID
  mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = saved.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID
  mutableEnv.APP_URL = saved.APP_URL
  vi.restoreAllMocks()
})

function ownerApp(workspaceId: string): AppUserContext {
  return {
    workspaceId,
    siteId: `site_${workspaceId}`,
    user: {
      id: 'user_billing_checkout',
      email: 'billing-checkout@example.com',
      name: 'Billing Checkout Tester',
    },
    actor: {
      type: 'human',
      id: 'user_billing_checkout',
      name: 'Billing Checkout Tester',
      role: 'owner',
    },
  }
}

async function seedWorkspace(id: string) {
  const ts = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, id, id, ts, ts)
    .run()
}

async function seedManagedWorkspace(id: string) {
  await seedWorkspace(id)
  const ts = Math.floor(Date.now() / 1000)
  const siteId = `site_${id}`
  const userId = `user_${id}`
  const keyId = `key_${id}`
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(userId, id, `${id}@billing.example.test`, ts, ts),
    env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
    ).bind(siteId, id, id, id, ts, ts),
    env.DB.prepare(
      `INSERT INTO api_keys (
         id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    ).bind(keyId, siteId, id, 'managed-billing', `hash-${id}`, id, userId, ts, ts),
    env.DB.prepare(
      `INSERT INTO autoseopilot_managed_sites (
         id, external_workspace_id, owner_user_id, workspace_id, site_id,
         credential_id, credential_generation, api_key_id, entitlement_status,
         entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', NULL, 1, ?, ?, NULL)`,
    ).bind(
      `binding_${id}`,
      `external_${id}`,
      userId,
      id,
      siteId,
      `credential_${id}`,
      keyId,
      ts,
      ts,
    ),
  ])
}

describe('checkoutIdempotencyKey', () => {
  it('is stable for the same workspace and interval', () => {
    expect(checkoutIdempotencyKey('ws_a', 'monthly', 'product', 'discount')).toBe('vc-checkout:ws_a:monthly:product:discount')
    expect(checkoutIdempotencyKey('ws_a', 'monthly', 'product', 'discount')).toBe(checkoutIdempotencyKey('ws_a', 'monthly', 'product', 'discount'))
    expect(checkoutIdempotencyKey('ws_a', 'monthly', 'product')).not.toBe(checkoutIdempotencyKey('ws_a', 'monthly', 'product', 'discount'))
    expect(checkoutIdempotencyKey('ws_a', 'monthly', 'other', 'discount')).not.toBe(checkoutIdempotencyKey('ws_a', 'monthly', 'product', 'discount'))
  })
})

describe('pickReusableOpenCheckoutUrl', () => {
  it('returns the first open, non-expired checkout URL', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z')
    expect(
      pickReusableOpenCheckoutUrl(
        [
          { url: 'https://polar.example/expired', status: 'open', expiresAt: '2026-07-25T11:00:00.000Z' },
          { url: 'https://polar.example/open', status: 'open', productId: 'product', expiresAt: '2026-07-25T13:00:00.000Z', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 },
        ],
        'product', undefined, 'monthly',
        1500, now,
      ),
    ).toBe('https://polar.example/open')
  })

  it('skips non-open statuses and missing URLs', () => {
    expect(
      pickReusableOpenCheckoutUrl([
        { url: 'https://polar.example/confirmed', status: 'confirmed' },
        { status: 'open' },
        { url: 'https://polar.example/ok', status: 'open', productId: 'product', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 },
      ], 'product', undefined, 'monthly', 1500),
    ).toBe('https://polar.example/ok')
  })
})

describe('createCheckoutSessionForApp — active subscription guard', () => {
  it('rejects checkout when the workspace subscription is already active', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-active-guard'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.upsertFromWebhook({
      workspaceId,
      polarCustomerId: 'cust_billing_active_guard',
      polarSubscriptionId: 'sub_billing_active_guard',
      status: 'active',
      currentPeriodEnd: 2_000_000_000,
    })

    const createCheckout = vi.fn()
    const listOpenCheckouts = vi.fn()
    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts,
    })

    expect(result).toEqual({ kind: 'error', code: 'already_active' })
    expect(createCheckout).not.toHaveBeenCalled()
    expect(listOpenCheckouts).not.toHaveBeenCalled()
  })

  it('preserves self-hosted rejection without calling Polar', async () => {
    mutableEnv.SELF_HOSTED = 'true'
    const createCheckout = vi.fn()
    const listOpenCheckouts = vi.fn()
    const result = await createCheckoutSessionForApp(ownerApp('ws-billing-self-host'), 'monthly', {
      createCheckout,
      listOpenCheckouts,
    })
    expect(result).toEqual({ kind: 'error', code: 'self_hosted' })
    expect(createCheckout).not.toHaveBeenCalled()
    expect(listOpenCheckouts).not.toHaveBeenCalled()
  })

  it('rejects checkout for managed workspaces without creating a Polar relationship', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-billing-managed-guard'
    await seedManagedWorkspace(workspaceId)
    const createCheckout = vi.fn()
    const listOpenCheckouts = vi.fn()

    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts,
    })

    expect(result).toEqual({ kind: 'error', code: 'managed_workspace' })
    expect(createCheckout).not.toHaveBeenCalled()
    expect(listOpenCheckouts).not.toHaveBeenCalled()
  })

  it('refuses a new checkout for past_due even when an open checkout exists', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = ''
    const workspaceId = 'ws-billing-past-due-guard'
    await seedWorkspace(workspaceId)
    await createDataAccess(env.DB).billing.ensureBillingRow(workspaceId, 'past_due')
    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      listOpenCheckouts: async () => [{
        url: 'https://polar.example/existing', productId: 'prod_monthly',
        currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500, status: 'open',
      }],
      createCheckout: async () => ({
        url: 'https://polar.example/new', productId: 'prod_monthly',
        currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500,
      }),
    })
    expect(result).toEqual({ kind: 'error', code: 'payment_past_due' })
    expect((await createDataAccess(env.DB).billing.getBillingRecord(workspaceId))?.status).toBe('past_due')
  })

  it.each(['canceled', 'none', 'unpaid'] as const)('allows fresh checkout for terminal/non-subscribed status %s with a neutral cancel return', async (status) => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = ''
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = `ws-billing-ended-${status}`
    await seedWorkspace(workspaceId)
    await createDataAccess(env.DB).billing.ensureBillingRow(workspaceId, status)
    let returnUrl: string | undefined
    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      listOpenCheckouts: async () => [],
      createCheckout: async (body) => {
        returnUrl = body.returnUrl
        return {
          url: 'https://polar.example/new', productId: 'prod_monthly',
          currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500,
        }
      },
    })
    expect(result).toEqual({ kind: 'ok', url: 'https://polar.example/new' })
    expect(returnUrl).toBe('https://app.example.com/dashboard/billing')
  })
})

describe('createCheckoutSessionForApp — open checkout reuse', () => {
  it('returns an existing open Polar checkout URL and does not create another session', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-open-reuse'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.ensureBillingRow(workspaceId, 'none')

    const createCheckout = vi.fn()
    const listOpenCheckouts = vi.fn().mockResolvedValue([
      {
        url: 'https://polar.example/checkout/existing',
        productId: 'prod_monthly',
        currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500,
        status: 'open',
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])

    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      createCheckout,
      listOpenCheckouts,
    })

    expect(result).toEqual({ kind: 'ok', url: 'https://polar.example/checkout/existing' })
    expect(listOpenCheckouts).toHaveBeenCalledWith({
      externalCustomerId: workspaceId,
      productId: 'prod_monthly',
    })
    expect(createCheckout).not.toHaveBeenCalled()
  })
})

describe('createCheckoutSessionForApp — repeat request idempotency key', () => {
  it('reuses the same Idempotency-Key for repeated checkout attempts', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-repeat-key'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.ensureBillingRow(workspaceId, 'none')

    const createCheckout = vi.fn().mockResolvedValue({ url: 'https://polar.example/checkout/1', productId: 'prod_monthly', discountId: null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 })
    const listOpenCheckouts = vi.fn().mockResolvedValue([])
    const app = ownerApp(workspaceId)
    const deps = { createCheckout, listOpenCheckouts }

    const first = await createCheckoutSessionForApp(app, 'monthly', deps)
    const second = await createCheckoutSessionForApp(app, 'monthly', deps)

    expect(first).toEqual({ kind: 'ok', url: 'https://polar.example/checkout/1' })
    expect(second).toEqual({ kind: 'ok', url: 'https://polar.example/checkout/1' })
    expect(listOpenCheckouts).toHaveBeenCalledTimes(2)
    expect(createCheckout).toHaveBeenCalledTimes(2)

    const key = checkoutIdempotencyKey(workspaceId, 'monthly', 'prod_monthly')
    expect(createCheckout.mock.calls[0][1]).toEqual({ headers: { 'Idempotency-Key': key } })
    expect(createCheckout.mock.calls[1][1]).toEqual({ headers: { 'Idempotency-Key': key } })
    expect(createCheckout.mock.calls[0][1]).toEqual(createCheckout.mock.calls[1][1])
  })
})

describe('createPortalSessionForApp — intact for active workspaces', () => {
  it('still requires Polar configuration rather than being blocked by already_active', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = undefined
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-portal-intact'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.upsertFromWebhook({
      workspaceId,
      polarCustomerId: 'cust_billing_portal_intact',
      polarSubscriptionId: 'sub_billing_portal_intact',
      status: 'active',
      currentPeriodEnd: 2_000_000_000,
    })

    const result = await createPortalSessionForApp(ownerApp(workspaceId))
    expect(result).toEqual({ kind: 'error', code: 'polar_unconfigured' })
  })
})

describe('createPortalSessionForApp — Polar customer shared with other products', () => {
  it("opens the stored Polar customer's portal when that customer carries no external ID for this blog", async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-billing-portal-shared-customer'
    await seedWorkspace(workspaceId)
    await createDataAccess(env.DB).billing.upsertFromWebhook({
      workspaceId,
      polarCustomerId: 'cust_bought_other_product_first',
      polarSubscriptionId: 'sub_billing_portal_shared_customer',
      status: 'active',
      currentPeriodEnd: 2_000_000_000,
    })
    // Polar keeps one customer per email. This person first bought another
    // product, so their customer has no external ID, and a vibecms checkout
    // reuses it without setting one. Polar finds a customer session by
    // customer ID or by external ID, and answers 422 when neither matches.
    const portalUrl = 'https://polar.example/portal/session'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname !== '/v1/customer-sessions/') return new Response('Not found', { status: 404 })
      const body = (await request.json()) as { customer_id?: string; external_customer_id?: string }
      if (body.customer_id !== 'cust_bought_other_product_first') {
        return Response.json(
          { detail: [{ loc: ['body', body.customer_id ? 'customer_id' : 'external_customer_id'], msg: 'Customer does not exist.', type: 'value_error' }] },
          { status: 422 },
        )
      }
      const now = new Date().toISOString()
      return Response.json({
        created_at: now, modified_at: null, id: 'cs_shared_customer', token: 'polar_cst_test',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(), return_url: 'https://app.example.com/dashboard/billing',
        customer_portal_url: portalUrl, customer_id: 'cust_bought_other_product_first',
        customer: {
          id: 'cust_bought_other_product_first', created_at: now, modified_at: null, metadata: {}, external_id: null,
          email: 'billing-checkout@example.com', email_verified: true, type: 'individual', name: 'Billing Checkout Tester',
          billing_address: null, tax_id: null, organization_id: 'org_test', deleted_at: null, avatar_url: 'https://polar.example/avatar.png',
        },
      }, { status: 201 })
    })

    expect(await createPortalSessionForApp(ownerApp(workspaceId))).toEqual({ kind: 'ok', url: portalUrl })
  })
})

function polarValidationError(field: string) {
  return new HTTPValidationError(
    { detail: [{ loc: ['body', field], msg: 'Discount is not applicable.', type: 'value_error' }] },
    { request: new Request('https://sandbox-api.polar.sh/v1/checkouts/'), response: new Response('', { status: 422 }), body: '' },
  )
}

describe('isOfferPrice', () => {
  const at = (netAmount: number | null, amount: number | null = 1500, currency = 'usd', product: object | null = MONTHLY) => ({ currency, amount, netAmount, product })
  it('allows only the list price without a discount and only less than list with one, never more', () => {
    expect(isOfferPrice(at(1500), 'monthly', 1500, false)).toBe(true)
    expect(isOfferPrice(at(900), 'monthly', 1500, false)).toBe(false)
    expect(isOfferPrice(at(1501), 'monthly', 1500, false)).toBe(false)
    expect(isOfferPrice(at(900), 'monthly', 1500, true)).toBe(true)
    expect(isOfferPrice(at(1499), 'monthly', 1500, true)).toBe(true)
    expect(isOfferPrice(at(1500), 'monthly', 1500, true)).toBe(false)
    expect(isOfferPrice(at(1501), 'monthly', 1500, true)).toBe(false)
    expect(isOfferPrice(at(0), 'monthly', 1500, true)).toBe(false)
    expect(isOfferPrice(at(null), 'monthly', 1500, false)).toBe(false)
  })

  it('refuses a product priced above list even when the discounted first charge is below it', () => {
    expect(isOfferPrice(at(1200, 3000), 'monthly', 1500, true)).toBe(false)
    expect(isOfferPrice(at(1500, 3000), 'monthly', 1500, false)).toBe(false)
    expect(isOfferPrice(at(900, null), 'monthly', 1500, true)).toBe(false)
    expect(isOfferPrice(at(900, 1500, 'eur'), 'monthly', 1500, true)).toBe(false)
  })

  it('refuses a product that bills on another cadence than the plan', () => {
    const yearly = { recurringInterval: 'year', recurringIntervalCount: 1 }
    expect(isOfferPrice(at(15000, 15000, 'usd', yearly), 'yearly', 15000, false)).toBe(true)
    expect(isOfferPrice(at(15000, 15000, 'usd', MONTHLY), 'yearly', 15000, false)).toBe(false)
    expect(isOfferPrice(at(1500, 1500, 'usd', yearly), 'monthly', 1500, false)).toBe(false)
    expect(isOfferPrice(at(1500, 1500, 'usd', { recurringInterval: 'month', recurringIntervalCount: 3 }), 'monthly', 1500, false)).toBe(false)
    expect(isOfferPrice(at(1500, 1500, 'usd', null), 'monthly', 1500, false)).toBe(false)
  })
})

describe('isRedeemableDiscount', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z')
  it('follows Polar: not before it starts, not after it ends, not once every spot is used', () => {
    expect(isRedeemableDiscount({ maxRedemptions: 50, redemptionsCount: 49 }, now)).toBe(true)
    expect(isRedeemableDiscount({ maxRedemptions: 50, redemptionsCount: 50 }, now)).toBe(false)
    expect(isRedeemableDiscount({ maxRedemptions: null, redemptionsCount: 500 }, now)).toBe(true)
    expect(isRedeemableDiscount({ startsAt: new Date(now + 1000) }, now)).toBe(false)
    expect(isRedeemableDiscount({ endsAt: new Date(now - 1000) }, now)).toBe(false)
    expect(isRedeemableDiscount({ startsAt: new Date(now - 1000), endsAt: new Date(now + 1000) }, now)).toBe(true)
  })
})

describe('isDiscountRefusal through the Polar SDK', () => {
  it('recognises the 422 Polar sends for a refused discount_id, and nothing else', async () => {
    const { Polar } = await import('@polar-sh/sdk')
    const refuse = (field: string) => async () => new Response(JSON.stringify({
      detail: [{ loc: ['body', field], msg: 'Discount is no longer redeemable.', type: 'value_error', input: 'disc' }],
    }), { status: 422, headers: { 'content-type': 'application/json' } })
    const attempt = (field: string) => new Polar({ accessToken: 'polar_test', server: 'sandbox', httpClient: pinnedPolarHttpClient(refuse(field)) })
      .checkouts.create({ products: ['prod_monthly'], discountId: 'disc' }).then(() => null, (error: unknown) => error)
    expect(isDiscountRefusal(await attempt('discount_id'))).toBe(true)
    expect(isDiscountRefusal(await attempt('customer_email'))).toBe(false)
  })
})

describe('createCheckoutSessionForApp — early-user discount', () => {
  it.each([
    ['usd', 1500], ['eur', 900], ['usd', 0], ['usd', 1600],
  ])('skips reused checkout with currency %s and net amount %i when the early-user discount is on', async (currency, netAmount) => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = `ws-reuse-price-${currency}-${netAmount}`
    await seedWorkspace(workspaceId)
    const createCheckout = vi.fn().mockResolvedValue({
      url: 'https://polar.example/correct', productId: 'prod_monthly',
      discountId: 'disc_early_monthly', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 900,
    })
    const listOpenCheckouts = vi.fn().mockResolvedValue([{
      url: 'https://polar.example/wrong', status: 'open', productId: 'prod_monthly',
      discountId: 'disc_early_monthly', currency, amount: 1500, product: MONTHLY, netAmount,
    }])
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/correct' })
    expect(createCheckout).toHaveBeenCalledOnce()
  })

  it('drops a used-up discount before checkout and reuses an open list-price checkout instead of the stale discounted one', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-spots-gone'
    await seedWorkspace(workspaceId)
    const createCheckout = vi.fn()
    const getDiscount = vi.fn(async () => ({ maxRedemptions: 50, redemptionsCount: 50 }))
    const listOpenCheckouts = vi.fn(async () => [
      { url: 'https://polar.example/stale-discounted', status: 'open', productId: 'prod_monthly', discountId: 'disc_early_monthly', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 900 },
      { url: 'https://polar.example/list-price', status: 'open', productId: 'prod_monthly', discountId: null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 },
    ])
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts, getDiscount }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/list-price' })
    expect(getDiscount).toHaveBeenCalledWith('disc_early_monthly')
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it('never reuses a discounted checkout when the discount cannot be read, and lets Polar validate a new one', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-lookup-failed'
    await seedWorkspace(workspaceId)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createCheckout = vi.fn(async (body: { discountId?: string }, _options?: unknown) => ({ url: 'https://polar.example/validated', productId: 'prod_monthly', discountId: body.discountId ?? null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 900 }))
    const getDiscount = vi.fn(async () => { throw new Error('404 not found') })
    const listOpenCheckouts = vi.fn(async () => [
      { url: 'https://polar.example/stale-discounted', status: 'open', productId: 'prod_monthly', discountId: 'disc_early_monthly', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 900 },
    ])
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts, getDiscount }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/validated' })
    expect(createCheckout).toHaveBeenCalledOnce()
    expect(createCheckout.mock.calls[0]?.[0]).toMatchObject({ discountId: 'disc_early_monthly' })
  })

  it('reuses an open list-price checkout when Polar refuses the discount at create', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-refused-reuse'
    await seedWorkspace(workspaceId)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const createCheckout = vi.fn(async () => { throw polarValidationError('discount_id') })
    const listOpenCheckouts = vi.fn(async () => [
      { url: 'https://polar.example/list-price', status: 'open', productId: 'prod_monthly', discountId: null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 },
    ])
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/list-price' })
    expect(createCheckout).toHaveBeenCalledOnce()
  })

  it('rejects a created checkout whose product is priced above list, even with the discount', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-above-list'
    await seedWorkspace(workspaceId)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      listOpenCheckouts: async () => [],
      createCheckout: async () => ({ url: 'https://polar.example/above-list', productId: 'prod_monthly', discountId: 'disc_early_monthly', currency: 'usd', amount: 3000, product: MONTHLY, netAmount: 1200 }),
    })).toEqual({ kind: 'error', code: 'checkout_failed' })
    expect(log).toHaveBeenCalledWith('polar checkout offer mismatch', expect.objectContaining({ amount: 3000, netAmount: 1200 }))
  })

  it.each([
    ['eur', 900], ['usd', 1500], ['usd', 1501], ['usd', 0],
  ])('rejects a discounted checkout with currency %s and net amount %i', async (currency, netAmount) => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = `ws-created-price-${currency}-${netAmount}`
    await seedWorkspace(workspaceId)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', {
      listOpenCheckouts: async () => [],
      createCheckout: async () => ({
        url: 'https://polar.example/wrong', productId: 'prod_monthly',
        discountId: 'disc_early_monthly', currency, amount: 1500, product: MONTHLY, netAmount,
      }),
    })).toEqual({ kind: 'error', code: 'checkout_failed' })
    expect(log).toHaveBeenCalledWith('polar checkout offer mismatch', expect.objectContaining({ currency, netAmount }))
  })

  it('falls back to a list-price checkout when Polar refuses the early-user discount', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-used-up'
    await seedWorkspace(workspaceId)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const createCheckout = vi.fn(async (body: { discountId?: string }, _options?: unknown) => {
      if (body.discountId) throw polarValidationError('discount_id')
      return { url: 'https://polar.example/list-price', productId: 'prod_monthly', discountId: null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 1500 }
    })
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts: async () => [] }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/list-price' })
    expect(createCheckout).toHaveBeenCalledTimes(2)
    expect(createCheckout.mock.calls[0]?.[0]).toMatchObject({ discountId: 'disc_early_monthly' })
    expect(createCheckout.mock.calls[1]?.[0]).not.toHaveProperty('discountId')
    expect(createCheckout.mock.calls[1]?.[1]).toEqual({ headers: { 'Idempotency-Key': checkoutIdempotencyKey(workspaceId, 'monthly', 'prod_monthly') } })
  })

  it('does not retry a refusal that is not about the discount', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-early-user-other-422'
    await seedWorkspace(workspaceId)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createCheckout = vi.fn(async () => { throw polarValidationError('customer_email') })
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts: async () => [] }))
      .toEqual({ kind: 'error', code: 'checkout_failed' })
    expect(createCheckout).toHaveBeenCalledOnce()
  })

  it('applies the early-user discount when configured and charges list price when not', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-billing-early-user'
    await seedWorkspace(workspaceId)
    const createCheckout = vi.fn(async (body: { discountId?: string }, _options?: unknown) => ({ url: 'https://polar.example/checkout', productId: 'prod_monthly', discountId: body.discountId ?? null, currency: 'usd', amount: 1500, product: MONTHLY, netAmount: body.discountId ? 900 : 1500 }))
    const listOpenCheckouts = vi.fn(async () => [])
    const getDiscount = async () => ({ maxRedemptions: 50, redemptionsCount: 3 })

    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts, getDiscount })
    expect(createCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ products: ['prod_monthly'], discountId: 'disc_early_monthly' }),
      expect.anything(),
    )

    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = ''
    await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { createCheckout, listOpenCheckouts, getDiscount })
    expect(createCheckout.mock.calls.at(-1)?.[0]).not.toHaveProperty('discountId')
  })

  it('skips open checkouts with another product or discount and rejects a mismatched create response', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_MONTHLY_PRODUCT_ID = 'prod_monthly'
    mutableEnv.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID = 'disc_early_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'
    const workspaceId = 'ws-billing-offer-mismatch'
    await seedWorkspace(workspaceId)
    const listOpenCheckouts = vi.fn().mockResolvedValue([
      { url: 'https://polar.example/wrong-product', status: 'open', productId: 'other', discountId: 'disc_early_monthly' },
      { url: 'https://polar.example/wrong-discount', status: 'open', productId: 'prod_monthly', discountId: null },
    ])
    const createCheckout = vi.fn().mockResolvedValue({ url: 'https://polar.example/new', productId: 'prod_monthly', discountId: null })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { listOpenCheckouts, createCheckout, getDiscount: async () => ({}) })
    expect(result).toEqual({ kind: 'error', code: 'checkout_failed' })
    expect(createCheckout).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('polar checkout offer mismatch', expect.objectContaining({ requestedDiscountId: 'disc_early_monthly', returnedDiscountId: null }))
    createCheckout.mockResolvedValue({ url: 'https://polar.example/new', productId: 'prod_monthly', discountId: 'disc_early_monthly', currency: 'usd', amount: 1500, product: MONTHLY, netAmount: 900 })
    expect(await createCheckoutSessionForApp(ownerApp(workspaceId), 'monthly', { listOpenCheckouts, createCheckout, getDiscount: async () => ({}) }))
      .toEqual({ kind: 'ok', url: 'https://polar.example/new' })
  })
})

describe('Polar API version pin', () => {
  it('sends Polar-Version on every SDK request', async () => {
    const seen: Array<string | null> = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init).headers.get('Polar-Version'))
      return new Response(JSON.stringify({ items: [], pagination: { total_count: 0, max_page: 0 } }), { headers: { 'content-type': 'application/json' } })
    }
    const { Polar } = await import('@polar-sh/sdk')
    const { POLAR_API_VERSION } = await import('@vc/config')
    const client = new Polar({ accessToken: 'polar_test', server: 'sandbox', httpClient: pinnedPolarHttpClient(fetcher) })
    await client.products.list({}).catch(() => undefined)
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen)).toEqual(new Set([POLAR_API_VERSION]))
  })
})
