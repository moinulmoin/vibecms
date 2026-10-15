// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SegmentedControl } from './segmented-control'

/** A layout picker that also flips a preview, like the Theme page's Home page row. */
function LayoutPicker() {
  const [layout, setLayout] = useState<'grid' | 'list' | 'compact'>('grid')
  const [preview, setPreview] = useState<'article' | 'home'>('article')
  const [changes, setChanges] = useState(0)
  const [activations, setActivations] = useState(0)
  const showHome = () => {
    setPreview('home')
    setActivations((count) => count + 1)
  }
  return (
    <>
      <SegmentedControl
        label="Home layout"
        value={layout}
        onChange={(next) => {
          setLayout(next)
          setChanges((count) => count + 1)
        }}
        options={[
          { value: 'grid', label: 'Grid', onActivate: showHome },
          { value: 'list', label: 'List', onActivate: showHome },
          { value: 'compact', label: 'Compact', onActivate: showHome },
        ]}
      />
      <output aria-label="Preview">{preview}</output>
      <output aria-label="Changes">{changes}</output>
      <output aria-label="Activations">{activations}</output>
    </>
  )
}

let root: Root | null = null
let container: HTMLElement

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<LayoutPicker />))
}

const radio = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((item) => item.textContent === name)!
const shown = (name: string) => container.querySelector(`output[aria-label="${name}"]`)?.textContent

describe('SegmentedControl', () => {
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('runs an option’s activation when the already-chosen option is picked again', async () => {
    await mount()
    expect(radio('Grid').getAttribute('aria-checked')).toBe('true')
    expect(shown('Preview')).toBe('article')
    await act(async () => radio('Grid').click())
    expect(shown('Preview')).toBe('home')
    expect(shown('Activations')).toBe('1')
    expect(shown('Changes')).toBe('0')
    expect(radio('Grid').getAttribute('aria-checked')).toBe('true')
  })

  it('activates once and changes once when a different option is picked', async () => {
    await mount()
    await act(async () => radio('List').click())
    expect(radio('List').getAttribute('aria-checked')).toBe('true')
    expect(shown('Preview')).toBe('home')
    expect(shown('Activations')).toBe('1')
    expect(shown('Changes')).toBe('1')
  })

  it('keeps one tab stop and arrow-key selection, activating each arrowed-to option once', async () => {
    await mount()
    // Radix roving focus: before entry the group itself is the one tab stop
    // and every option is -1; keyboard focus on the group forwards to the
    // chosen option, which then holds the tab stop.
    const group = container.querySelector<HTMLElement>('[role="radiogroup"]')!
    const tabStops = () => [...container.querySelectorAll('[role="radio"]')].map((item) => item.getAttribute('tabindex'))
    expect(group.getAttribute('tabindex')).toBe('0')
    expect(tabStops()).toEqual(['-1', '-1', '-1'])
    await act(async () => group.focus())
    expect(document.activeElement).toBe(radio('Grid'))
    expect(tabStops()).toEqual(['0', '-1', '-1'])
    // Entering the group moves focus only; it is not an activation.
    expect(shown('Activations')).toBe('0')
    await act(async () => {
      radio('Grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      // Radix moves roving focus on the next tick. Executor form: the
      // dashboard tsconfig lib is ES2022 (no Promise.withResolvers).
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(radio('List'))
    expect(radio('List').getAttribute('aria-checked')).toBe('true')
    expect(radio('List').getAttribute('tabindex')).toBe('0')
    expect(shown('Preview')).toBe('home')
    expect(shown('Activations')).toBe('1')
    expect(shown('Changes')).toBe('1')
  })
})
