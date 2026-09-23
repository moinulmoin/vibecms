// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { PreviewPane, type PreviewMetadata } from './PreviewPane'

const site = { name: 'QA Blog', description: 'A blog for agents.', slug: 'qa' , themeAccent: null, themeFont: null, themeMode: 'dark' }

describe('PreviewPane', () => {
  it('renders from React metadata and stamps the selected preset into the public page', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const metadata: PreviewMetadata = { title: 'First title', excerpt: 'Deck' }
    act(() => root.render(<PreviewPane source="Body" metadata={metadata} presetId="technical" site={site} publishedAt={1_700_000_000} updatedAt={1_700_000_000} />))
    const preview = container.querySelector('[aria-label="Post preview"]') as HTMLElement
    expect(preview.getAttribute('role')).toBe('region')
    expect(preview.querySelector('main[data-vc-theme="technical"]')).toBeTruthy()
    expect(preview.querySelector('article h1')?.textContent).toBe('First title')
    expect(preview.textContent).toContain('QA Blog')
    act(() => root.render(<PreviewPane source="Body" metadata={{ ...metadata, title: 'Updated title' }} presetId="technical" site={site} publishedAt={1_700_000_000} updatedAt={1_700_000_000} />))
    expect(preview.querySelector('article h1')?.textContent).toBe('Updated title')
    act(() => root.unmount())
    container.remove()
  })
})
