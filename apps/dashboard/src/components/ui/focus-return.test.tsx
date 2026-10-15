// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'

type Harness = { open: boolean; page: 'list' | 'detail'; preventCloseFocus?: boolean }

// The opener stays mounted across the "route change", like a sidebar link or
// toolbar button in the persistent app shell.
function App({ open, page, preventCloseFocus }: Harness) {
  return (
    <>
      <button type="button">Open prompt</button>
      {page === 'detail' ? <DestinationPage /> : null}
      <Dialog open={open}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={preventCloseFocus ? (event) => event.preventDefault() : undefined}
        >
          <DialogTitle>Leave page?</DialogTitle>
          <DialogDescription>Unsaved changes will be lost.</DialogDescription>
          <button type="button">Leave</button>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DestinationPage() {
  const heading = React.useRef<HTMLHeadingElement>(null)
  // Route-level focus management: the new page takes focus on mount.
  React.useEffect(() => heading.current?.focus(), [])
  return (
    <h1 ref={heading} tabIndex={-1}>
      Destination
    </h1>
  )
}

// Radix runs close autofocus in a timeout after the content unmounts. Executor
// form because the dashboard tsconfig lib is ES2022 (no Promise.withResolvers).
async function flushCloseAutoFocus() {
  await act(async () => {
    for (let tick = 0; tick < 2; tick++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

describe('dialog focus return', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: Harness) {
    act(() => root.render(<App {...props} />))
  }

  async function openFromOpener() {
    render({ open: false, page: 'list' })
    const opener = container.querySelector('button') as HTMLButtonElement
    opener.focus()
    render({ open: true, page: 'list' })
    await flushCloseAutoFocus()
    const leave = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave')
    leave?.focus()
    expect(document.activeElement?.textContent).toBe('Leave')
    return opener
  }

  it('returns focus to the opener when the dialog closes in place', async () => {
    const opener = await openFromOpener()

    render({ open: false, page: 'list' })
    await flushCloseAutoFocus()

    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus on the destination page when closing navigates away', async () => {
    await openFromOpener()

    render({ open: false, page: 'detail' })
    await flushCloseAutoFocus()

    expect(document.activeElement?.textContent).toBe('Destination')
  })

  it('respects a caller that cancels close autofocus', async () => {
    render({ open: false, page: 'list', preventCloseFocus: true })
    const opener = container.querySelector('button') as HTMLButtonElement
    opener.focus()
    render({ open: true, page: 'list', preventCloseFocus: true })
    await flushCloseAutoFocus()

    render({ open: false, page: 'list', preventCloseFocus: true })
    await flushCloseAutoFocus()

    expect(document.activeElement).not.toBe(opener)
  })
})
