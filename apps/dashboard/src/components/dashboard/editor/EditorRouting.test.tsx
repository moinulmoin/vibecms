// @vitest-environment happy-dom
import { createMemoryHistory, createRootRouteWithContext, createRouter, Outlet, RouterProvider, type AnyRoute } from '@tanstack/react-router'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@vc/core'
import type * as ApiClient from '~/lib/api-client'
import type { AppRouterContext, PostEditorPageLoad } from '~/types/dashboard'
import { withQueryClient } from '~/test/query'
import { emptyPostsListSearch } from '~/lib/dashboard-search'

// Only the API boundary and the heavy editor surfaces are replaced; the router,
// route files, PostEditorPage and the real PostEditorShell (with autosave) run as shipped.
const api = vi.hoisted(() => ({
  createPostMutation: vi.fn(),
  updatePostMutation: vi.fn(),
  publishPostMutation: vi.fn(),
  loadPostEditorPage: vi.fn(),
  checkPostSeo: vi.fn(async () => ({ versionNumber: 1, findings: [] })),
  loadPostAnalytics: vi.fn(async () => null),
}))

vi.mock('~/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  createPostMutation: api.createPostMutation,
  updatePostMutation: api.updatePostMutation,
  publishPostMutation: api.publishPostMutation,
  loadPostEditorPage: api.loadPostEditorPage,
  checkPostSeo: api.checkPostSeo,
  loadPostAnalytics: api.loadPostAnalytics,
}))
vi.mock('@vc/content', () => ({ renderRichContent: () => ({ warnings: [] }) }))
vi.mock('./RichCanvas', () => ({ RichCanvas: ({ source }: { source: string }) => <textarea data-testid="rich-canvas-input" value={source} readOnly /> }))
vi.mock('./MarkdownSource', () => ({ MarkdownSource: ({ value }: { value: string }) => <textarea data-testid="markdown-source" value={value} readOnly /> }))
vi.mock('./PostMetadataRail', () => ({ PostMetadataRail: () => <input id="post-seo-title" data-testid="post-metadata-rail" /> }))
vi.mock('./PreviewPane', () => ({ PreviewPane: () => null }))
vi.mock('./VersionHistory', () => ({ VersionHistory: () => null }))
vi.mock('./ReviewView', () => ({ ReviewView: () => <div data-testid="review-view" /> }))
vi.mock('~/components/dashboard/PostsPage', () => ({ PostsPage: () => <p data-testid="posts-list">Posts</p> }))

import { Route as PostsRoute } from '~/routes/dashboard/posts/route'
import { Route as PostsIndexRoute } from '~/routes/dashboard/posts/index'
import { Route as NewPostRoute } from '~/routes/dashboard/posts/new'
import { Route as EditPostRoute } from '~/routes/dashboard/posts/$postId/edit'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function context(role: 'owner' | 'editor' | 'viewer'): AppRouterContext {
  const user = { id: 'user-1', name: 'Owner', email: 'owner@example.test' }
  return {
    googleEnabled: false, githubEnabled: false, user,
    app: { user, siteId: 'site-a', workspaceId: 'workspace-a', actor: { type: 'human', id: 'user-1', name: 'Owner', role } },
    apps: [], siteSetupComplete: true, siteDisplayName: 'Site A',
  }
}

// Mirrors the generated routeTree wiring for the posts subtree, using the real route files.
const rootRoute = createRootRouteWithContext<AppRouterContext>()({ component: Outlet })
const attach = (route: AnyRoute, id: string, parent: () => AnyRoute) => route.update({ id, path: id, getParentRoute: parent } as never)
attach(PostsRoute as AnyRoute, '/dashboard/posts', () => rootRoute)
attach(PostsIndexRoute as AnyRoute, '/', () => PostsRoute as AnyRoute)
attach(NewPostRoute as AnyRoute, '/new', () => PostsRoute as AnyRoute)
attach(EditPostRoute as AnyRoute, '/$postId/edit', () => PostsRoute as AnyRoute)
const routeTree = rootRoute.addChildren([
  (PostsRoute as AnyRoute).addChildren([PostsIndexRoute, NewPostRoute, EditPostRoute]),
])

function editorPage(id: string, title: string, versionNumber: number): PostEditorPageLoad {
  const slug = title.toLowerCase().replace(/\s+/g, '-')
  const post: Post = {
    id, siteId: 'site-a', title, slug, excerpt: null, contentMarkdown: `${title} body`, coverAssetId: null,
    canonicalUrl: null, seoTitle: null, seoDescription: null, status: 'draft', publishedAt: null, originalPublishedAt: null, tags: [],
    createdAt: 1, updatedAt: versionNumber, presentation: { layout: 'standard', toc: false },
    currentVersionNumber: versionNumber, publishedVersionNumber: null,
  }
  return {
    mode: 'edit', post, assets: [], missing: false, presetId: 'minimal', site: null, publicBaseUrl: null,
    currentVersionNumber: versionNumber,
    latestVersion: { versionNumber, title, slug, status: 'draft', changeSummary: null, actorType: 'human', actorName: 'Owner', createdAt: versionNumber },
  }
}

const newPage: PostEditorPageLoad = { ...editorPage('unused', 'unused', 1), mode: 'new', post: null, currentVersionNumber: null, latestVersion: null }

let mounted: { root: Root; container: HTMLElement } | null = null

async function renderAt(path: string, role: 'owner' | 'editor' | 'viewer' = 'owner') {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }), context: context(role) })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => {
    root.render(withQueryClient(<RouterProvider router={router} />))
  })
  return { router, container }
}

async function waitFor(check: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) {
    await act(async () => {
      const { promise, resolve } = deferred<void>()
      window.setTimeout(resolve, 25)
      await promise
    })
  }
  expect(check()).toBe(true)
}

const titleInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>('#post-title')

async function typeTitle(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const buttonWithText = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent?.includes(text))

describe('posts editor routing', () => {
  afterEach(async () => {
    if (mounted) {
      const { root, container } = mounted
      await act(async () => root.unmount())
      container.remove()
      mounted = null
    }
    vi.clearAllMocks()
    document.body.innerHTML = ''
    window.localStorage.clear()
  })

  it('keeps the same title field, focus, caret and typing when autosave creates the post and the route becomes /$postId/edit', async () => {
    const create = deferred<{ kind: 'ok'; code: string; postId: string; versionNumber: number }>()
    const created = editorPage('post-1', 'Hello', 1)
    created.previewUrl = 'https://blog.example/preview/opaque-token'
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId === 'post-1' ? created : newPage))
    api.createPostMutation.mockReturnValueOnce(create.promise)
    api.updatePostMutation.mockResolvedValue({ kind: 'ok', code: 'post_saved', versionNumber: 2 })

    const { router, container } = await renderAt('/dashboard/posts/new')
    await waitFor(() => titleInput(container) !== null)
    const title = titleInput(container)!
    const historyLength = router.history.length
    title.focus()
    await typeTitle(title, 'Hello')

    // Autosave (2.5s debounce) starts the create; keep it pending while the writer types on.
    await waitFor(() => api.createPostMutation.mock.calls.length === 1, 4000)
    expect(api.createPostMutation.mock.calls[0][0]).toMatchObject({ title: 'Hello' })
    await typeTitle(title, 'Hello world')
    title.setSelectionRange(5, 5)
    expect(router.state.location.pathname).toBe('/dashboard/posts/new')

    await act(async () => create.resolve({ kind: 'ok', code: 'post_created', postId: 'post-1', versionNumber: 1 }))
    await waitFor(() => router.state.location.pathname === '/dashboard/posts/post-1/edit')
    await waitFor(() => container.querySelector('a[href="https://blog.example/preview/opaque-token"]') !== null)

    expect(router.history.length).toBe(historyLength)
    expect(titleInput(container)).toBe(title)
    expect(document.activeElement).toBe(title)
    expect(title.value).toBe('Hello world')
    expect(title.selectionStart).toBe(5)
    expect(title.selectionEnd).toBe(5)
    expect(buttonWithText('Copy preview link', container)).toBeDefined()

    // Typing after the route change lands in the same post, as an update.
    await typeTitle(title, 'Hello world, again')
    await waitFor(() => api.updatePostMutation.mock.calls.some(([input]) => input.title === 'Hello world, again'), 4000)
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    for (const [input] of api.updatePostMutation.mock.calls) expect(input).toMatchObject({ postId: 'post-1' })
    expect(titleInput(container)).toBe(title)
    expect(title.value).toBe('Hello world, again')
  }, 15000)

  it('drops an open publish approval and saves only the next post when moving from one existing post to another', async () => {
    const loadB = deferred<PostEditorPageLoad>()
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId === 'post-a' ? editorPage('post-a', 'Post A', 3) : loadB.promise))
    api.updatePostMutation.mockResolvedValue({ kind: 'ok', code: 'post_saved', versionNumber: 8 })

    const { router, container } = await renderAt('/dashboard/posts/post-a/edit')
    await waitFor(() => titleInput(container)?.value === 'Post A')
    await act(async () => buttonWithText('Publish v3', container)?.click())
    await waitFor(() => buttonWithText('Publish v3', document.querySelector('[role="dialog"]') ?? document.createElement('div')) !== undefined)

    await act(async () => {
      await router.navigate({ to: '/dashboard/posts/$postId/edit', params: { postId: 'post-b' }, search: emptyPostsListSearch })
    })
    await waitFor(() => router.state.location.pathname === '/dashboard/posts/post-b/edit')
    // B is still loading: nothing from A may remain on screen or be approvable.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(titleInput(container)).toBeNull()
    expect(buttonWithText('Publish v3')).toBeUndefined()

    await act(async () => loadB.resolve(editorPage('post-b', 'Post B', 7)))
    await waitFor(() => titleInput(container)?.value === 'Post B')
    expect(buttonWithText('Publish v7', container)).toBeDefined()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await typeTitle(titleInput(container)!, 'Post B edited')
    await waitFor(() => api.updatePostMutation.mock.calls.length > 0, 4000)
    expect(api.updatePostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation.mock.calls[0][0]).toMatchObject({ postId: 'post-b', expectedVersionNumber: 7, title: 'Post B edited' })
    expect(api.publishPostMutation).not.toHaveBeenCalled()
  }, 15000)

  it('ignores a slow load for the previous post after moving to another', async () => {
    const loadA = deferred<PostEditorPageLoad>()
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId === 'post-a' ? loadA.promise : editorPage('post-b', 'Post B', 7)))

    const { router, container } = await renderAt('/dashboard/posts/post-a/edit')
    await waitFor(() => api.loadPostEditorPage.mock.calls.some(([input]) => input.postId === 'post-a'))
    await act(async () => {
      await router.navigate({ to: '/dashboard/posts/$postId/edit', params: { postId: 'post-b' }, search: emptyPostsListSearch })
    })
    await waitFor(() => titleInput(container)?.value === 'Post B')
    const title = titleInput(container)!

    await act(async () => loadA.resolve(editorPage('post-a', 'Post A', 3)))
    expect(titleInput(container)).toBe(title)
    expect(title.value).toBe('Post B')
    expect(buttonWithText('Publish v7', container)).toBeDefined()
    expect(buttonWithText('Publish v3')).toBeUndefined()
  })

  it('starts a blank new post, created separately, when moving from an existing post to /new', async () => {
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId === 'post-a' ? editorPage('post-a', 'Post A', 3) : postId === 'post-new' ? editorPage('post-new', 'Fresh', 1) : newPage))
    api.createPostMutation.mockResolvedValue({ kind: 'ok', code: 'post_created', postId: 'post-new', versionNumber: 1 })
    api.updatePostMutation.mockResolvedValue({ kind: 'ok', code: 'post_saved', versionNumber: 4 })

    const { router, container } = await renderAt('/dashboard/posts/post-a/edit')
    await waitFor(() => titleInput(container)?.value === 'Post A')
    await act(async () => {
      await router.navigate({ to: '/dashboard/posts/new', search: emptyPostsListSearch })
    })
    await waitFor(() => router.state.location.pathname === '/dashboard/posts/new')
    await waitFor(() => titleInput(container)?.value === '')
    expect(buttonWithText('Publish v3')).toBeUndefined()

    await typeTitle(titleInput(container)!, 'Fresh')
    await waitFor(() => api.createPostMutation.mock.calls.length === 1, 4000)
    expect(api.createPostMutation.mock.calls[0][0]).toMatchObject({ title: 'Fresh' })
    await waitFor(() => router.state.location.pathname === '/dashboard/posts/post-new/edit')
    expect(titleInput(container)?.value).toBe('Fresh')
    expect(api.updatePostMutation).not.toHaveBeenCalled()
  }, 15000)

  it('sends viewers from /new back to the list rendered through the posts outlet', async () => {
    const { router, container } = await renderAt('/dashboard/posts/new', 'viewer')
    await waitFor(() => router.state.location.pathname.replace(/\/$/, '') === '/dashboard/posts')
    await waitFor(() => container.querySelector('[data-testid="posts-list"]') !== null)
    expect(titleInput(container)).toBeNull()
    expect(api.loadPostEditorPage).not.toHaveBeenCalled()
  })
})
