// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { SidebarProvider, useSidebar } from './sidebar'

function SidebarState() {
  const { open, setOpen } = useSidebar()
  return (
    <button type="button" onClick={() => setOpen(false)}>
      {String(open)}
    </button>
  )
}

describe('SidebarProvider persistence', () => {
  let container: HTMLDivElement
  let unmount: (() => void) | undefined

  beforeEach(() => {
    unmount = undefined
    document.cookie = 'sidebar_state=; path=/; max-age=0'
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => unmount?.())
    container.remove()
  })

  it('restores the collapsed state from the cookie', () => {
    document.cookie = 'sidebar_state=false; path=/'
    act(() => {
      const root = createRoot(container)
      unmount = () => root.unmount()
      root.render(
        <SidebarProvider>
          <SidebarState />
        </SidebarProvider>,
      )
    })

    expect(container.querySelector('button')?.textContent).toBe('false')
  })

  it('writes the collapsed state when toggled', () => {
    act(() => {
      const root = createRoot(container)
      unmount = () => root.unmount()
      root.render(
        <SidebarProvider>
          <SidebarState />
        </SidebarProvider>,
      )
    })

    act(() => container.querySelector('button')?.click())
    expect(document.cookie).toContain('sidebar_state=false')
  })
})
