/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module 'vitest' {
  interface ProvidedContext {
    migrations: import('cloudflare:test').D1Migration[]
  }
}

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, afterEach, describe, expect, inject, it } from 'vitest'
import { createDataAccess } from '@vc/db'
import { agentRollupValues, loadAnalyticsForApp } from './analytics'
import { runAnalyticsRollup } from './analytics-rollup'
import type { AppUserContext } from './onboarding'

const T = 1_800_000_000
const mutableEnv = env as unknown as Record<string, unknown>
const savedEnv = {
  SELF_HOSTED: mutableEnv.SELF_HOSTED,
  ANALYTICS_ACCOUNT_ID: mutableEnv.ANALYTICS_ACCOUNT_ID,
  ANALYTICS_DATASET: mutableEnv.ANALYTICS_DATASET,
  ANALYTICS_API_TOKEN: mutableEnv.ANALYTICS_API_TOKEN,
}

type Seed = { workspaceId: string; siteId: string }

async function seedSite(suffix: string, options: { paid?: boolean } = {}): Promise<Seed> {
  const workspaceId = `agents-ws-${suffix}`
  const siteId = `agents-site-${suffix}`
  const timestamp = T - 100
  const statements = [
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(workspaceId, `Agents ${suffix}`, `agents-${suffix}`, timestamp, timestamp),
    env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
      .bind(siteId, workspaceId, `Agents ${suffix}`, `agents-${suffix}`, timestamp, timestamp),
  ]
  if (options.paid !== false) {
    statements.push(
      env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
        .bind(`agents-billing-${suffix}`, workspaceId, timestamp, timestamp),
    )
  }
  await env.DB.batch(statements)
  return { workspaceId, siteId }
}

async function seedPost(siteId: string, suffix: string): Promise<string> {
  const postId = `agents-post-${suffix}`
  const versionId = crypto.randomUUID()
  const columns = 'id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at'
  await env.DB.prepare(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'agents-test', 'api_key', 'agents-test', ?, ?)`)
    .bind(postId, siteId, `Post ${suffix}`, suffix, '# Post', T - 100, T - 100, T - 100).run()
  await env.DB.prepare(
    "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'agents-test', 'seed', ?)",
  ).bind(versionId, postId, siteId, `Post ${suffix}`, suffix, '# Post', T - 100).run()
  await env.DB.prepare('UPDATE posts SET published_version_id = ? WHERE id = ?').bind(versionId, postId).run()
  return postId
}

function appFor(seed: Seed): AppUserContext {
  return {
    workspaceId: seed.workspaceId,
    siteId: seed.siteId,
    user: { id: 'agents-user', name: 'Agents user', email: 'agents@example.test' },
    actor: { type: 'human', id: 'agents-user', name: 'Agents user', role: 'owner' },
  }
}

/** AE mock: { data: rows } for every query; the body tells page_view from agent_fetch. */
function aeFetcher(rows: { page_view?: unknown[]; agent_fetch?: unknown[] }) {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    const data = body.includes("'agent_fetch'") ? (rows.agent_fetch ?? []) : (rows.page_view ?? [])
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

function configureAnalytics() {
  mutableEnv.SELF_HOSTED = 'false'
  mutableEnv.ANALYTICS_ACCOUNT_ID = 'account'
  mutableEnv.ANALYTICS_DATASET = 'dataset'
  mutableEnv.ANALYTICS_API_TOKEN = 'token'
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

afterEach(() => {
  mutableEnv.SELF_HOSTED = savedEnv.SELF_HOSTED
  mutableEnv.ANALYTICS_ACCOUNT_ID = savedEnv.ANALYTICS_ACCOUNT_ID
  mutableEnv.ANALYTICS_DATASET = savedEnv.ANALYTICS_DATASET
  mutableEnv.ANALYTICS_API_TOKEN = savedEnv.ANALYTICS_API_TOKEN
})

describe('agentFetch rollup values', () => {
  it('aggregates source rows into the four kinds plus repr/signed resources', () => {
    const values = agentRollupValues([
      { date: '2026-10-10', post_id: 'p1', resource: 'post', agent_id: 'GPTBot', category: 'ai-training', representation: 'markdown', signed: '1', fetches: 3 },
      { date: '2026-10-10', post_id: '', resource: 'llms', agent_id: 'unknown', category: 'unknown-agent', representation: 'text', signed: '', fetches: 2 },
      { date: '2026-10-10', post_id: 'p1', resource: 'post', agent_id: 'GPTBot', category: 'ai-training', representation: 'html', signed: '', fetches: 1 },
    ])
    const byKind = (kind: string) => values.filter((value) => value.kind === kind)
    expect(byKind('agent')).toEqual([
      { kind: 'agent', dimension: 'GPTBot', label: 'GPTBot', value: 4 },
      { kind: 'agent', dimension: 'unknown', label: 'Unknown', value: 2 },
    ])
    expect(byKind('agent_category')).toEqual([
      { kind: 'agent_category', dimension: 'ai-training', label: null, value: 4 },
      { kind: 'agent_category', dimension: 'unknown-agent', label: null, value: 2 },
    ])
    expect(byKind('agent_post')).toEqual([{ kind: 'agent_post', dimension: 'p1', label: null, value: 4 }])
    expect(byKind('agent_resource')).toEqual(expect.arrayContaining([
      { kind: 'agent_resource', dimension: 'post', label: null, value: 4 },
      { kind: 'agent_resource', dimension: 'llms', label: null, value: 2 },
      { kind: 'agent_resource', dimension: 'repr_markdown', label: null, value: 3 },
      { kind: 'agent_resource', dimension: 'repr_html', label: null, value: 1 },
      { kind: 'agent_resource', dimension: 'repr_text', label: null, value: 2 },
      { kind: 'agent_resource', dimension: 'signed', label: null, value: 3 },
    ]))
  })
})

describe('loadAnalyticsForApp agents section', () => {
  it('returns agent aggregates from source and stored rows', async () => {
    configureAnalytics()
    const seed = await seedSite('loader')
    const postId = await seedPost(seed.siteId, 'agents-loader-post')
    const data = createDataAccess(env.DB)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    await data.analytics.replaceDaily(seed.siteId, yesterday, [
      { kind: 'post', dimension: postId, label: 'agents-loader-post', value: 9 },
      { kind: 'page', dimension: '', label: null, value: 9 },
      { kind: 'agent', dimension: 'GPTBot', label: 'GPTBot', value: 4 },
      { kind: 'agent_category', dimension: 'ai-training', label: null, value: 4 },
      { kind: 'agent_post', dimension: postId, label: null, value: 4 },
      { kind: 'agent_resource', dimension: 'post', label: null, value: 4 },
      { kind: 'agent_resource', dimension: 'repr_markdown', label: null, value: 2 },
      // Rollout-overlap day: agent rows exist, so this crawler row must not
      // count toward series or the legacy totals.
      { kind: 'crawler', dimension: 'Bytespider', label: 'ByteDance', value: 99 },
    ])
    await data.analytics.replaceDaily(seed.siteId, threeDaysAgo, [
      { kind: 'crawler', dimension: 'ClaudeBot', label: 'Anthropic', value: 7 },
    ])

    const result = await loadAnalyticsForApp(appFor(seed), 7, {
      fetcher: aeFetcher({
        page_view: [{ date: '2099-01-01', post_id: postId, post_slug: 'x', referrer: 'chatgpt.com', views: 5 }],
        agent_fetch: [
          { date: '2099-01-01', post_id: postId, resource: 'post', agent_id: 'ChatGPT-User', category: 'ai-assistant', representation: 'markdown', signed: '1', fetches: 6 },
          { date: '2099-01-01', post_id: '', resource: 'llms', agent_id: 'unknown', category: 'unknown-agent', representation: 'text', signed: '', fetches: 2 },
        ],
      }),
    })

    if (result.status !== 'available') throw new Error(`expected available, got ${JSON.stringify(result)}`)
    expect(result.views).toBe(14)
    expect(result.agents).toMatchObject({
      total: 12,
      llmsReads: 2,
      markdownShare: 67,
      signedShare: 50,
    })
    expect(result.agents.byCategory).toEqual(expect.arrayContaining([
      { category: 'ai-training', fetches: 4 },
      { category: 'ai-assistant', fetches: 6 },
      { category: 'unknown-agent', fetches: 2 },
    ]))
    expect(result.agents.topAgents[0]).toMatchObject({ id: 'ChatGPT-User', operator: 'OpenAI', fetches: 6 })
    expect(result.agents.topPosts[0]).toMatchObject({ postId, fetches: 10 })
    // Legacy zone-GraphQL rows stay readable only on days without agent data;
    // the same-day Bytespider row is excluded (no double counting).
    expect(result.aiCrawlers.agents).toEqual([
      { agent: 'ClaudeBot', operator: 'Anthropic', category: 'AI crawler', requests: 7 },
    ])
    const byDate = Object.fromEntries(result.series.map((point) => [point.date, point.aiCrawlerRequests]))
    expect(byDate[yesterday]).toBe(4) // agent rows only — not 4+99
    expect(byDate[threeDaysAgo]).toBe(7) // crawler-only day falls back
  })

  it('rejects a postId that could escape the Analytics Engine SQL string before any query', async () => {
    const seed = await seedSite('inject', { paid: true })
    let queried = false
    const fetcher = (async () => {
      queried = true
      return new Response(JSON.stringify({ data: [] }))
    }) as unknown as typeof fetch
    for (const postId of ["\\' OR 1=1 --", "x' OR index1 != '", 'has space']) {
      await expect(loadAnalyticsForApp(appFor(seed), 7, { fetcher, postId })).rejects.toThrow('postId is not a valid post id.')
    }
    expect(queried).toBe(false)
  })

  it('scopes per-post numbers with postId and empties site-grain sections', async () => {
    configureAnalytics()
    const seed = await seedSite('scoped')
    const postId = await seedPost(seed.siteId, 'agents-scoped-post')
    const otherId = await seedPost(seed.siteId, 'agents-scoped-other')
    const data = createDataAccess(env.DB)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await data.analytics.replaceDaily(seed.siteId, yesterday, [
      { kind: 'page', dimension: '', label: null, value: 30 },
      { kind: 'post', dimension: postId, label: 'agents-scoped-post', value: 20 },
      { kind: 'post', dimension: otherId, label: 'agents-scoped-other', value: 10 },
      { kind: 'referrer', dimension: 'chatgpt.com', label: null, value: 4 },
      { kind: 'agent_post', dimension: postId, label: null, value: 3 },
      { kind: 'agent_post', dimension: otherId, label: null, value: 8 },
      { kind: 'agent', dimension: 'GPTBot', label: 'GPTBot', value: 11 },
    ])

    const scoped = await loadAnalyticsForApp(appFor(seed), 7, { postId, fetcher: aeFetcher({}) })
    if (scoped.status !== 'available') throw new Error('expected available')
    expect(scoped.views).toBe(20)
    expect(scoped.topPosts).toEqual([{ postId, slug: 'agents-scoped-post', title: 'Post agents-scoped-post', views: 20 }])
    expect(scoped.referrers).toEqual([])
    expect(scoped.aiReferralViews).toBe(0)
    expect(scoped.agents.total).toBe(3)
    expect(scoped.agents.topPosts).toEqual([{ postId, slug: 'agents-scoped-post', title: 'Post agents-scoped-post', fetches: 3 }])
    expect(scoped.agents.byCategory).toEqual([])
    expect(scoped.agents.topAgents).toEqual([])

    const unscoped = await loadAnalyticsForApp(appFor(seed), 7, { fetcher: aeFetcher({}) })
    if (unscoped.status !== 'available') throw new Error('expected available')
    expect(unscoped.views).toBe(30)
    expect(unscoped.referrers).toHaveLength(1)
    expect(unscoped.agents.total).toBe(11)
  })

  it('keeps paid gating and reports self-host as unconfigured without AE credentials', async () => {
    mutableEnv.SELF_HOSTED = 'false'
    mutableEnv.ANALYTICS_ACCOUNT_ID = undefined
    mutableEnv.ANALYTICS_DATASET = undefined
    mutableEnv.ANALYTICS_API_TOKEN = undefined
    const free = await seedSite('agents-free', { paid: false })
    expect(await loadAnalyticsForApp(appFor(free), 7)).toEqual({ status: 'locked', retentionDays: 365 })

    // Self-host with no AE config: unavailable/self_hosted, entitlement skipped.
    mutableEnv.SELF_HOSTED = 'true'
    expect(await loadAnalyticsForApp(appFor(free), 7)).toEqual({
      status: 'unavailable', retentionDays: 365, reason: 'self_hosted',
    })

    // Self-host configured: the section loads without a paid entitlement.
    configureAnalytics()
    mutableEnv.SELF_HOSTED = 'true'
    const hosted = await loadAnalyticsForApp(appFor(free), 7, { fetcher: aeFetcher({}) })
    expect(hosted.status).toBe('available')
    if (hosted.status === 'available') expect(hosted.agents.total).toBe(0)
  })
})

describe('runAnalyticsRollup agent kinds', () => {
  it('writes agent kinds from agent_fetch and carries crawler rows forward only without agent data', async () => {
    const seed = await seedSite('rollup')
    const postId = await seedPost(seed.siteId, 'agents-rollup-post')
    const data = createDataAccess(env.DB)
    // Prime two pre-023 days inside the overlap re-roll window: one gains
    // agent data (crawler row must drop), one stays legacy (must survive).
    const lastRolled = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    const dayBefore = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    await data.analytics.replaceDaily(seed.siteId, lastRolled, [
      { kind: 'page', dimension: '', label: null, value: 1 },
      { kind: 'crawler', dimension: 'ClaudeBot', label: 'Anthropic', value: 7 },
    ])
    await data.analytics.replaceDaily(seed.siteId, dayBefore, [
      { kind: 'page', dimension: '', label: null, value: 2 },
      { kind: 'crawler', dimension: 'GPTBot', label: 'OpenAI', value: 3 },
    ])

    const result = await runAnalyticsRollup(
      {
        ...env,
        SELF_HOSTED: 'false',
        PUBLIC_BLOG_DOMAIN: 'example.test',
        ANALYTICS_ACCOUNT_ID: 'account',
        ANALYTICS_DATASET: 'dataset',
        ANALYTICS_API_TOKEN: 'token',
      } as typeof env,
      aeFetcher({
        page_view: [],
        agent_fetch: [
          { date: lastRolled, post_id: postId, resource: 'post', agent_id: 'GPTBot', category: 'ai-training', representation: 'markdown', signed: '1', fetches: 5 },
          { date: lastRolled, post_id: '', resource: 'feed', agent_id: 'Googlebot', category: 'search-engine', representation: 'xml', signed: '', fetches: 2 },
        ],
      }),
    )
    expect(result.sites).toBeGreaterThanOrEqual(1)

    const rows = await data.analytics.listDaily(seed.siteId, lastRolled, lastRolled)
    const kinds = new Map(rows.map((row) => [`${row.kind}:${row.dimension}`, row]))
    expect(kinds.get('agent:GPTBot')).toMatchObject({ value: 5 })
    expect(kinds.get('agent:Googlebot')).toMatchObject({ value: 2 })
    expect(kinds.get('agent_category:search-engine')).toMatchObject({ value: 2 })
    expect(kinds.get('agent_post:' + postId)).toMatchObject({ value: 5 })
    expect(kinds.get('agent_resource:feed')).toMatchObject({ value: 2 })
    expect(kinds.get('agent_resource:repr_markdown')).toMatchObject({ value: 5 })
    expect(kinds.get('agent_resource:signed')).toMatchObject({ value: 5 })
    // Agent data landed on this day → the carried crawler row is dropped to
    // avoid double-counting the rollout overlap.
    expect(kinds.has('crawler:ClaudeBot')).toBe(false)

    // The crawler-only day keeps its legacy rows untouched.
    const legacyRows = await data.analytics.listDaily(seed.siteId, dayBefore, dayBefore)
    const legacyKinds = new Map(legacyRows.map((row) => [`${row.kind}:${row.dimension}`, row]))
    expect(legacyKinds.get('crawler:GPTBot')).toMatchObject({ value: 3 })
  })
})

describe('runAnalyticsRollup self-host', () => {
  const rollupEnv = (selfHosted: string, configured: boolean) =>
    ({
      ...env,
      SELF_HOSTED: selfHosted,
      PUBLIC_BLOG_DOMAIN: 'example.test',
      ANALYTICS_ACCOUNT_ID: configured ? 'account' : undefined,
      ANALYTICS_DATASET: configured ? 'dataset' : undefined,
      ANALYTICS_API_TOKEN: configured ? 'token' : undefined,
    }) as typeof env

  it('processes self-hosted sites only when the analytics env is configured', async () => {
    const seed = await seedSite('selfhost-rollup')
    const data = createDataAccess(env.DB)

    // Unconfigured self-host: nothing runs, today's behaviour.
    const skipped = await runAnalyticsRollup(
      rollupEnv('true', false),
      aeFetcher({ page_view: [{ date: '2026-10-10', post_id: '', post_slug: '', referrer: '', views: 3 }] }),
    )
    expect(skipped).toEqual({ sites: 0, compactedMonths: 0 })
    expect(await data.analytics.listDaily(seed.siteId, '2026-10-10', '2026-10-10')).toEqual([])

    // Configured self-host: always entitled, page_view rows roll up.
    const result = await runAnalyticsRollup(
      rollupEnv('true', true),
      aeFetcher({
        page_view: [{ date: '2026-10-10', post_id: '', post_slug: '', referrer: '', views: 3 }],
        agent_fetch: [{ date: '2026-10-10', post_id: '', resource: 'llms', agent_id: 'GPTBot', category: 'ai-training', representation: 'text', signed: '', fetches: 2 }],
      }),
    )
    expect(result.sites).toBeGreaterThanOrEqual(1)
    const rows = await data.analytics.listDaily(seed.siteId, '2026-10-10', '2026-10-10')
    const kinds = new Map(rows.map((row) => [`${row.kind}:${row.dimension}`, row]))
    expect(kinds.get('page:')).toMatchObject({ value: 3 })
    expect(kinds.get('agent:GPTBot')).toMatchObject({ value: 2 })
  })
})
