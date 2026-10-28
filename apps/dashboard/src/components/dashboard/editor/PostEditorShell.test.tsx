// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@vc/core'
import type { MutationResult, PostEditorPageLoad, SeoCheckResult } from '~/types/dashboard'
import { withQueryClient } from '~/test/query'
import { contextQuery } from '~/lib/queries'
const api = vi.hoisted(() => ({
  archivePostMutation: vi.fn(),
  unarchivePostMutation: vi.fn(),
  createPostMutation: vi.fn(),
  checkPostSeo: vi.fn(async (): Promise<SeoCheckResult> => ({ versionNumber: 1, findings: [] })),
  deleteArchivedPostMutation: vi.fn(),
  loadPostAnalytics: vi.fn(async () => null),
  loadPostEditorPage: vi.fn(),
  publishPostMutation: vi.fn(),
  restorePostVersionFn: vi.fn(),
  updatePostMutation: vi.fn(),
  schedulePostMutation: vi.fn(),
  unschedulePostMutation: vi.fn(),
  // Optional upgrade eligibility must never make publishing unavailable.
  loadDashboardOverview: vi.fn(async () => {
    throw new Error('Overview unavailable')
  }),
  navigate: vi.fn(async () => {}),
  blockerOptions: undefined as undefined | {
    shouldBlockFn: () => boolean
    enableBeforeUnload: () => boolean
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search }: { children?: ReactNode; to?: string; search?: unknown }) => {
    const tab = search && typeof search === 'object' && 'tab' in search ? `?tab=${String(search.tab)}` : ''
    return <a href={typeof to === 'string' ? `${to}${tab}` : '#'}>{children}</a>
  },
  useBlocker: (options: { shouldBlockFn: () => boolean; enableBeforeUnload: () => boolean }) => {
    api.blockerOptions = options
    return {
      status: 'idle' as const,
      current: undefined,
      next: undefined,
      action: undefined,
      proceed: undefined,
      reset: undefined,
    }
  },
  useNavigate: () => api.navigate,
}))

vi.mock('@vc/content', () => ({
  renderRichContent: () => ({ warnings: [] }),
}))

vi.mock('~/lib/api-client', () => ({
  archivePostMutation: api.archivePostMutation,
  unarchivePostMutation: api.unarchivePostMutation,
  createPostMutation: api.createPostMutation,
  checkPostSeo: api.checkPostSeo,
  deleteArchivedPostMutation: api.deleteArchivedPostMutation,
  loadPostAnalytics: api.loadPostAnalytics,
  loadPostEditorPage: api.loadPostEditorPage,
  publishPostMutation: api.publishPostMutation,
  restorePostVersionFn: api.restorePostVersionFn,
  updatePostMutation: api.updatePostMutation,
  schedulePostMutation: api.schedulePostMutation,
  unschedulePostMutation: api.unschedulePostMutation,
  loadDashboardOverview: api.loadDashboardOverview,
}))

vi.mock('./RichCanvas', () => ({
  RichCanvas: ({ source, onChange, onUnsafeMarkdownPaste }: { source: string; onChange: (value: string) => void; onUnsafeMarkdownPaste: (value: string) => void }) => (
    <>
      <textarea data-testid="rich-canvas-input" aria-label="Post content" value={source} onChange={(event) => onChange(event.currentTarget.value)} />
      <button type="button" data-testid="type-newer-markdown" onClick={() => onChange('newer local Markdown')}>Type newer Markdown</button>
      <button type="button" data-testid="paste-unsafe-markdown" onClick={() => onUnsafeMarkdownPaste('# Title\n\n<details><summary>More</summary>Hidden</details>')}>Paste unsafe Markdown</button>
    </>
  ),
}))
vi.mock('./MarkdownSource', () => ({ MarkdownSource: ({ value }: { value: string }) => <textarea data-testid="markdown-source" value={value} readOnly /> }))
vi.mock('./PostMetadataRail', () => ({
  PostMetadataRail: ({ metadata, onChange }: { metadata: { slug: string }; onChange: (field: 'slug', value: string) => void }) => (
    <>
      <input id="post-seo-title" data-testid="post-metadata-rail" />
      <input data-testid="rail-slug" aria-label="Slug" value={metadata.slug} onChange={(event) => onChange('slug', event.currentTarget.value)} />
    </>
  ),
}))
vi.mock('./PreviewPane', () => ({ PreviewPane: () => null }))
vi.mock('./VersionHistory', () => ({ VersionHistory: () => null }))
vi.mock('./ReviewView', () => ({ ReviewView: ({ onPublish }: { onPublish?: () => void }) => (
  <div data-testid="review-view"><button type="button" onClick={onPublish}>Review publish</button></div>
) }))

import { PostEditorShell } from './PostEditorShell'

function editorPage(contentMarkdown: string, versionNumber: number): PostEditorPageLoad {
  const post: Post = {
    id: 'post-1',
    siteId: 'site-1',
    title: 'Exact Markdown',
    slug: 'exact-markdown',
    excerpt: null,
    contentMarkdown,
    coverAssetId: null,
    canonicalUrl: null,
    seoTitle: null,
    seoDescription: null,
    status: 'draft',
    publishedAt: null,
    originalPublishedAt: null,
    tags: [],
    createdAt: 1,
    updatedAt: versionNumber,
    presentation: { layout: 'standard', toc: false },
    currentVersionNumber: versionNumber,
    publishedVersionNumber: null,
  }
  return {
    mode: 'edit',
    post,
    assets: [],
    missing: false,
    presetId: 'minimal',
    site: null,
    publicBaseUrl: null,
    currentVersionNumber: versionNumber,
    latestVersion: {
      versionNumber,
      title: post.title,
      slug: post.slug,
      status: post.status,
      changeSummary: null,
      actorType: 'human',
      actorName: 'Owner',
      createdAt: versionNumber,
    },
  }
}

async function settle(rounds = 3) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }
}

function pageFor(id: string, title: string, body: string, versionNumber: number): PostEditorPageLoad {
  const page = editorPage(body, versionNumber)
  const slug = title.toLowerCase().replace(/\s+/g, '-')
  page.post = { ...page.post!, id, title, slug }
  page.latestVersion = { ...page.latestVersion!, title, slug }
  return page
}

function newPostPage(): PostEditorPageLoad {
  return { ...editorPage('', 1), mode: 'new', post: null, currentVersionNumber: null, latestVersion: null }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** One QueryClient for the whole test so route-param rerenders keep the tree mounted. */
function mountEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return {
    client,
    container,
    render: (postId?: string) => act(async () => root.render(<QueryClientProvider client={client}><PostEditorShell postId={postId} /></QueryClientProvider>)),
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

/** React-controlled inputs only see a change through the native value setter plus an input event. */
async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function buttonWithText(root: ParentNode, text: string) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(text))
}

function submitForm(container: HTMLElement) {
  return act(async () => {
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('PostEditorShell', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    // Per-test implementations must not leak into the next test.
    api.loadPostEditorPage.mockReset()
    api.createPostMutation.mockReset()
    api.updatePostMutation.mockReset()
    api.publishPostMutation.mockReset()
    api.loadDashboardOverview.mockReset().mockRejectedValue(new Error('Overview unavailable'))
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    window.localStorage.clear()
  })

  it('offers copy and open links for a saved draft', async () => {
    const page = editorPage('Preview body', 2)
    page.previewUrl = 'https://blog.example/preview/opaque-token'
    api.loadPostEditorPage.mockResolvedValueOnce(page)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    const copy = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Copy preview link'))
    expect(copy).toBeDefined()
    expect(container.querySelector('a[href="https://blog.example/preview/opaque-token"]')?.textContent).toContain('Open private preview')
    await act(async () => copy?.click())
    expect(writeText).toHaveBeenCalledWith(page.previewUrl)
    expect(copy?.textContent).toContain('Link copied')
    await act(async () => root.unmount())
    container.remove()
  })

  it('offers permanent deletion only for an archived post and calls the dashboard API after two clicks', async () => {
    const page = editorPage('Archive', 2)
    page.post = { ...page.post!, status: 'archived' }
    api.loadPostEditorPage.mockResolvedValueOnce(page)
    api.deleteArchivedPostMutation.mockResolvedValueOnce({ kind: 'ok', code: 'post_deleted' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    const settings = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Settings'))
    await act(async () => settings?.click())
    const action = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Delete post forever') || button.textContent?.includes('Delete “Exact Markdown” forever?'))
    expect(action()).toBeDefined()
    await act(async () => action()?.click())
    expect(api.deleteArchivedPostMutation).not.toHaveBeenCalled()
    await act(async () => action()?.click())
    expect(api.deleteArchivedPostMutation).toHaveBeenCalledWith({ postId: 'post-1' })
    await act(async () => root.unmount())
  })

  it('hides unavailable preview links and restores an archived post to draft', async () => {
    const archived = editorPage('Archived body', 2)
    archived.post = { ...archived.post!, status: 'archived' }
    archived.previewUrl = 'https://blog.example/preview/expired'
    api.loadPostEditorPage.mockResolvedValueOnce(archived)
    api.loadPostEditorPage.mockResolvedValueOnce({ ...archived, post: { ...archived.post, status: 'draft' } })
    api.unarchivePostMutation.mockResolvedValueOnce({ kind: 'ok', code: 'post_unarchived' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    expect(container.textContent).toContain('Restoring brings it back as a draft')
    expect(container.textContent).not.toContain('Copy preview link')
    expect(container.textContent).not.toContain('Open preview')
    const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Restore')
    expect(restore).toBeDefined()
    await act(async () => restore?.click())
    await settle()
    expect(api.unarchivePostMutation).toHaveBeenCalledWith({ postId: 'post-1' })
    expect(container.textContent).toContain('Copy preview link')
    await act(async () => root.unmount())
  })

  it('switches an unsafe paste to Markdown with the source intact', async () => {
    api.loadPostEditorPage.mockResolvedValue(editorPage('Intro', 1))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="paste-unsafe-markdown"]')?.click())
    await settle()
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-source"]')?.value)
      .toBe('Intro\n\n# Title\n\n<details><summary>More</summary>Hidden</details>')
    expect(container.textContent).toContain('Pasted in Markdown mode')
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps Markdown typed while a manual save is in flight and saves it right after', async () => {
    let resolveUpdate: ((value: { kind: 'ok'; code: string; versionNumber: number }) => void) | undefined
    const updatePending = new Promise<{ kind: 'ok'; code: string; versionNumber: number }>((resolve) => {
      resolveUpdate = resolve
    })
    api.loadPostEditorPage.mockResolvedValueOnce(editorPage('submitted Markdown', 1))
    api.updatePostMutation
      .mockReturnValueOnce(updatePending)
      .mockResolvedValueOnce({ kind: 'ok', code: 'post_saved', versionNumber: 2 })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()

    const form = container.querySelector('form')
    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')
    expect(form).toBeTruthy()
    expect(editor?.value).toBe('submitted Markdown')
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="type-newer-markdown"]')?.click())
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(api.updatePostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation.mock.calls[0][0]).toMatchObject({ expectedVersionNumber: 1, contentMarkdown: 'newer local Markdown' })
    expect(api.blockerOptions?.shouldBlockFn()).toBe(true)
    expect(api.blockerOptions?.enableBeforeUnload()).toBe(true)

    await act(async () => resolveUpdate?.({ kind: 'ok', code: 'post_saved', versionNumber: 2 }))
    await settle()

    expect(editor?.value).toBe('newer local Markdown')
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)
    expect(container.textContent).toContain('Saved · v2')
    expect(api.navigate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  })

  it('opens an agent-written draft in review', async () => {
    const page = editorPage('agent Markdown', 3)
    page.latestVersion = { ...page.latestVersion!, actorType: 'api_key', actorName: 'Claude' }
    api.loadPostEditorPage.mockResolvedValueOnce(page)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    expect(container.querySelector('[data-testid="review-view"]')).toBeTruthy()
    await act(async () => root.unmount())
    container.remove()
  })

  it('leaves Review mode and opens the rail when the SEO Review action fires on desktop', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    window.localStorage.setItem('vc-editor-view', 'edit')
    const page = editorPage('agent Markdown', 3)
    page.latestVersion = { ...page.latestVersion!, actorType: 'api_key', actorName: 'Claude' }
    api.loadPostEditorPage.mockResolvedValueOnce(page)
    api.checkPostSeo.mockResolvedValue({
      versionNumber: 3,
      findings: [{ code: 'title-length', severity: 'error' as const, field: 'seoTitle', message: 'Title too short', fix: 'Lengthen it' }],
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    expect(container.querySelector('[data-testid="review-view"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="post-metadata-rail"]')).toBeNull()
    // The debounced SEO check must settle before the dialog lists findings.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    const publish = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Review publish')
    await act(async () => publish?.click())
    await settle()
    const review = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Review')
    expect(review).toBeTruthy()
    await act(async () => (review as HTMLButtonElement).click())
    await settle()
    // Review mode is gone and the rail mounted, so the focus target exists.
    expect(container.querySelector('[data-testid="review-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="post-metadata-rail"]')).toBeTruthy()
    for (let i = 0; i < 20 && document.activeElement?.id !== 'post-seo-title'; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    }
    expect(document.activeElement?.id).toBe('post-seo-title')
    await act(async () => root.unmount())
    container.remove()
  })
  it('leaves mobile post settings when the already-chosen view is picked again', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    api.loadPostEditorPage.mockResolvedValueOnce(editorPage('human Markdown', 1))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell postId="post-1" />)))
    await settle()
    const write = [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="View"] [role="radio"]')]
      .find((radio) => radio.textContent === 'Write')
    expect(write?.getAttribute('aria-checked')).toBe('true')
    const settingsToggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Post settings')
    await act(async () => settingsToggle?.click())
    expect(container.querySelector('[data-testid="post-metadata-rail"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="rich-canvas-input"]')).toBeNull()
    await act(async () => write?.click())
    expect(container.querySelector('[data-testid="post-metadata-rail"]')).toBeNull()
    expect(container.querySelector('[data-testid="rich-canvas-input"]')).toBeTruthy()
    expect(write?.getAttribute('aria-checked')).toBe('true')
    await act(async () => root.unmount())
    container.remove()
  })
  it('saves a new post once, then updates it, and never lets a title edit move a live URL', async () => {
    const page = editorPage('', 1)
    api.loadPostEditorPage.mockResolvedValueOnce({ ...page, mode: 'new', post: null, currentVersionNumber: null, latestVersion: null })
    api.createPostMutation.mockResolvedValueOnce({ kind: 'ok', code: 'post_created', postId: 'post-1', versionNumber: 1 })
    const draft = editorPage('', 1)
    draft.post = { ...draft.post!, title: 'Hello', slug: 'hello' }
    const live = editorPage('', 1)
    live.post = { ...live.post!, title: 'Hello', slug: 'hello', status: 'published', publishedVersionNumber: 1, publishedAt: 5 }
    api.loadPostEditorPage.mockResolvedValueOnce(draft).mockResolvedValue(live)
    api.publishPostMutation.mockResolvedValueOnce({ kind: 'ok', code: 'post_published' })
    api.updatePostMutation.mockResolvedValue({ kind: 'ok', code: 'post_saved', versionNumber: 2 })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<PostEditorShell />)))
    await settle()

    const setTitle = async (value: string) => {
      const input = container.querySelector<HTMLInputElement>('#post-title')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => {
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const submit = async () => {
      await act(async () => {
        container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await settle()
    }

    await setTitle('Hello')
    await submit()
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.createPostMutation.mock.calls[0][0]).toMatchObject({ title: 'Hello', slug: 'hello' })

    // Publish v1 through the confirm dialog.
    const publishButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Publish v1'))
    await act(async () => publishButton?.click())
    await settle()
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.includes('Publish v1'))
    expect(confirm).toBeTruthy()
    await act(async () => (confirm as HTMLButtonElement).click())
    await settle()
    expect(api.publishPostMutation).toHaveBeenCalledWith({ postId: 'post-1', expectedVersionNumber: 1 })

    await setTitle('Hello again')
    await submit()
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation.mock.calls[0][0]).toMatchObject({ postId: 'post-1', title: 'Hello again', slug: 'hello' })

    await act(async () => root.unmount())
    container.remove()
  })

  it('drops post A when the route moves to post B, and saves or publishes B only with B’s own version', async () => {
    const postA = pageFor('post-a', 'Post A', 'A body', 3)
    const postB = pageFor('post-b', 'Post B', 'B body', 7)
    const liveB = pageFor('post-b', 'Post B', 'B edited', 8)
    liveB.post = { ...liveB.post!, status: 'published', publishedVersionNumber: 8, publishedAt: 9 }
    const bLoad = deferred<PostEditorPageLoad>()
    const aUpdate = deferred<MutationResult>()
    let bPublished = false
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => {
      if (postId === 'post-a') return postA
      if (postId === 'post-b') return bPublished ? liveB : bLoad.promise
      throw new Error(`Unexpected load for ${postId}`)
    })
    api.updatePostMutation.mockImplementation(async (input: { postId: string; expectedVersionNumber: number }) => (
      input.postId === 'post-a' ? aUpdate.promise : { kind: 'ok', code: 'post_saved', versionNumber: input.expectedVersionNumber + 1 }
    ))
    api.publishPostMutation.mockImplementation(async () => {
      bPublished = true
      return { kind: 'ok', code: 'post_published' }
    })
    // An earlier test leaves SEO errors behind; this approval path needs a clean check.
    api.checkPostSeo.mockResolvedValue({ versionNumber: 8, findings: [] })
    const bSaves = () => api.updatePostMutation.mock.calls.map(([input]) => input).filter((input) => input.postId === 'post-b')
    const body = '[data-testid="rich-canvas-input"]'

    const editor = mountEditor()
    const { container } = editor
    await editor.render('post-a')
    await settle()
    expect(container.querySelector<HTMLInputElement>('#post-title')?.value).toBe('Post A')

    // A has a save in flight and more unsaved typing when the route param changes.
    await typeInto(container.querySelector<HTMLTextAreaElement>(body)!, 'A edited')
    await submitForm(container)
    expect(api.updatePostMutation).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-a', expectedVersionNumber: 3, contentMarkdown: 'A edited' }))
    await typeInto(container.querySelector<HTMLTextAreaElement>(body)!, 'A edited twice')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await editor.render('post-b')
    await advance(0)
    expect(container.querySelector<HTMLInputElement>('#post-title')?.value ?? '').not.toBe('Post A')
    expect(container.querySelector<HTMLTextAreaElement>(body)?.value ?? '').not.toContain('A edited')
    expect(buttonWithText(container, 'Publish v3')).toBeUndefined()

    // While B loads: a save shortcut, A's late save response, and autosave ticks must not touch B.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    })
    await act(async () => aUpdate.resolve({ kind: 'ok', code: 'post_saved', versionNumber: 4 }))
    await advance(5000)
    expect(bSaves()).toEqual([])
    expect(api.publishPostMutation).not.toHaveBeenCalled()

    vi.useRealTimers()
    await act(async () => bLoad.resolve(postB))
    await settle()
    expect(container.querySelector<HTMLInputElement>('#post-title')?.value).toBe('Post B')
    expect(container.querySelector<HTMLTextAreaElement>(body)?.value).toBe('B body')
    expect(buttonWithText(container, 'Publish v4')).toBeUndefined()
    expect(buttonWithText(container, 'Publish v7')).toBeDefined()

    // Approving B saves B's content against B's version, then publishes exactly that version.
    await typeInto(container.querySelector<HTMLTextAreaElement>(body)!, 'B edited')
    await act(async () => buttonWithText(container, 'Publish v7')?.click())
    await settle()
    expect(bSaves()).toHaveLength(1)
    expect(bSaves()[0]).toMatchObject({ postId: 'post-b', expectedVersionNumber: 7, title: 'Post B', contentMarkdown: 'B edited' })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    await act(async () => buttonWithText(dialog!, 'Publish v8')?.click())
    await settle()
    expect(api.publishPostMutation).toHaveBeenCalledTimes(1)
    expect(api.publishPostMutation).toHaveBeenCalledWith({ postId: 'post-b', expectedVersionNumber: 8 })

    await editor.unmount()
  })

  it('adopts a just-created post in place: typing during the create survives, focus and caret stay, and later typing saves to the new id', async () => {
    const created = deferred<MutationResult>()
    const serverCopy = pageFor('post-new', 'Hello', '', 1)
    serverCopy.previewUrl = 'https://blog.example/preview/new-token'
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId === 'post-new' ? serverCopy : newPostPage()))
    api.createPostMutation.mockReturnValueOnce(created.promise)
    api.updatePostMutation.mockImplementation(async (input: { expectedVersionNumber: number }) => ({ kind: 'ok', code: 'post_saved', versionNumber: input.expectedVersionNumber + 1 }))

    const editor = mountEditor()
    const { container } = editor
    await editor.render()
    await settle()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const title = container.querySelector<HTMLInputElement>('#post-title')!
    const body = container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')!
    await act(async () => title.focus())
    await typeInto(title, 'Hello')
    await advance(2500)
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.createPostMutation.mock.calls[0][0]).toMatchObject({ title: 'Hello', slug: 'hello' })

    // The writer keeps going while the create is in flight, caret mid-title.
    await typeInto(title, 'Hello world')
    await typeInto(body, 'Body typed in flight')
    title.setSelectionRange(5, 5)
    expect(document.activeElement).toBe(title)

    await act(async () => created.resolve({ kind: 'ok', code: 'post_created', postId: 'post-new', versionNumber: 1 }))
    await advance(0)
    expect(api.navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: '/dashboard/posts/$postId/edit',
      params: { postId: 'post-new' },
      replace: true,
      ignoreBlocker: true,
    }))

    // The router answers with the new param; the session is adopted, not remounted or reset by the metadata load.
    await editor.render('post-new')
    await advance(0)
    await advance(0)
    expect(container.querySelector('#post-title')).toBe(title)
    expect(container.querySelector('[data-testid="rich-canvas-input"]')).toBe(body)
    expect(title.value).toBe('Hello world')
    expect(body.value).toBe('Body typed in flight')
    expect(document.activeElement).toBe(title)
    expect([title.selectionStart, title.selectionEnd]).toEqual([5, 5])
    expect(container.querySelector(`a[href="${serverCopy.previewUrl}"]`)).toBeTruthy()

    await typeInto(title, 'Hello world again')
    await advance(2500)
    await advance(0)
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    const updates = api.updatePostMutation.mock.calls.map(([input]) => input)
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.every((input) => input.postId === 'post-new')).toBe(true)
    expect(updates[0]).toMatchObject({ expectedVersionNumber: 1 })
    expect(updates.at(-1)).toMatchObject({ title: 'Hello world again', contentMarkdown: 'Body typed in flight' })
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)

    await editor.unmount()
  })

  it('keeps a created post editable when its preview details fail to load, and Retry fills them in without touching the writing', async () => {
    const serverCopy = pageFor('post-new', 'Hello', '', 1)
    serverCopy.previewUrl = 'https://blog.example/preview/recovered-token'
    let metadataLoads = 0
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => {
      if (!postId) return newPostPage()
      if (postId !== 'post-new') throw new Error(`Unexpected load for ${postId}`)
      metadataLoads += 1
      if (metadataLoads === 1) throw new TypeError('Failed to fetch')
      return serverCopy
    })
    api.createPostMutation.mockResolvedValueOnce({ kind: 'ok', code: 'post_created', postId: 'post-new', versionNumber: 1 })
    api.updatePostMutation.mockImplementation(async (input: { expectedVersionNumber: number }) => ({ kind: 'ok', code: 'post_saved', versionNumber: input.expectedVersionNumber + 1 }))
    const editor = mountEditor()
    const { container } = editor
    // Four lockstep lookups by the button's exact accessible name.
    const retryButton = () => [...container.querySelectorAll('button')]
      .find((button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === 'Retry preview details')
    await editor.render()
    await settle()

    const title = container.querySelector<HTMLInputElement>('#post-title')!
    const body = container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')!
    await typeInto(title, 'Hello')
    await submitForm(container)
    await settle()
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(metadataLoads).toBe(1)

    // The router answers with the new param; the failed metadata fetch leaves the created session usable.
    await editor.render('post-new')
    await settle()
    expect(retryButton()).toBeDefined()
    expect(container.querySelector(`a[href="${serverCopy.previewUrl}"]`)).toBeNull()
    expect(title.value).toBe('Hello')

    // Newer writing saves as an update against v1, never as a second create.
    await typeInto(title, 'Hello world')
    await typeInto(body, 'Body written after create')
    await submitForm(container)
    await settle()
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation.mock.calls[0][0]).toMatchObject({
      postId: 'post-new',
      expectedVersionNumber: 1,
      title: 'Hello world',
      contentMarkdown: 'Body written after create',
    })
    expect(buttonWithText(container, 'Publish v2')).toBeDefined()

    // Retry fetches only server metadata: the preview link appears, the stale v1 copy changes nothing local.
    await act(async () => retryButton()!.click())
    await settle()
    expect(metadataLoads).toBe(2)
    expect(container.querySelector(`a[href="${serverCopy.previewUrl}"]`)).toBeTruthy()
    expect(retryButton()).toBeUndefined()
    expect(container.querySelector('#post-title')).toBe(title)
    expect(container.querySelector('[data-testid="rich-canvas-input"]')).toBe(body)
    expect(title.value).toBe('Hello world')
    expect(body.value).toBe('Body written after create')
    expect(buttonWithText(container, 'Publish v2')).toBeDefined()
    expect(buttonWithText(container, 'Publish v1')).toBeUndefined()
    expect(api.updatePostMutation).toHaveBeenCalledTimes(1)
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)

    // The next save still builds on v2.
    await typeInto(body, 'Body written after retry')
    await submitForm(container)
    await settle()
    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.updatePostMutation).toHaveBeenCalledTimes(2)
    expect(api.updatePostMutation.mock.calls[1][0]).toMatchObject({ postId: 'post-new', expectedVersionNumber: 2, contentMarkdown: 'Body written after retry' })

    await editor.unmount()
  })

  it('retries a title-derived slug as -2 then -3 when it collides on create', async () => {
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => (postId ? pageFor(postId, 'Hello', '', 1) : newPostPage()))
    api.createPostMutation
      .mockResolvedValueOnce({ kind: 'error', code: 'slug_conflict' })
      .mockResolvedValueOnce({ kind: 'error', code: 'slug_conflict' })
      .mockResolvedValueOnce({ kind: 'ok', code: 'post_created', postId: 'post-1', versionNumber: 1 })
    const editor = mountEditor()
    const { container } = editor
    await editor.render()
    await settle()

    const title = container.querySelector<HTMLInputElement>('#post-title')!
    await typeInto(title, 'Hello')
    await submitForm(container)
    await settle()

    expect(api.createPostMutation.mock.calls.map(([input]) => input.slug)).toEqual(['hello', 'hello-2', 'hello-3'])
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(title.value).toBe('Hello')
    expect(api.navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { postId: 'post-1' } }))

    await editor.unmount()
  })

  it('never rewrites a slug the writer typed: a collision fails with that slug left as written', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    api.loadPostEditorPage.mockResolvedValue(newPostPage())
    api.createPostMutation.mockResolvedValue({ kind: 'error', code: 'slug_conflict' })
    const editor = mountEditor()
    const { container } = editor
    await editor.render()
    await settle()

    const slug = container.querySelector<HTMLInputElement>('[data-testid="rail-slug"]')!
    const title = container.querySelector<HTMLInputElement>('#post-title')!
    await typeInto(slug, 'my-hello')
    await typeInto(title, 'Hello')
    expect(slug.value).toBe('my-hello')
    await submitForm(container)
    await settle()

    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(api.createPostMutation.mock.calls[0][0]).toMatchObject({ title: 'Hello', slug: 'my-hello' })
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('[data-testid="rail-slug"]')?.value).toBe('my-hello')
    expect(title.value).toBe('Hello')
    expect(api.navigate).not.toHaveBeenCalled()

    await editor.unmount()
  })

  it('stops generated slug attempts at -5 and leaves the unsaved writing available with the conflict', async () => {
    api.loadPostEditorPage.mockResolvedValue(newPostPage())
    api.createPostMutation.mockResolvedValue({ kind: 'error', code: 'slug_conflict' })
    const editor = mountEditor()
    await editor.render()
    await settle()
    await typeInto(editor.container.querySelector<HTMLInputElement>('#post-title')!, 'Hello')
    await submitForm(editor.container)
    await settle()

    expect(api.createPostMutation.mock.calls.map(([input]) => input.slug)).toEqual(['hello', 'hello-2', 'hello-3', 'hello-4', 'hello-5'])
    expect(editor.container.querySelector('[role="alert"]')).not.toBeNull()
    expect(editor.container.querySelector<HTMLInputElement>('#post-title')?.value).toBe('Hello')
    expect(api.blockerOptions?.shouldBlockFn()).toBe(true)
    expect(api.navigate).not.toHaveBeenCalled()
    await editor.unmount()
  })

  it.each([1, 2])('stops a stale create after attempt %i conflicts without creating another draft', async (attempt) => {
    const pending = deferred<MutationResult>()
    const postB = pageFor('post-b', 'Post B', 'B body', 7)
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => postId ? postB : newPostPage())
    for (let index = 1; index < attempt; index += 1) {
      api.createPostMutation.mockResolvedValueOnce({ kind: 'error', code: 'slug_conflict' })
    }
    api.createPostMutation.mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ kind: 'ok', code: 'post_created', postId: 'unwanted-draft', versionNumber: 1 })
    const editor = mountEditor()
    await editor.render()
    await settle()
    await typeInto(editor.container.querySelector<HTMLInputElement>('#post-title')!, 'Hello')
    await submitForm(editor.container)
    await editor.render('post-b')
    await settle()
    await act(async () => pending.resolve({ kind: 'error', code: 'slug_conflict' }))
    await settle()

    expect(api.createPostMutation).toHaveBeenCalledTimes(attempt)
    expect(api.navigate).not.toHaveBeenCalled()
    expect(editor.container.querySelector<HTMLInputElement>('#post-title')?.value).toBe('Post B')
    expect(editor.container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')?.value).toBe('B body')
    expect(editor.container.querySelector('[role="alert"]')).toBeNull()
    await editor.unmount()
  })

  it('opens approval on the first Publish click when create saves an automatically suffixed URL', async () => {
    const savedPage = pageFor('post-new', 'Hello', '', 1)
    savedPage.post!.slug = 'hello-2'
    savedPage.latestVersion!.slug = 'hello-2'
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => postId ? savedPage : newPostPage())
    api.createPostMutation.mockResolvedValueOnce({ kind: 'error', code: 'slug_conflict' })
      .mockResolvedValueOnce({ kind: 'ok', code: 'post_created', postId: 'post-new', versionNumber: 1 })
    const editor = mountEditor()
    await editor.render()
    await settle()
    await typeInto(editor.container.querySelector<HTMLInputElement>('#post-title')!, 'Hello')
    await act(async () => buttonWithText(editor.container.querySelector('header')!, 'Publish')!.click())
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(buttonWithText(document.querySelector('[role="dialog"]')!, 'Publish v1 now')).toBeDefined()
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)
    expect(editor.container.querySelector('header [role="status"]')?.textContent).toContain('Saved')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await advance(5000)
    expect(api.updatePostMutation).not.toHaveBeenCalled()
    await editor.unmount()
  })

  it.each(['body', 'title', 'slug'])('keeps in-flight %s edits dirty after a suffixed create, then saves them against the created version', async (field) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const created = deferred<MutationResult>()
    const savedPage = pageFor('post-new', 'Hello', '', 1)
    savedPage.post!.slug = 'hello-2'
    savedPage.latestVersion!.slug = 'hello-2'
    api.loadPostEditorPage.mockImplementation(async ({ postId }: { postId?: string }) => postId ? savedPage : newPostPage())
    api.createPostMutation.mockResolvedValueOnce({ kind: 'error', code: 'slug_conflict' })
      .mockReturnValueOnce(created.promise)
    api.updatePostMutation.mockResolvedValue({ kind: 'ok', code: 'post_saved', versionNumber: 2 })
    const editor = mountEditor()
    await editor.render()
    await settle()
    const title = editor.container.querySelector<HTMLInputElement>('#post-title')!
    const body = editor.container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')!
    const slug = editor.container.querySelector<HTMLInputElement>('[data-testid="rail-slug"]')!
    await typeInto(title, 'Hello')
    await submitForm(editor.container)
    if (field === 'body') await typeInto(body, 'New body')
    if (field === 'title') await typeInto(title, 'Hello world')
    if (field === 'slug') await typeInto(slug, 'chosen-url')
    await act(async () => created.resolve({ kind: 'ok', code: 'post_created', postId: 'post-new', versionNumber: 1 }))
    await settle()

    const expectedSlug = field === 'slug' ? 'chosen-url' : field === 'title' ? 'hello-world' : 'hello-2'
    expect(title.value).toBe(field === 'title' ? 'Hello world' : 'Hello')
    expect(body.value).toBe(field === 'body' ? 'New body' : '')
    expect(slug.value).toBe(expectedSlug)
    expect(api.blockerOptions?.shouldBlockFn()).toBe(true)
    await submitForm(editor.container)
    await settle()
    expect(api.updatePostMutation).toHaveBeenCalledWith(expect.objectContaining({
      postId: 'post-new', expectedVersionNumber: 1, slug: expectedSlug,
      title: title.value, contentMarkdown: body.value,
    }))
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)
    await editor.unmount()
  })

  it('opens approval and publishes while optional upgrade eligibility remains unavailable', async () => {
    const overview = deferred<never>()
    api.loadDashboardOverview.mockReturnValue(overview.promise)
    const savedPage = pageFor('post-nudge', 'Hello', 'Body', 1)
    const livePage = pageFor('post-nudge', 'Hello', 'Body', 1)
    livePage.post = { ...livePage.post!, status: 'published', publishedVersionNumber: 1, publishedAt: 2 }
    let live = false
    api.loadPostEditorPage.mockImplementation(async () => live ? livePage : savedPage)
    api.publishPostMutation.mockImplementation(async () => {
      live = true
      return { kind: 'ok', code: 'post_published' }
    })
    const editor = mountEditor()
    const user = { id: 'owner-nudge', name: 'Owner', email: 'owner@example.test' }
    editor.client.setQueryData(contextQuery.queryKey, {
      googleEnabled: false, githubEnabled: false, user, apps: [],
      siteSetupComplete: true, siteDisplayName: 'Nudge blog',
      app: {
        siteId: 'site-nudge', workspaceId: 'workspace-nudge', user,
        actor: { type: 'human', id: user.id, name: user.name, role: 'owner' },
      },
    })
    await editor.render('post-nudge')
    await settle()
    await act(async () => buttonWithText(editor.container.querySelector('header')!, 'Publish')!.click())
    await settle()
    expect(api.loadDashboardOverview).toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    await act(async () => buttonWithText(dialog!, 'Publish v1 now')!.click())
    await settle()

    expect(live).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(buttonWithText(editor.container.querySelector('header')!, 'Publish')).toBeUndefined()
    expect(window.localStorage.getItem('vc-first-publish-nudge:site-nudge')).toBeNull()
    await editor.unmount()
  })

  it('keeps an unsaved post at the draft cap out of Publish and links straight to billing', async () => {
    api.loadPostEditorPage.mockResolvedValue(newPostPage())
    api.createPostMutation.mockResolvedValue({ kind: 'error', code: 'draft_limit' })
    const editor = mountEditor()
    const { container } = editor
    await editor.render()
    await settle()

    const title = container.querySelector<HTMLInputElement>('#post-title')!
    await typeInto(title, 'Over the cap')
    expect(buttonWithText(container.querySelector('header')!, 'Publish')?.disabled).toBe(false)
    await submitForm(container)
    await settle()

    expect(api.createPostMutation).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
    expect(container.querySelector('a[href*="billing"]')).toBeTruthy()
    expect(buttonWithText(container.querySelector('header')!, 'Publish')?.disabled).toBe(true)
    expect(title.value).toBe('Over the cap')
    expect(api.publishPostMutation).not.toHaveBeenCalled()

    await editor.unmount()
  })
})
