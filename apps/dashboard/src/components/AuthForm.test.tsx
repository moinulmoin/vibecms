// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthForm } from './AuthForm'

const authMocks = vi.hoisted(() => ({
  sendVerificationOtp: vi.fn(),
  emailOtp: vi.fn(),
  social: vi.fn(),
}))

vi.mock('~/lib/auth-client', () => ({
  setupAuthClient: () => ({
    emailOtp: { sendVerificationOtp: authMocks.sendVerificationOtp },
    signIn: {
      emailOtp: authMocks.emailOtp,
      social: authMocks.social,
    },
  }),
}))

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('AuthForm network recovery', () => {
  it('restores the send-code action and shows feedback after a rejected request', async () => {
    authMocks.sendVerificationOtp.mockRejectedValueOnce(new Error('offline'))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(<AuthForm googleEnabled={false} />))
    const email = container.querySelector('input[type="email"]') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    act(() => {
      email.value = 'reader@example.com'
      email.dispatchEvent(new Event('input', { bubbles: true }))
      email.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Send sign-in code')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not reach the sign-in service')

    act(() => root.unmount())
  })
})
