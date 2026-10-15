/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module 'vitest' {
  interface ProvidedContext {
    migrations: import('cloudflare:test').D1Migration[]
  }
}

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, afterEach, describe, expect, inject, it, vi } from 'vitest'
import {
  BillingRequiredError,
  createPost,
  publishPost,
  RateLimitError,
  type Actor,
  type BillingStatus,
} from '@vc/core'
import { API_USAGE_LIMITS, PAST_DUE_GRACE_DAYS } from '@vc/config'
import { createDataAccess, createD1PostRepository } from '@vc/db'
import { addCustomDomainForApp, listCustomDomainsForApp } from './custom-domains'
import { loadAnalyticsForApp } from './analytics'
import { runAnalyticsRollup } from './analytics-rollup'
import {
  billingStatusForCore,
  getCoreBillingStatusForSite,
  resolveEffectiveEntitlementForSite,
  resolveEffectiveEntitlementForWorkspace,
} from './effective-entitlement'
import { assertMediaUploadAllowed } from './media-quota'
import { listApiKeys, revokeApiKeyForApp } from './api-keys'
import { enforceApiBudget, getApiUsageSummary } from './usage'
import type { AppUserContext } from './onboarding'
import { runWithExecutionContext } from './execution-scope'
import { scheduleManagedSitePurge } from './purge-scheduler'
import {
  articleCacheUrls,
  articleCacheUrlsForHost,
  hostnameCacheUrls,
  siteCacheUrls,
} from './public-blog-cache'

const NOW = 1_800_000_000
const mutableEnv = env as unknown as Record<string, unknown>
const savedEnv = {
  APP_ENV: mutableEnv.APP_ENV,
  SELF_HOSTED: mutableEnv.SELF_HOSTED,
  API_USAGE_TEST_LIMIT: mutableEnv.API_USAGE_TEST_LIMIT,
  CLOUDFLARE_ZONE_ID: mutableEnv.CLOUDFLARE_ZONE_ID,
  CUSTOM_HOSTNAME_API_TOKEN: mutableEnv.CUSTOM_HOSTNAME_API_TOKEN,
  CACHE_PURGE_API_TOKEN: mutableEnv.CACHE_PURGE_API_TOKEN,
}

const fullActor: Actor = {
  type: 'api_key',
  id: 'entitlement-test-actor',
  name: 'Entitlement test actor',
  scopes: [
    'sites:read',
    'posts:read',
    'posts:create',
    'posts:update',
    'posts:publish',
    'posts:archive',
    'assets:write',
    'activity:read',
  ],
}

type SeedOptions = {
  polarStatus?: BillingStatus
  /** Epoch milliseconds; only meaningful with polarStatus 'past_due'. */
  pastDueSince?: number | null
  managedStatus?: 'active' | 'revoked'
  managedExpiresAt?: number | null
  siteStatus?: 'active' | 'archived'
}

type SeededSite = { workspaceId: string; siteId: string }

async function seedSite(suffix: string, options: SeedOptions = {}): Promise<SeededSite> {
  const workspaceId = `entitlement-ws-${suffix}`
  const siteId = `entitlement-site-${suffix}`
  const timestamp = NOW - 100
  const polarStatus = options.polarStatus
  const managedStatus = options.managedStatus
  const ownerId = `entitlement-owner-${suffix}`
  const managedKeyId = `entitlement-key-${suffix}`

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      'INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(workspaceId, `Entitlement ${suffix}`, `entitlement-${suffix}`, timestamp, timestamp),
    env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(siteId, workspaceId, `Site ${suffix}`, `site-${suffix}`, options.siteStatus ?? 'active', timestamp, timestamp),
  ]

  if (polarStatus) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO billing_customers (id, workspace_id, status, current_period_end, past_due_since, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(`entitlement-billing-${suffix}`, workspaceId, polarStatus, NOW + 100, options.pastDueSince ?? null, timestamp, timestamp),
    )
  }

  if (managedStatus) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ).bind(ownerId, `Owner ${suffix}`, `${suffix}@entitlement.example.test`, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO api_keys (
           id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
           created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        managedKeyId,
        siteId,
        'Entitlement managed key',
        'prefix',
        `hash-${suffix}`,
        '[]',
        'Entitlement managed key',
        ownerId,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        `INSERT INTO autoseopilot_managed_sites (
           id, external_workspace_id, owner_user_id, workspace_id, site_id,
           credential_id, credential_generation, api_key_id, entitlement_status,
           entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        `entitlement-binding-${suffix}`,
        `entitlement-external-${suffix}`,
        ownerId,
        workspaceId,
        siteId,
        `entitlement-credential-${suffix}`,
        managedKeyId,
        managedStatus,
        options.managedExpiresAt ?? null,
        timestamp,
        timestamp,
        managedStatus === 'revoked' ? timestamp : null,
      ),
    )
  }

  await env.DB.batch(statements)
  return { workspaceId, siteId }
}

function appFor(seed: SeededSite): AppUserContext {
  return {
    workspaceId: seed.workspaceId,
    siteId: seed.siteId,
    user: {
      id: 'entitlement-dashboard-user',
      name: 'Entitlement dashboard user',
      email: 'dashboard@entitlement.example.test',
    },
    actor: {
      type: 'human',
      id: 'entitlement-dashboard-user',
      name: 'Entitlement dashboard user',
      role: 'owner',
    },
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

afterEach(() => {
  mutableEnv.APP_ENV = savedEnv.APP_ENV
  mutableEnv.SELF_HOSTED = savedEnv.SELF_HOSTED
  mutableEnv.API_USAGE_TEST_LIMIT = savedEnv.API_USAGE_TEST_LIMIT
  mutableEnv.CLOUDFLARE_ZONE_ID = savedEnv.CLOUDFLARE_ZONE_ID
  mutableEnv.CUSTOM_HOSTNAME_API_TOKEN = savedEnv.CUSTOM_HOSTNAME_API_TOKEN
  mutableEnv.CACHE_PURGE_API_TOKEN = savedEnv.CACHE_PURGE_API_TOKEN
  vi.restoreAllMocks()
})

describe('effective entitlement resolution', () => {
  it('distinguishes managed, expired, revoked, Polar, free, and self-hosted access', async () => {
    const managed = await seedSite('managed-active', {
      managedStatus: 'active',
      managedExpiresAt: NOW + 10,
    })
    const expired = await seedSite('managed-exact-expiry', {
      managedStatus: 'active',
      managedExpiresAt: NOW,
    })
    const revoked = await seedSite('managed-revoked', { managedStatus: 'revoked' })
    const polar = await seedSite('polar-active', { polarStatus: 'active' })
    const free = await seedSite('free')

    const managedEntitlement = await resolveEffectiveEntitlementForSite(managed.siteId, {
      selfHosted: false,
      now: NOW,
    })
    expect(managedEntitlement).toMatchObject({
      effective: true,
      access: 'hosted_paid',
      source: 'managed_sponsorship',
      rawPolarStatus: 'none',
      managedSponsorship: { active: true },
    })
    expect(billingStatusForCore(managedEntitlement)).toBe('active')

    for (const site of [expired, revoked, free]) {
      const entitlement = await resolveEffectiveEntitlementForSite(site.siteId, {
        selfHosted: false,
        now: NOW,
      })
      expect(entitlement.effective).toBe(false)
      expect(entitlement.access).toBe('hosted_free')
      expect(billingStatusForCore(entitlement)).toBe('none')
    }

    const polarEntitlement = await resolveEffectiveEntitlementForSite(polar.siteId, {
      selfHosted: false,
      now: NOW,
    })
    expect(polarEntitlement).toMatchObject({
      effective: true,
      source: 'polar',
      rawPolarStatus: 'active',
      managedSponsorship: { active: false },
    })
    expect(await getCoreBillingStatusForSite(polar.siteId, { selfHosted: false, now: NOW })).toBe('active')

    const selfHostedEntitlement = await resolveEffectiveEntitlementForSite(free.siteId, {
      selfHosted: true,
      now: NOW,
    })
    expect(selfHostedEntitlement).toMatchObject({
      effective: true,
      access: 'self_hosted',
      source: 'self_hosted',
      rawPolarStatus: 'none',
    })
    expect(await resolveEffectiveEntitlementForWorkspace(managed.workspaceId, { selfHosted: false, now: NOW }))
      .toMatchObject({ effective: true, source: 'managed_sponsorship' })
  })
})

describe('publishing and media paid gates', () => {
  it('keeps managed sponsorship and self-hosted drafts unlimited', async () => {
    const managed = await seedSite('draft-managed', { managedStatus: 'active' })
    const selfHosted = await seedSite('draft-self-hosted')
    const repo = createD1PostRepository(env.DB)
    for (const [site, hosted] of [[managed, false], [selfHosted, true]] as const) {
      const billingStatus = await getCoreBillingStatusForSite(site.siteId, { selfHosted: hosted, now: NOW })
      expect(billingStatus).toBe('active')
      for (let index = 0; index < 6; index++) {
        await expect(createPost(repo, fullActor, { siteId: site.siteId, title: `Draft ${index}`,
          slug: `draft-${index}`, contentMarkdown: '# Draft' }, billingStatus))
          .resolves.toMatchObject({ status: 'draft' })
      }
    }
  })
  it('passes managed sponsorship into the core publish boundary while preserving the free cap', async () => {
    const managed = await seedSite('publish-managed', { managedStatus: 'active' })
    const free = await seedSite('publish-free')
    const repo = createD1PostRepository(env.DB)
    const managedStatus = await getCoreBillingStatusForSite(managed.siteId, { selfHosted: false, now: NOW })

    const managedPost = await createPost(repo, fullActor, {
      siteId: managed.siteId,
      title: 'Managed publish',
      slug: 'managed-publish',
      contentMarkdown: '# Managed publish',
    })
    await expect(
      publishPost(repo, fullActor, {
        siteId: managed.siteId,
        postId: managedPost.id,
        expectedVersionNumber: managedPost.currentVersionNumber,
        billingStatus: managedStatus,
      }),
    ).resolves.toMatchObject({ status: 'published' })

    for (let index = 0; index < 5; index += 1) {
      const post = await createPost(repo, fullActor, {
        siteId: free.siteId,
        title: `Free publish ${index}`,
        slug: `free-publish-${index}`,
        contentMarkdown: `# Free publish ${index}`,
      }, 'none')
      await publishPost(repo, fullActor, {
        siteId: free.siteId,
        postId: post.id,
        expectedVersionNumber: post.currentVersionNumber,
        billingStatus: 'none',
      })
    }
    const sixth = await createPost(repo, fullActor, {
      siteId: free.siteId,
      title: 'Free publish 5',
      slug: 'free-publish-5',
      contentMarkdown: '# Free publish 5',
    }, 'none')
    await expect(
      publishPost(repo, fullActor, {
        siteId: free.siteId,
        postId: sixth.id,
        expectedVersionNumber: sixth.currentVersionNumber,
        billingStatus: 'none',
      }),
    ).rejects.toBeInstanceOf(BillingRequiredError)
  })

  it('allows media for managed/Polar access, skips self-hosted quota, and denies free access', async () => {
    const managed = await seedSite('media-managed', { managedStatus: 'active' })
    const polar = await seedSite('media-polar', { polarStatus: 'active' })
    const free = await seedSite('media-free')

    mutableEnv.SELF_HOSTED = 'false'
    await expect(assertMediaUploadAllowed(managed.siteId)).resolves.toMatchObject({ skipQuota: false })
    await expect(assertMediaUploadAllowed(polar.siteId)).resolves.toMatchObject({ skipQuota: false })
    await expect(assertMediaUploadAllowed(free.siteId)).resolves.toMatchObject({ quotaType: 'images', limit: 10 })

    mutableEnv.SELF_HOSTED = 'true'
    await expect(assertMediaUploadAllowed(free.siteId)).resolves.toEqual({ skipQuota: true, limit: 0 })
  })
})

describe('usage plan and budget gates', () => {
  it('keeps monthly paid caps above any month of daily guardrails', () => {
    expect(API_USAGE_LIMITS.paid.calls.month).toBe(API_USAGE_LIMITS.paid.calls.day * 31)
    expect(API_USAGE_LIMITS.paid.writes.month).toBe(API_USAGE_LIMITS.paid.writes.day * 31)
  })
  it('uses effective entitlement for paid/free limits and budget enforcement', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.APP_ENV = 'production'
    mutableEnv.API_USAGE_TEST_LIMIT = undefined

    const managed = await seedSite('usage-managed', { managedStatus: 'active' })
    const free = await seedSite('usage-free')
    const managedSummary = await getApiUsageSummary({
      workspaceId: managed.workspaceId,
      siteId: managed.siteId,
      tokenId: 'usage-managed-key',
    })
    const freeSummary = await getApiUsageSummary({
      workspaceId: free.workspaceId,
      siteId: free.siteId,
      tokenId: 'usage-free-key',
    })

    expect(managedSummary).toMatchObject({
      billingStatus: 'none',
      effective: true,
      access: 'hosted_paid',
      source: 'managed_sponsorship',
      calls: { day: { limit: API_USAGE_LIMITS.paid.calls.day } },
    })
    expect(freeSummary).toMatchObject({
      billingStatus: 'none',
      effective: false,
      access: 'hosted_free',
      source: 'none',
      calls: { day: { limit: API_USAGE_LIMITS.free.calls.day } },
    })

    const today = new Date().toISOString().slice(0, 10)
    await env.DB.prepare(
      `INSERT INTO usage_counters
         (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'calls', ?, ?, ?)`,
    )
      .bind(
        `workspace:${free.workspaceId}:calls:${today}`,
        free.workspaceId,
        today,
        API_USAGE_LIMITS.free.calls.day,
        NOW,
        NOW,
      )
      .run()
    await expect(
      enforceApiBudget({
        workspaceId: free.workspaceId,
        siteId: free.siteId,
        tokenId: 'usage-free-budget-key',
        kind: 'read',
      }),
    ).rejects.toBeInstanceOf(RateLimitError)

    await env.DB.prepare(
      `INSERT INTO usage_counters
         (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'calls', ?, ?, ?)`,
    )
      .bind(
        `workspace:${managed.workspaceId}:calls:${today}`,
        managed.workspaceId,
        today,
        API_USAGE_LIMITS.free.calls.day,
        NOW,
        NOW,
      )
      .run()
    await expect(
      enforceApiBudget({
        workspaceId: managed.workspaceId,
        siteId: managed.siteId,
        tokenId: 'usage-managed-budget-key',
        kind: 'read',
      }),
    ).resolves.toBeUndefined()
  })
})

describe('analytics and custom-domain gates', () => {
  it('opens analytics for managed sponsorship and locks expired/free sites', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    const managed = await seedSite('analytics-managed', { managedStatus: 'active' })
    const expired = await seedSite('analytics-expired', {
      managedStatus: 'active',
      managedExpiresAt: Math.floor(Date.now() / 1000) - 1,
    })
    const free = await seedSite('analytics-free')

    expect(await loadAnalyticsForApp(appFor(managed), 7)).toMatchObject({
      status: 'unavailable',
      reason: 'not_configured',
    })
    expect(await loadAnalyticsForApp(appFor(expired), 7)).toEqual({
      status: 'locked',
      retentionDays: 365,
    })
    expect(await loadAnalyticsForApp(appFor(free), 7)).toEqual({
      status: 'locked',
      retentionDays: 365,
    })

    mutableEnv.SELF_HOSTED = 'true'
    expect(await loadAnalyticsForApp(appFor(free), 7)).toEqual({
      status: 'unavailable',
      retentionDays: 365,
      reason: 'self_hosted',
    })
  })

  it('allows custom domains for managed access and denies expired sponsorship', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    const managed = await seedSite('domain-managed', { managedStatus: 'active' })
    const expired = await seedSite('domain-expired', {
      managedStatus: 'active',
      managedExpiresAt: Math.floor(Date.now() / 1000) - 1,
    })

    const added = await addCustomDomainForApp(appFor(managed), 'managed.example.test')
    expect(added).toMatchObject({ ok: true, domain: { hostname: 'managed.example.test' } })
    await expect(addCustomDomainForApp(appFor(expired), 'expired.example.test')).resolves.toEqual({
      ok: false,
      code: 'domain_billing',
    })
  })

  it('does not retry custom-hostname provisioning after sponsorship expires', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.CLOUDFLARE_ZONE_ID = 'zone-entitlement-test'
    mutableEnv.CUSTOM_HOSTNAME_API_TOKEN = 'credential-placeholder'
    const expired = await seedSite('domain-retry-expired', {
      managedStatus: 'active',
      managedExpiresAt: Math.floor(Date.now() / 1000) - 1,
    })
    await env.DB.prepare(
      `INSERT INTO domains (
         id, site_id, hostname, type, status, cloudflare_custom_hostname_id,
         verification_errors_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'custom', 'pending', NULL, NULL, ?, ?)`,
    )
      .bind(
        'entitlement-domain-retry-expired',
        expired.siteId,
        'retry-expired.example.test',
        NOW,
        NOW,
      )
      .run()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: true,
        result: {
          id: 'provider-host-placeholder',
          hostname: 'retry-expired.example.test',
          status: 'pending',
          ssl: { status: 'pending_validation' },
        },
      }),
    )

    const panel = await listCustomDomainsForApp(appFor(expired))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(panel.domains).toContainEqual(
      expect.objectContaining({
        hostname: 'retry-expired.example.test',
        status: 'pending',
      }),
    )
  })

  it('selects active managed and Polar sites for rollup, excluding expired, revoked, and free sites', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    const managed = await seedSite('rollup-managed', { managedStatus: 'active' })
    const polar = await seedSite('rollup-polar', { polarStatus: 'active' })
    const expired = await seedSite('rollup-expired', {
      managedStatus: 'active',
      managedExpiresAt: Math.floor(Date.now() / 1000) - 1,
    })
    const revoked = await seedSite('rollup-revoked', { managedStatus: 'revoked' })
    const free = await seedSite('rollup-free')

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    const result = await runAnalyticsRollup(
      {
        ...env,
        SELF_HOSTED: 'false',
        ANALYTICS_ACCOUNT_ID: 'account',
        ANALYTICS_DATASET: 'dataset',
        ANALYTICS_API_TOKEN: 'x',
        CLOUDFLARE_ZONE_ID: undefined,
      } as typeof env,
      fetcher,
    )

    expect(result.sites).toBeGreaterThanOrEqual(2)
    const rollupState = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM analytics_rollup_state WHERE site_id = ?')
      .bind(managed.siteId)
      .first<{ count: number }>()
    const polarRollupState = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM analytics_rollup_state WHERE site_id = ?')
      .bind(polar.siteId)
      .first<{ count: number }>()
    expect(rollupState?.count).toBeGreaterThan(0)
    expect(polarRollupState?.count).toBeGreaterThan(0)
    for (const site of [expired, revoked, free]) {
      const excludedState = await env.DB
        .prepare('SELECT COUNT(*) AS count FROM analytics_rollup_state WHERE site_id = ?')
        .bind(site.siteId)
        .first<{ count: number }>()
      expect(excludedState?.count).toBe(0)
    }
    expect((await createDataAccess(env.DB).managedSites.resolveSite(managed.siteId, {
      selfHosted: false,
      now: Math.floor(Date.now() / 1000),
    }))?.effective).toBe(true)
    expect((await createDataAccess(env.DB).managedSites.resolveSite(polar.siteId, {
      selfHosted: false,
      now: Math.floor(Date.now() / 1000),
    }))?.effective).toBe(true)
  })
})

describe('managed entitlement cache invalidation', () => {
  it('purges site, article, custom-host, robots, feed, sitemap, and llms cache keys', async () => {
    mutableEnv.CLOUDFLARE_ZONE_ID = undefined
    mutableEnv.CACHE_PURGE_API_TOKEN = undefined
    const managed = await seedSite('cache-purge-managed', { managedStatus: 'active' })
    const repo = createD1PostRepository(env.DB)
    const post = await createPost(repo, fullActor, {
      siteId: managed.siteId,
      title: 'Cache purge post',
      slug: 'cache-purge-post',
      contentMarkdown: '# Cache purge post',
    })
    await publishPost(repo, fullActor, {
      siteId: managed.siteId,
      postId: post.id,
      expectedVersionNumber: post.currentVersionNumber,
      billingStatus: 'active',
    })
    const customHost = 'cache-purge-managed.example.test'
    await env.DB.prepare(
      `INSERT INTO domains (
         id, site_id, hostname, type, status, created_at, updated_at
       ) VALUES (?, ?, ?, 'custom', 'active', ?, ?)`,
    )
      .bind('entitlement-domain-cache-purge', managed.siteId, customHost, NOW, NOW)
      .run()

    const siteSlug = 'site-cache-purge-managed'
    const urls = [
      ...siteCacheUrls(siteSlug),
      ...articleCacheUrls(siteSlug, post.slug),
      ...hostnameCacheUrls(customHost),
      ...articleCacheUrlsForHost(customHost, post.slug),
    ]
    const cache = (caches as CacheStorage & { default: Cache }).default
    for (const url of urls) {
      await cache.put(
        new Request(url),
        new Response('stale', {
          headers: { 'cache-control': 'public, max-age=60' },
        }),
      )
    }

    const tasks: Promise<unknown>[] = []
    runWithExecutionContext(
      {
        waitUntil(task: Promise<unknown>) {
          tasks.push(task)
        },
      } as unknown as ExecutionContext,
      () => scheduleManagedSitePurge(env.DB, managed.siteId, siteSlug),
    )
    await Promise.all(tasks)

    for (const url of urls) {
      expect(await cache.match(new Request(url))).toBeUndefined()
    }
  })
})

describe('managed API key ownership boundary', () => {
  it('keeps the current AutoSEOPilot key out of dashboard token management', async () => {
    const managed = await seedSite('managed-key-dashboard', {
      managedStatus: 'active',
    })
    const app = appFor(managed)
    const managedKeyId = 'entitlement-key-managed-key-dashboard'

    expect(await listApiKeys(app)).toEqual([])
    await expect(revokeApiKeyForApp(app, managedKeyId)).resolves.toEqual({
      kind: 'error',
      code: 'managed_key',
    })
    expect(
      await env.DB.prepare('SELECT revoked_at FROM api_keys WHERE id = ?')
        .bind(managedKeyId)
        .first<{ revoked_at: number | null }>(),
    ).toMatchObject({ revoked_at: null })
  })
})

describe('past_due grace through real entitlement paths', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  // Non-zero millisecond start so the deadline never lands on a whole second.
  const SINCE = NOW * 1000 - 2 * DAY_MS + 321
  const DEADLINE = SINCE + PAST_DUE_GRACE_DAYS * DAY_MS
  // Pins the clock every default-clock seam reads (Date.now() / 1000, unfloored).
  const clockAt = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(ms)
  const graceSite = (suffix: string, pastDueSince: number | null = SINCE) =>
    seedSite(suffix, { polarStatus: 'past_due', pastDueSince })

  it('is paid strictly before the millisecond deadline and maps to synthetic active only then', async () => {
    const grace = await graceSite('grace-resolve')
    const unknown = await graceSite('grace-unknown-start', null)

    for (const ms of [SINCE, DEADLINE - 1]) {
      // Injected fractional seconds and the default clock agree.
      const injected = await resolveEffectiveEntitlementForSite(grace.siteId, { selfHosted: false, now: ms / 1000 })
      clockAt(ms)
      const defaulted = await resolveEffectiveEntitlementForWorkspace(grace.workspaceId, { selfHosted: false })
      for (const entitlement of [injected, defaulted]) {
        expect(entitlement).toMatchObject({
          effective: true,
          access: 'hosted_paid',
          source: 'polar',
          rawPolarStatus: 'past_due',
          effectiveUntil: DEADLINE / 1000,
          polar: { status: 'past_due', active: true, pastDueSince: SINCE, graceEndsAt: DEADLINE },
        })
        expect(billingStatusForCore(entitlement)).toBe('active')
      }
      expect(await getCoreBillingStatusForSite(grace.siteId, { selfHosted: false })).toBe('active')
    }

    for (const ms of [DEADLINE, DEADLINE + 1, DEADLINE + 999]) {
      clockAt(ms)
      const entitlement = await resolveEffectiveEntitlementForSite(grace.siteId, { selfHosted: false })
      expect(entitlement).toMatchObject({
        effective: false,
        access: 'hosted_free',
        source: 'none',
        rawPolarStatus: 'past_due',
        polar: { active: false, graceEndsAt: DEADLINE },
      })
      expect(billingStatusForCore(entitlement)).toBe('past_due')
    }

    clockAt(SINCE)
    expect(await resolveEffectiveEntitlementForSite(unknown.siteId, { selfHosted: false })).toMatchObject({
      effective: false,
      access: 'hosted_free',
      rawPolarStatus: 'past_due',
      polar: { active: false, pastDueSince: null, graceEndsAt: null },
    })
  })

  it('lifts the draft and publish caps within grace and restores them at the deadline', async () => {
    const site = await graceSite('grace-caps')
    const repo = createD1PostRepository(env.DB)
    const draft = (index: number) => ({
      siteId: site.siteId,
      title: `Grace draft ${index}`,
      slug: `grace-draft-${index}`,
      contentMarkdown: '# Grace draft',
    })

    clockAt(DEADLINE)
    const drafts = []
    for (let index = 0; index < 5; index += 1) {
      drafts.push(await createPost(repo, fullActor, draft(index), await getCoreBillingStatusForSite(site.siteId)))
    }
    await expect(createPost(repo, fullActor, draft(5), await getCoreBillingStatusForSite(site.siteId)))
      .rejects.toBeInstanceOf(BillingRequiredError)

    clockAt(DEADLINE - 1)
    const sixth = await createPost(repo, fullActor, draft(5), await getCoreBillingStatusForSite(site.siteId))
    expect(sixth.status).toBe('draft')

    // Publish cap: five live posts at the deadline, a sixth only within grace.
    clockAt(DEADLINE)
    for (const post of drafts) {
      await publishPost(repo, fullActor, {
        siteId: site.siteId,
        postId: post.id,
        expectedVersionNumber: post.currentVersionNumber,
        billingStatus: await getCoreBillingStatusForSite(site.siteId),
      })
    }
    await expect(publishPost(repo, fullActor, {
      siteId: site.siteId,
      postId: sixth.id,
      expectedVersionNumber: sixth.currentVersionNumber,
      billingStatus: await getCoreBillingStatusForSite(site.siteId),
    })).rejects.toBeInstanceOf(BillingRequiredError)

    clockAt(DEADLINE - 1)
    await expect(publishPost(repo, fullActor, {
      siteId: site.siteId,
      postId: sixth.id,
      expectedVersionNumber: sixth.currentVersionNumber,
      billingStatus: await getCoreBillingStatusForSite(site.siteId),
    })).resolves.toMatchObject({ status: 'published' })
  })

  it('applies paid API quotas within grace and free quotas from the deadline', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.APP_ENV = 'production'
    mutableEnv.API_USAGE_TEST_LIMIT = undefined
    const site = await graceSite('grace-usage')
    const summary = () => getApiUsageSummary({ workspaceId: site.workspaceId, siteId: site.siteId, tokenId: 'grace-usage-key' })

    clockAt(DEADLINE - 1)
    expect(await summary()).toMatchObject({
      billingStatus: 'past_due',
      polarStatus: 'past_due',
      effective: true,
      access: 'hosted_paid',
      source: 'polar',
      calls: { day: { limit: API_USAGE_LIMITS.paid.calls.day }, month: { limit: API_USAGE_LIMITS.paid.calls.month } },
      writes: { day: { limit: API_USAGE_LIMITS.paid.writes.day }, month: { limit: API_USAGE_LIMITS.paid.writes.month } },
    })
    clockAt(DEADLINE)
    expect(await summary()).toMatchObject({
      billingStatus: 'past_due',
      effective: false,
      access: 'hosted_free',
      source: 'none',
      calls: { day: { limit: API_USAGE_LIMITS.free.calls.day }, month: { limit: API_USAGE_LIMITS.free.calls.month } },
      writes: { day: { limit: API_USAGE_LIMITS.free.writes.day }, month: { limit: API_USAGE_LIMITS.free.writes.month } },
    })

    // Counter period ids follow the real calendar day (`new Date()`), not the pinned clock.
    const today = new Date().toISOString().slice(0, 10)
    await env.DB.prepare(
      `INSERT INTO usage_counters
         (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'calls', ?, ?, ?)`,
    )
      .bind(`workspace:${site.workspaceId}:calls:${today}`, site.workspaceId, today, API_USAGE_LIMITS.free.calls.day, NOW, NOW)
      .run()
    const budget = () => enforceApiBudget({ workspaceId: site.workspaceId, siteId: site.siteId, tokenId: 'grace-budget-key', kind: 'read' })
    clockAt(DEADLINE - 1)
    await expect(budget()).resolves.toBeUndefined()
    clockAt(DEADLINE)
    await expect(budget()).rejects.toBeInstanceOf(RateLimitError)
  })

  it('gates media, custom domains, and analytics on the same deadline', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    const site = await graceSite('grace-gates')

    clockAt(DEADLINE - 1)
    await expect(assertMediaUploadAllowed(site.siteId)).resolves.toMatchObject({ skipQuota: false, quotaType: 'bytes' })
    await expect(addCustomDomainForApp(appFor(site), 'grace-within.example.test'))
      .resolves.toMatchObject({ ok: true, domain: { hostname: 'grace-within.example.test' } })
    expect(await loadAnalyticsForApp(appFor(site), 7)).toMatchObject({ status: 'unavailable', reason: 'not_configured' })

    clockAt(DEADLINE)
    await expect(assertMediaUploadAllowed(site.siteId)).resolves.toMatchObject({ quotaType: 'images', limit: 10 })
    await expect(addCustomDomainForApp(appFor(site), 'grace-expired.example.test'))
      .resolves.toEqual({ ok: false, code: 'domain_billing' })
    expect(await loadAnalyticsForApp(appFor(site), 7)).toEqual({ status: 'locked', retentionDays: 365 })
  })

  it('rolls up analytics for a site within grace and skips one at its exact deadline', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    const clock = NOW * 1000 + 654
    const within = await graceSite('grace-rollup-within', clock - DAY_MS)
    const expired = await graceSite('grace-rollup-expired', clock - PAST_DUE_GRACE_DAYS * DAY_MS)
    clockAt(clock)

    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })
    await runAnalyticsRollup(
      {
        ...env,
        SELF_HOSTED: 'false',
        ANALYTICS_ACCOUNT_ID: 'account',
        ANALYTICS_DATASET: 'dataset',
        ANALYTICS_API_TOKEN: 'x',
        CLOUDFLARE_ZONE_ID: undefined,
      } as typeof env,
      fetcher,
    )

    const rolled = async (siteId: string) =>
      (await env.DB.prepare('SELECT COUNT(*) AS count FROM analytics_rollup_state WHERE site_id = ?')
        .bind(siteId)
        .first<{ count: number }>())?.count
    expect(await rolled(within.siteId)).toBeGreaterThan(0)
    expect(await rolled(expired.siteId)).toBe(0)
  })
})
