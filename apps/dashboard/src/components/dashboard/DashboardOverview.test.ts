import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const pageState = vi.hoisted(() => ({ response: null as unknown }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: options.queryKey[0] === 'context' ? null : pageState.response }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: unknown; className?: string }) => createElement('a', { className }, children as never),
}))

vi.mock('~/lib/api-client', () => ({
  loadDashboardOverview: vi.fn(),
}))

import { DashboardOverview, postEditorLink, narrowDashboardData, overviewEntitlementBadge } from './DashboardOverview'
import type { z } from 'zod'
import { dashboardDataSchema } from '~/lib/dashboard-response-schemas'

type DashboardApiResponse = z.infer<typeof dashboardDataSchema>

const baseResponse = {
  site: null,
  publicUrl: null,
  publicUrlLocal: false,
  billing: { status: 'none' as const },
  apiUsage: {
    enforced: false,
    calls: {
      minute: { metric: 'calls', period: 'minute', used: 0, limit: 100, remaining: 100, resetsAt: 0 },
      day: { metric: 'calls', period: 'day', used: 0, limit: 1000, remaining: 1000, resetsAt: 0 },
      month: { metric: 'calls', period: 'month', used: 0, limit: 10000, remaining: 10000, resetsAt: 0 },
    },
    writes: {
      day: { metric: 'writes', period: 'day', used: 0, limit: 100, remaining: 100, resetsAt: 0 },
      month: { metric: 'writes', period: 'month', used: 0, limit: 1000, remaining: 1000, resetsAt: 0 },
    },
  },
  counts: { published: 0, draft: 0, archived: 0 },
  media: { bytes: 0, count: 0 },
  tokenCount: 0,
  versionCount: 0,
  recentPosts: [],
  recentDrafts: [],
  recentActivity: [],
  activationPost: null,
} as DashboardApiResponse

describe('DashboardOverview recent-post navigation', () => {
  it('keeps long review and recent-post titles readable without clipping them', () => {
    const title = 'Share cards now render in their own Worker'
    pageState.response = {
      ...baseResponse,
      counts: { published: 1, draft: 1, archived: 0 },
      recentPosts: [{ id: 'p1', title, slug: 'share-cards', status: 'published', updatedAt: 1, publishedAt: 1 }],
      needsReview: [{ id: 'p2', title, slug: 'share-cards-draft', status: 'draft', updatedAt: 1, publishedAt: null, versionNumber: 1, publishedVersionNumber: null, latestActorType: 'api_key' }],
    }
    const html = renderToStaticMarkup(createElement(DashboardOverview, { canEdit: true }))
    const matching = [...html.matchAll(/<[^>]+class="([^"]+)"[^>]*>Share cards now render in their own Worker/g)]
    expect(matching.length).toBeGreaterThanOrEqual(2)
    expect(matching.every((match) => !match[1]?.split(' ').includes('truncate'))).toBe(true)
  })

  it('builds an edit link for the selected recent post', () => {
    expect(postEditorLink('post_123')).toEqual({
      to: '/dashboard/posts/$postId/edit',
      params: { postId: 'post_123' },
    })
  })

  it('preserves a scheduled publication in the overview response', () => {
    const schedule = { versionNumber: 2, publishAt: 1_800_000_000, status: 'pending' as const, error: null }
    const recentPosts = dashboardDataSchema.shape.recentPosts.parse([{
      id: 'post-2', title: 'Later', slug: 'later', status: 'draft', updatedAt: 1,
      publishedAt: null, scheduledPublish: schedule,
    }])
    expect(narrowDashboardData({ ...baseResponse, recentPosts }).recentPosts[0].scheduledPublish).toEqual(schedule)
  })
})

describe('DashboardOverview entitlement status', () => {
  it('shows paid month counts without quota meters and keeps free meters', () => {
    const usage = { ...baseResponse.apiUsage, enforced: true,
      calls: { ...baseResponse.apiUsage.calls, month: { ...baseResponse.apiUsage.calls.month, used: 42 } },
      writes: { ...baseResponse.apiUsage.writes, month: { ...baseResponse.apiUsage.writes.month, used: 7 } },
    }
    pageState.response = { ...baseResponse, apiUsage: usage, billing: { status: 'active' } }
    const paid = renderToStaticMarkup(createElement(DashboardOverview, { canEdit: true }))
    expect(paid).toContain('Requests this month: 42')
    expect(paid).toContain('Writes this month: 7')
    expect(paid).toContain('Unlimited, fair use')
    expect(paid).not.toContain('role="meter"')

    pageState.response = { ...baseResponse, apiUsage: usage }
    const free = renderToStaticMarkup(createElement(DashboardOverview, { canEdit: true }))
    expect(free).toContain('role="meter"')
  })
  it('shows managed access instead of a free-plan label', () => {
    expect(
      overviewEntitlementBadge({
        status: 'none',
        polarStatus: 'none',
        effective: true,
        access: 'hosted_paid',
        source: 'managed_sponsorship',
        managed: {
          status: 'active',
          expiresAt: null,
          effective: true,
        },
      }),
    ).toBe('Managed access')
  })

  it('does not report a stale managed state while Polar access is effective', () => {
    expect(
      overviewEntitlementBadge({
        status: 'active',
        polarStatus: 'active',
        effective: true,
        access: 'hosted_paid',
        source: 'polar',
        managed: {
          status: 'revoked',
          expiresAt: null,
          effective: false,
        },
      }),
    ).toBeNull()
  })
})

describe('DashboardOverview activation proof contract', () => {
  it('preserves activationPost url and actorName when present', () => {
    const result = narrowDashboardData({
      ...baseResponse,
      activationPost: {
        id: 'post_1',
        title: 'Hello World',
        slug: 'hello-world',
        publishedAt: 1700000000,
        url: 'https://blog.example.com/hello-world',
        actorName: 'My agent',
      },
    })
    expect(result.activationPost).not.toBeNull()
    expect(result.activationPost?.url).toBe('https://blog.example.com/hello-world')
    expect(result.activationPost?.title).toBe('Hello World')
    expect(result.activationPost?.actorName).toBe('My agent')
  })

  it('preserves live proof when the public URL is not active yet', () => {
    const result = narrowDashboardData({
      ...baseResponse,
      activationPost: {
        id: 'post_2',
        title: 'Published without a domain',
        slug: 'published-without-a-domain',
        publishedAt: 1700000001,
        url: null,
        actorName: 'My agent',
      },
    })

    expect(result.activationPost?.url).toBeNull()
    expect(result.activationPost?.title).toBe('Published without a domain')
  })

  it('preserves null activationPost when absent', () => {
    const result = narrowDashboardData({ ...baseResponse, activationPost: null })
    expect(result.activationPost).toBeNull()
  })
})
