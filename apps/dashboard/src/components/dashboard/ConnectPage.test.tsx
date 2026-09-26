// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_ACCESS, NewKeyForm } from './ConnectPage'

describe('new agent keys', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('defaults to drafting and makes publishing without the dashboard explicit', async () => {
    const onCreate = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<NewKeyForm pending={false} onCreate={onCreate} />))
    expect(container.querySelector('#key-access-draft')?.getAttribute('data-state')).toBe('checked')
    expect(KEY_ACCESS.find((access) => access.id === 'publish')?.description).toContain('publishing without using the dashboard')
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(onCreate).toHaveBeenCalledWith({ name: 'My agent', preset: 'draft' })
    await act(async () => root.unmount())
    container.remove()
  })
})
