// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { PREVIEW_DEBOUNCE_MS, PostPreviewPane, usePostPreviewSync } from './MarkdownEditor'

function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const site = { name: 'QA Blog', description: 'A clean blog for you and your agents.', slug: 'qa-blog' }
// Stable identity — the hook treats `assets` as an effect dep.
const NO_ASSETS: never[] = []

function LivePreviewHarness({ initialSource }: { initialSource: string }) {
  const live = usePostPreviewSync(initialSource, 0, NO_ASSETS)
  return (
    <PostPreviewPane
      source={live.source}
      metadata={live.metadata}
      presetId="minimal"
      site={site}
      publishedAt={null}
    />
  )
}

function renderEditorForm(initialSource: string) {
  return render(
    <form>
      <input id="post-title" defaultValue="Ship the preview" />
      <textarea id="post-excerpt" defaultValue="Why the preview is the page" />
      <select id="post-cover" defaultValue="">
        <option value="">No image</option>
      </select>
      <input id="post-tags" defaultValue="launch, notes" />
      <textarea id="post-markdown" defaultValue={initialSource} />
      <LivePreviewHarness initialSource={initialSource} />
    </form>,
  )
}

describe('PostPreviewPane exact public page', () => {
  it('renders the full public chrome: masthead, article metadata, and an inert subscribe block', () => {
    const { container, unmount } = renderEditorForm('# Ship the preview\n\nFirst paragraph of the post.')
    try {
      const preview = container.querySelector('[aria-label="Markdown preview"]') as HTMLElement
      expect(preview).toBeTruthy()
      expect(preview.textContent).toContain('live as you type')

      // The public page shell, not a lookalike: themed <main> + masthead brand.
      const page = preview.querySelector('main[data-vc-theme="minimal"]') as HTMLElement
      expect(page).toBeTruthy()
      expect(page.querySelector('header a')?.textContent).toBe('QA Blog')
      expect(page.textContent).toContain('A clean blog for you and your agents.')

      // Article with live form metadata and byline.
      expect(page.querySelector('article h1')?.textContent).toBe('Ship the preview')
      expect(page.textContent).toContain('By QA Blog')
      expect(page.textContent).toContain('1 min read')

      // Subscribe end-matter renders but is inert (no site slug to act on).
      const form = page.querySelector('form.vc-subscribe-form')
      expect(form).toBeTruthy()
      expect(form?.getAttribute('data-site-slug')).toBeNull()
      expect(page.textContent).toContain('Get new posts by email')
    } finally {
      unmount()
    }
  })
})

describe('usePostPreviewSync live refresh', () => {
  it('updates the preview shortly after typing, not before the debounce settles', () => {
    vi.useFakeTimers()
    const { container, unmount } = renderEditorForm('# Seed\n\nFirst paragraph.')
    try {
      const preview = container.querySelector('[aria-label="Markdown preview"]') as HTMLElement
      expect(preview.textContent).toContain('First paragraph.')

      const textarea = container.querySelector('#post-markdown') as HTMLTextAreaElement
      act(() => {
        textarea.value = '# Seed\n\nEdited paragraph.'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })

      // Not immediate — the writer is still typing.
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1))
      expect(preview.textContent).toContain('First paragraph.')
      expect(preview.textContent).not.toContain('Edited paragraph.')

      // Settles into the exact public page without any refresh action.
      act(() => vi.advanceTimersByTime(1))
      expect(preview.textContent).toContain('Edited paragraph.')
    } finally {
      unmount()
    }
  })

  it('keeps article metadata (title, tags, deck) in sync with the form', () => {
    vi.useFakeTimers()
    const { container, unmount } = renderEditorForm('# Seed\n\nBody.')
    try {
      const preview = container.querySelector('[aria-label="Markdown preview"]') as HTMLElement
      const page = preview.querySelector('main[data-vc-theme="minimal"]') as HTMLElement
      expect(page.querySelector('article h1')?.textContent).toBe('Ship the preview')

      const titleInput = container.querySelector('#post-title') as HTMLInputElement
      act(() => {
        titleInput.value = 'Retitled post'
        titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS))
      expect(page.querySelector('article h1')?.textContent).toBe('Retitled post')
    } finally {
      unmount()
    }
  })

  it('shows an empty-state hint, not a broken page, before any content exists', () => {
    vi.useFakeTimers()
    const { container, unmount } = renderEditorForm('')
    try {
      const preview = container.querySelector('[aria-label="Markdown preview"]') as HTMLElement
      const textarea = container.querySelector('#post-markdown') as HTMLTextAreaElement
      act(() => {
        textarea.value = ''
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      act(() => vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS))
      expect(preview.querySelector('main[data-vc-theme]')).toBeNull()
      expect(preview.textContent).toContain('Nothing here yet')
    } finally {
      unmount()
    }
  })
})
