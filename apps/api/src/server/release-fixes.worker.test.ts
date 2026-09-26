/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { createD1PostRepository, createDataAccess } from '@vc/db'
import { createPost, firstParagraph, publishPost, updatePost, type Actor } from '@vc/core'
import { mapPost, mapPostSummary } from '@vc/api-contract'
import { updatePostForApp } from './post-mutations'
import { handleExport } from './export'
import { deleteSubscriberForApp } from './dashboard-api'
import { maybeRejectOtpSendRateLimit } from './auth-guards'
import { listActivityOp, unarchivePostOp, updateAssetOp, type OperationContext } from './operations'
import type { AppUserContext } from './onboarding'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

const siteId = 'release-fixes-site'
const actor: Actor = { type: 'human', id: 'release-fixes-user', name: 'Reviewer', role: 'owner' }
const app = { siteId, workspaceId: 'release-fixes-ws', actor, user: { id: actor.id, name: actor.name, email: 'reviewer@example.com' } } as AppUserContext
const ctx: OperationContext = { siteId, workspaceId: app.workspaceId, actor, tokenId: 'release-fixes-token' }
const repo = createD1PostRepository(env.DB)

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind(app.workspaceId, 'Release fixes', app.workspaceId).run()
  await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
    .bind(siteId, app.workspaceId, 'Release fixes', siteId).run()
})

async function draft(slug: string, coverAssetId: string | null = null) {
  return createPost(repo, actor, { siteId, title: 'Published title', slug, contentMarkdown: 'Published paragraph', coverAssetId, tags: [] })
}

describe('release regression paths', () => {
  it('persists an explicit null cover from the dashboard save', async () => {
    const assetId = 'release-cover'
    await env.DB.prepare(`INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, created_by_type, created_by_id, created_at, updated_at)
      VALUES (?, ?, ?, 'cover.png', 'image/png', 1, 'human', ?, 1, 1)`)
      .bind(assetId, siteId, assetId, actor.id).run()
    const post = await draft('release-cover-post', assetId)
    const result = await updatePostForApp(app, post.id, {
      title: post.title, slug: post.slug, contentMarkdown: post.contentMarkdown,
      coverAssetId: null, tags: [],
    }, 1)
    expect(result.kind).toBe('ok')
    expect((await repo.getPost(siteId, post.id))?.coverAssetId).toBeNull()
  })

  it('exports the pinned live snapshot separately from the private tip and media references', async () => {
    const post = await draft('release-export-post')
    await publishPost(repo, actor, { siteId, postId: post.id, expectedVersionNumber: 1, billingStatus: 'active' })
    await updatePost(repo, actor, { siteId, postId: post.id, expectedVersionNumber: 1,
      slug: 'release-export-draft', title: 'Private title', contentMarkdown: 'Private text ![image](/media-assets/release-cover)',
      presentation: { layout: 'essay', toc: true }, tags: ['private'],
    })
    const response = await handleExport(app)
    const payload = await response.json() as { schemaVersion: number; posts: Array<Record<string, any>> }
    const exported = payload.posts.find((item) => item.id === post.id)!
    expect(payload.schemaVersion).toBe(2)
    expect(exported.publishedVersion).toMatchObject({ title: 'Published title', slug: 'release-export-post', contentMarkdown: 'Published paragraph', publishedAt: expect.any(Number) })
    expect(exported.draftTip).toMatchObject({ title: 'Private title', slug: 'release-export-draft', presentation: { layout: 'essay', toc: true }, tags: ['private'] })
    expect(exported.mediaAssets).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'release-cover', url: '/media-assets/release-cover' })]))
    const working = (await repo.getPost(siteId, post.id))!
    expect(mapPost(working, null).publishedSlug).toBe('release-export-post')
    const summaries = await repo.listPosts({ siteId, limit: 20, offset: 0 })
    expect(mapPostSummary(summaries.find((item) => item.id === post.id)!, null).publishedSlug).toBe('release-export-post')
    const dashboardRows = await createDataAccess(env.DB).dashboard.listPostsForDashboard(siteId, { limit: 20, offset: 0, sort: 'updated' })
    expect(dashboardRows.find((item) => item.id === post.id)?.publishedSlug).toBe('release-export-post')
  })

  it('uses stored plain text from the pinned body for public list and feed descriptions', async () => {
    const post = await createPost(repo, actor, { siteId, title: 'Fallback', slug: 'release-fallback',
      excerpt: '', seoDescription: '', contentMarkdown: '# Heading\n\nThe **first** paragraph has [a link](https://example.com) and words.\n\nSecond paragraph.', tags: [],
    })
    await publishPost(repo, actor, { siteId, postId: post.id, expectedVersionNumber: 1, billingStatus: 'active' })
    await updatePost(repo, actor, { siteId, postId: post.id, expectedVersionNumber: 1, contentMarkdown: 'Private replacement.' })
    const publicBlog = createDataAccess(env.DB).publicBlog
    const listed = await publicBlog.listPublishedPostSummaries(siteId, Math.floor(Date.now() / 1000) + 1, 20)
    const feed = await publicBlog.listPublishedPostsForFeed(siteId, Math.floor(Date.now() / 1000) + 1, 20)
    const description = 'The first paragraph has a link and words.'
    expect(firstParagraph('# Heading\n\nThe **first** paragraph has [a link](https://example.com) and words.')).toBe(description)
    const long = firstParagraph(`A ${'word '.repeat(60)}`)
    expect(long.length).toBeLessThanOrEqual(201)
    expect(long).toMatch(/word…$/)
    expect(listed.find((item) => item.id === post.id)?.excerpt).toBe(description)
    expect(feed.find((item) => item.id === post.id)?.excerpt).toBe(description)
  })

  it('records subscriber deletion with actor and masked email', async () => {
    const id = 'release-subscriber'
    await env.DB.prepare(`INSERT INTO subscribers (id, site_id, email, status, consent_text, consent_version, created_at, updated_at)
      VALUES (?, ?, 'alice@example.com', 'pending', 'yes', 'v1', 1, 1)`).bind(id, siteId).run()
    expect((await deleteSubscriberForApp(app, id)).kind).toBe('ok')
    const event = await env.DB.prepare("SELECT actor_id, summary FROM activity_events WHERE entity_type = 'subscriber' AND entity_id = ?").bind(id).first<{ actor_id: string; summary: string }>()
    expect(event).toMatchObject({ actor_id: actor.id, summary: 'Deleted subscriber a***@example.com' })
    expect(event?.summary).not.toContain('alice@')
  })

  it('returns the durable OTP retry delay in both body and header', async () => {
    const request = () => new Request('https://example.com/api/auth/email-otp/send-verification-otp', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'release-rate@example.com' }),
    })
    for (let n = 0; n < 5; n++) expect(await maybeRejectOtpSendRateLimit(request())).toBeUndefined()
    const response = await maybeRejectOtpSendRateLimit(request())
    expect(response?.status).toBe(429)
    const body = await response!.json() as { retryAfter: number }
    expect(body.retryAfter).toBe(Number(response?.headers.get('retry-after')))
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it('supports unarchive and asset alt updates through agent operations', async () => {
    const post = await draft('release-agent-post')
    await repo.updatePostWithHistory(siteId, post.id, { status: 'archived' }, actor,
      { changeSummary: 'Archived', activityAction: 'post.archived', activitySummary: 'Archived' }, 1)
    expect((await unarchivePostOp(ctx, { postId: post.id })).status).toBe('draft')
    const updated = await updateAssetOp(ctx, { assetId: 'release-cover', altText: 'A better description' })
    expect(updated.altText).toBe('A better description')
  })

  it('pages past the first 50 agent activity events', async () => {
    for (let n = 0; n < 55; n++) await env.DB.prepare(`INSERT INTO activity_events
      (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
      VALUES (?, ?, 'human', ?, 'Reviewer', 'test.event', 'test', ?, 'Event', ?)`)
      .bind(`release-event-${n}`, siteId, actor.id, `release-${n}`, 2_000_000_000 + n).run()
    const secondPage = await listActivityOp(ctx, { limit: 50, offset: 50 })
    expect(secondPage.some((item) => item.id === 'release-event-4')).toBe(true)
  })
})
