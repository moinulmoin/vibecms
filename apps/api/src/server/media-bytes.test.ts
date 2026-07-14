import { describe, expect, it } from 'vitest'
import { sniffImageMime, validateDeclaredImageMime } from '@/server/media-bytes'

describe('media-bytes', () => {
  it('sniffs PNG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(sniffImageMime(png)).toBe('image/png')
    expect(validateDeclaredImageMime('image/png', png)).toBe(true)
  })

  it('rejects declared MIME that does not match bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    expect(validateDeclaredImageMime('image/png', jpeg)).toBe(false)
  })
})