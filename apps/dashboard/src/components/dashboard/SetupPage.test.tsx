// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'

const mocks = vi.hoisted(() => ({
  completeSetupMutation: vi.fn(),
  loadSetupPage: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error { status = 500 },
  completeSetupMutation: mocks.completeSetupMutation,
  loadSetupPage: mocks.loadSetupPage,
}))

import { SetupPage } from './SetupPage'

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderPage() {
  mocks.loadSetupPage.mockResolvedValue({ name: 'My Blog', slug: 'owner-1a2b3c4d', description: '', baseDomain: 'vibecms.dev' })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(withQueryClient(<SetupPage />)))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const nameInput = () => container.querySelector<HTMLInputElement>('#blog-name')!
  const addressInput = () => container.querySelector<HTMLInputElement>('#blog-address')
  const addressError = () => container.querySelector('#blog-address-error')?.textContent ?? null
  const preview = () => container.querySelector('figure')?.textContent ?? ''
  return {
    container,
    nameInput,
    addressInput,
    addressError,
    preview,
    typeName: (value: string) => act(async () => setValue(nameInput(), value)),
    typeAddress: (value: string) => act(async () => setValue(addressInput()!, value)),
    openEditor: () => act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => /^(Edit|Choose address)$/.test(button.textContent ?? ''))!.click()
    }),
    submit: () => act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }),
    cleanup: async () => { await act(async () => root.unmount()); container.remove() },
  }
}

describe('SetupPage address', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('flags a reserved address live and keeps the editor open with the error beside it', async () => {
    const page = await renderPage()
    await page.typeName('Admin')
    expect(page.addressError()).toBe('That address is reserved. Choose another.')
    expect(page.nameInput().getAttribute('aria-describedby')).toBe('blog-address-error')

    await page.submit()
    expect(mocks.completeSetupMutation).not.toHaveBeenCalled()
    const address = page.addressInput()!
    expect(address.value).toBe('admin')
    expect(address.getAttribute('aria-invalid')).toBe('true')
    expect(address.getAttribute('aria-describedby')).toBe('blog-address-error')
    await act(async () => address.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(page.addressInput()).not.toBeNull()
    await page.cleanup()
  })

  it('rejects a typed address shorter than three characters live', async () => {
    const page = await renderPage()
    await page.typeName('Field Notes')
    await page.openEditor()
    await page.typeAddress('x-')
    expect(page.addressError()).toBe('Use at least 3 letters or numbers.')
    expect(page.addressInput()!.getAttribute('aria-invalid')).toBe('true')
    await page.submit()
    expect(mocks.completeSetupMutation).not.toHaveBeenCalled()

    await page.typeAddress('xyz')
    expect(page.addressError()).toBeNull()
    expect(page.preview()).toContain('xyz.vibecms.dev')
    await page.cleanup()
  })

  it.each(['!!!???', '🙂🙂', 'Полевые заметки'])('asks for an explicit address when %s has no usable letters', async (name) => {
    const page = await renderPage()
    await page.typeName(name)
    expect(page.addressError()).toBe('Choose an address using letters a-z, numbers, and hyphens.')
    expect(page.preview()).toContain('Choose an address')
    expect(page.preview()).not.toContain('your-blog')

    await page.submit()
    expect(mocks.completeSetupMutation).not.toHaveBeenCalled()
    await page.typeAddress('field-notes')
    expect(page.preview()).toContain('field-notes.vibecms.dev')
    mocks.completeSetupMutation.mockResolvedValue({ kind: 'error', code: 'unknown' })
    await page.submit()
    expect(mocks.completeSetupMutation).toHaveBeenCalledWith({ name, slug: 'field-notes' })
    await page.cleanup()
  })

  it('shows a taken address inline, keeping the entered name and address', async () => {
    mocks.completeSetupMutation.mockResolvedValue({ kind: 'error', code: 'address_taken' })
    const page = await renderPage()
    await page.typeName('Field Notes')
    expect(page.preview()).toContain('field-notes.vibecms.dev')
    await page.submit()

    expect(mocks.completeSetupMutation).toHaveBeenCalledWith({ name: 'Field Notes', slug: 'field-notes' })
    expect(page.nameInput().value).toBe('Field Notes')
    const address = page.addressInput()!
    expect(address.value).toBe('field-notes')
    expect(address.getAttribute('aria-invalid')).toBe('true')
    expect(address.getAttribute('aria-describedby')).toBe('blog-address-error')
    expect(page.addressError()).toBe('That address is taken. Choose another.')

    await page.typeAddress('field-notes-2')
    expect(page.addressError()).toBeNull()
    await page.cleanup()
  })

  it('does not overwrite edits made while a rejected save was in flight', async () => {
    let resolveSave: ((value: { kind: 'error'; code: string }) => void) | undefined
    mocks.completeSetupMutation.mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
    const page = await renderPage()
    await page.typeName('Field Notes')
    await page.submit()
    await page.typeName('Garden Log')
    await act(async () => resolveSave?.({ kind: 'error', code: 'address_taken' }))

    expect(page.nameInput().value).toBe('Garden Log')
    expect(page.preview()).toContain('garden-log.vibecms.dev')
    expect(page.addressError()).toBeNull()
    expect(page.addressInput()).toBeNull()
    await page.cleanup()
  })
})
