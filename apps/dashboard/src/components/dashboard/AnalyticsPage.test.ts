import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsPageData } from '~/types/dashboard'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: unknown; className?: string }) => createElement('a', { className }, children as never),
  useNavigate: () => vi.fn(),
}))

import { TopPosts, analyticsUnavailableMessage } from './AnalyticsPage'

it('shows the full top-post title on narrow layouts', () => {
  const data = { status: 'available', topPosts: [{ postId: 'p1', slug: 'share-cards', title: 'Share cards now render in their own Worker', views: 1 }] } as Extract<AnalyticsPageData, { status: 'available' }>
  const html = renderToStaticMarkup(createElement(TopPosts, { data }))
  const title = html.match(/<a[^>]+class="([^"]+)"[^>]*>Share cards now render in their own Worker<\/a>/)
  expect(title).not.toBeNull()
  expect(title?.[1]?.split(' ')).not.toContain('truncate')
})

it('explains unavailable analytics in customer-facing language', () => {
  expect(analyticsUnavailableMessage('not_configured')).toBe('Analytics isn’t available for this blog yet. Try again later.')
})
