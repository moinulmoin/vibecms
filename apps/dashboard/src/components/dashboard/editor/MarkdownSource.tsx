import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Annotation, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { altFromFileName } from './image-alt'

export type SlashCommand = {
  id: string
  title: string
  description: string
  keywords: string[]
  text?: string
  placeholder?: readonly [number, number]
  action?: 'open-image-dialog'
}

function block(text: string, selected: string) {
  const from = text.indexOf(selected)
  return { text, placeholder: [from, from + selected.length] as const }
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h2', title: 'Heading 2', description: 'Start a new section', keywords: ['h2', 'heading', 'title'], ...block('## Heading\n\n', 'Heading') },
  { id: 'h3', title: 'Heading 3', description: 'Subsection of the current section', keywords: ['h3', 'heading', 'sub'], ...block('### Subheading\n\n', 'Subheading') },
  { id: 'bullet', title: 'Bulleted list', description: 'Unordered list of points', keywords: ['ul', 'bullet', 'point'], ...block('- First item\n- Second item\n', 'First item') },
  { id: 'numbered', title: 'Numbered list', description: 'Ordered steps', keywords: ['ol', 'number', 'step', 'order'], ...block('1. First item\n2. Second item\n', 'First item') },
  { id: 'task', title: 'To-do item', description: 'Checkable box in the rendered page', keywords: ['todo', 'task', 'check', 'box'], ...block('- [ ] Task\n', 'Task') },
  { id: 'quote', title: 'Quote', description: 'Pull-quote or blockquote', keywords: ['quote', 'blockquote', 'cite'], ...block('> Quote\n\n', 'Quote') },
  { id: 'code', title: 'Code block', description: 'Fenced block with a language', keywords: ['code', 'snippet', 'fence', 'terminal'], ...block('```language\ncode\n```\n\n', 'language') },
  { id: 'divider', title: 'Divider', description: 'Horizontal rule between sections', keywords: ['hr', 'rule', 'separator', 'line'], text: '---\n\n' },
  { id: 'table', title: 'Table', description: 'Two-column table — extend with |pipes|', keywords: ['table', 'grid', 'column'], ...block('| Column | Column |\n| --- | --- |\n| Value | Value |\n\n', 'Value') },
  { id: 'link', title: 'Link', description: 'Inline Markdown link', keywords: ['url', 'anchor', 'href'], ...block('[text](https://)', 'text') },
  { id: 'image', title: 'Image…', description: 'Upload and insert an image', keywords: ['img', 'photo', 'picture', 'figure', 'cover'], action: 'open-image-dialog' },
]

export function slashQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  if (value[lineStart] !== '/' || caret <= lineStart) return null
  const query = value.slice(lineStart + 1, caret)
  return /^[a-z0-9-]*$/i.test(query) ? { start: lineStart, query } : null
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS
    .map((cmd) => {
      const title = cmd.title.toLowerCase()
      const words = title.split(/[^a-z0-9]+/).filter(Boolean)
      const haystack = [title, ...cmd.keywords, ...words]
      let score = -1
      for (const candidate of haystack) {
        if (candidate.startsWith(q)) score = Math.max(score, title.startsWith(q) || words.some((word) => word.startsWith(q)) ? 0 : 1)
        else if (candidate.includes(q)) score = Math.max(score, 2)
      }
      return { cmd, score }
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.cmd.title.localeCompare(b.cmd.title))
    .map(({ cmd }) => cmd)
}

export function applySlashCommand(value: string, caret: number, queryStart: number, cmd: SlashCommand) {
  const text = cmd.text ?? ''
  const nextValue = value.slice(0, queryStart) + text + value.slice(caret)
  const [selectionStart, selectionEnd] = cmd.placeholder ?? [text.length, text.length]
  return {
    value: nextValue,
    selectionStart: queryStart + selectionStart,
    selectionEnd: queryStart + selectionEnd,
  }
}

export type MarkdownSourceProps = {
  value: string
  onChange: (value: string) => void
  onRequestImage?: () => void
  uploadFile?: (file: File) => Promise<string>
}

const externalSync = Annotation.define<boolean>()
const MAX_MARKDOWN_LENGTH = 500_000

const sourceTheme = EditorView.theme({
  '&': {
    minHeight: '22rem',
    borderRadius: '0.75rem',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: '0.875rem',
  },
  '&.cm-focused': {
    outline: '2px solid var(--ring)',
    outlineOffset: '2px',
  },
  '.cm-scroller': {
    minHeight: '22rem',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.5rem',
  },
  '.cm-content': {
    padding: '0.875rem 0',
    caretColor: 'var(--brand-bright)',
  },
  '.cm-line': {
    padding: '0 1rem 0 0.75rem',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--border)',
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--brand-bright) 22%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklch, var(--brand-bright) 18%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--brand-bright) 20%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--brand-bright) 45%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border)',
  },
  '.cm-textfield': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
}, { dark: false })

// Token colors inherit the dashboard's audited light/dark variables instead of
// CodeMirror's light-only default highlight palette.
const sourceHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '700' },
  { tag: tags.strong, color: 'var(--foreground)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--foreground)', fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--brand-bright)' },
  { tag: [tags.quote, tags.list, tags.meta], color: 'var(--muted-foreground)' },
  { tag: tags.contentSeparator, color: 'var(--muted-foreground)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
])

/** Wrap (or unwrap) every selection range with a Markdown marker, e.g. ** or _. */
export function toggleInlineMarker(view: EditorView, marker: string) {
  const { state } = view
  const size = marker.length
  view.dispatch(state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - size, range.from)
    const after = state.sliceDoc(range.to, range.to + size)
    if (before === marker && after === marker) {
      return {
        changes: [{ from: range.from - size, to: range.from }, { from: range.to, to: range.to + size }],
        range: EditorSelection.range(range.from - size, range.to - size),
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    if (text.length > size * 2 && text.startsWith(marker) && text.endsWith(marker)) {
      return {
        changes: { from: range.from, to: range.to, insert: text.slice(size, -size) },
        range: EditorSelection.range(range.from, range.to - size * 2),
      }
    }
    return {
      changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
      range: EditorSelection.range(range.from + size, range.to + size),
    }
  }), { userEvent: 'input.format' })
  return true
}

/** Turn the selection into a Markdown link and select the URL placeholder. */
export function insertMarkdownLink(view: EditorView) {
  const { state } = view
  view.dispatch(state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const isUrl = /^https?:\/\/\S+$/.test(text)
    const label = isUrl ? 'link' : text || 'link'
    const url = isUrl ? text : 'https://'
    const insert = `[${label}](${url})`
    const urlStart = range.from + label.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: isUrl || !text
        ? EditorSelection.range(range.from + 1, range.from + 1 + label.length)
        : EditorSelection.range(urlStart, urlStart + url.length),
    }
  }), { userEvent: 'input.format' })
  return true
}

const formattingKeymap = keymap.of([
  { key: 'Mod-b', run: (view) => toggleInlineMarker(view, '**') },
  { key: 'Mod-i', run: (view) => toggleInlineMarker(view, '_') },
  { key: 'Mod-k', run: insertMarkdownLink },
])

function editorExtensions(
  onChange: (value: string) => void,
  onSelection: (view: EditorView) => void,
  onKeyDown: (event: KeyboardEvent, view: EditorView) => boolean,
  onFiles: (files: File[], view: EditorView, position: number | null) => boolean,
) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    search({ top: true }),
    highlightSelectionMatches(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    markdown({ base: markdownLanguage, addKeymap: false }),
    syntaxHighlighting(sourceHighlightStyle),
    // Slash-menu navigation must win over Enter/arrow bindings below.
    Prec.highest(EditorView.domEventHandlers({ keydown: onKeyDown })),
    formattingKeymap,
    keymap.of([
      ...closeBracketsKeymap,
      ...markdownKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
    ]),
    EditorView.lineWrapping,
    placeholder('Write in Markdown. Type / on a new line for blocks, paste or drop images.'),
    EditorView.contentAttributes.of({
      'aria-label': 'Post Markdown source',
      spellcheck: 'true',
      autocapitalize: 'sentences',
    }),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged || transaction.annotation(externalSync)) return transaction
      return transaction.newDoc.length <= MAX_MARKDOWN_LENGTH ? transaction : []
    }),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        return onFiles(files, view, null)
      },
      drop: (event, view) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        return onFiles(files, view, view.posAtCoords({ x: event.clientX, y: event.clientY }))
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const isExternal = update.transactions.some((transaction) => transaction.annotation(externalSync) === true)
        if (!isExternal) onChange(update.state.doc.toString())
      }
      if (update.docChanged || update.selectionSet) onSelection(update.view)
    }),
    sourceTheme,
  ]
}

export function MarkdownSource({ value, onChange, onRequestImage, uploadFile }: MarkdownSourceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const onRequestImageRef = useRef(onRequestImage)
  const uploadFileRef = useRef(uploadFile)
  const [slash, setSlash] = useState<{ start: number; query: string; index: number } | null>(null)
  const slashRef = useRef(slash)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingImageRef = useRef<{ from: number; to: number; trigger: string } | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const commands = slash ? filterSlashCommands(slash.query) : []
  const commandsRef = useRef(commands)

  onChangeRef.current = onChange
  onRequestImageRef.current = onRequestImage
  uploadFileRef.current = uploadFile
  slashRef.current = slash
  commandsRef.current = commands

  function updateSlash(view: EditorView) {
    const selection = view.state.selection.main
    if (!selection.empty) {
      setSlash(null)
      return
    }
    const document = view.state.doc.toString()
    const match = slashQueryAt(document, selection.head)
    setSlash((current) => match ? {
      ...match,
      index: current?.start === match.start && current.query === match.query ? current.index : 0,
    } : null)
  }

  function runSlashCommand(view: EditorView, command: SlashCommand) {
    const state = slashRef.current
    if (!state) return
    const caret = view.state.selection.main.head
    if (command.action === 'open-image-dialog') {
      if (uploadFileRef.current) {
        pendingImageRef.current = {
          from: state.start,
          to: caret,
          trigger: view.state.doc.sliceString(state.start, caret),
        }
        setSlash(null)
        fileInputRef.current?.click()
      } else {
        onRequestImageRef.current?.()
      }
      return
    }
    const applied = applySlashCommand(view.state.doc.toString(), caret, state.start, command)
    view.dispatch({
      changes: { from: state.start, to: caret, insert: command.text ?? '' },
      selection: { anchor: applied.selectionStart, head: applied.selectionEnd },
      userEvent: 'input.complete',
    })
    setSlash(null)
    view.focus()
  }

  function handleEditorKeyDown(event: KeyboardEvent, view: EditorView) {
    const state = slashRef.current
    const available = commandsRef.current
    if (!state || available.length === 0) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSlash({ ...state, index: (state.index + 1) % available.length })
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSlash({ ...state, index: (state.index - 1 + available.length) % available.length })
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runSlashCommand(view, available[Math.min(state.index, available.length - 1)])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setSlash(null)
      return true
    }
    return false
  }

  useLayoutEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions(
          (nextValue) => onChangeRef.current(nextValue),
          updateSlash,
          handleEditorKeyDown,
          (files, view, position) => {
            void insertUploadedImages(files, view, position)
            return true
          },
        ),
      }),
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
    // CodeMirror owns one view per mount; current callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
    })
  }, [value])

  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [slash?.index])

  async function insertUploadedImages(files: File[], view: EditorView, position: number | null, replace?: { from: number; to: number; trigger: string }) {
    const upload = uploadFileRef.current
    if (!upload) {
      setUploadStatus('Image uploads are not available here.')
      return
    }
    setUploadStatus(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading image…')
    let missingAlt = false
    try {
      const snippets: string[] = []
      for (const file of files) {
        const url = await upload(file)
        const alt = altFromFileName(file.name)
        if (!alt) missingAlt = true
        snippets.push(`![${alt}](${url})`)
      }
      const current = viewRef.current ?? view
      const docLength = current.state.doc.length
      const triggerStillThere = replace && current.state.doc.sliceString(replace.from, replace.to) === replace.trigger
      const from = triggerStillThere ? replace.from : Math.min(position ?? current.state.selection.main.head, docLength)
      const to = triggerStillThere ? replace.to : from
      const insert = snippets.join('\n\n')
      current.dispatch({
        changes: { from, to, insert },
        selection: missingAlt ? { anchor: from + 2 } : { anchor: from + insert.length },
        userEvent: 'input.complete',
      })
      current.focus()
      setUploadStatus(missingAlt ? 'Image added. Describe it between the brackets so readers and search engines know what it shows.' : 'Image added.')
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Image upload failed. Try again.')
    }
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    const pending = pendingImageRef.current
    pendingImageRef.current = null
    const view = viewRef.current
    if (files.length === 0 || !view) return
    await insertUploadedImages(files, view, pending?.from ?? null, pending ?? undefined)
  }

  return (
    <div className="relative" data-testid="markdown-source">
      <div
        ref={hostRef}
        data-testid="markdown-source-editor"
        className="min-w-0 sm:[&_.cm-editor]:min-h-[32rem] sm:[&_.cm-scroller]:min-h-[32rem]"
      />
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="markdown-image-input" onChange={(event) => void handleImageChange(event)} />
      {uploadStatus ? <p role="status" className="mt-2 font-mono text-xs text-muted-foreground">{uploadStatus}</p> : null}
      {slash && commands.length > 0 ? (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Insert a block"
          className="absolute inset-x-2 top-2 z-20 max-w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-menu)]"
        >
          <div className="max-h-64 overflow-y-auto">
            {commands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === slash.index}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left outline-none ${index === slash.index ? 'bg-accent' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  const view = viewRef.current
                  if (view) runSlashCommand(view, command)
                }}
                onMouseEnter={() => setSlash((current) => (current ? { ...current, index } : current))}
              >
                <span className="shrink-0 font-sans text-sm font-medium text-foreground">{command.title}</span>
                <span className="min-w-0 truncate font-sans text-xs text-muted-foreground">{command.description}</span>
              </button>
            ))}
          </div>
          <p className="border-t border-[color:var(--hairline)] px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            Arrow keys choose · Enter inserts · Esc closes
          </p>
        </div>
      ) : null}
    </div>
  )
}
