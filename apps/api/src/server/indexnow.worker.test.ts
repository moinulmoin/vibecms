/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { runWithExecutionContext } from '@/server/execution-scope'
import { archivePostOp, createPostOp, publishPostOp, updatePostOp } from './operations'
import type { OperationContext } from './operations'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

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
})
