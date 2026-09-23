import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  type Block,
  type PartialBlock,
} from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { ListTree } from 'lucide-react'

export const CALLOUT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export const CALLOUT_PLACEHOLDER_PREFIX = 'vc-callout-marker-'
export const TOC_PLACEHOLDER = 'vc-toc-marker'
export const VISUAL_MARKDOWN_VERSION = 1

const calloutKindValues = [...CALLOUT_KINDS] as const

/**
 * These are deliberately first-class blocks instead of markdown-looking text.
 * The markdown adapter hides their implementation details behind placeholders,
 * which keeps BlockNote's parser/exporter in charge of ordinary markdown.
 */
export const calloutBlock = createReactBlockSpec(
  {
    type: 'vcCallout',
    propSchema: {
      kind: { default: 'NOTE', values: calloutKindValues },
    },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => (
      <div className="vc-editor-callout" data-callout-kind={block.props.kind}>
        <span className="vc-editor-callout__label">{block.props.kind}</span>
        <div ref={contentRef} className="vc-editor-callout__content" />
      </div>
    ),
  },
)

export const tocBlock = createReactBlockSpec(
  {
    type: 'vcToc',
    propSchema: {},
    content: 'none',
  },
  {
    render: () => (
      <div className="vc-editor-toc" contentEditable={false} role="note" aria-label="Table of contents">
        <ListTree aria-hidden="true" size={16} />
        <span>Table of contents</span>
      </div>
    ),
  },
)

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    vcCallout: calloutBlock(),
    vcToc: tocBlock(),
  },
})

export type EditorBlock = Block<typeof editorSchema.blockSchema, typeof editorSchema.inlineContentSchema, typeof editorSchema.styleSchema>
export type EditorPartialBlock = PartialBlock<
  typeof editorSchema.blockSchema,
  typeof editorSchema.inlineContentSchema,
  typeof editorSchema.styleSchema
>

export type MarkdownAdapterResult = {
  blocks: EditorPartialBlock[]
  /** True when an adapter round-trip changes meaningful markdown. */
  drifted: boolean
  /** Useful for diagnostics and the dismissible safety banner. */
  roundTripMarkdown: string
}

/**
 * BlockNote's custom-schema editors carry schema-dependent generics; the
 * adapter only calls schema-agnostic APIs (parse/export/replace), so the
 * canonical loose editor type is the correct boundary here.
 */
export type AnyBlockNoteEditor = BlockNoteEditor<any, any, any>

export function createMarkdownEditor(options?: Parameters<typeof BlockNoteEditor.create>[0]): AnyBlockNoteEditor {
  return BlockNoteEditor.create({ schema: editorSchema, ...options })
}

function calloutPlaceholder(index: number) {
  return `${CALLOUT_PLACEHOLDER_PREFIX}${index}\uE001`
}

function replaceSpecialMarkdown(markdown: string) {
  const placeholders = new Map<string, { kind: CalloutKind; body: string }>()
  let index = 0
  let source = markdown.replace(
    /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:>[^\n]*(?:\n|$))*)/gim,
    (_match, kind: string, rawBody: string) => {
      const body = rawBody
        .split('\n')
        .map((line: string) => line.replace(/^> ?/, ''))
        .join('\n')
        .replace(/\n+$/, '')
      const placeholder = calloutPlaceholder(index++)
      placeholders.set(placeholder, { kind: kind.toUpperCase() as CalloutKind, body })
      return `${placeholder}\n\n`
    },
  )
  source = source.replace(/^\s*\[\[toc\]\]\s*$/gim, () => `${TOC_PLACEHOLDER}\n\n`)
  return { source, placeholders }
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) return String(item.text)
      return ''
    })
    .join('')
}

const STYLE_MARKERS: Array<[style: string, marker: string]> = [['code', '`'], ['bold', '**'], ['italic', '*'], ['strike', '~~']]

/**
 * Callout bodies are stored as literal Markdown, so formatting or links added
 * inside a callout must be written back as Markdown instead of dropped.
 */
function inlineMarkdown(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      if ('type' in item && item.type === 'link' && 'href' in item) {
        return `[${inlineMarkdown((item as { content?: unknown }).content)}](${String(item.href)})`
      }
      if (!('text' in item)) return ''
      const text = String(item.text)
      const styles = ('styles' in item && item.styles && typeof item.styles === 'object' ? item.styles : {}) as Record<string, unknown>
      const core = text.trim()
      if (!core) return text
      // Markers must hug the text (`** now**` is not bold), so keep edge spaces outside.
      const start = text.indexOf(core)
      const wrapped = STYLE_MARKERS.reduce((value, [style, marker]) => (styles[style] ? `${marker}${value}${marker}` : value), core)
      return `${text.slice(0, start)}${wrapped}${text.slice(start + core.length)}`
    })
    .join('')
}

function mapSpecialBlocks(blocks: EditorPartialBlock[], placeholders: Map<string, { kind: CalloutKind; body: string }>): EditorPartialBlock[] {
  const markerPattern = new RegExp(`${CALLOUT_PLACEHOLDER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+\\uE001|${TOC_PLACEHOLDER}`, 'g')
  const mapped: EditorPartialBlock[] = []
  for (const block of blocks) {
    const children = block.children ? { children: mapSpecialBlocks(block.children, placeholders) } : {}
    const text = inlineText(block.content)
    const matches = [...text.matchAll(markerPattern)]
    if (matches.length === 0) {
      mapped.push({ ...block, ...children })
      continue
    }
    let cursor = 0
    for (const match of matches) {
      const before = text.slice(cursor, match.index).trim()
      if (before) mapped.push({ ...block, content: before, ...children } as EditorPartialBlock)
      const marker = match[0]
      const callout = placeholders.get(marker)
      if (callout) {
        mapped.push({ type: 'vcCallout', props: { kind: callout.kind }, content: callout.body } as EditorPartialBlock)
      } else if (marker === TOC_PLACEHOLDER) {
        mapped.push({ type: 'vcToc' } as EditorPartialBlock)
      }
      cursor = (match.index ?? 0) + marker.length
    }
    const after = text.slice(cursor).trim()
    if (after) mapped.push({ ...block, content: after, ...children } as EditorPartialBlock)
  }
  return mapped
}

const MEDIA_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'file'])

/**
 * BlockNote parses media through an <img src>, which resolves relative URLs
 * against the page. Undo that so `/media-assets/…` stays relative (otherwise
 * every post with an uploaded image drifts and can never be edited visually).
 */
function restoreRelativeMediaUrls(blocks: EditorPartialBlock[], markdown: string): EditorPartialBlock[] {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined
  if (!origin || origin === 'null') return blocks
  return blocks.map((block) => {
    const children = block.children ? { children: restoreRelativeMediaUrls(block.children, markdown) } : {}
    const url = (block.props as { url?: unknown } | undefined)?.url
    if (MEDIA_BLOCK_TYPES.has(String(block.type)) && typeof url === 'string' && url.startsWith(`${origin}/`) && !markdown.includes(url)) {
      return { ...block, ...children, props: { ...block.props, url: url.slice(origin.length) } } as EditorPartialBlock
    }
    return { ...block, ...children }
  })
}

/** Parse markdown while making callouts and [[toc]] durable custom blocks. */
export function markdownToBlocks(markdown: string, editor: AnyBlockNoteEditor = createMarkdownEditor()) {
  const { source, placeholders } = replaceSpecialMarkdown(markdown)
  const parsed = editor.tryParseMarkdownToBlocks(source) as EditorPartialBlock[]
  return restoreRelativeMediaUrls(mapSpecialBlocks(parsed, placeholders), markdown)
}

function placeholderParagraph(value: string): EditorPartialBlock {
  return { type: 'paragraph', content: value }
}
function prepareBlocksForExport(
  blocks: EditorPartialBlock[],
  specials: Map<string, string>,
  indexRef = { value: 0 },
): EditorPartialBlock[] {
  return blocks.map((block) => {
    const children = block.children
      ? { children: prepareBlocksForExport(block.children, specials, indexRef) }
      : {}
    if (block.type === 'vcCallout') {
      const marker = calloutPlaceholder(indexRef.value++)
      const kind = String((block.props as { kind?: string } | undefined)?.kind ?? 'NOTE').toUpperCase()
      const body = inlineMarkdown(block.content)
      const bodyLines = body.split('\n').map((line) => `> ${line}`).join('\n')
      specials.set(marker, `> [!${kind}]\n${bodyLines}`)
      return { ...placeholderParagraph(marker), ...children, id: block.id }
    }
    if (block.type === 'vcToc') {
      specials.set(TOC_PLACEHOLDER, '[[toc]]')
      return { ...placeholderParagraph(TOC_PLACEHOLDER), ...children, id: block.id }
    }
    return { ...block, ...children }
  })
}
function canonicalizeMarkdown(markdown: string) {
  return markdown
    .split('\n')
    .map((line) => {
      const list = /^(\s*)\* (?=(?:\[[ xX]\] )?\S)/.exec(line)
      if (list) return `${list[1]}- ${line.slice(list[0].length)}`
      if (line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')) {
        const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim().replace(/^-+$/, '---'))
        return `| ${cells.join(' | ')} |`
      }
      return line
    })
    .join('\n')
}

/**
 * Empty paragraphs (pressing Enter mid-document) export as extra blank lines,
 * which Markdown ignores. Collapse them outside code fences so a transient
 * empty block never counts as lossy and ejects the writer from Visual mode.
 */
function collapseBlankLines(markdown: string) {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null
      out.push(line)
      continue
    }
    if (marker) fence = marker
    if (line.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue
    out.push(line)
  }
  return out.join('\n')
}

export function blocksToMarkdown(blocks: EditorPartialBlock[], editor: AnyBlockNoteEditor = createMarkdownEditor()) {
  const specials = new Map<string, string>()
  const prepared = prepareBlocksForExport(blocks, specials)
  let markdown = collapseBlankLines(canonicalizeMarkdown(editor.blocksToMarkdownLossy(prepared)))
  for (const [marker, replacement] of specials) markdown = markdown.replaceAll(marker, replacement)
  return markdown
}

/** Display-only normalization. Never use this to decide whether rich editing is lossless. */
export function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

export function markdownAdapterResult(markdown: string, editor?: AnyBlockNoteEditor): MarkdownAdapterResult {
  const instance = editor ?? createMarkdownEditor()
  const blocks = markdownToBlocks(markdown, instance)
  const roundTripMarkdown = blocksToMarkdown(blocks, instance)
  return {
    blocks,
    roundTripMarkdown,
    drifted: roundTripMarkdown !== markdown,
  }
}

export type VisualMarkdownSafety = MarkdownAdapterResult & {
  safe: boolean
  reason: 'internal_marker' | 'unsupported_syntax' | 'lossy_round_trip' | null
}

const unsupportedVisualSyntax = [
  /(^|\n)\s*:::/,
  /(^|\n)\s*\[\^[^\]]+\]:/,
  /\[\^[^\]]+\]/,
  /(^|\n)\s*\[[^\]]+\]:\s*\S+/,
  /<\/?[A-Za-z][^>]*>/,
  /(^|[^\\])\{[^\n{}]+\}/,
  /(^|\n)\s*\$\$/,
] as const

/**
 * Markdown with fenced code blocks and inline code spans blanked out, so
 * syntax checks only see prose. Code is still covered by the round-trip check.
 */
export function markdownOutsideCode(markdown: string) {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null
      out.push('')
      continue
    }
    if (marker) {
      fence = marker
      out.push('')
      continue
    }
    out.push(line.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, ''))
  }
  return out.join('\n')
}

/**
 * Rich editing is allowed only for the versioned subset that BlockNote can
 * round-trip byte-for-byte. Markdown remains canonical and Source mode is the
 * safe fallback for every other document.
 */
export function visualMarkdownSafety(markdown: string, editor?: AnyBlockNoteEditor): VisualMarkdownSafety {
  const result = markdownAdapterResult(markdown, editor)
  if (markdown.includes(CALLOUT_PLACEHOLDER_PREFIX) || markdown.includes(TOC_PLACEHOLDER) || markdown.includes('\uE001')) {
    return { ...result, safe: false, reason: 'internal_marker' }
  }
  const prose = markdownOutsideCode(markdown)
  if (unsupportedVisualSyntax.some((pattern) => pattern.test(prose))) {
    return { ...result, safe: false, reason: 'unsupported_syntax' }
  }
  if (result.drifted) return { ...result, safe: false, reason: 'lossy_round_trip' }
  return { ...result, safe: true, reason: null }
}

export function isMarkdownPaste(text: string) {
  return /^#{1,6} |^> |^- \[ |^```|^\|/m.test(text)
}
