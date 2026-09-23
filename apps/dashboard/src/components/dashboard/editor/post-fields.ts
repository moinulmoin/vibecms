/** Pure helpers for post metadata fields. */

export function parseTags(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(',')) {
    const tag = raw.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  return tags
}

/** First prose paragraph as plain text: what readers see when no excerpt is set. */
export function firstParagraph(markdown: string, limit = 200): string {
  let inFence = false
  for (const block of markdown.split(/\n\s*\n/)) {
    const trimmed = block.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      const fences = trimmed.match(/^(```|~~~)/gm)?.length ?? 0
      if (fences % 2 === 1) inFence = !inFence
      continue
    }
    if (inFence || !trimmed) continue
    if (/^(#{1,6}\s|>|[-*+]\s|\d+\.\s|\||!\[|\[\[|<|:::|---|\*\*\*)/.test(trimmed)) continue
    const plain = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[\^[^\]]+\]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!plain) continue
    return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain
  }
  return ''
}
