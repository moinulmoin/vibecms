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
} from '@/server/billing'
import type { AppUserContext } from '@/server/onboarding'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const mutableEnv = env as unknown as Record<string, unknown>
const saved = {
  SELF_HOSTED: mutableEnv.SELF_HOSTED,
  POLAR_ACCESS_TOKEN: mutableEnv.POLAR_ACCESS_TOKEN,
  POLAR_PRODUCT_ID: mutableEnv.POLAR_PRODUCT_ID,
  APP_URL: mutableEnv.APP_URL,
}

beforeAll(async () => {
  const migrations = inject('migrations') as D1Migration[]
  await applyD1Migrations(env.DB, migrations)
})

afterEach(() => {
  mutableEnv.SELF_HOSTED = saved.SELF_HOSTED
  mutableEnv.POLAR_ACCESS_TOKEN = saved.POLAR_ACCESS_TOKEN
  mutableEnv.POLAR_PRODUCT_ID = saved.POLAR_PRODUCT_ID
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
    expect(checkoutIdempotencyKey('ws_a', 'monthly')).toBe('vc-checkout:ws_a:monthly')
    expect(checkoutIdempotencyKey('ws_a', 'monthly')).toBe(checkoutIdempotencyKey('ws_a', 'monthly'))
    expect(checkoutIdempotencyKey('ws_a', 'yearly')).not.toBe(checkoutIdempotencyKey('ws_a', 'monthly'))
  })
})

describe('pickReusableOpenCheckoutUrl', () => {
  it('returns the first open, non-expired checkout URL', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z')
    expect(
      pickReusableOpenCheckoutUrl(
        [
          { url: 'https://polar.example/expired', status: 'open', expiresAt: '2026-07-25T11:00:00.000Z' },
          { url: 'https://polar.example/open', status: 'open', expiresAt: '2026-07-25T13:00:00.000Z' },
        ],
        now,
      ),
    ).toBe('https://polar.example/open')
  })

  it('skips non-open statuses and missing URLs', () => {
    expect(
      pickReusableOpenCheckoutUrl([
        { url: 'https://polar.example/confirmed', status: 'confirmed' },
        { status: 'open' },
        { url: 'https://polar.example/ok', status: 'open' },
      ]),
    ).toBe('https://polar.example/ok')
  })
})

describe('createCheckoutSessionForApp — active subscription guard', () => {
  it('rejects checkout when the workspace subscription is already active', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_PRODUCT_ID = 'prod_monthly'
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
    mutableEnv.POLAR_PRODUCT_ID = 'prod_monthly'
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
})

describe('createCheckoutSessionForApp — open checkout reuse', () => {
  it('returns an existing open Polar checkout URL and does not create another session', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.POLAR_ACCESS_TOKEN = 'polar_test_token'
    mutableEnv.POLAR_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-open-reuse'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.ensureBillingRow(workspaceId, 'none')

    const createCheckout = vi.fn()
    const listOpenCheckouts = vi.fn().mockResolvedValue([
      {
        url: 'https://polar.example/checkout/existing',
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
    mutableEnv.POLAR_PRODUCT_ID = 'prod_monthly'
    mutableEnv.APP_URL = 'https://app.example.com'

    const workspaceId = 'ws-billing-repeat-key'
    await seedWorkspace(workspaceId)
    const db = createDataAccess(env.DB)
    await db.billing.ensureBillingRow(workspaceId, 'none')

    const createCheckout = vi.fn().mockResolvedValue({ url: 'https://polar.example/checkout/1' })
    const listOpenCheckouts = vi.fn().mockResolvedValue([])
    const app = ownerApp(workspaceId)
    const deps = { createCheckout, listOpenCheckouts }

    const first = await createCheckoutSessionForApp(app, 'monthly', deps)
    const second = await createCheckoutSessionForApp(app, 'monthly', deps)

    expect(first).toEqual({ kind: 'ok', url: 'https://polar.example/checkout/1' })
    expect(second).toEqual({ kind: 'ok', url: 'https://polar.example/checkout/1' })
    expect(listOpenCheckouts).toHaveBeenCalledTimes(2)
    expect(createCheckout).toHaveBeenCalledTimes(2)

    const key = checkoutIdempotencyKey(workspaceId, 'monthly')
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
