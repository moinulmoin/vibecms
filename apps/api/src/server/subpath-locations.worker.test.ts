/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Plan 022 phase 3a: the subpath setup check, app-level location operations,
 * the daily re-check, and the managed API's location routes — all against real
 * miniflare D1 with `fetch` stubbed (the probe is the only outbound call).
 */
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { proxyFingerprint } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { checkSubpathSetup } from '@/server/subpath-setup'
import { apiUsageKind } from '@/server/mcp'
import {
  checkSubpathLocationForApp,
  getSiteLocationForApp,
  removeSubpathLocationForApp,
  rotateSubpathProxyLinkForApp,
  setSubpathLocationForApp,
} from '@/server/subpath-locations'
import { recheckActiveSubpathLocations } from '@/server/subpath-recheck'
import { runWithExecutionContext } from '@/server/execution-scope'
import { dispatchOperation } from '@/server/mcp-dispatch'
import type { OperationContext } from '@/server/operations'
import type { AppUserContext } from '@/server/onboarding'
import type { Actor } from '@vc/core'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const T = 1_700_000_000
const WS = 'ws-sloc'
const SITE = 'site-sloc'
const SLUG = 'sloc'
const FREE_SITE = 'site-sloc-free'
const WS2 = 'ws-sloc-2'
const SITE2 = 'site-sloc-2'

const ownerActor: Actor = { type: 'human', id: 'user-sloc-owner', name: 'Owner', role: 'owner' }
const editorActor: Actor = { type: 'human', id: 'user-sloc-editor', name: 'Editor', role: 'editor' }
const manageKeyActor: Actor = { type: 'api_key', id: 'key-sloc', name: 'Manage key', scopes: ['site:write'] }
const readKeyActor: Actor = { type: 'api_key', id: 'key-sloc-read', name: 'Read key', scopes: ['sites:read'] }

function appFor(actor: Actor, siteId = SITE, workspaceId = WS): AppUserContext {
  return {
    user: { id: actor.id, name: actor.name, email: `${actor.id}@test` } as AppUserContext['user'],
    siteId,
    workspaceId,
    actor,
  }
}

function opCtx(actor: Actor): OperationContext {
  return { actor, siteId: SITE, workspaceId: WS, tokenId: actor.id }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Route probe URLs: health, the mounted index, and root robots.txt. */
function proxyFetch(behavior: {
  health?: Response | 'throw'
  page?: Response | 'throw'
  robots?: Response | 'throw'
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/_vc/health')) {
      if (behavior.health === 'throw' || behavior.health === undefined) throw new Error('network down')
      return behavior.health
    }
    if (url.endsWith('/robots.txt')) {
      if (behavior.robots === 'throw' || behavior.robots === undefined) throw new Error('network down')
      return behavior.robots
    }
    if (behavior.page === 'throw' || behavior.page === undefined) throw new Error('network down')
    return behavior.page
  })
}

async function healthBody(siteId = SITE, proxyId: string | null = null) {
  return { ok: true, siteId, proxyFingerprint: proxyId === null ? null : await proxyFingerprint(proxyId) }
}

async function seedSubpath(status: 'pending' | 'active' | 'failed' = 'pending') {
  const repo = createDataAccess(env.DB).domains
  const record = await repo.insertSubpath({ siteId: SITE, hostname: 'customer.sloc.test', basePath: '/blog' })
  if (status !== 'pending') await repo.setSubpathStatus(record.id, SITE, status)
  return record
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run()
  await exec('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', WS, 'Sloc', WS, T, T)
  await exec('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'ws-sloc-free', 'Free', 'ws-sloc-free', T, T)
  await exec('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', SITE, WS, 'Sloc Blog', SLUG, T, T)
  await exec('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', FREE_SITE, 'ws-sloc-free', 'Free Blog', 'sloc-free', T, T)
  await exec('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', WS2, 'Sloc 2', WS2, T, T)
  await exec('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', SITE2, WS2, 'Sloc Blog 2', 'sloc-2', T, T)
  await exec("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)", 'bc-sloc-2', WS2, T, T)
  await exec("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)", 'bc-sloc', WS, T, T)
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)",
    'dom-sloc-default', SITE, `${SLUG}.basedui.dev`, T, T,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkSubpathSetup', () => {
  const row = { hostname: 'customer.sloc.test', basePath: '/blog', proxyId: 'probe-proxy-0000000001' }

  it('no_response when the fetch fails', async () => {
    vi.stubGlobal('fetch', proxyFetch({}))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.ok).toBe(false)
    expect(result.errors[0]!.code).toBe('no_response')
  })

  it('redirects when the mount 3xxs instead of proxying', async () => {
    vi.stubGlobal('fetch', proxyFetch({
      health: new Response(null, { status: 301, headers: { location: 'https://customer.sloc.test/' } }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('redirects')
  })

  it('http_error for non-2xx mounts', async () => {
    vi.stubGlobal('fetch', proxyFetch({ health: new Response('oops', { status: 500 }) }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('http_error')
  })

  it('not_proxied when their own site answers', async () => {
    vi.stubGlobal('fetch', proxyFetch({ health: jsonResponse({ hello: 'world' }) }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('not_proxied')
  })

  it('wrong_site when health names another blog', async () => {
    vi.stubGlobal('fetch', proxyFetch({ health: jsonResponse(await healthBody('site-other', row.proxyId)) }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('wrong_site')
  })

  it('old_proxy_link when the fingerprint does not match', async () => {
    vi.stubGlobal('fetch', proxyFetch({ health: jsonResponse(await healthBody(SITE, 'different-proxy-id-000000')) }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('old_proxy_link')
  })

  it('passes with cdn_caching and robots_missing_sitemap warnings', async () => {
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, row.proxyId)),
      page: new Response('<html></html>', { status: 200, headers: { age: '300', 'content-type': 'text/html' } }),
      robots: new Response('User-agent: *\nAllow: /', { status: 200 }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.map((warning) => warning.code)).toEqual(['cdn_caching', 'robots_missing_sitemap'])
  })

  it('passes clean when robots.txt names the sitemap', async () => {
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, row.proxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('User-agent: *\nSitemap: https://customer.sloc.test/blog/sitemap.xml\n', { status: 200 }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('marks oversized health bodies as not_proxied instead of buffering them', async () => {
    vi.stubGlobal('fetch', proxyFetch({ health: new Response('x'.repeat(20 * 1024), { status: 200 }) }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('not_proxied')
  })

  it('redacts proxy ids from redirect targets in error messages', async () => {
    vi.stubGlobal('fetch', proxyFetch({
      health: new Response(null, { status: 301, headers: { location: `https://sloc.basedui.dev/_vc/p/${row.proxyId}/` } }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.errors[0]!.code).toBe('redirects')
    expect(result.errors[0]!.message).not.toContain(row.proxyId)
    expect(result.errors[0]!.message).toContain('/_vc/p/…')
  })

  it('never reads the index page body (headers carry every caching signal)', async () => {
    const unreadable = new Response(
      new ReadableStream({ pull() { throw new Error('body must not be read') } }),
      { status: 200, headers: { age: '300' } },
    )
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, row.proxyId)),
      page: unreadable,
      robots: new Response('Sitemap: https://customer.sloc.test/blog/sitemap.xml', { status: 200 }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.ok).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toEqual(['cdn_caching'])
  })

  it('skips the robots warning when robots.txt exceeds the read cap', async () => {
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, row.proxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('x'.repeat(80 * 1024), { status: 200 }),
    }))
    const result = await checkSubpathSetup(row, { id: SITE })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })
})

describe('location app operations', () => {
  it('set validates and writes a pending row with snippets; view hides setup from non-owners', async () => {
    const bad = await setSubpathLocationForApp(appFor(ownerActor), 'http://customer.sloc.test/blog')
    expect(bad).toEqual({ ok: false, code: 'location_invalid' })

    const set = await setSubpathLocationForApp(appFor(ownerActor), 'https://customer.sloc.test/blog')
    expect(set.ok).toBe(true)
    if (!set.ok) return
    expect(set.location).toMatchObject({ type: 'subpath', status: 'pending', url: 'https://customer.sloc.test/blog' })
    expect(set.location.proxyTarget).toContain('/_vc/p/')
    expect(set.location.snippets?.cloudflareWorker.route).toBe('customer.sloc.test/blog*')
    expect(set.location.snippets?.nginx).toContain(`proxy_set_header Host ${SLUG}.basedui.dev;`)

    // A read-only key sees status, never the proxy credential.
    const publicView = await getSiteLocationForApp(appFor(readKeyActor))
    expect(publicView?.type).toBe('subpath')
    expect(publicView?.proxyTarget).toBeUndefined()
    expect(publicView?.snippets).toBeUndefined()
  })

  it('rejects non-owners and unentitled workspaces', async () => {
    const editor = await setSubpathLocationForApp(appFor(editorActor), 'https://customer.sloc.test/blog')
    expect(editor).toEqual({ ok: false, code: 'owner_required' })
    const free = await setSubpathLocationForApp(appFor(ownerActor, FREE_SITE, 'ws-sloc-free'), 'https://customer.sloc.test/blog')
    expect(free).toEqual({ ok: false, code: 'billing_required' })
  })

  it('check promotes pending to active and records the result', async () => {
    const record = await seedSubpath()
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, record.proxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('Sitemap: https://customer.sloc.test/blog/sitemap.xml', { status: 200 }),
    }))
    const result = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.check.ok).toBe(true)
    expect(result.location.status).toBe('active')
    const stored = (await createDataAccess(env.DB).domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(stored.status).toBe('active')
    expect(JSON.parse(stored.verificationErrorsJson!)).toMatchObject({ ok: true })
    const activity = await env.DB
      .prepare("SELECT action FROM activity_events WHERE site_id = ? AND action = 'site.location.verified'")
      .bind(SITE)
      .first<{ action: string }>()
    expect(activity?.action).toBe('site.location.verified')
  })

  it('a failed check never demotes an active row', async () => {
    const record = await seedSubpath('active')
    vi.stubGlobal('fetch', proxyFetch({})) // everything fails
    const result = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.check.ok).toBe(false)
    expect(result.check.errors[0]!.code).toBe('no_response')
    expect(result.location.status).toBe('active')
    const stored = (await createDataAccess(env.DB).domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(stored.status).toBe('active')
    void record
  })

  it('rotate issues a new proxy id and keeps active rows active with a warning', async () => {
    const record = await seedSubpath('active')
    const result = await rotateSubpathProxyLinkForApp(appFor(ownerActor))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warning).toContain('old link stops working')
    expect(result.location.status).toBe('active')
    const stored = (await createDataAccess(env.DB).domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(stored.proxyId).not.toBe(record.proxyId)
  })

  it('remove deletes the row and the view falls back to default', async () => {
    await seedSubpath()
    const result = await removeSubpathLocationForApp(appFor(ownerActor))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.location.type).toBe('default')
    expect(result.location.url).toBe(`https://${SLUG}.basedui.dev`)
    const rows = (await createDataAccess(env.DB).domains.listBySite(SITE)).filter((row) => row.type === 'subpath')
    expect(rows).toEqual([])
  })

  it("the check response's location view carries the result just recorded", async () => {
    const record = await seedSubpath()
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, record.proxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('Sitemap: https://customer.sloc.test/blog/sitemap.xml', { status: 200 }),
    }))
    const result = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.location.lastCheck).toMatchObject({ ok: true, checkedAt: result.check.checkedAt })

    // A subsequent failed check reports ITS result, not the earlier pass.
    vi.stubGlobal('fetch', proxyFetch({}))
    const failed = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    expect(failed.location.lastCheck).toMatchObject({ ok: false, checkedAt: failed.check.checkedAt })
    expect(failed.location.lastCheck?.errors[0]?.code).toBe('no_response')
  })

  it('a check that finishes after a rotate conflicts instead of activating the new link', async () => {
    const record = await seedSubpath('active')
    const data = createDataAccess(env.DB)
    // The first probe call rotates the link mid-check, as the dashboard could.
    let rotated = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!rotated && url.endsWith('/_vc/health')) {
        rotated = true
        await data.domains.rotateProxyId(record.id, SITE)
        return jsonResponse(await healthBody(SITE, record.proxyId))
      }
      return new Response('ok', { status: 200 })
    }))
    const result = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(result).toEqual({ ok: false, code: 'domain_conflict' })
    const stored = (await data.domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    // The stale probe must not have activated or stamped the rotated row.
    expect(stored.proxyId).not.toBe(record.proxyId)
  })

  it('owners can remove the location after their subscription lapses', async () => {
    const repo = createDataAccess(env.DB).domains
    await repo.insertSubpath({ siteId: FREE_SITE, hostname: 'free.sloc.test', basePath: '/blog' })
    const set = await setSubpathLocationForApp(appFor(ownerActor, FREE_SITE, 'ws-sloc-free'), 'https://free.sloc.test/blog')
    expect(set).toEqual({ ok: false, code: 'billing_required' }) // setting still gates on entitlement
    const removed = await removeSubpathLocationForApp(appFor(ownerActor, FREE_SITE, 'ws-sloc-free'))
    expect(removed.ok).toBe(true)
    expect(await repo.listBySite(FREE_SITE)).toEqual([])
  })
})

describe('MCP write-budget classification', () => {
  it('location mutations consume the write budget like their REST equivalents', () => {
    expect(apiUsageKind('sites.location.set_subpath')).toBe('write')
    expect(apiUsageKind('sites.location.check')).toBe('write')
    expect(apiUsageKind('sites.location.remove')).toBe('write')
    expect(apiUsageKind('sites.location.get')).toBe('read')
  })
})

describe('operations dispatch (REST + MCP)', () => {
  it('sites.location.get works with sites:read and omits setup secrets', async () => {
    await seedSubpath()
    const location = await dispatchOperation('sites.location.get', opCtx(readKeyActor), {})
    expect(location).toMatchObject({ type: 'subpath', status: 'pending' })
    expect((location as Record<string, unknown>).proxyTarget).toBeUndefined()
  })

  it('sites.location.set_subpath needs site:write', async () => {
    await expect(dispatchOperation('sites.location.set_subpath', opCtx(readKeyActor), { url: 'https://customer.sloc.test/blog' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const location = await dispatchOperation('sites.location.set_subpath', opCtx(manageKeyActor), { url: 'https://customer.sloc.test/blog' })
    expect(location).toMatchObject({ type: 'subpath', status: 'pending' })
    expect((location as Record<string, unknown>).proxyTarget).toContain('/_vc/p/')
  })

  it('sites.location.check runs the probe for site:write keys', async () => {
    const record = await seedSubpath()
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE, record.proxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('Sitemap: https://customer.sloc.test/blog/sitemap.xml', { status: 200 }),
    }))
    const result = await dispatchOperation('sites.location.check', opCtx(manageKeyActor), {}) as { check: { ok: boolean }; location: { status: string } }
    expect(result.check.ok).toBe(true)
    expect(result.location.status).toBe('active')
  })
})

describe('hostname claims (squatting fix)', () => {
  it("a squatter's pending claim blocks nothing: the owner claims, verifies, activates", async () => {
    const data = createDataAccess(env.DB)
    // Squatter (SITE) parks a claim on the victim hostname.
    const squatter = await setSubpathLocationForApp(appFor(ownerActor), 'https://victim.sloc.test/blog')
    expect(squatter.ok).toBe(true)
    // The real owner (SITE2) claims the same hostname — pending claims coexist.
    const owner = await setSubpathLocationForApp(appFor(ownerActor, SITE2, WS2), 'https://victim.sloc.test/blog')
    expect(owner.ok).toBe(true)
    if (!owner.ok) return
    expect(owner.location.status).toBe('pending')
    const ownerProxyId = owner.location.proxyTarget!.split('/_vc/p/')[1]!

    // The owner's check passes (the hostname proxies to SITE2's proxy id).
    // Fresh Responses per fetch: the owner AND squatter checks each read the
    // health body, so the fixtures can't be shared Response instances.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/_vc/health')) return jsonResponse(await healthBody(SITE2, ownerProxyId))
      if (url.endsWith('/robots.txt')) return new Response('Sitemap: https://victim.sloc.test/blog/sitemap.xml', { status: 200 })
      return new Response('<html></html>', { status: 200 })
    }))
    const check = await checkSubpathLocationForApp(appFor(ownerActor, SITE2, WS2))
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.location.status).toBe('active')

    // The squatter's check then proves nothing: the hostname answers SITE2.
    const squatterCheck = await checkSubpathLocationForApp(appFor(ownerActor))
    expect(squatterCheck.ok).toBe(true)
    if (!squatterCheck.ok) return
    expect(squatterCheck.check.ok).toBe(false)
    expect(squatterCheck.check.errors[0]!.code).toBe('wrong_site')
    const squatterRow = (await data.domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(squatterRow.status).toBe('failed')
    // The squatter's failed check never demotes the verified row.
    const ownerRow = (await data.domains.listBySite(SITE2)).find((row) => row.type === 'subpath')!
    expect(ownerRow.status).toBe('active')
  })

  it("a passing check moves the hostname: the loser's active row is demoted and told", async () => {
    const data = createDataAccess(env.DB)
    // SITE serves move.sloc.test/blog today.
    const live = await data.domains.insertSubpath({ siteId: SITE, hostname: 'move.sloc.test', basePath: '/blog' })
    await data.domains.setSubpathStatus(live.id, SITE, 'active')
    // SITE2's owner sets the same location and passes the check.
    const owner = await setSubpathLocationForApp(appFor(ownerActor, SITE2, WS2), 'https://move.sloc.test/blog')
    expect(owner.ok).toBe(true)
    if (!owner.ok) return
    const ownerProxyId = owner.location.proxyTarget!.split('/_vc/p/')[1]!
    vi.stubGlobal('fetch', proxyFetch({
      health: jsonResponse(await healthBody(SITE2, ownerProxyId)),
      page: new Response('<html></html>', { status: 200 }),
      robots: new Response('Sitemap: https://move.sloc.test/blog/sitemap.xml', { status: 200 }),
    }))
    const check = await checkSubpathLocationForApp(appFor(ownerActor, SITE2, WS2))
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.location.status).toBe('active')

    // SITE's row is failed with the superseded marker, and both sites got an
    // activity entry.
    const loser = (await data.domains.listBySite(SITE)).find((row) => row.id === live.id)!
    expect(loser.status).toBe('failed')
    expect(JSON.parse(loser.verificationErrorsJson!).errors[0].code).toBe('superseded')
    const superseded = await env.DB
      .prepare("SELECT actor_type, action FROM activity_events WHERE site_id = ? AND action = 'site.location.superseded'")
      .bind(SITE)
      .first<{ actor_type: string; action: string }>()
    expect(superseded).toMatchObject({ actor_type: 'system', action: 'site.location.superseded' })
    const verified = await env.DB
      .prepare("SELECT action FROM activity_events WHERE site_id = ? AND action = 'site.location.verified'")
      .bind(SITE2)
      .first<{ action: string }>()
    expect(verified?.action).toBe('site.location.verified')

    // Exactly one active subpath row remains on the hostname.
    const active = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM domains WHERE hostname = 'move.sloc.test' AND type = 'subpath' AND status = 'active'")
      .first<{ count: number }>()
    expect(active!.count).toBe(1)
  })

  it('the cron prunes never-active claims older than 30 days, bounded', async () => {
    const data = createDataAccess(env.DB)
    const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run()
    const stale = Math.floor(Date.now() / 1000) - 40 * 24 * 60 * 60
    await exec(
      "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, updated_at, created_at) VALUES (?, ?, ?, 'subpath', 'pending', '/blog', 'stale-proxy-1', ?, ?)",
      'dom-sloc-stale-1', SITE2, 'stale-1.sloc.test', stale, stale,
    )
    await exec(
      "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, activated_at, updated_at, created_at) VALUES (?, ?, ?, 'subpath', 'failed', '/blog', 'stale-proxy-2', ?, ?, ?)",
      'dom-sloc-stale-2', SITE2, 'stale-2.sloc.test', stale, stale, stale,
    )
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const { pruned } = await recheckActiveSubpathLocations(env.DB)
    // stale-1 is never-active → pruned; stale-2 was live once → kept (SITE2's
    // other subpath rows from earlier tests are unaffected either way).
    expect(pruned).toBeGreaterThanOrEqual(1)
    const rows = (await data.domains.listBySite(SITE2)).filter((row) => row.type === 'subpath').map((row) => row.id)
    expect(rows).not.toContain('dom-sloc-stale-1')
    expect(rows).toContain('dom-sloc-stale-2')
  })
})


describe('daily re-check', () => {
  it('records results on active rows but never demotes them', async () => {
    await seedSubpath('active')
    vi.stubGlobal('fetch', proxyFetch({})) // probe fails today
    const { checked } = await recheckActiveSubpathLocations(env.DB)
    // SITE's row plus SITE2's still-active claim from the earlier suite.
    expect(checked).toBeGreaterThanOrEqual(1)
    const stored = (await createDataAccess(env.DB).domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(stored.status).toBe('active')
    expect(JSON.parse(stored.verificationErrorsJson!)).toMatchObject({ ok: false })
  })

  it('does not touch pending rows', async () => {
    await seedSubpath()
    vi.stubGlobal('fetch', proxyFetch({}))
    const { checked } = await recheckActiveSubpathLocations(env.DB)
    const stored = (await createDataAccess(env.DB).domains.listBySite(SITE)).find((row) => row.type === 'subpath')!
    expect(stored.status).toBe('pending')
    // SITE2's still-active claim gets checked; the pending row does not.
    expect(checked).toBe(1)
  })

  it('stops starting new checks at the wall-clock budget, leaving the rest for tomorrow', async () => {
    const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run()
    const data = createDataAccess(env.DB)
    for (let i = 0; i < 12; i++) {
      const siteId = `site-sloc-budget-${i}`
      await exec('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', siteId, WS, `Budget ${i}`, `sloc-budget-${i}`, T, T)
      const record = await data.domains.insertSubpath({ siteId, hostname: `budget-${i}.sloc.test`, basePath: '/blog' })
      await data.domains.setSubpathStatus(record.id, siteId, 'active')
    }
    await seedSubpath('active') // 13 active rows total

    // Every probe burns two minutes of fake clock; the pool must stop picking
    // up rows once the ten-minute budget is spent.
    let tick = 1_000_000
    vi.stubGlobal('fetch', vi.fn(async () => {
      tick += 120_000
      throw new Error('down')
    }))
    const { checked } = await recheckActiveSubpathLocations(env.DB, { now: () => tick })
    expect(checked).toBeLessThanOrEqual(8)
    const unprobed = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM domains WHERE type = 'subpath' AND verification_errors_json IS NULL")
      .first<{ count: number }>()
    expect(unprobed!.count).toBeGreaterThan(0)
  })
})

describe('hostname purge gates (never-verified claims)', () => {
  function collectPurgeBodies() {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response('{"success":true}', { status: 200 })
    }))
    return bodies
  }

  function fakeExecutionContext(tasks: Promise<unknown>[]) {
    return { waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext
  }

  function hostnamesPurged(bodies: Record<string, unknown>[]) {
    return bodies.filter((body) => Array.isArray(body.hosts)).flatMap((body) => body.hosts as string[])
  }

  it('a never-verified claim purges nothing on the claimed hostname', async () => {
    const data = createDataAccess(env.DB)
    const victim = 'squat-purge.sloc.test'
    // The victim's real owner serves this hostname today.
    const live = await data.domains.insertSubpath({ siteId: SITE2, hostname: victim, basePath: '/blog' })
    await data.domains.setSubpathStatus(live.id, SITE2, 'active')

    const previousZone = env.CLOUDFLARE_ZONE_ID
    const previousToken = env.CACHE_PURGE_API_TOKEN
    env.CLOUDFLARE_ZONE_ID = 'zone-purge-test'
    env.CACHE_PURGE_API_TOKEN = 'token-purge-test'
    const bodies = collectPurgeBodies()
    const tasks: Promise<unknown>[] = []
    try {
      // Squatter parks a claim on the victim's hostname, then removes it. The
      // claim never passed a check, so it owns no mount: no hosts purge.
      const set = await setSubpathLocationForApp(appFor(ownerActor), `https://${victim}/blog`)
      expect(set.ok).toBe(true)
      await runWithExecutionContext(fakeExecutionContext(tasks), () => removeSubpathLocationForApp(appFor(ownerActor)))
      await Promise.all(tasks)
    } finally {
      vi.unstubAllGlobals()
      env.CLOUDFLARE_ZONE_ID = previousZone
      env.CACHE_PURGE_API_TOKEN = previousToken
    }
    expect(hostnamesPurged(bodies)).not.toContain(victim)
    // The squatter's own site tag still purges — only the hostname is spared.
    expect(bodies).toContainEqual({ tags: [`vc-site:${SITE}`] })
  })

  it('removing a previously active location still purges its old mount', async () => {
    const repo = createDataAccess(env.DB).domains
    const record = await repo.insertSubpath({ siteId: SITE, hostname: 'purge-live.sloc.test', basePath: '/blog' })
    await repo.setSubpathStatus(record.id, SITE, 'active')

    const previousZone = env.CLOUDFLARE_ZONE_ID
    const previousToken = env.CACHE_PURGE_API_TOKEN
    env.CLOUDFLARE_ZONE_ID = 'zone-purge-test'
    env.CACHE_PURGE_API_TOKEN = 'token-purge-test'
    const bodies = collectPurgeBodies()
    const tasks: Promise<unknown>[] = []
    try {
      await runWithExecutionContext(fakeExecutionContext(tasks), () => removeSubpathLocationForApp(appFor(ownerActor)))
      await Promise.all(tasks)
    } finally {
      vi.unstubAllGlobals()
      env.CLOUDFLARE_ZONE_ID = previousZone
      env.CACHE_PURGE_API_TOKEN = previousToken
    }
    expect(bodies).toContainEqual({ hosts: ['purge-live.sloc.test'] })
    expect(bodies).toContainEqual({ tags: [`vc-site:${SITE}`] })
  })

  it('replacing a live location with a new claim purges the old mount', async () => {
    const repo = createDataAccess(env.DB).domains
    const live = await repo.insertSubpath({ siteId: SITE, hostname: 'purge-swap.sloc.test', basePath: '/blog' })
    await repo.setSubpathStatus(live.id, SITE, 'active')

    const previousZone = env.CLOUDFLARE_ZONE_ID
    const previousToken = env.CACHE_PURGE_API_TOKEN
    env.CLOUDFLARE_ZONE_ID = 'zone-purge-test'
    env.CACHE_PURGE_API_TOKEN = 'token-purge-test'
    const bodies = collectPurgeBodies()
    const tasks: Promise<unknown>[] = []
    try {
      const set = await runWithExecutionContext(fakeExecutionContext(tasks), () =>
        setSubpathLocationForApp(appFor(ownerActor), 'https://elsewhere.sloc.test/blog'),
      )
      expect(set.ok).toBe(true)
      await Promise.all(tasks)
    } finally {
      vi.unstubAllGlobals()
      env.CLOUDFLARE_ZONE_ID = previousZone
      env.CACHE_PURGE_API_TOKEN = previousToken
    }
    expect(bodies).toContainEqual({ hosts: ['purge-swap.sloc.test'] })
  })
})
