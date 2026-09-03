'use client'

import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
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

function editorExtensions(onChange: (value: string) => void, onSelection: (view: EditorView) => void, onKeyDown: (event: KeyboardEvent, view: EditorView) => boolean) {
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
    keymap.of([
      ...closeBracketsKeymap,
      ...markdownKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
    ]),
    EditorView.lineWrapping,
    placeholder('Write Markdown… type / on a new line for blocks.'),
    EditorView.contentAttributes.of({
      'aria-label': 'Post Markdown source',
      spellcheck: 'true',
      autocapitalize: 'sentences',
    }),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged || transaction.annotation(externalSync)) return transaction
      return transaction.newDoc.length <= MAX_MARKDOWN_LENGTH ? transaction : []
    }),
    EditorView.domEventHandlers({ keydown: onKeyDown }),
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

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    const upload = uploadFileRef.current
    const pending = pendingImageRef.current
    pendingImageRef.current = null
    if (!file || !upload || !pending) return
    setUploadStatus('Uploading image…')
    try {
      const url = await upload(file)
      const view = viewRef.current
      if (!view) return
      const currentTrigger = view.state.doc.sliceString(pending.from, pending.to)
      const from = currentTrigger === pending.trigger ? pending.from : view.state.selection.main.head
      const to = currentTrigger === pending.trigger ? pending.to : from
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').trim() || 'Image'
      const markdownImage = `![${alt}](${url})`
      view.dispatch({
        changes: { from, to, insert: markdownImage },
        selection: { anchor: from + markdownImage.length },
        userEvent: 'input.complete',
      })
      view.focus()
      setUploadStatus('Image inserted')
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Image upload failed. Try again.')
    }
  }

  return (
    <div className="relative" data-testid="markdown-source">
      <div
        ref={hostRef}
        data-testid="markdown-source-editor"
        className="min-w-0 sm:[&_.cm-editor]:min-h-[32rem] sm:[&_.cm-scroller]:min-h-[32rem]"
      />
      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void handleImageChange(event)} />
      {uploadStatus ? <p role="status" className="mt-2 font-mono text-xs text-muted-foreground">{uploadStatus}</p> : null}
      {slash && commands.length > 0 ? (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Insert a block"
          className="absolute inset-x-2 top-2 z-20 max-w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/25"
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
