import { describe, expect, it } from 'vitest'
import { readImageDimensions, sniffImageMime, validateDeclaredImageMime } from '@/server/media-bytes'

describe('media-bytes', () => {
  it('sniffs PNG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(sniffImageMime(png)).toBe('image/png')
    expect(validateDeclaredImageMime('image/png', png)).toBe(true)
  })


  it('reads PNG dimensions from the IHDR chunk', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    png.set([0x49, 0x48, 0x44, 0x52], 12)
    png.set([0x00, 0x00, 0x04, 0xb0, 0x00, 0x00, 0x02, 0x76], 16)

    expect(readImageDimensions('image/png', png)).toEqual({ width: 1200, height: 630 })
  })

  it('reads GIF logical-screen dimensions', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02])
    expect(readImageDimensions('image/gif', gif)).toEqual({ width: 800, height: 600 })
  })

  it('reads JPEG start-of-frame dimensions', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x07, 0x08, 0x02, 0x76, 0x04, 0xb0,
    ])
    expect(readImageDimensions('image/jpeg', jpeg)).toEqual({ width: 1200, height: 630 })
  })

  it('reads extended WebP canvas dimensions', () => {
    const webp = new Uint8Array(30)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    webp.set([0x56, 0x50, 0x38, 0x58], 12)
    webp.set([0xaf, 0x04, 0x00, 0x75, 0x02, 0x00], 24)

    expect(readImageDimensions('image/webp', webp)).toEqual({ width: 1200, height: 630 })
  })
  it('rejects declared MIME that does not match bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    expect(validateDeclaredImageMime('image/png', jpeg)).toBe(false)
  })
})