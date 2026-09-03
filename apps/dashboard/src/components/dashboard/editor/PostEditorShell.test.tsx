// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@vc/core'
import type { PostEditorPageLoad } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  archivePostMutation: vi.fn(),
  createPostMutation: vi.fn(),
  loadPostEditorPage: vi.fn(),
  publishPostMutation: vi.fn(),
  restorePostVersionFn: vi.fn(),
  updatePostMutation: vi.fn(),
  navigate: vi.fn(),
  blockerOptions: undefined as undefined | {
    shouldBlockFn: () => boolean
    enableBeforeUnload: () => boolean
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
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
  createPostMutation: api.createPostMutation,
  loadPostEditorPage: api.loadPostEditorPage,
  publishPostMutation: api.publishPostMutation,
  restorePostVersionFn: api.restorePostVersionFn,
  updatePostMutation: api.updatePostMutation,
}))

vi.mock('./RichCanvas', () => ({
  RichCanvas: ({ source, onChange }: { source: string; onChange: (value: string) => void }) => (
    <>
      <textarea data-testid="rich-canvas-input" value={source} readOnly />
      <button type="button" data-testid="type-newer-markdown" onClick={() => onChange('newer local Markdown')}>Type newer Markdown</button>
    </>
  ),
}))
vi.mock('./MarkdownSource', () => ({ MarkdownSource: () => null }))
vi.mock('./PostMetadataRail', () => ({ PostMetadataRail: () => null }))
vi.mock('./PreviewPane', () => ({ PreviewPane: () => null }))
vi.mock('./VersionHistory', () => ({ VersionHistory: () => null }))

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

describe('PostEditorShell', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('preserves Markdown typed while a manual save and its readback are in flight', async () => {
    let resolveUpdate: ((value: { kind: 'ok'; code: string; versionNumber: number }) => void) | undefined
    const updatePending = new Promise<{ kind: 'ok'; code: string; versionNumber: number }>((resolve) => {
      resolveUpdate = resolve
    })
    api.loadPostEditorPage
      .mockResolvedValueOnce(editorPage('submitted Markdown', 1))
      .mockResolvedValueOnce(editorPage('submitted Markdown', 2))
    api.updatePostMutation.mockReturnValue(updatePending)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<PostEditorShell postId="post-1" />))
    await settle()

    const form = container.querySelector('form')
    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="rich-canvas-input"]')
    expect(form).toBeTruthy()
    expect(editor?.value).toBe('submitted Markdown')
    expect(api.blockerOptions?.shouldBlockFn()).toBe(false)

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="type-newer-markdown"]')?.click())
    expect(editor?.value).toBe('newer local Markdown')
    expect(api.blockerOptions?.shouldBlockFn()).toBe(true)
    expect(api.blockerOptions?.enableBeforeUnload()).toBe(true)

    await act(async () => resolveUpdate?.({ kind: 'ok', code: 'updated', versionNumber: 2 }))
    await settle()

    expect(editor?.value).toBe('newer local Markdown')
    expect(container.textContent).toContain('Newer local changes remain unsaved.')
    expect(api.navigate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  })
})
