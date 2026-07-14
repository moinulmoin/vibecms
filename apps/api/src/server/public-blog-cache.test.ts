import { describe, expect, it, vi } from 'vitest'
import { articleCacheTag, articleCacheUrls, purgeArticleCache } from './public-blog-cache'
import { runWithExecutionContext } from './execution-scope'
import { scheduleArticlePurge } from './purge-scheduler'

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
