// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { StatusBadge } from './status-badge'

function renderStatus(status: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<StatusBadge status={status} />))
  return { container, unmount: () => act(() => root.unmount()) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('StatusBadge vocabulary', () => {
  it('uses a glowing dot for successful states', () => {
    const { container, unmount } = renderStatus('connected')
    expect(container.querySelector('[class*="bg-brand-bright"]')).not.toBeNull()
    unmount()
  })

  it('uses warning tokens for billing and provisioning states', () => {
    const { container, unmount } = renderStatus('past_due')
    expect(container.firstElementChild?.className).toContain('text-warning')
    expect(container.textContent).toContain('past due')
    expect(container.querySelector('[class*="bg-brand-bright"]')).toBeNull()
    unmount()
  })

  it('keeps draft states neutral and unknown states muted-dashed', () => {
    const draft = renderStatus('unpublished')
    expect(draft.container.firstElementChild?.className).toContain('bg-muted')
    expect(draft.container.querySelector('[class*="rounded-full bg-brand-bright"]')).toBeNull()
    draft.unmount()

    const unknown = renderStatus('something_new')
    expect(unknown.container.firstElementChild?.className).toContain('border-dashed')
    unknown.unmount()
  })
})
