// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Asset } from '@vc/core'
import { MediaPage } from './MediaPage'

function asset(id: string, filename: string, altText: string | null = null): Asset {
  return {
    id,
    siteId: 'site-1',
    r2Key: `r2/${id}`,
    filename,
    mimeType: 'image/png',
    sizeBytes: 1024,
    width: 800,
    height: 600,
    altText,
    createdAt: 1_720_000_000,
    updatedAt: 1_720_000_000,
  }
}

const FIXTURES = [
  asset('a1', 'cover-one.png', 'A desk in morning light'),
  asset('a2', 'cover-two.png'),
  asset('a3', 'cover-three.png', 'A terminal screenshot'),
]

vi.mock('~/lib/api-client', () => ({
  loadMediaPage: vi.fn(async () => ({ assets: FIXTURES })),
  updateMediaAltMutation: vi.fn(async () => ({ kind: 'ok', code: 'media_alt_saved' })),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => async () => ({}) }
})

function deleteResponse(kind: 'ok' | 'error') {
  return Promise.resolve(
    new Response(JSON.stringify(kind === 'ok' ? { kind: 'ok', code: 'media_deleted' } : { kind: 'error', code: 'unknown' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('MediaPage bulk delete', () => {
  let deletePlan: Array<'ok' | 'error'>
  beforeEach(() => {
    deletePlan = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/media/delete')) return deleteResponse(deletePlan.shift() ?? 'ok')
      return deleteResponse('ok')
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function renderPage() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<MediaPage />)
    })
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  async function selectAll(container: HTMLElement) {
    const selectAllBox = container.querySelector('[aria-label^="Select all"]') as HTMLElement
    expect(selectAllBox).toBeTruthy()
    await act(async () => { click(selectAllBox) })
  }

  async function armAndConfirmDelete(container: HTMLElement) {
    const deleteButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Delete'),
    ) as HTMLButtonElement
    await act(async () => { click(deleteButton) })
    const confirmButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Confirm delete'),
    ) as HTMLButtonElement
    await act(async () => { click(confirmButton) })
  }

  // The bulk-delete loop detaches behind the confirm click; settle the
  // sequential fetch promises before asserting.
  async function settle(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  function filenames(container: HTMLElement): string[] {
    return [...container.querySelectorAll('strong')].map((el) => el.textContent ?? '')
  }

  it('removes the selected tiles optimistically, then announces the deletion', async () => {
    const { container, unmount } = await renderPage()
    try {
      expect(filenames(container)).toHaveLength(3)

      // Select one tile; the bulk action bar appears.
      const firstBox = container.querySelector('[aria-label="Select cover-one.png"]') as HTMLElement
      await act(async () => { click(firstBox) })
      expect(container.textContent).toContain('1 selected')

      await selectAll(container)
      expect(container.textContent).toContain('3 selected')

      // Tiles vanish as the confirm click lands, then the loop settles.
      deletePlan = ['ok', 'ok', 'ok']
      await armAndConfirmDelete(container)
      await settle()
      expect(filenames(container)).toHaveLength(0)
      expect(container.textContent).not.toContain('selected')

      // The polite announcement reports the finished count.
      const status = container.querySelector('p[role="status"]')
      expect(status?.textContent).toBe('3 images deleted.')
    } finally {
      await unmount()
    }
  })

  it('rolls back only the failed file, in its original position', async () => {
    const { container, unmount } = await renderPage()
    try {
      // The bulk bar (with select-all) appears once anything is selected.
      const firstBox = container.querySelector('[aria-label="Select cover-one.png"]') as HTMLElement
      await act(async () => { click(firstBox) })
      await selectAll(container)
      deletePlan = ['ok', 'error', 'ok']
      await armAndConfirmDelete(container)
      await settle()

      // a2 fails mid-sequence; a1 and a3 stay gone, a2 returns in place.
      expect(filenames(container)).toEqual(['cover-two.png'])
      const status = container.querySelector('p[role="status"]')
      expect(status?.textContent).toBe('1 image could not be deleted and was restored.')
    } finally {
      await unmount()
    }
  })
})
