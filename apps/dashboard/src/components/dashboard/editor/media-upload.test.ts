// @vitest-environment happy-dom
import type { Asset } from '@vc/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const library: Asset[] = []
vi.mock('~/lib/api-client', () => ({
  loadMediaPage: vi.fn(async () => ({ assets: [...library].reverse() })),
}))

import { uploadEditorMedia } from './media-upload'

const asset = (id: string) => ({ id, mimeType: 'image/png', filename: `${id}.png` }) as Asset

afterEach(() => {
  vi.unstubAllGlobals()
  library.length = 0
})

describe('uploadEditorMedia', () => {
  it('gives each of two concurrent uploads its own asset', async () => {
    // The server stores each upload as soon as its request lands.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const file = (init.body as FormData).get('file') as File
      library.push(asset(file.name.replace('.png', '')))
      return new Response(JSON.stringify({ kind: 'ok', code: 'media_uploaded' }))
    }))
    let known: Asset[] = []
    const onAssets = (next: Asset[]) => { known = next }
    const a = uploadEditorMedia(new File(['a'], 'a.png', { type: 'image/png' }), 'A', () => known, onAssets, async () => {})
    const b = uploadEditorMedia(new File(['b'], 'b.png', { type: 'image/png' }), 'B', () => known, onAssets, async () => {})
    const [first, second] = await Promise.all([a, b])
    expect(first?.id).toBe('a')
    expect(second?.id).toBe('b')
  })

  it('keeps later uploads working after one fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: 'error', code: 'upload_too_large' })))
      .mockImplementationOnce(async () => {
        library.push(asset('c'))
        return new Response(JSON.stringify({ kind: 'ok', code: 'media_uploaded' }))
      }))
    const failed = uploadEditorMedia(new File(['x'], 'x.png', { type: 'image/png' }), 'X', [], () => {}, async () => {})
    const ok = uploadEditorMedia(new File(['c'], 'c.png', { type: 'image/png' }), 'C', [], () => {}, async () => {})
    await expect(failed).rejects.toThrow(/or smaller/)
    expect((await ok)?.id).toBe('c')
  })
})
