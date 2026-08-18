'use client'

import { renderRichContent, readingTimeMinutes } from '@vc/content'
import { PresentedPostArticle, type SiteThemeInput } from '@vc/content/presented-post'
import { PublicPageChrome } from '@vc/content/public-chrome'
import { MEDIA, resolvePresentation, type Presentation } from '@vc/config'
import { Button, Field, FieldDescription, FieldLabel, Input, Textarea } from '@vc/ui'
import { ImageIcon, UploadIcon } from '@radix-ui/react-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { loadMediaPage } from '~/lib/api-client'
import { parseMutationResultJson } from '~/lib/mutation-result'

type MarkdownAsset = {
  id: string
  filename: string
  altText: string | null
  width: number | null
  height: number | null
}
type EditorSite = {
  name: string
  description: string | null
  slug: string
}

export type PreviewMetadata = {
  title?: string
  excerpt?: string
  coverAssetSrc?: string
  coverAssetAlt?: string
  coverAssetWidth?: number
  coverAssetHeight?: number
  tags?: string[]
}

// Typing settles ~400ms before the exact public page re-renders beside the
// textarea. Short enough to feel live, long enough that renderRichContent
// never runs per keystroke.
export const PREVIEW_DEBOUNCE_MS = 400

// ---------------------------------------------------------------------------
// Slash commands — Notion-lite block insertion into the Markdown textarea.
// Deliberately no H1 (the post title is the page's one H1), and "Image"
// routes to the media dialog so alt text is never skippable.
// ---------------------------------------------------------------------------
export type SlashCommand = {
  id: string
  title: string
  description: string
  keywords: string[]
  /** Text inserted in place of the typed `/query`. */
  text?: string
  /** [from, to] offsets into `text` selecting the word the writer replaces. */
  placeholder?: readonly [number, number]
  /** Non-text command: handled by the caller. */
  action?: 'open-image-dialog'
}

function block(text: string, selected: string): { text: string; placeholder: readonly [number, number] } {
  const from = text.indexOf(selected)
  return { text, placeholder: [from, from + selected.length] }
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
  { id: 'image', title: 'Image…', description: 'Media library or upload, with alt text', keywords: ['img', 'photo', 'picture', 'figure', 'cover'], action: 'open-image-dialog' },
]

/** The `/query` under the caret, only when `/` opens a new line. */
export function slashQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  if (value[lineStart] !== '/' || caret <= lineStart) return null
  const query = value.slice(lineStart + 1, caret)
  return /^[a-z0-9-]*$/i.test(query) ? { start: lineStart, query } : null
}

/** Commands matching the query; best (prefix) matches first. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  const scored = SLASH_COMMANDS.map((cmd) => {
    const title = cmd.title.toLowerCase()
    const words = title.split(/[^a-z0-9]+/).filter(Boolean)
    const hay = [title, ...cmd.keywords, ...words]
    let score = -1 // -1 no match; 0 word/title prefix; 1 keyword prefix; 2 substring
    for (const candidate of hay) {
      if (candidate.startsWith(q)) score = Math.max(score, title.startsWith(q) || words.some((w) => w.startsWith(q)) ? 0 : 1)
      else if (candidate.includes(q)) score = Math.max(score, 2)
    }
    return { cmd, score }
  })
  return scored
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.cmd.title.localeCompare(b.cmd.title))
    .map((entry) => entry.cmd)
}

/** Replace the typed `/query` span with a command's snippet. */
export function applySlashCommand(
  value: string,
  caret: number,
  queryStart: number,
  cmd: SlashCommand,
): { value: string; selectionStart: number; selectionEnd: number } {
  const text = cmd.text ?? ''
  const next = value.slice(0, queryStart) + text + value.slice(caret)
  const [selStart, selEnd] = cmd.placeholder ?? [text.length, text.length]
  return { value: next, selectionStart: queryStart + selStart, selectionEnd: queryStart + selEnd }
}

/** Caret pixel position inside the textarea (mirror-div measure), for the
 *  menu anchor. Returns null when measurement is impossible. */
function caretPixelOffset(textarea: HTMLTextAreaElement, position: number): { left: number; top: number } | null {
  try {
    const style = getComputedStyle(textarea)
    const mirror = document.createElement('div')
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    for (const prop of [
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textIndent',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'width', 'boxSizing', 'textTransform', 'wordBreak',
    ] as const) {
      mirror.style[prop] = style[prop]
    }
    mirror.textContent = textarea.value.slice(0, position)
    const marker = document.createElement('span')
    marker.textContent = '.'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6
    const result = {
      left: marker.offsetLeft - textarea.scrollLeft,
      top: marker.offsetTop - textarea.scrollTop + lineHeight,
    }
    document.body.removeChild(mirror)
    return result
  } catch {
    return null
  }
}

function readPreviewMetadata(assets: MarkdownAsset[]): PreviewMetadata {
  const title = document.getElementById('post-title')
  const excerpt = document.getElementById('post-excerpt')
  const cover = document.getElementById('post-cover')
  const tagsField = document.getElementById('post-tags')
  const coverAssetId = cover instanceof HTMLSelectElement ? cover.value : ''
  const coverAsset = coverAssetId ? assets.find((asset) => asset.id === coverAssetId) : undefined
  const tagsValue = tagsField instanceof HTMLInputElement ? tagsField.value : ''
  const tags = tagsValue.split(',').map((tag) => tag.trim()).filter(Boolean)
  return {
    title: title instanceof HTMLInputElement ? title.value.trim() || undefined : undefined,
    excerpt: excerpt instanceof HTMLTextAreaElement ? excerpt.value.trim() || undefined : undefined,
    coverAssetSrc: coverAssetId ? `/media-assets/${coverAssetId}` : undefined,
    coverAssetAlt: coverAsset?.altText ?? undefined,
    coverAssetWidth: coverAsset?.width ?? undefined,
    coverAssetHeight: coverAsset?.height ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
  }
}

/**
 * Keeps an { source, metadata } snapshot of the live post form, refreshed
 * shortly after any field changes. Flushes immediately on mount and whenever
 * a dep changes (version restore, async post/asset load), so the preview is
 * never stale and needs no manual refresh.
 */
export function usePostPreviewSync(initialSource: string, deps: unknown[], assets: MarkdownAsset[]) {
  const [source, setSource] = useState(initialSource)
  const [metadata, setMetadata] = useState<PreviewMetadata>({})
  useEffect(() => {
    let timer: number | undefined
    const flush = () => {
      const textarea = document.getElementById('post-markdown')
      setSource(textarea instanceof HTMLTextAreaElement ? textarea.value : '')
      setMetadata(readPreviewMetadata(assets))
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, PREVIEW_DEBOUNCE_MS)
    }
    const form = document.getElementById('post-markdown')?.closest('form')
    form?.addEventListener('input', schedule)
    flush()
    return () => {
      window.clearTimeout(timer)
      form?.removeEventListener('input', schedule)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, assets])
  return { source, metadata }
}

/** Exact public page, live. Rendered beside the write surface on desktop and
 *  as the Preview tab on mobile; the surrounding frame is inert (links never
 *  navigate the editor away). */
export function PostPreviewPane({
  source,
  metadata,
  presetId,
  presentation,
  site,
  siteTheme,
  publishedAt,
}: {
  source: string
  metadata: PreviewMetadata
  presetId?: string
  presentation?: { layout?: string; toc?: boolean }
  site?: EditorSite | null
  siteTheme?: SiteThemeInput
  publishedAt?: number | null
}) {
  const previewResult = useMemo(
    () => renderRichContent(source, { pageTitle: metadata.title }),
    [source, metadata.title],
  )
  return (
    <div aria-label="Markdown preview" className="min-w-0 lg:sticky lg:top-20">
      <p className="mb-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground" aria-live="polite">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright/40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-brand-bright" />
        </span>
        Exact public page · live as you type
      </p>
      {/* Read-only frame: in-page links (tags, masthead, anchors) must not
          navigate the editor away, so anchor activation is captured here —
          click and middle-click (auxclick) alike. */}
      <div
        className="overflow-y-auto rounded-xl border border-[color:var(--hairline)] lg:max-h-[calc(100dvh-10rem)]"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
        onAuxClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
      >
        {source.trim() ? (
          <PublicPageChrome
            siteName={site?.name ?? 'Your blog'}
            tagline={site?.description ?? null}
            homeHref="/"
            allPostsHref="/"
            presetId={presetId ?? 'minimal'}
            theme={siteTheme}
            article
            subscribeVariant="end"
          >
            <PresentedPostArticle
              renderResult={previewResult}
              presetId={presetId ?? 'minimal'}
              presentation={resolvePresentation(presetId ?? 'minimal', presentation as Presentation | null | undefined).resolved}
              theme={siteTheme}
              title={metadata.title}
              excerpt={metadata.excerpt}
              byline={site?.name}
              coverAssetSrc={metadata.coverAssetSrc}
              coverAssetAlt={metadata.coverAssetAlt}
              coverAssetWidth={metadata.coverAssetWidth}
              coverAssetHeight={metadata.coverAssetHeight}
              dateText={new Date((publishedAt ?? Math.floor(Date.now() / 1000)) * 1000).toLocaleDateString()}
              readingMinutes={readingTimeMinutes(source)}
              tags={metadata.tags}
              basePath="/"
            />
          </PublicPageChrome>
        ) : (
          <div className="bg-muted/50 p-8">
            <p className="font-mono text-xs text-muted-foreground">
              Nothing here yet — start writing and the page builds itself.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

type MarkdownEditorProps = {
  assets: MarkdownAsset[]
  defaultValue: string
}

export function MarkdownEditor({ assets, defaultValue }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: defaultValue.length, end: defaultValue.length })
  const [wordCount, setWordCount] = useState(() => countWords(defaultValue))
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? '')
  const [availableAssets, setAvailableAssets] = useState(assets)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [imageAltText, setImageAltText] = useState(assets[0]?.altText ?? '')
  const [imageUploadPending, setImageUploadPending] = useState(false)
  const [imagePickerError, setImagePickerError] = useState<string | null>(null)
  // Slash menu: the typed `/query` span plus the focused command index.
  const [slash, setSlash] = useState<{ start: number; query: string; index: number } | null>(null)
  const slashCommands = slash ? filterSlashCommands(slash.query) : []
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menuRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slash?.index])

  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? availableAssets[0]

  useEffect(() => {
    setAvailableAssets(assets)
    setSelectedAssetId((current) => {
      if (assets.some((asset) => asset.id === current)) return current
      setImageAltText(assets[0]?.altText ?? '')
      return assets[0]?.id ?? ''
    })
  }, [assets])

  function rememberSelection() {
    const textarea = textareaRef.current
    if (!textarea) return
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  function closeSlash() {
    setSlash((current) => (current === null ? current : null))
  }

  function runSlashCommand(cmd: SlashCommand) {
    const textarea = textareaRef.current
    const state = slash
    closeSlash()
    if (cmd.action === 'open-image-dialog') {
      // Rewind the `/query` so the dialog opens on a clean line.
      if (textarea && state) {
        const next = textarea.value.slice(0, state.start) + textarea.value.slice(textarea.selectionStart)
        textarea.value = next
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.setSelectionRange(state.start, state.start)
        selectionRef.current = { start: state.start, end: state.start }
      }
      rememberSelection()
      setImagePickerError(null)
      setImagePickerOpen(true)
      return
    }
    if (!textarea || !state) return
    const applied = applySlashCommand(textarea.value, textarea.selectionStart, state.start, cmd)
    textarea.value = applied.value
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
    textarea.setSelectionRange(applied.selectionStart, applied.selectionEnd)
    selectionRef.current = { start: applied.selectionStart, end: applied.selectionEnd }
  }

  function handleEditorInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget
    rememberSelection()
    setWordCount(countWords(textarea.value))
    const match = slashQueryAt(textarea.value, textarea.selectionStart)
    if (!match) {
      closeSlash()
      return
    }
    setSlash((current) =>
      current && current.start === match.start
        ? { ...current, query: match.query, index: 0 }
        : { ...match, index: 0 },
    )
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!slash || slashCommands.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSlash({ ...slash, index: (slash.index + 1) % slashCommands.length })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSlash({ ...slash, index: (slash.index - 1 + slashCommands.length) % slashCommands.length })
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      runSlashCommand(slashCommands[Math.min(slash.index, slashCommands.length - 1)])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSlash()
    }
  }

  const anchor = slash && textareaRef.current ? caretPixelOffset(textareaRef.current, slash.start) : null

  async function handleImageUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const altText = String(form.get('altText') ?? '').trim()
    if (!altText) {
      setImagePickerError('Describe the image before uploading.')
      return
    }

    setImageUploadPending(true)
    setImagePickerError(null)
    try {
      const priorIds = new Set(availableAssets.map((asset) => asset.id))
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (response.status === 401) {
        window.location.assign('/login')
        return
      }
      const result = parseMutationResultJson(await response.json())
      if (result.kind !== 'ok') {
        setImagePickerError(
          result.code === 'billing_required'
            ? 'A paid plan is required to upload images.'
            : result.code === 'upload_too_large'
              ? `Images must be ${MEDIA.maxImageLabel} or smaller.`
              : 'The image could not be uploaded. Check the file type and try again.',
        )
        return
      }

      const loaded = await loadMediaPage()
      setAvailableAssets(loaded.assets)
      const uploaded = loaded.assets.find((asset) => !priorIds.has(asset.id)) ?? loaded.assets[0]
      if (uploaded) {
        setSelectedAssetId(uploaded.id)
        setImageAltText(uploaded.altText ?? altText)
      }
      formElement.reset()
    } catch {
      setImagePickerError('The image could not be uploaded. Try again.')
    } finally {
      setImageUploadPending(false)
    }
  }

  function insertImage() {
    const textarea = textareaRef.current
    const altText = imageAltText.trim()
    if (!textarea || !selectedAsset || !altText) return

    const imageMarkdown = `![${escapeMarkdownAlt(altText)}](/media-assets/${selectedAsset.id})`
    const value = textarea.value
    const { start, end } = selectionRef.current
    const before = value.slice(0, start)
    const after = value.slice(end)
    const prefix = before.length === 0 || before.endsWith('\n') ? '' : '\n'
    const suffix = after.length === 0 || after.startsWith('\n') ? '' : '\n'
    const nextValue = `${before}${prefix}${imageMarkdown}${suffix}${after}`
    const nextCaret = before.length + prefix.length + imageMarkdown.length

    textarea.value = nextValue
    // The form input listener in usePostPreviewSync catches this dispatch and
    // brings the live preview up to date — no manual refresh anywhere.
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
    selectionRef.current = { start: nextCaret, end: nextCaret }
    setImagePickerOpen(false)
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 rounded-xl border border-[color:var(--hairline)] p-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="px-1 font-mono text-[11px] text-muted-foreground">
          Markdown · <span className="tabular-nums">{wordCount}</span> words ·{' '}
          <span className="tabular-nums">{Math.max(1, Math.ceil(wordCount / 238))}</span> min read
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 justify-center gap-1.5 font-mono text-[11px]"
          onClick={() => {
            rememberSelection()
            setImagePickerError(null)
            setImagePickerOpen(true)
          }}
        >
          <ImageIcon className="size-4" aria-hidden="true" />
          Add image
        </Button>
      </div>
      <Dialog open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add image</DialogTitle>
            <DialogDescription>
              Choose an image or upload a new one, then write alt text for this article.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
            <section className="min-w-0 space-y-3">
              <div>
                <h3 className="font-display text-base font-medium">Media library</h3>
                <p className="text-sm text-muted-foreground">Select an image already in your workspace.</p>
              </div>
              {availableAssets.length > 0 ? (
                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {availableAssets.map((asset) => {
                    const selected = asset.id === selectedAsset?.id
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`min-w-0 rounded-lg bg-muted/50 p-2 text-left transition-colors hover:bg-muted ${
                          selected ? 'ring-2 ring-brand-bright/50' : ''
                        }`}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedAssetId(asset.id)
                          setImageAltText(asset.altText ?? '')
                          setImagePickerError(null)
                        }}
                      >
                        <img
                          src={`/media-assets/${asset.id}`}
                          alt=""
                          className="aspect-[4/3] w-full rounded-md object-cover"
                        />
                        <span className="mt-2 block truncate font-mono text-[11px]">{asset.filename}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                  No images yet. Upload the first one here.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="font-display text-base font-medium">Upload new</h3>
                <p className="text-sm text-muted-foreground">{MEDIA.formatsLabel}, up to {MEDIA.maxImageLabel}.</p>
              </div>
              <form className="grid gap-3" onSubmit={(event) => void handleImageUpload(event)}>
                <Field>
                  <FieldLabel htmlFor="editor-image-file">Image</FieldLabel>
                  <Input
                    id="editor-image-file"
                    type="file"
                    name="file"
                    accept={MEDIA.mimeTypes.join(',')}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="editor-upload-alt">Alt text</FieldLabel>
                  <Input
                    id="editor-upload-alt"
                    name="altText"
                    maxLength={180}
                    placeholder="Describe what the image shows"
                    required
                  />
                </Field>
                <Button type="submit" variant="outline" disabled={imageUploadPending}>
                  <UploadIcon className="size-4" aria-hidden="true" />
                  {imageUploadPending ? 'Uploading…' : 'Upload'}
                </Button>
              </form>
            </section>
          </div>

          {selectedAsset ? (
            <Field>
              <FieldLabel htmlFor="editor-image-alt">Alt text in this article</FieldLabel>
              <Input
                id="editor-image-alt"
                value={imageAltText}
                maxLength={180}
                placeholder="Describe the image in context"
                onChange={(event) => setImageAltText(event.currentTarget.value)}
              />
              <FieldDescription>
                Required for accessibility and publishing. This becomes the text inside <code>![…]</code>.
              </FieldDescription>
            </Field>
          ) : null}

          {imagePickerError ? (
            <p className="text-sm text-destructive" role="alert">{imagePickerError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setImagePickerOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={insertImage}
              disabled={!selectedAsset || !imageAltText.trim()}
            >
              Insert image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="relative">
        <Textarea
          ref={textareaRef}
          id="post-markdown"
          name="contentMarkdown"
          className="min-h-[22rem] font-mono text-sm leading-6 sm:min-h-[32rem]"
          maxLength={500000}
          defaultValue={defaultValue}
          placeholder="Start writing… type / on a new line for blocks, a blank line between paragraphs."
          onChange={handleEditorInput}
          onKeyDown={handleEditorKeyDown}
          onScroll={closeSlash}
          onClick={rememberSelection}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
        />
        {slash && slashCommands.length > 0 ? (
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Insert a block"
            className="absolute z-20 w-72 max-w-[calc(100%-1rem)] overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-popover p-1 shadow-lg shadow-black/25"
            style={anchor ? { left: Math.max(0, anchor.left - 4), top: anchor.top + 4 } : { left: 4, top: 4 }}
          >
            <div className="max-h-64 overflow-y-auto">
              {slashCommands.map((cmd, i) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={i === slash.index}
                  className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left outline-none ${
                    i === slash.index ? 'bg-accent' : ''
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    runSlashCommand(cmd)
                  }}
                  onMouseEnter={() => setSlash((current) => (current ? { ...current, index: i } : current))}
                >
                  <span className="shrink-0 font-sans text-sm font-medium text-foreground">{cmd.title}</span>
                  <span className="min-w-0 truncate font-sans text-xs text-muted-foreground">{cmd.description}</span>
                </button>
              ))}
            </div>
            <p className="border-t border-[color:var(--hairline)] px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              ↑↓ choose · ↵ insert · esc close
            </p>
          </div>
        ) : null}
      </div>
      <FieldDescription className="font-mono text-[11px] text-muted-foreground">
        Markdown for links, lists, tables, code, and quotes — or type <code>/</code> on a new line for a block. The page next door shows the result.
      </FieldDescription>
    </div>
  )
}

function countWords(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function slugifyPostTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

type PostSlugFromTitleProps = {
  enabled?: boolean
}

export function PostSlugFromTitle({ enabled = true }: PostSlugFromTitleProps) {
  const lastAutoSlugRef = useRef('')

  useEffect(() => {
    if (!enabled) return

    const titleInput = document.getElementById('post-title')
    const slugInput = document.getElementById('post-slug')
    if (!(titleInput instanceof HTMLInputElement) || !(slugInput instanceof HTMLInputElement)) return

    const syncSlug = () => {
      const nextSlug = slugifyPostTitle(titleInput.value)
      const currentSlug = slugInput.value
      if (currentSlug !== '' && currentSlug !== lastAutoSlugRef.current) return
      lastAutoSlugRef.current = nextSlug
      if (slugInput.value !== nextSlug) slugInput.value = nextSlug
    }

    const handleSlugInput = () => {
      const currentSlug = slugInput.value
      if (currentSlug === '' || currentSlug === lastAutoSlugRef.current) return
      lastAutoSlugRef.current = ''
    }

    titleInput.addEventListener('input', syncSlug)
    slugInput.addEventListener('input', handleSlugInput)
    return () => {
      titleInput.removeEventListener('input', syncSlug)
      slugInput.removeEventListener('input', handleSlugInput)
    }
  }, [enabled])

  return null
}

// Guards against losing unsaved edits via full-page unload or in-app link
// navigation. Saving (form submit) and the in-editor Publish/Archive actions are
// NOT blocked here - the editor persists the form before those (see
// PostEditorPage), so this only protects against leaving the page entirely.
export function UnsavedChangesGuard({
  message = 'You have unsaved changes.',
  resetKey,
}: {
  message?: string
  // Change this (e.g. pass the loaded post) after a successful save so the guard
  // re-captures its baseline and clears the in-flight `submitting` flag.
  resetKey?: unknown
}) {
  const markerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const form = markerRef.current?.closest('form')
    if (!(form instanceof HTMLFormElement)) return

    // Baseline is recaptured whenever resetKey changes (the editor passes the
    // loaded post, so a successful save rebaselines and isDirty() goes false).
    // The editor saves via SPA mutation (no real page unload), so a dirty form
    // here always means genuinely-unsaved edits worth warning about - including
    // after a FAILED save, where the post (and resetKey) never changed.
    const initialValue = serializeForm(form)
    const isDirty = () => serializeForm(form) !== initialValue

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>('a[href]')
      if (!link || link.target || link.hasAttribute('download')) return
      const href = link.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      if (!isDirty() || window.confirm(message)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [message, resetKey])

  return <span ref={markerRef} className="hidden" aria-hidden="true" />
}

export function serializeForm(form: HTMLFormElement) {
  return Array.from(new FormData(form).entries())
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : value.name}`)
    .sort()
    .join('\n')
}

function escapeMarkdownAlt(altText: string) {
  return altText.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}
