// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { MarkdownEditor } from './MarkdownEditor'

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
  document.body.innerHTML = ''
})

const site = { name: 'QA Blog', description: 'A clean blog for you and your agents.', slug: 'qa-blog' }

describe('MarkdownEditor exact public-page preview', () => {
  it('renders the full public chrome: masthead, article metadata, and an inert subscribe block', () => {
    const { container, unmount } = render(
      <div>
        <input id="post-title" defaultValue="Ship the preview" />
        <textarea id="post-excerpt" defaultValue="Why the preview is the page" />
        <input id="post-tags" defaultValue="launch, notes" />
        <MarkdownEditor
          assets={[]}
          defaultValue={'# Ship the preview\n\nFirst paragraph of the post.'}
          presetId="minimal"
          site={site}
          siteTheme={{ accent: null, font: null, mode: null }}
          publishedAt={null}
        />
      </div>,
    )
    try {
      const previewButton = [...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Preview',
      ) as HTMLButtonElement
      act(() => previewButton.click())

      const preview = container.querySelector('[aria-label="Markdown preview"]') as HTMLElement
      expect(preview).toBeTruthy()

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
