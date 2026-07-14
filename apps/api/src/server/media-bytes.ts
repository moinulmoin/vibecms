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