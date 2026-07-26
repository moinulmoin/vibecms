const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]

function startsWith(bytes: Uint8Array, sig: number[]) {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false
  }
  return true
}

export type ImageDimensions = {
  width: number
  height: number
}

function dimensions(width: number, height: number): ImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null
}

function uint16BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function uint16LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (marker === 0xda || offset + 1 >= bytes.length) return null

    const segmentLength = uint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isStartOfFrame && segmentLength >= 7) {
      return dimensions(
        uint16BigEndian(bytes, offset + 5),
        uint16BigEndian(bytes, offset + 3),
      )
    }
    offset += segmentLength
  }
  return null
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunk === 'VP8X') {
    return dimensions(
      uint24LittleEndian(bytes, 24) + 1,
      uint24LittleEndian(bytes, 27) + 1,
    )
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21])
    const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6))
    return dimensions(width, height)
  }
  if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return dimensions(
      uint16LittleEndian(bytes, 26) & 0x3fff,
      uint16LittleEndian(bytes, 28) & 0x3fff,
    )
  }
  return null
}

export function readImageDimensions(
  mimeType: string,
  bytes: Uint8Array,
): ImageDimensions | null {
  if (mimeType === 'image/png') {
    if (
      bytes.length < 24 ||
      String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR'
    ) {
      return null
    }
    return dimensions(uint32BigEndian(bytes, 16), uint32BigEndian(bytes, 20))
  }
  if (mimeType === 'image/gif') {
    return bytes.length >= 10
      ? dimensions(uint16LittleEndian(bytes, 6), uint16LittleEndian(bytes, 8))
      : null
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/webp') return webpDimensions(bytes)
  return null
}

export function sniffImageMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif'
  if (
    bytes.length >= 12 &&
    startsWith(bytes, WEBP_RIFF) &&
    bytes[8] === WEBP_MAGIC[0] &&
    bytes[9] === WEBP_MAGIC[1] &&
    bytes[10] === WEBP_MAGIC[2] &&
    bytes[11] === WEBP_MAGIC[3]
  ) {
    return 'image/webp'
  }
  return null
}

export function validateDeclaredImageMime(declared: string, bytes: Uint8Array): boolean {
  const sniffed = sniffImageMime(bytes)
  if (!sniffed) return false
  return sniffed === declared
}