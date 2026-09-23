/**
 * Alt text from an uploaded file name. Camera, screenshot, and clipboard names
 * ("IMG_1234.png", "Screenshot 2024-…", "image.png") say nothing about the
 * picture, so they yield an empty string and the preview asks for real alt text.
 */
const GENERIC_WORDS = new Set([
  'img', 'image', 'images', 'dsc', 'dscn', 'dcim', 'pxl', 'photo', 'pic', 'picture', 'screenshot', 'screen', 'shot',
  'scr', 'clipboard', 'pasted', 'paste', 'untitled', 'file', 'download', 'capture', 'cleanshot', 'snap', 'whatsapp',
  'mvimg', 'vid', 'frame', 'copy', 'at', 'am', 'pm', 'edited', 'final', 'new',
])

function isGeneric(words: string) {
  return words
    .toLowerCase()
    .split(/[\s.()]+/)
    .filter(Boolean)
    .every((token) => GENERIC_WORDS.has(token) || /^[a-z]{0,3}\d[\d.:]*$/.test(token))
}

export function altFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\[\]]/g, '')
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return ''
  if (isGeneric(words)) return ''
  // Mostly digits or hashes (e.g. "20240102 101500", "a8f3c9e1b2") carry no meaning.
  const letters = words.replace(/[^a-z]/gi, '')
  if (letters.length < 3 || /^[0-9a-f]{8,}$/i.test(words.replace(/\s/g, ''))) return ''
  return words.charAt(0).toUpperCase() + words.slice(1)
}
