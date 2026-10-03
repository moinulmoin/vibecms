// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { DataRow } from './list-row'

function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DataRow row-click navigation', () => {
  it('activates the row key link when clicking non-interactive row space', () => {
    let navigated = 0
    const { container, unmount } = render(
      <DataRow className="grid-cols-2">
        <a
          data-row-key
          href="/dashboard/posts/abc/edit"
          onClick={(event) => {
            event.preventDefault()
            navigated += 1
          }}
        >
          A post title
        </a>
        <span className="text-muted-foreground">Updated today</span>
      </DataRow>,
    )
    try {
      const row = container.firstElementChild as HTMLElement
      const metaSpan = row.querySelector('span') as HTMLElement
      act(() => {
        metaSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(navigated).toBe(1)
    } finally {
      unmount()
    }
  })

  it('does not double-fire when the key link itself is clicked', () => {
    let navigated = 0
    const { container, unmount } = render(
      <DataRow>
        <a
          data-row-key
          href="/x"
          onClick={(event) => {
            event.preventDefault()
            navigated += 1
          }}
        >
          Title link
        </a>
      </DataRow>,
    )
    try {
      const link = container.querySelector('a[data-row-key]') as HTMLAnchorElement
      act(() => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(navigated).toBe(1)
    } finally {
      unmount()
    }
  })

  it('ignores clicks on interactive descendants and modifier-clicks', () => {
    let navigated = 0
    const { container, unmount } = render(
      <DataRow>
        <a
          data-row-key
          href="/x"
          onClick={(event) => {
            event.preventDefault()
            navigated += 1
          }}
        >
          Title link
        </a>
        <button type="button">Archive</button>
      </DataRow>,
    )
    try {
      const row = container.firstElementChild as HTMLElement
      const button = row.querySelector('button') as HTMLButtonElement
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const metaSpan = document.createElement('span')
      row.appendChild(metaSpan)
      // Modifier click should not activate (native middle/cmd-click stays on
      // the key link, which keeps full semantics).
      act(() => {
        metaSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
      })
      // Plain click still works from the new non-interactive child.
      act(() => {
        metaSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(navigated).toBe(1)
    } finally {
      unmount()
    }
  })

  it('stays inert when no row key link exists', () => {
    let navigated = 0
    const { container, unmount } = render(
      <DataRow>
        <span>Activity entry</span>
        <button
          type="button"
          onClick={() => {
            navigated += 1
          }}
        >
          View
        </button>
      </DataRow>,
    )
    try {
      const row = container.firstElementChild as HTMLElement
      const span = row.querySelector('span') as HTMLElement
      act(() => {
        span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(navigated).toBe(0)
    } finally {
      unmount()
    }
  })
})
