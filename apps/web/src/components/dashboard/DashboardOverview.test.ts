import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/dashboard-page-fn', () => ({
  loadDashboardOverview: vi.fn(),
}))

import { postEditorLink } from './DashboardOverview'

describe('DashboardOverview recent-post navigation', () => {
  it('builds an edit link for the selected recent post', () => {
    expect(postEditorLink('post_123')).toEqual({
      to: '/dashboard/posts/$postId/edit',
      params: { postId: 'post_123' },
    })
  })
})
