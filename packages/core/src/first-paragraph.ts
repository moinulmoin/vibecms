/** A short plain-text description of the first prose paragraph in Markdown. */
export function firstParagraph(markdown: string, maxLength = 200): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const prose: string[] = []
  let fence: { marker: string; length: number } | null = null

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.marker && marker[1]!.length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))) fence = null
      continue
    }
    if (marker) {
      if (prose.length) break
      fence = { marker: marker[1]![0]!, length: marker[1]!.length }
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      if (prose.length) break
      continue
    }
    if (/^(?: {4}|\t)/.test(line) || /^(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|\|)/.test(trimmed) ||
        /^(?:!\[[^\]]*\]\([^)]*\)\s*|:::|(?:-{3,}|\*{3,}|_{3,})\s*|<(?:!--|\/?[a-z][\w-]*(?:\s|>|\/)))/i.test(trimmed)) {
      if (prose.length) break
      continue
    }
    prose.push(trimmed)
  }

  const plain = prose.join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?<!\\)[`*_~]/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, '$1')
    .replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? _
      const codePoint = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : _
    })
    .replace(/\s+/g, ' ').trim()
  if (plain.length <= maxLength) return plain
  if (maxLength <= 1) return maxLength === 1 ? '…' : ''
  const prefix = plain.slice(0, maxLength - 1)
  const boundary = prefix.lastIndexOf(' ')
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`
}
