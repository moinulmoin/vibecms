// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AnalyticsPageData } from '~/types/dashboard'

const mocks = vi.hoisted(() => ({
  loadAnalyticsPage: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) =>
    createElement('a', { className }, children),
  useNavigate: () => mocks.navigate,
}))

vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    constructor(public status = 400) { super('Request failed') }
  },
  loadAnalyticsPage: mocks.loadAnalyticsPage,
}))

// happy-dom gives ResponsiveContainer zero size, so charts are stubbed; the
// rendered line keys stay observable via data-testid.
vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  Line: ({ dataKey }: { dataKey: string }) => createElement('div', { 'data-testid': `line-${dataKey}` }),
  LineChart: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  XAxis: () => null,
  YAxis: () => null,
}))
vi.mock('~/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}))

// LoadError is the only thing AnalyticsPage needs from the layout module;
// stubbing avoids pulling in the whole dashboard chrome.
vi.mock('~/components/dashboard/DashboardLayout', () => ({
  LoadError: ({ message }: { message: string }) => createElement('p', null, message),
}))

import { AnalyticsPage, TopPosts, analyticsUnavailableMessage, type AnalyticsTab } from './AnalyticsPage'
import type { AnalyticsRange } from '~/types/dashboard'

type AvailableData = Extract<AnalyticsPageData, { status: 'available' }>

function availableData(overrides: Partial<AvailableData> = {}): AvailableData {
  return {
    status: 'available',
    rangeDays: 30,
    retentionDays: 365,
    views: 120,
    previousViews: 100,
    trendPercent: 20,
    seriesGranularity: 'day',
    aiReferralViews: 7,
    series: [{ date: '2026-10-01', views: 4, aiCrawlerRequests: 3 }],
    topPosts: [{ postId: 'p1', slug: 'share-cards', title: 'Share cards now render in their own Worker', views: 90 }],
    referrers: [{ domain: 'chatgpt.com', views: 7, ai: true, operator: 'OpenAI' }],
    aiCrawlers: { status: 'unavailable', lookbackDays: 30, requests: 0, agents: [] },
    agents: {
      total: 62,
      byCategory: [
        { category: 'ai-assistant', fetches: 40 },
        { category: 'search-engine', fetches: 22 },
      ],
      topAgents: [
        { id: 'ChatGPT-User', label: 'ChatGPT', operator: 'OpenAI', category: 'ai-assistant', fetches: 40 },
      ],
      topPosts: [{ postId: 'p1', slug: 'share-cards', title: 'Share cards now render in their own Worker', fetches: 31 }],
      markdownShare: 62,
      signedShare: 12,
      llmsReads: 9,
    },
    ...overrides,
  }
}
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const roots: Array<{ root: Root; container: HTMLElement }> = []

async function render({ range = 30, tab = 'people' }: { range?: AnalyticsRange; tab?: AnalyticsTab } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <AnalyticsPage range={range} tab={tab} />
    </QueryClientProvider>,
  ))
  await settle()
  roots.push({ root, container })
  return { container }
}
afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

it('shows the full top-post title on narrow layouts', () => {
  const data = { status: 'available', topPosts: [{ postId: 'p1', slug: 'share-cards', title: 'Share cards now render in their own Worker', views: 1 }] } as AvailableData
  const html = renderToStaticMarkup(createElement(TopPosts, { data }))
  const title = html.match(/<a[^>]+class="([^"]+)"[^>]*>Share cards now render in their own Worker<\/a>/)
  expect(title).not.toBeNull()
  expect(title?.[1]?.split(' ')).not.toContain('truncate')
})

it('explains unavailable analytics in customer-facing language', () => {
  expect(analyticsUnavailableMessage('not_configured')).toBe('Analytics isn’t available for this blog yet. Try again later.')
})

describe('AnalyticsPage', () => {
  it('shows views, agent reads, and AI referrals in the metric strip', async () => {
    mocks.loadAnalyticsPage.mockResolvedValue(availableData())
    const { container } = await render()
    expect(container.textContent).toContain('Page views')
    expect(container.textContent).toContain('Agent reads')
    expect(container.textContent).toContain('AI referrals')
    expect(container.textContent).toContain('62')
  })

  it('switches to the Agents tab through the URL search param', async () => {
    mocks.loadAnalyticsPage.mockResolvedValue(availableData())
    const { container } = await render({ range: 90 })
    const agentsTab = [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Agents')!
    await act(async () => agentsTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    await act(async () => agentsTab.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard/analytics',
      search: { range: 90, tab: 'agents' },
      replace: true,
    })
  })

  it('renders the agents tab: trend, top agents, agent-read posts, and stats', async () => {
    mocks.loadAnalyticsPage.mockResolvedValue(availableData())
    const { container } = await render({ tab: 'agents' })
    const text = container.textContent ?? ''
    expect(text).toContain('Agent reads over time')
    expect(container.querySelector('[data-testid="line-agentReads"]')).not.toBeNull()
    expect(text).toContain('Reads by category')
    expect(text).toContain('AI assistant')
    expect(text).toContain('Search engine')
    expect(text).toContain('Top agents')
    expect(text).toContain('ChatGPT')
    expect(text).toContain('OpenAI')
    expect(text).toContain('Posts agents read most')
    expect(text).toContain('Markdown requests')
    expect(text).toContain('62%')
    expect(text).toContain('llms.txt reads')
    expect(text).toContain('Signed requests')
    expect(text).toContain('12%')
    // People-only panels stay out of the agents tab.
    expect(text).not.toContain('Referrers')
  })

  it('explains what counts as an agent read when there is no agent data', async () => {
    mocks.loadAnalyticsPage.mockResolvedValue(availableData({
      agents: {
        total: 0,
        byCategory: [],
        topAgents: [],
        topPosts: [],
        markdownShare: 0,
        signedShare: 0,
        llmsReads: 0,
      },
    }))
    const { container } = await render({ tab: 'agents' })
    const text = container.textContent ?? ''
    expect(text).toContain('No agent reads yet')
    expect(text).toContain('agent read is any request')
    expect(text).toContain('update daily')
  })

  it('keeps the locked upsell unchanged', async () => {
    mocks.loadAnalyticsPage.mockResolvedValue({ status: 'locked', retentionDays: 365 })
    const { container } = await render()
    const text = container.textContent ?? ''
    expect(text).toContain('See who reads, and which AI tools find you')
    expect(text).toContain('See plans')
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })
})
