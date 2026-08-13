// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'

vi.mock('~/hooks/use-mobile', () => ({ useIsMobile: () => true }))

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '~/components/ui/sidebar'

function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    root,
    unmount: () => act(() => root.unmount()),
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mobile dashboard sidebar accessibility isolation', () => {
  it('marks the dashboard background inert while the drawer is open and restores it on close', () => {
    const { container, unmount } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader />
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="#">Nav item</a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <header>
            <SidebarTrigger />
          </header>
          <main>
            <button id="bg-action">Background action</button>
          </main>
        </SidebarInset>
      </SidebarProvider>,
    )

    const trigger = container.querySelector('header button') as HTMLButtonElement
    const bg = document.getElementById('bg-action') as HTMLElement

    // Closed: the background action is interactive and reachable.
    expect(document.querySelector('[data-mobile="true"]')).toBeNull()
    expect(bg.closest('[inert]')).toBeNull()
    expect(bg.closest('[aria-hidden="true"]')).toBeNull()

    // Open the mobile drawer.
    act(() => trigger.click())

    expect(document.querySelector('[data-mobile="true"]'), 'mobile sheet renders when open').not.toBeNull()
    expect(document.querySelector('[role="dialog"]'), 'dialog role is present').not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-close"]'), 'visible close control is present').not.toBeNull()
    // The background is inert: removed from the keyboard tab order and the a11y tree.
    expect(bg.closest('[inert]'), 'background is inert while the drawer is open').not.toBeNull()

    // Close it again (toggling the trigger; synthetic click bypasses pointer-events:none).
    act(() => trigger.click())

    expect(document.querySelector('[data-mobile="true"]'), 'mobile sheet unmounts on close').toBeNull()
    expect(bg.closest('[inert]'), 'background is interactive again after closing').toBeNull()
    expect(bg.closest('[aria-hidden="true"]'), 'background aria-hidden is restored after closing').toBeNull()

    unmount()
  })
})
