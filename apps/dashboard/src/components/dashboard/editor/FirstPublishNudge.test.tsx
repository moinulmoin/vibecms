// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ApiClientModule from '~/lib/api-client'

const api = vi.hoisted(() => ({ loadDashboardOverview: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search }: { children?: ReactNode; to: string; search?: { tab?: string } }) => (
    <a href={`${to}?tab=${search?.tab ?? ''}`}>{children}</a>
  ),
}))

vi.mock('~/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  loadDashboardOverview: api.loadDashboardOverview,
}))

import { overviewQuery } from '~/lib/queries'
import { FirstPublishNudge, useFirstPublishNudge, type FirstPublishNudgeState, type FirstPublishTicket } from './FirstPublishNudge'

type OverviewFixture = {
  billing: { status: string; access: string }
  counts: { published: number; draft: number; archived: number }
  activationPost: { id: string; title: string; slug: string; publishedAt: number; url: null; actorName: string } | null
}

function overview({ access = 'hosted_free', published = 0, live = false }: { access?: string; published?: number; live?: boolean } = {}): OverviewFixture {
  return {
    billing: { status: 'none', access },
    counts: { published, draft: 1, archived: 0 },
    activationPost: live ? { id: 'p', title: 'Live', slug: 'live', publishedAt: 1, url: null, actorName: 'Agent' } : null,
  }
}

function Harness({ onState }: { onState: (state: FirstPublishNudgeState) => void }) {
  const nudge = useFirstPublishNudge()
  onState(nudge)
  return <FirstPublishNudge nudge={nudge} />
}

const mounted: Array<{ root: Root; container: HTMLElement }> = []

/** Lets the mount-time eligibility prefetch settle (mocked reads resolve within microtasks). */
async function settlePrefetch() {
  // Executor form: the dashboard targets the ES2022 lib, which has no Promise.withResolvers.
  await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) })
}

async function mount(siteId: string, { cachedOverview }: { cachedOverview?: OverviewFixture } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['context'], { app: { siteId } })
  // Same cache entry, untagged key: a partial stale overview, like the mocked reads.
  if (cachedOverview) client.setQueryData([...overviewQuery.queryKey], cachedOverview)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  let state!: FirstPublishNudgeState
  await act(async () => root.render(
    <QueryClientProvider client={client}><Harness onState={(next) => { state = next }} /></QueryClientProvider>,
  ))
  await settlePrefetch()
  return {
    container,
    unmount: () => {
      mounted.splice(mounted.findIndex((entry) => entry.root === root), 1)
      act(() => root.unmount())
      container.remove()
    },
    /** The editor's sequence: snapshot when the publish dialog opens, confirm once live. */
    publish: () => {
      const ticket: FirstPublishTicket = state.prepare()
      act(() => state.confirm(ticket))
      return ticket
    },
    /** A publish that failed: the snapshot is taken, confirm never runs. */
    prepareOnly: (): FirstPublishTicket => state.prepare(),
  }
}

describe('first publish nudge', () => {
  afterEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => root.unmount())
      container.remove()
    }
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('shows once after the first confirmed publish on the hosted free plan, linking to billing', async () => {
    api.loadDashboardOverview.mockResolvedValue(overview())
    const editor = await mount('site-first-free')
    expect(editor.container.textContent).toBe('')

    const ticket = editor.publish()

    expect(ticket).toEqual({ siteId: 'site-first-free' })
    const status = editor.container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Your first post is live.')
    expect(status?.textContent).toContain('free plan')
    const plans = [...editor.container.querySelectorAll('a')].find((link) => link.textContent?.includes('Upgrade to Cloud'))
    expect(plans?.getAttribute('href')).toBe('/dashboard/settings?tab=billing')
    expect(window.localStorage.getItem('vc-first-publish-nudge:site-first-free')).toBe('1')
  })

  it('stays hidden and records nothing when the publish is never confirmed', async () => {
    api.loadDashboardOverview.mockResolvedValue(overview())
    const editor = await mount('site-unconfirmed')

    expect(editor.prepareOnly()).toEqual({ siteId: 'site-unconfirmed' })

    expect(editor.container.querySelector('[role="status"]')).toBeNull()
    expect(window.localStorage.getItem('vc-first-publish-nudge:site-unconfirmed')).toBeNull()
    // The retry that succeeds still gets the first-publish note.
    editor.publish()
    expect(editor.container.querySelector('[role="status"]')).not.toBeNull()
  })

  it.each([
    ['hosted paid', 'hosted_paid'],
    ['self-hosted', 'self_hosted'],
  ])('never nudges on a %s site', async (_label, access) => {
    api.loadDashboardOverview.mockResolvedValue(overview({ access }))
    const editor = await mount(`site-${access}`)

    expect(editor.publish()).toBeNull()

    expect(editor.container.querySelector('[role="status"]')).toBeNull()
    expect(window.localStorage.getItem(`vc-first-publish-nudge:site-${access}`)).toBeNull()
  })

  it('keeps a dismissal across remounts and honors one stored for the site', async () => {
    api.loadDashboardOverview.mockResolvedValue(overview())
    const first = await mount('site-dismiss')
    first.publish()
    const dismiss = first.container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!
    act(() => dismiss.click())
    expect(first.container.querySelector('[role="status"]')).toBeNull()
    first.unmount()

    // Overview still reports no live post (e.g. stale or archived); storage wins.
    const again = await mount('site-dismiss')
    expect(again.publish()).toBeNull()
    expect(again.container.querySelector('[role="status"]')).toBeNull()

    // A record from an earlier session (another tab, a reload) suppresses it too.
    window.localStorage.setItem('vc-first-publish-nudge:site-recorded', '1')
    const recorded = await mount('site-recorded')
    expect(recorded.publish()).toBeNull()
    expect(recorded.container.querySelector('[role="status"]')).toBeNull()
  })

  it('does not nudge on later publishes', async () => {
    api.loadDashboardOverview.mockResolvedValue(overview())
    const editor = await mount('site-repeat')
    editor.publish()
    act(() => editor.container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click())

    expect(editor.publish()).toBeNull()
    expect(editor.container.querySelector('[role="status"]')).toBeNull()
  })

  it('does not nudge when a post is already live, by count or by agent proof', async () => {
    api.loadDashboardOverview.mockResolvedValue(overview({ published: 1 }))
    const counted = await mount('site-has-live')
    expect(counted.publish()).toBeNull()

    api.loadDashboardOverview.mockResolvedValue(overview({ live: true }))
    const proven = await mount('site-agent-live')
    expect(proven.publish()).toBeNull()

    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('skips the nudge, without throwing, when the overview cannot be read', async () => {
    api.loadDashboardOverview.mockRejectedValue(new Error('offline'))
    const editor = await mount('site-offline')

    expect(editor.publish()).toBeNull()
    expect(editor.container.querySelector('[role="status"]')).toBeNull()
  })

  it('skips the nudge, without waiting, while eligibility is still loading', async () => {
    let resolveOverview!: (value: OverviewFixture) => void
    api.loadDashboardOverview.mockReturnValue(new Promise<OverviewFixture>((resolve) => { resolveOverview = resolve }))
    const editor = await mount('site-slow')

    // Approval never waits on the overview: an unresolved read yields no ticket.
    expect(editor.publish()).toBeNull()
    expect(editor.container.querySelector('[role="status"]')).toBeNull()
    expect(window.localStorage.getItem('vc-first-publish-nudge:site-slow')).toBeNull()

    // Once the prefetch lands, a later publish attempt still gets the note.
    resolveOverview(overview())
    await settlePrefetch()
    expect(editor.publish()).toEqual({ siteId: 'site-slow' })
    expect(editor.container.querySelector('[role="status"]')).not.toBeNull()
  })

  it('does not trust a cached eligible overview when the fresh read fails', async () => {
    api.loadDashboardOverview.mockRejectedValue(new Error('offline'))
    const editor = await mount('site-stale-cache', { cachedOverview: overview() })

    expect(api.loadDashboardOverview).toHaveBeenCalled()
    expect(editor.publish()).toBeNull()
    expect(editor.container.querySelector('[role="status"]')).toBeNull()
  })
})
