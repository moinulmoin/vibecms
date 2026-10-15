// @vitest-environment happy-dom
import { CopyButton } from '@vc/ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const KEY = 'vc_live_secret_key'

describe('CopyButton', () => {
  let container: HTMLDivElement
  let root: Root
  let writeText: Mock
  let execCommand: Mock

  beforeEach(() => {
    writeText = vi.fn()
    execCommand = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<CopyButton value={KEY} label="Copy key" copiedLabel="Copied" />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const button = () => container.querySelector<HTMLButtonElement>('button')!
  const click = () => act(async () => button().click())

  it('confirms only after the clipboard write resolves', async () => {
    writeText.mockResolvedValue(undefined)
    await click()
    expect(writeText).toHaveBeenCalledWith(KEY)
    expect(execCommand).not.toHaveBeenCalled()
    expect(button().textContent).toBe('Copied')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('confirms when the clipboard API is refused but the legacy copy succeeds', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    execCommand.mockReturnValue(true)
    await click()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(button().textContent).toBe('Copied')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('reports failure and keeps the value selectable when nothing was copied', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    execCommand.mockReturnValue(false)
    await click()

    expect(button().textContent).toBe("Couldn't copy")
    expect(button().textContent).not.toContain('Copied')
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('copy it manually')
    expect(button().getAttribute('aria-describedby')).toBe(alert?.id)
    const field = container.querySelector<HTMLTextAreaElement>('textarea[readonly]')
    expect(field?.value).toBe(KEY)
    expect(field?.getAttribute('aria-labelledby')).toBe(alert?.id)
    expect(document.activeElement).toBe(field)

    // Escape closes only the fallback, not an enclosing Sheet/Dialog (Radix listens on document, capture phase).
    const ancestorEscape = vi.fn()
    document.addEventListener('keydown', ancestorEscape, { capture: true })
    act(() => field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    document.removeEventListener('keydown', ancestorEscape, { capture: true })
    expect(ancestorEscape).not.toHaveBeenCalled()
    expect(container.querySelector('textarea[readonly]')).toBeNull()
    expect(button().textContent).toBe('Copy key')
    expect(document.activeElement).toBe(button())
  })

  it('treats a throwing legacy copy as a failure and keeps multi-line values intact', async () => {
    const snippet = 'claude mcp add vibecms \\\n  --header "Authorization: Bearer vc_live_x"'
    act(() => root.render(<CopyButton value={snippet} label="Copy command" iconOnly />))
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    execCommand.mockImplementation(() => {
      throw new Error('SecurityError')
    })
    await click()
    expect(button().getAttribute('aria-label')).toBe("Couldn't copy")
    expect(container.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toBe(snippet)
  })
})
