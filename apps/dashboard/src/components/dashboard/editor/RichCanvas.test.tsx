// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { RichCanvas } from './RichCanvas'

describe('RichCanvas', () => {
  it('turns a Markdown paste into a canonical document change', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onChange = vi.fn()
    await act(async () => {
      root.render(<RichCanvas source="Intro" onChange={onChange} />)
    })

    const canvas = container.querySelector('[data-testid="rich-canvas"] .ProseMirror')
    expect(canvas).toBeTruthy()
    const pasted = '## Added\n\n> [!TIP]\n> Keep exact Markdown.\n\n- [x] Checked'
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? pasted : '') },
    })

    await act(async () => {
      canvas?.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(event.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalled()
    const markdown = onChange.mock.calls.at(-1)?.[0] as string
    expect(markdown).toContain('## Added')
    expect(markdown).toContain('> [!TIP]\n> Keep exact Markdown.')
    expect(markdown).toContain('- [x] Checked')

    act(() => root.unmount())
    container.remove()
  })
  it('pastes Markdown exactly once when the paste lands in the editor itself', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onChange = vi.fn()
    await act(async () => {
      root.render(<RichCanvas source="Intro" onChange={onChange} />)
    })
    const surface = container.querySelector('.ProseMirror')
    expect(surface).toBeTruthy()
    const pasted = '## Added once\n\n- one\n- two'
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? pasted : '') },
    })
    await act(async () => {
      surface?.dispatchEvent(event)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    const markdown = onChange.mock.calls.at(-1)?.[0] as string
    expect(markdown.match(/## Added once/g)).toHaveLength(1)
    expect(markdown).toContain('- one\n- two')

    act(() => root.unmount())
    container.remove()
  })
})
