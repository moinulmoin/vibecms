import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/api-client', () => ({
  loadDashboardOverview: vi.fn(),
}))

import { postEditorLink, narrowDashboardData } from './DashboardOverview'
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
  recentActivity: [],
  activationPost: null,
} as DashboardApiResponse

describe('DashboardOverview recent-post navigation', () => {
  it('builds an edit link for the selected recent post', () => {
    expect(postEditorLink('post_123')).toEqual({
      to: '/dashboard/posts/$postId/edit',
      params: { postId: 'post_123' },
    })
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
