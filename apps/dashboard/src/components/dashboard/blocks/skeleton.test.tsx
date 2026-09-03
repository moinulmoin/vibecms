// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { PageSkeleton } from './skeleton'

function renderSkeleton(variant: 'stats' | 'list' | 'table' | 'detail' | 'panels') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<PageSkeleton variant={variant} />))
  return { container, unmount: () => act(() => root.unmount()) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PageSkeleton', () => {
  it('keeps the header and content rhythm across all variants', () => {
    for (const variant of ['stats', 'list', 'table', 'detail', 'panels'] as const) {
      const { container, unmount } = renderSkeleton(variant)
      expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true')
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
      unmount()
    }
  })

  it('allows a page to provide its own panel skeleton content', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <PageSkeleton variant="list">
          <div data-testid="custom-loading-content" />
        </PageSkeleton>,
      )
    })

    expect(container.querySelector('[data-testid="custom-loading-content"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    act(() => root.unmount())
  })
})
