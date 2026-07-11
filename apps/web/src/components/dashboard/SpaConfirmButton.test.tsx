// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { SpaConfirmButton } from './SpaConfirmButton'

/** A promise whose settlement we control from the test. */
function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    button: () => container.querySelector('button') as HTMLButtonElement,
    helper: () => container.querySelector('[role="status"]'),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function click(button: HTMLButtonElement) {
  act(() => button.click())
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SpaConfirmButton two-step interaction', () => {
  it('arms on the first click without invoking onConfirm', () => {
    const onConfirm = vi.fn()
    const { button, helper, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        helperText="Revoking blocks this token immediately."
        pendingLabel="Revoking…"
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    expect(button().textContent).toBe('Revoke token')
    expect(helper()).toBeNull()

    click(button())

    // First click only arms: relabels, shows helper, does not invoke.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(button().textContent).toBe('Confirm revoke')
    expect(helper()).not.toBeNull()
    expect(helper()!.textContent).toBe('Revoking blocks this token immediately.')
    unmount()
  })

  it('invokes onConfirm exactly once on the second click and locks while pending', async () => {
    const { promise, resolve } = deferred()
    const onConfirm = vi.fn(() => promise)
    const { button, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        pendingLabel="Revoking…"
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    click(button()) // arm
    expect(onConfirm).toHaveBeenCalledTimes(0)

    await act(async () => {
      button().click() // confirm
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Locked + visibly pending until the promise settles.
    expect(button().disabled).toBe(true)
    expect(button().getAttribute('aria-busy')).toBe('true')
    expect(button().textContent).toBe('Revoking…')

    await act(async () => {
      resolve()
      await promise
    })

    unmount()
  })

  it('does not re-invoke on duplicate clicks while the promise is pending', async () => {
    const { promise, resolve } = deferred()
    const onConfirm = vi.fn(() => promise)
    const { button, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        pendingLabel="Revoking…"
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    click(button()) // arm
    await act(async () => {
      button().click() // confirm -> pending
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // The button is disabled while pending; real clicks are no-ops.
    expect(button().disabled).toBe(true)
    click(button())
    click(button())
    click(button())
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve()
      await promise
    })
    unmount()
  })

  it('returns to the unarmed state after the promise resolves', async () => {
    const { promise, resolve } = deferred()
    const onConfirm = vi.fn(() => promise)
    const { button, helper, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        helperText="Revoking blocks this token immediately."
        pendingLabel="Revoking…"
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    click(button()) // arm
    await act(async () => {
      button().click() // confirm -> pending
    })

    await act(async () => {
      resolve()
      await promise
    })

    // Back to the resting state: original label, interactive, no helper.
    expect(button().textContent).toBe('Revoke token')
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-busy')).toBeNull()
    expect(helper()).toBeNull()
    unmount()
  })

  it('disarms even when onConfirm rejects', async () => {
    const { promise, reject } = deferred()
    const onConfirm = vi.fn(() => promise)
    const { button, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        pendingLabel="Revoking…"
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    click(button()) // arm
    await act(async () => {
      button().click() // confirm -> pending
    })

    await act(async () => {
      reject(new Error('network down'))
      await promise.catch(() => {})
    })

    // finally always resets to unarmed + interactive.
    expect(button().textContent).toBe('Revoke token')
    expect(button().disabled).toBe(false)
    unmount()
  })

  it('preserves an externally-controlled disabled state', () => {
    const onConfirm = vi.fn()
    const { button, unmount } = render(
      <SpaConfirmButton
        confirmLabel="Confirm revoke"
        disabled
        armedTimeoutMs={60000}
        onConfirm={onConfirm}
      >
        Revoke token
      </SpaConfirmButton>,
    )

    expect(button().disabled).toBe(true)
    click(button()) // cannot arm while externally disabled
    expect(onConfirm).not.toHaveBeenCalled()
    expect(button().textContent).toBe('Revoke token')
    unmount()
  })
})
