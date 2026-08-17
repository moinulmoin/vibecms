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
 * formKey or assets change (version restore / cover upload complete), so the
 * preview is never stale and needs no manual refresh.
 */
export function usePostPreviewSync(initialSource: string, formKey: unknown, assets: MarkdownAsset[]) {
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
  }, [formKey, assets])
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

      <Textarea
        ref={textareaRef}
        id="post-markdown"
        name="contentMarkdown"
        className="min-h-[22rem] font-mono text-sm leading-6 sm:min-h-[32rem]"
        maxLength={500000}
        defaultValue={defaultValue}
        placeholder="Start writing… # for a heading, a blank line between paragraphs."
        onChange={(event) => {
          rememberSelection()
          setWordCount(countWords(event.currentTarget.value))
        }}
        onClick={rememberSelection}
        onKeyUp={rememberSelection}
        onSelect={rememberSelection}
      />
      <FieldDescription className="font-mono text-[11px] text-muted-foreground">
        Markdown for links, lists, tables, code, quotes, and images — the page next door shows the result.
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
