// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_DRAFT_DESCRIPTION, FIRST_DRAFT_PROMPT, KEY_ACCESS, NewKeyForm, accessLabel } from './ConnectPage'

describe('new agent keys', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('asks the agent for a private preview and explicit publishing approval', () => {
    expect(FIRST_DRAFT_PROMPT).toBe("Use vibecms to write a short first post for my blog. Save it as a draft and send me the private preview link. Don't publish until I say so.")
    expect(FIRST_DRAFT_DESCRIPTION).toContain('private preview to approve')
    expect(FIRST_DRAFT_DESCRIPTION).toContain('Publish from Posts')
    expect(FIRST_DRAFT_DESCRIPTION).toContain('publishing key')
  })

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

  it('offers Manage with clear human controls while recognizing legacy full keys', () => {
    expect(KEY_ACCESS.map((access) => access.id)).toEqual(['draft', 'publish', 'manage'])
    expect(KEY_ACCESS[2].description).toBe('Publishing, plus settings, links, theme, voice, the signup form, and analytics. Billing, keys, and deleting the blog stay with you.')
    expect(accessLabel(['site:write', 'posts:publish'])).toBe('Manage')
    expect(accessLabel(['posts:archive', 'assets:delete'])).toBe('Full access')
  })
})
