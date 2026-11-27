/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { runWithExecutionContext } from '@/server/execution-scope'
import { archivePostOp, createPostOp, publishPostOp, schedulePostOp, updatePostOp } from './operations'
import type { OperationContext } from './operations'
import type { AppUserContext } from './onboarding'
import { archivePostForApp, publishPostForApp } from './post-mutations'
import { processDueSchedules } from './post-scheduler'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

// Fault injection for the IndexNow-only snapshot read: the next N reads throw like a D1 error.
const snapshotFault = vi.hoisted(() => ({ remaining: 0 }))
vi.mock('./live-post-version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./live-post-version')>()
  return {
    ...actual,
    readLiveVersion: async (...args: Parameters<typeof actual.readLiveVersion>) => {
      if (snapshotFault.remaining > 0) {
        snapshotFault.remaining--
        throw new Error('D1_ERROR: injected snapshot read failure')
      }
      return actual.readLiveVersion(...args)
    },
  }
})

const KEY = 'inx0a1b2c3d4e5f6a7b8c9d0e1f2a3b4'
const INDEXNOW = 'https://api.indexnow.org/indexnow'
const T = 1_700_000_000

const scopes = ['posts:read', 'posts:create', 'posts:update', 'posts:publish', 'posts:archive'] as const
function ctxFor(siteId: string): OperationContext {
  return {
    siteId, workspaceId: siteId + '-ws', tokenId: siteId + '-key',
    actor: { type: 'api_key', id: siteId + '-key', name: 'IndexNow writer', scopes: [...scopes] },
  }
}

type DomainSeed = { type: string; hostname: string; basePath?: string }
const sites: Record<string, { id: string; paid: boolean; domains: DomainSeed[] }> = {
  default: { id: 'inx-default', paid: false, domains: [{ type: 'default', hostname: 'inx-default.basedui.dev' }] },
  custom: {
    id: 'inx-custom', paid: true,
    domains: [{ type: 'default', hostname: 'inx-custom.basedui.dev' }, { type: 'custom', hostname: 'blog.inx-custom.test' }],
  },
  subpath: {
    id: 'inx-subpath', paid: true,
    domains: [{ type: 'default', hostname: 'inx-subpath.basedui.dev' }, { type: 'subpath', hostname: 'www.inx-subpath.test', basePath: '/blog' }],
  },
  unrouted: { id: 'inx-unrouted', paid: false, domains: [] },
  paused: { id: 'inx-paused', paid: false, domains: [{ type: 'default', hostname: 'inx-paused.basedui.dev' }] },
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  for (const site of Object.values(sites)) {
    const ws = site.id + '-ws'
    await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(ws, ws, ws, T, T).run()
    await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(site.id, ws, site.id, site.id, T, T).run()
    if (site.paid) {
      await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)")
        .bind(site.id + '-bc', ws, T * 2, T, T).run()
    }
    for (const [index, domain] of site.domains.entries()) {
      await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, base_path, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)")
        .bind(site.id + '-domain-' + index, site.id, domain.hostname, domain.type, domain.basePath ?? null, T + index, T + index).run()
    }
  }
  // A managed blog whose AutoSEOPilot plan ended past the 7-day claim grace: every address shows the paused page.
  const paused = sites.paused!
  const revokedAt = Math.floor(Date.now() / 1000) - 10 * 86_400
  await env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .bind('inx-paused-owner', 'Owner', 'inx-paused@example.com', T, T).run()
  await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, 'managed', 'vc_test_inx_paused', 'hash-inx-paused', '[]', 'AutoSEOPilot', 'inx-paused-owner', ?, ?)`)
    .bind('inx-paused-key', paused.id, T, T).run()
  await env.DB.prepare(`INSERT INTO autoseopilot_managed_sites (id, external_workspace_id, owner_user_id, workspace_id, site_id, credential_id,
      credential_generation, api_key_id, entitlement_status, lifecycle_revision, created_at, updated_at, revoked_at)
    VALUES ('inx-paused-managed', 'ext-inx-paused', 'inx-paused-owner', ?, ?, 'cred-inx-paused', 1, 'inx-paused-key', 'revoked', 1, ?, ?, ?)`)
    .bind(paused.id + '-ws', paused.id, T, T, revokedAt).run()
})

type Submission = { url: string; body: Record<string, unknown> }
let submissions: Submission[]
let tasks: Promise<unknown>[]
let respond: (init: RequestInit | undefined) => Promise<Response>
const previousKey = env.INDEXNOW_KEY

beforeEach(() => {
  submissions = []
  tasks = []
  respond = async () => new Response(null, { status: 202 })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== INDEXNOW) return new Response(null, { status: 200 })
    submissions.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return respond(init)
  }))
  env.INDEXNOW_KEY = KEY
  snapshotFault.remaining = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  env.INDEXNOW_KEY = previousKey
})

function inScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithExecutionContext({ waitUntil: (task: Promise<unknown>) => tasks.push(task) } as unknown as ExecutionContext, fn)
}

async function settle() {
  await Promise.all(tasks)
}

async function publishedPost(siteId: string, slug: string) {
  const ctx = ctxFor(siteId)
  const draft = await createPostOp(ctx, { title: 'Post ' + slug, slug, contentMarkdown: '## ' + slug + '\n\nBody.' })
  const published = await inScope(() => publishPostOp(ctx, { postId: draft.id, expectedVersionNumber: draft.currentVersionNumber }))
  await settle()
  return published
}

describe('IndexNow submissions', () => {
  it('submits the canonical URL of a newly published post on its default host', async () => {
    const published = await publishedPost(sites.default!.id, 'first-default')
    expect(published.url).toBe('https://inx-default.basedui.dev/first-default')
    expect(submissions).toEqual([{
      url: INDEXNOW,
      body: {
        host: 'inx-default.basedui.dev',
        key: KEY,
        keyLocation: 'https://inx-default.basedui.dev/' + KEY + '.txt',
        urlList: ['https://inx-default.basedui.dev/first-default'],
      },
    }])
  })

  it('submits on the custom domain when it is the primary location', async () => {
    await publishedPost(sites.custom!.id, 'first-custom')
    expect(submissions.map((s) => s.body)).toEqual([{
      host: 'blog.inx-custom.test',
      key: KEY,
      keyLocation: 'https://blog.inx-custom.test/' + KEY + '.txt',
      urlList: ['https://blog.inx-custom.test/first-custom'],
    }])
  })

  it('puts keyLocation under the base path of a subpath blog', async () => {
    await publishedPost(sites.subpath!.id, 'first-subpath')
    expect(submissions.map((s) => s.body)).toEqual([{
      host: 'www.inx-subpath.test',
      key: KEY,
      keyLocation: 'https://www.inx-subpath.test/blog/' + KEY + '.txt',
      urlList: ['https://www.inx-subpath.test/blog/first-subpath'],
    }])
  })

  it('submits a republished edit, both URLs on a slug change, and the old URL on archive', async () => {
    const ctx = ctxFor(sites.default!.id)
    const first = await publishedPost(sites.default!.id, 'edited-default')
    submissions = []
    const edited = await updatePostOp(ctx, { postId: first.id, expectedVersionNumber: first.currentVersionNumber, title: 'A better title', slug: 'renamed-default' })
    await settle()
    expect(submissions).toEqual([])
    await inScope(() => publishPostOp(ctx, { postId: first.id, expectedVersionNumber: edited.currentVersionNumber }))
    await settle()
    expect(submissions.map((s) => s.body.urlList)).toEqual([[
      'https://inx-default.basedui.dev/edited-default',
      'https://inx-default.basedui.dev/renamed-default',
    ]])
    submissions = []
    await inScope(() => archivePostOp(ctx, { postId: first.id }))
    await settle()
    expect(submissions.map((s) => s.body.urlList)).toEqual([['https://inx-default.basedui.dev/renamed-default']])
  })

  it('sends nothing when a publish or archive changes nothing public', async () => {
    const ctx = ctxFor(sites.default!.id)
    const first = await publishedPost(sites.default!.id, 'noop-default')
    submissions = []
    await inScope(() => publishPostOp(ctx, { postId: first.id, expectedVersionNumber: first.currentVersionNumber }))
    const resaved = await updatePostOp(ctx, { postId: first.id, expectedVersionNumber: first.currentVersionNumber })
    expect(resaved.currentVersionNumber).toBeGreaterThan(first.currentVersionNumber)
    await inScope(() => publishPostOp(ctx, { postId: first.id, expectedVersionNumber: resaved.currentVersionNumber }))
    const draft = await createPostOp(ctx, { title: 'Never live', slug: 'never-live', contentMarkdown: 'Body.' })
    await inScope(() => archivePostOp(ctx, { postId: draft.id }))
    await settle()
    expect(submissions).toEqual([])
  })

  it('sends nothing when IndexNow is not configured', async () => {
    env.INDEXNOW_KEY = undefined
    const published = await publishedPost(sites.default!.id, 'unconfigured-default')
    expect(published.status).toBe('published')
    expect(submissions).toEqual([])
  })

  it('sends nothing for a configured key that is not a valid IndexNow key', async () => {
    env.INDEXNOW_KEY = 'short'
    await publishedPost(sites.default!.id, 'invalid-key-default')
    expect(submissions).toEqual([])
  })

  it('sends nothing for a blog with no public address', async () => {
    const published = await publishedPost(sites.unrouted!.id, 'unrouted-only')
    expect(published.status).toBe('published')
    expect(submissions).toEqual([])
  })

  it('sends nothing for a blog an operator suspended', async () => {
    const ctx = ctxFor(sites.default!.id)
    const first = await publishedPost(sites.default!.id, 'suspended-default')
    submissions = []
    await env.DB.prepare('UPDATE sites SET suspended_at = ? WHERE id = ?').bind(T, sites.default!.id).run()
    try {
      await inScope(() => archivePostOp(ctx, { postId: first.id }))
      await settle()
    } finally {
      await env.DB.prepare('UPDATE sites SET suspended_at = NULL WHERE id = ?').bind(sites.default!.id).run()
    }
    expect(submissions).toEqual([])
  })

  it('still publishes when IndexNow rejects the submission, and logs no key', async () => {
    const logs: string[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')) })
    }
    respond = async () => new Response('bad key', { status: 403 })
    const published = await publishedPost(sites.default!.id, 'rejected-default')
    expect(published.status).toBe('published')
    expect(submissions).toHaveLength(1)
    expect(logs.join('\n')).toContain('403')
    expect(logs.join('\n')).not.toContain(KEY)
  })

  it('returns from publish without waiting for IndexNow, and gives up on a hung request', async () => {
    respond = (init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
    const ctx = ctxFor(sites.default!.id)
    const draft = await createPostOp(ctx, { title: 'Hung', slug: 'hung-default', contentMarkdown: 'Body.' })
    const published = await inScope(() => publishPostOp(ctx, { postId: draft.id, expectedVersionNumber: draft.currentVersionNumber }))
    expect(published.status).toBe('published')
    const background = Promise.all(tasks).then(() => 'settled')
    expect(await Promise.race([background, new Promise((resolve) => setTimeout(() => resolve('pending'), 500))])).toBe('pending')
    expect(submissions).toHaveLength(1)
    expect(await background).toBe('settled')
  }, 15_000)

  it('submits a same-slug body edit when it is republished', async () => {
    const ctx = ctxFor(sites.default!.id)
    const first = await publishedPost(sites.default!.id, 'body-edit-default')
    submissions = []
    const edited = await updatePostOp(ctx, { postId: first.id, expectedVersionNumber: first.currentVersionNumber, contentMarkdown: '## A fuller answer\n\nNew body.' })
    await inScope(() => publishPostOp(ctx, { postId: first.id, expectedVersionNumber: edited.currentVersionNumber }))
    await settle()
    expect(submissions.map((s) => s.body.urlList)).toEqual([['https://inx-default.basedui.dev/body-edit-default']])
  })

  it('treats a blank SEO field saved as empty text and later as no value as unchanged', async () => {
    const ctx = ctxFor(sites.default!.id)
    const draft = await createPostOp(ctx, { title: 'Blank SEO', slug: 'blank-seo-default', contentMarkdown: 'Body.', seoDescription: '' })
    await inScope(() => publishPostOp(ctx, { postId: draft.id, expectedVersionNumber: draft.currentVersionNumber }))
    await settle()
    submissions = []
    const resaved = await updatePostOp(ctx, { postId: draft.id, expectedVersionNumber: draft.currentVersionNumber, seoDescription: '' })
    expect(resaved.currentVersionNumber).toBeGreaterThan(draft.currentVersionNumber)
    await inScope(() => publishPostOp(ctx, { postId: draft.id, expectedVersionNumber: resaved.currentVersionNumber }))
    await settle()
    expect(submissions).toEqual([])
  })

  it('submits dashboard publishes and archives', async () => {
    const siteId = sites.default!.id
    const app = { siteId, workspaceId: siteId + '-ws', user: { id: 'inx-owner' }, actor: { type: 'human', id: 'inx-owner', name: 'Owner', role: 'owner' } } as unknown as AppUserContext
    const draft = await createPostOp(ctxFor(siteId), { title: 'Dashboard', slug: 'dashboard-default', contentMarkdown: 'Body.' })
    expect((await inScope(() => publishPostForApp(app, draft.id, draft.currentVersionNumber))).kind).toBe('ok')
    await settle()
    expect((await inScope(() => archivePostForApp(app, draft.id))).kind).toBe('ok')
    await settle()
    expect(submissions.map((s) => s.body.urlList)).toEqual([
      ['https://inx-default.basedui.dev/dashboard-default'],
      ['https://inx-default.basedui.dev/dashboard-default'],
    ])
  })

  it('submits a scheduled publish when it goes live', async () => {
    const ctx = ctxFor(sites.default!.id)
    const draft = await createPostOp(ctx, { title: 'Scheduled', slug: 'scheduled-default', contentMarkdown: 'Body.' })
    const publishAt = Math.floor(Date.now() / 1000) + 60
    await schedulePostOp(ctx, { postId: draft.id, versionNumber: draft.currentVersionNumber, publishAt })
    const run = await inScope(() => processDueSchedules(env.DB, publishAt + 1))
    await settle()
    expect(run.published).toBe(1)
    expect(submissions.map((s) => s.body.urlList)).toEqual([['https://inx-default.basedui.dev/scheduled-default']])
  })

  it('sends nothing for a managed blog paused after its plan ended', async () => {
    const published = await publishedPost(sites.paused!.id, 'paused-managed')
    expect(published.status).toBe('published')
    expect(submissions).toEqual([])
  })

  it('sends nothing when archiving a post whose publish time has not come yet', async () => {
    const siteId = sites.default!.id
    const future = Math.floor(Date.now() / 1000) + 86_400
    await env.DB.prepare(`INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
      VALUES ('inx-future', ?, 'Future', 'future-default', 'Body.', 'published', ?, 'api_key', 'seed', 'api_key', 'seed', ?, ?)`).bind(siteId, future, T, T).run()
    await env.DB.prepare(`INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at)
      VALUES ('inx-future-v1', 'inx-future', ?, 1, 'Future', 'future-default', 'Body.', 'published', 'api_key', 'seed', 'seed', ?)`).bind(siteId, T).run()
    await env.DB.prepare("UPDATE posts SET published_version_id = 'inx-future-v1' WHERE id = 'inx-future'").run()
    await inScope(() => archivePostOp(ctxFor(siteId), { postId: 'inx-future' }))
    await settle()
    expect(submissions).toEqual([])
  })

  it('still publishes and archives when the IndexNow snapshot read fails, sending nothing and logging no key', async () => {
    const logs: string[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')) })
    }
    const ctx = ctxFor(sites.default!.id)
    const draft = await createPostOp(ctx, { title: 'Snapshot', slug: 'snapshot-default', contentMarkdown: 'Body.' })
    snapshotFault.remaining = 1
    const published = await inScope(() => publishPostOp(ctx, { postId: draft.id, expectedVersionNumber: draft.currentVersionNumber }))
    await settle()
    expect(published.status).toBe('published')
    snapshotFault.remaining = 1
    const archived = await inScope(() => archivePostOp(ctx, { postId: draft.id }))
    await settle()
    expect(archived.status).toBe('archived')
    const row = await env.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(draft.id).first<{ status: string }>()
    expect(row?.status).toBe('archived')
    expect(submissions).toEqual([])
    expect(logs.join('\n')).toContain('indexnow')
    expect(logs.join('\n')).not.toContain(KEY)
  })
})
