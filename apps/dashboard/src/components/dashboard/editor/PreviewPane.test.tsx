// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { PreviewPane, type PreviewMetadata } from './PreviewPane'

const site = { name: 'QA Blog', description: 'A blog for agents.', slug: 'qa' , themeAccent: null, themeFont: null, themeMode: 'dark' }

describe('PreviewPane', () => {
  it('uses the live blog identity in the editor preview', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<PreviewPane source="Body" metadata={{ title: 'Draft' }} presetId="technical" site={{
      ...site, logoAssetId: 'logo-1', navLinks: [{ label: 'About', url: '/about' }],
      socialLinks: [{ kind: 'mastodon', url: 'https://mastodon.social/@example' }],
    }} />))
    const preview = container.querySelector('[aria-label="Post preview"]')
    expect(preview?.querySelector('img[src="/media-assets/logo-1"]')).toBeTruthy()
    expect(preview?.querySelector('a[href="/about"]')?.textContent).toBe('About')
    expect(preview?.querySelector('a[aria-label="Mastodon"]')?.getAttribute('rel')).toContain('me')
    act(() => root.unmount())
    container.remove()
  })

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
