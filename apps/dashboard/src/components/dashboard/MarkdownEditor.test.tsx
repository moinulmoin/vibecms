// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import {
  MarkdownEditor,
  PREVIEW_DEBOUNCE_MS,
  PostPreviewPane,
  applySlashCommand,
  filterSlashCommands,
  slashQueryAt,
  usePostPreviewSync,
} from './MarkdownEditor'

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

// React keeps its own value tracker on inputs: assigning el.value directly
// marks the new value as "already seen", so onChange never fires. Going
// through the prototype setter bypasses the tracker and simulates real typing.
function typeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.setSelectionRange(value.length, value.length)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

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

describe('slash commands', () => {
  it('detects a /query only at the start of a line, with the caret inside it', () => {
    expect(slashQueryAt('/hea', 4)).toEqual({ start: 0, query: 'hea' })
    expect(slashQueryAt('para one\n/he', 12)).toEqual({ start: 9, query: 'he' })
    // Mid-word slash (e.g. a date or URL fragment) is not a command.
    expect(slashQueryAt('a/b', 3)).toBeNull()
    expect(slashQueryAt('x /hea', 6)).toBeNull()
    // Query characters are single-token; a space ends it.
    expect(slashQueryAt('/he llo', 7)).toBeNull()
  })

  it('never offers Heading 1 — the post title owns the page H1', () => {
    const titles = filterSlashCommands('').map((cmd) => cmd.title)
    expect(titles.some((t) => t === 'Heading 1')).toBe(false)
  })

  it('orders prefix matches before substring matches', () => {
    const head = filterSlashCommands('head')
    expect(head[0].title).toBe('Heading 2')
    expect(head[1].title).toBe('Heading 3')
    const bullets = filterSlashCommands('b')
    expect(bullets[0].title).toBe('Bulleted list')
    expect(filterSlashCommands('zz')).toEqual([])
  })

  it('replaces the typed /query and selects the word the writer replaces', () => {
    const h2 = filterSlashCommands('h2')[0]
    const applied = applySlashCommand('intro\n/he\noutro', 9, 6, h2)
    expect(applied.value).toBe('intro\n## Heading\n\n\noutro')
    expect(applied.value.slice(applied.selectionStart, applied.selectionEnd)).toBe('Heading')
  })

  it('opens on typed slash, inserts the focused block on Enter, and closes after', () => {
    const { container, unmount } = render(
      <form>
        <MarkdownEditor assets={[]} defaultValue={'First line.'} />
      </form>,
    )
    try {
      const textarea = container.querySelector('#post-markdown') as HTMLTextAreaElement
      act(() => {
        typeValue(textarea, 'First line.\n/num')
      })
      const menu = container.querySelector('[role="listbox"]') as HTMLElement
      expect(menu).toBeTruthy()
      expect(menu.textContent).toContain('Numbered list')

      act(() => {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(container.querySelector('[role="listbox"]')).toBeNull()
      expect(textarea.value).toContain('1. First item\n2. Second item')
    } finally {
      unmount()
    }
  })

  it('closes on Escape without touching the text', () => {
    const { container, unmount } = render(
      <form>
        <MarkdownEditor assets={[]} defaultValue={'x'} />
      </form>,
    )
    try {
      const textarea = container.querySelector('#post-markdown') as HTMLTextAreaElement
      act(() => {
        typeValue(textarea, 'x\n/q')
      })
      expect(container.querySelector('[role="listbox"]')).toBeTruthy()
      act(() => {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(container.querySelector('[role="listbox"]')).toBeNull()
      expect(textarea.value).toBe('x\n/q')
    } finally {
      unmount()
    }
  })
})
