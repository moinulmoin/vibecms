// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardPostSummary } from '~/types/dashboard'

const mock = vi.hoisted(() => ({
  deletePost: vi.fn(async () => ({ kind: 'ok', code: 'post_deleted' })),
  unschedulePost: vi.fn(async () => ({ kind: 'ok', code: 'post_unscheduled' })),
  navigate: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  status: 'archived',
  posts: [] as DashboardPostSummary[],
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useInfiniteQuery: () => ({ data: { pages: [{ posts: mock.posts, publicBaseUrl: null, hasMore: false }] }, isPlaceholderData: false }),
  useQuery: () => ({ data: { app: { user: { name: 'Owner' } } } }),
  useQueryClient: () => ({ invalidateQueries: mock.invalidate }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  useNavigate: () => mock.navigate,
}))
vi.mock('~/lib/api-client', () => ({
  archivePostMutation: vi.fn(),
  deleteArchivedPostMutation: mock.deletePost,
  loadPostsPage: vi.fn(),
  unarchivePostMutation: vi.fn(),
  unschedulePostMutation: mock.unschedulePost,
}))
vi.mock('~/components/Toaster', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { PostsPage } from './PostsPage'
import { postsListSearch } from '~/lib/dashboard-search'

function post(status: DashboardPostSummary['status']): DashboardPostSummary {
  return {
    id: 'post-1', title: 'A title', slug: 'a-title', publishedSlug: null, published: null,
    excerpt: null, coverAssetId: null, status, publishedAt: null, tags: [],
    createdAt: 1, updatedAt: 1, versionNumber: 1, publishedVersionNumber: null,
    latestActorType: 'human', updatedByType: 'human', updatedByName: 'Owner',
  }
}

describe('PostsPage permanent delete', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('keeps the last-change actor icon in agreement with its name after scheduled publishing', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mock.posts = [{ ...post('published'), title: 'Scheduled from the CLI', latestActorType: 'api_key', updatedByType: 'system', updatedByName: null }]
    await act(async () => root.render(<PostsPage search={postsListSearch({})} canEdit />))
    const byline = container.querySelector('time')?.parentElement
    expect(byline?.textContent).toContain('vibecms')
    expect(byline?.querySelector('svg')).toBeNull()
    mock.posts = [{ ...post('published'), title: 'Scheduled from the CLI', latestActorType: 'api_key', updatedByType: 'human', updatedByName: null }]
    await act(async () => root.render(<PostsPage search={postsListSearch({})} canEdit />))
    const humanByline = container.querySelector('time')?.parentElement
    expect(humanByline?.textContent).toContain('you')
    expect(humanByline?.querySelector('svg')).toBeNull()
    await act(async () => root.unmount())
  })

  it('shows the action only on an archived row in the Archived tab and calls the dashboard API after confirmation', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const deleteButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Delete “A title”'))
    mock.posts = [post('published')]
    await act(async () => root.render(<PostsPage search={postsListSearch({ status: 'archived' })} canEdit />))
    expect(deleteButton()).toBeUndefined()
    mock.posts = [post('archived')]
    await act(async () => root.render(<PostsPage search={postsListSearch({ status: 'archived' })} canEdit />))
    const button = deleteButton()
    expect(button).toBeDefined()
    await act(async () => button?.click())
    expect(container.textContent).toContain('Delete “A title” forever?')
    expect(mock.deletePost).not.toHaveBeenCalled()
    await act(async () => deleteButton()?.click())
    expect(mock.deletePost).toHaveBeenCalledWith({ postId: 'post-1' })
    await act(async () => root.render(<PostsPage search={postsListSearch({})} canEdit />))
    expect(deleteButton()).toBeUndefined()
    await act(async () => root.unmount())
  })

  it('shows a local scheduled badge and lets the owner unschedule', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mock.posts = [{ ...post('draft'), scheduledPublish: { versionNumber: 1, publishAt: 1_800_000_000, status: 'pending' } }]
    await act(async () => root.render(<PostsPage search={postsListSearch({})} canEdit />))
    expect(container.textContent).toContain('Scheduled ·')
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Unschedule'))
    await act(async () => button?.click())
    expect(mock.unschedulePost).toHaveBeenCalledWith({ postId: 'post-1' })
    await act(async () => root.unmount())
  })

  it('shows Already publishing when unschedule loses the claim race', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mock.posts = [{ ...post('draft'), scheduledPublish: { versionNumber: 1, publishAt: 1_800_000_000, status: 'pending' } }]
    mock.unschedulePost.mockRejectedValueOnce(new Error('Already publishing'))
    await act(async () => root.render(<PostsPage search={postsListSearch({})} canEdit />))
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Unschedule'))
    await act(async () => button?.click())
    expect(container.textContent).toContain('Already publishing')
    await act(async () => root.unmount())
  })
})
