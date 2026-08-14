import { describe, expect, it, vi } from 'vitest'
import {
  articleCacheTag,
  articleCacheUrls,
  articleCacheUrlsForHost,
  hostnameCacheUrls,
  purgeArticleCache,
  purgeHostnameCache,
  purgeSiteCache,
} from './public-blog-cache'
import { env } from 'cloudflare:workers'
import { runWithExecutionContext } from './execution-scope'
import { scheduleArticlePurge, scheduleHostnamePurge } from './purge-scheduler'

describe('public article cache invalidation', () => {
  it('uses stable article tags and host-only public URLs', () => {
    expect(articleCacheTag('site-1', 'hello')).toBe('vc-article:site-1:hello')
    expect(articleCacheUrls('demo', 'hello')).toEqual([
      'https://demo.basedui.dev/hello',
      'https://demo.basedui.dev/hello.md',
    ])
  })

  it('deletes HTML and Markdown variants from the Cache API fallback', async () => {
    const cache = (caches as CacheStorage & { default: Cache }).default
    const urls = articleCacheUrls('purge-fixture', 'cached-post')

    for (const url of urls) {
      await cache.put(
        new Request(url),
        new Response('stale', { headers: { 'cache-control': 'public, max-age=60' } }),
      )
      expect(await cache.match(new Request(url))).toBeDefined()
    }

    await purgeArticleCache('site-purge', 'purge-fixture', 'cached-post')

    for (const url of urls) {
      expect(await cache.match(new Request(url))).toBeUndefined()
    }
  })

  it('site purge deletes published article URLs from the Cache API fallback', async () => {
    // Settings/theme saves change every article render; without slugs the
    // fallback only cleared site-level URLs and articles stayed stale.
    const cache = (caches as CacheStorage & { default: Cache }).default
    const urls = articleCacheUrls('site-purge-fixture', 'themed-post')

    for (const url of urls) {
      await cache.put(
        new Request(url),
        new Response('stale', { headers: { 'cache-control': 'public, max-age=60' } }),
      )
      expect(await cache.match(new Request(url))).toBeDefined()
    }

    await purgeSiteCache('site-theme-save', 'site-purge-fixture', ['themed-post'])

    for (const url of urls) {
      expect(await cache.match(new Request(url))).toBeUndefined()
    }
  })

  it('site purge covers custom-hostname article URLs (keyed by their own host)', async () => {
    const cache = (caches as CacheStorage & { default: Cache }).default
    const urls = articleCacheUrlsForHost('blog.customer.example', 'themed-post')

    for (const url of urls) {
      await cache.put(
        new Request(url),
        new Response('stale', { headers: { 'cache-control': 'public, max-age=60' } }),
      )
      expect(await cache.match(new Request(url))).toBeDefined()
    }

    await purgeSiteCache('site-theme-save', 'site-purge-fixture', ['themed-post'], ['blog.customer.example'])

    for (const url of urls) {
      expect(await cache.match(new Request(url))).toBeUndefined()
    }
  })
})

describe('hostname ownership-transition cache invalidation', () => {
  it('builds stable custom-hostname cache URLs', () => {
    expect(hostnameCacheUrls('Blog.Example.com.')).toEqual([
      'https://blog.example.com',
      'https://blog.example.com/feed.xml',
      'https://blog.example.com/rss.xml',
      'https://blog.example.com/atom.xml',
      'https://blog.example.com/sitemap.xml',
      'https://blog.example.com/robots.txt',
      'https://blog.example.com/llms.txt',
    ])
    expect(hostnameCacheUrls('')).toEqual([])
  })

  it('clears cached custom-hostname site URLs on remove/reassign (Cache API fallback)', async () => {
    const cache = (caches as CacheStorage & { default: Cache }).default
    const hostname = 'reassign-purge.example.test'
    const urls = hostnameCacheUrls(hostname)

    for (const url of urls) {
      await cache.put(
        new Request(url),
        new Response('previous-owner', { headers: { 'cache-control': 'public, max-age=60' } }),
      )
      expect(await cache.match(new Request(url))).toBeDefined()
    }

    await purgeHostnameCache(hostname, 'site-previous-owner')

    for (const url of urls) {
      expect(await cache.match(new Request(url))).toBeUndefined()
    }
  })

  it('purges Cloudflare by hosts (and prior site tag) so a reassigned host cannot serve the old article', async () => {
    const previousZone = env.CLOUDFLARE_ZONE_ID
    const previousToken = env.CACHE_PURGE_API_TOKEN
    env.CLOUDFLARE_ZONE_ID = 'test-zone'
    env.CACHE_PURGE_API_TOKEN = 'test-purge-token'

    const bodies: unknown[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await purgeHostnameCache('old-owner.example.test', 'site-previous')
      expect(bodies).toEqual([
        { hosts: ['old-owner.example.test'] },
        { tags: ['vc-site:site-previous'] },
      ])
    } finally {
      vi.unstubAllGlobals()
      env.CLOUDFLARE_ZONE_ID = previousZone
      env.CACHE_PURGE_API_TOKEN = previousToken
    }
  })

  it('schedules hostname purge onto the current request execution context', () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>(() => {})
    const ctx = { waitUntil } as unknown as ExecutionContext

    runWithExecutionContext(ctx, () => {
      scheduleHostnamePurge('owned.example.test', 'site-a')
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })
})

describe('scheduled purge execution-context binding', () => {
  // The execution-scope seam: a duck-typed ExecutionContext whose only method
  // the scheduling path touches is `waitUntil`. Lets us observe which request
  // context a scheduled purge binds to without asserting on source text.
  function makeExecutionContext() {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>(() => {})
    return { waitUntil, ctx: { waitUntil } as unknown as ExecutionContext }
  }

  it('binds a scheduled purge to the current request execution context', () => {
    const { ctx, waitUntil } = makeExecutionContext()

    runWithExecutionContext(ctx, () => {
      scheduleArticlePurge('site-a', 'slug-a', 'post-a')
    })

    // The purge task is handed to THIS request's ctx.waitUntil, synchronously,
    // at schedule time — not deferred to a shared/global holder.
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('does not reuse a prior request context after its scope has ended', () => {
    const { ctx, waitUntil } = makeExecutionContext()

    runWithExecutionContext(ctx, () => {
      scheduleArticlePurge('site-a', 'slug-a', 'post-a')
    })
    expect(waitUntil).toHaveBeenCalledTimes(1)

    // Scheduled outside any request scope: must fall through to an untracked
    // task, never leak onto the previous request's execution context.
    scheduleArticlePurge('site-b', 'slug-b', 'post-b')

    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('isolates concurrent request scopes so each purge binds to its own context', async () => {
    const a = makeExecutionContext()
    const b = makeExecutionContext()
    const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

    // Two request scopes interleave their async work; each scheduled purge must
    // resolve to the request that is current at schedule time, never the other.
    await Promise.all([
      runWithExecutionContext(a.ctx, async () => {
        await tick()
        scheduleArticlePurge('site-a', 'slug-a', 'post-a')
        await tick()
      }),
      runWithExecutionContext(b.ctx, async () => {
        await tick()
        scheduleArticlePurge('site-b', 'slug-b', 'post-b')
        await tick()
      }),
    ])

    expect(a.waitUntil).toHaveBeenCalledTimes(1)
    expect(b.waitUntil).toHaveBeenCalledTimes(1)
  })
})
