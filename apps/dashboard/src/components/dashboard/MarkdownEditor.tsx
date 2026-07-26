'use client'

import { renderRichContent, RichContentFrame } from '@vc/content'
import { PresentedPostArticle } from '@vc/content/presented-post'
import { MEDIA, resolvePresentation, type Presentation } from '@vc/config'
import { Button, Field, FieldDescription, FieldLabel, Input, Textarea } from '@vc/ui'
import { EyeOpenIcon, ImageIcon, Pencil2Icon, UploadIcon } from '@radix-ui/react-icons'
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
type MarkdownEditorProps = {
  assets: MarkdownAsset[]
  defaultValue: string
  presetId?: string
  presentation?: { layout?: string; toc?: boolean }
}

type EditorMode = 'write' | 'preview'

type PreviewMetadata = {
  title?: string
  excerpt?: string
  coverAssetSrc?: string
}

export function isPreviewCurrent(
  draftRevision: number,
  previewDraftRevision: number,
  metadataRevision: number,
  previewMetadataRevision: number,
) {
  return draftRevision === previewDraftRevision && metadataRevision === previewMetadataRevision
}

export function MarkdownEditor({ assets, defaultValue, presetId, presentation }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: defaultValue.length, end: defaultValue.length })
  const contentRevisionRef = useRef(0)
  const metadataRevisionRef = useRef(0)
  const [mode, setMode] = useState<EditorMode>('write')
  const [previewSource, setPreviewSource] = useState(defaultValue)
  const [previewMetadata, setPreviewMetadata] = useState<PreviewMetadata>({})
  const [draftRevision, setDraftRevision] = useState(0)
  const [previewDraftRevision, setPreviewDraftRevision] = useState(0)
  const [metadataRevision, setMetadataRevision] = useState(0)
  const [previewMetadataRevision, setPreviewMetadataRevision] = useState(0)
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? '')
  const [availableAssets, setAvailableAssets] = useState(assets)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [imageAltText, setImageAltText] = useState(assets[0]?.altText ?? '')
  const [imageUploadPending, setImageUploadPending] = useState(false)
  const [imagePickerError, setImagePickerError] = useState<string | null>(null)

  const previewResult = useMemo(() => renderRichContent(previewSource, { pageTitle: previewMetadata.title }), [previewSource, previewMetadata.title])
  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? availableAssets[0]
  const previewIsCurrent = isPreviewCurrent(
    draftRevision,
    previewDraftRevision,
    metadataRevision,
    previewMetadataRevision,
  )

  useEffect(() => {
    setAvailableAssets(assets)
    setSelectedAssetId((current) => {
      if (assets.some((asset) => asset.id === current)) return current
      setImageAltText(assets[0]?.altText ?? '')
      return assets[0]?.id ?? ''
    })
  }, [assets])
  useEffect(() => {
    const metadataFields = ['post-title', 'post-excerpt', 'post-cover']
      .map((id) => document.getElementById(id))
      .filter((field): field is HTMLElement => field instanceof HTMLElement)
    const markMetadataChanged = () => {
      metadataRevisionRef.current += 1
      setMetadataRevision(metadataRevisionRef.current)
    }
    metadataFields.forEach((field) => {
      field.addEventListener('input', markMetadataChanged)
      field.addEventListener('change', markMetadataChanged)
    })
    return () => {
      metadataFields.forEach((field) => {
        field.removeEventListener('input', markMetadataChanged)
        field.removeEventListener('change', markMetadataChanged)
      })
    }
  }, [])

  function updateContentRevision() {
    contentRevisionRef.current += 1
    setDraftRevision(contentRevisionRef.current)
  }

  function readPreviewMetadata(): PreviewMetadata {
    const title = document.getElementById('post-title')
    const excerpt = document.getElementById('post-excerpt')
    const cover = document.getElementById('post-cover')
    const coverAssetId = cover instanceof HTMLSelectElement ? cover.value : ''
    return {
      title: title instanceof HTMLInputElement ? title.value.trim() || undefined : undefined,
      excerpt: excerpt instanceof HTMLTextAreaElement ? excerpt.value.trim() || undefined : undefined,
      coverAssetSrc: coverAssetId ? `/media-assets/${coverAssetId}` : undefined,
    }
  }

  function refreshPreview() {
    setPreviewSource(textareaRef.current?.value ?? '')
    setPreviewMetadata(readPreviewMetadata())
    setPreviewDraftRevision(contentRevisionRef.current)
    setPreviewMetadataRevision(metadataRevisionRef.current)
  }

  function showWrite() {
    setMode('write')
  }

  function showPreview() {
    refreshPreview()
    setMode('preview')
  }

  function rememberSelection() {
    const textarea = textareaRef.current
    if (!textarea) return
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  function handleContentChange() {
    rememberSelection()
    updateContentRevision()
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
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
    selectionRef.current = { start: nextCaret, end: nextCaret }
    if (mode === 'preview') {
      setPreviewSource(nextValue)
      setPreviewDraftRevision(contentRevisionRef.current)
    }
    setImagePickerOpen(false)
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex w-full rounded-lg bg-background/70 p-1 sm:w-auto"
          role="group"
          aria-label="Editor mode"
        >
          <Button
            type="button"
            variant={mode === 'write' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 flex-1 gap-1.5 rounded-lg font-mono text-[11px] sm:flex-none"
            aria-pressed={mode === 'write'}
            onClick={showWrite}
          >
            <Pencil2Icon className="size-4" aria-hidden="true" />
            Write
          </Button>
          <Button
            type="button"
            variant={mode === 'preview' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 flex-1 gap-1.5 rounded-lg font-mono text-[11px] sm:flex-none"
            aria-pressed={mode === 'preview'}
            onClick={showPreview}
          >
            <EyeOpenIcon className="size-4" aria-hidden="true" />
            Preview
          </Button>
        </div>
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

      <FieldDescription className="font-mono text-[11px] text-muted-foreground">
        Start with a heading, then use Markdown for links, lists, tables, code, quotes, and images.
      </FieldDescription>

      <div className={mode === 'write' ? 'block' : 'hidden'}>
        <Textarea
          ref={textareaRef}
          id="post-markdown"
          name="contentMarkdown"
          className="min-h-[22rem] font-mono text-sm leading-6 sm:min-h-[32rem]"
          maxLength={500000}
          defaultValue={defaultValue}
          onChange={handleContentChange}
          onClick={rememberSelection}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
        />
      </div>

      {mode === 'preview' ? (
        <div
          className="min-h-[22rem] overflow-x-auto rounded-xl bg-muted/50 p-4 sm:min-h-[32rem] sm:p-5"
          aria-label="Markdown preview"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline)] pb-3">
            <p className="font-mono text-[11px] text-muted-foreground" aria-live="polite">
              {previewIsCurrent ? 'Preview is current' : 'Preview is stale after recent edits'}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={refreshPreview}>
              Refresh preview
            </Button>
          </div>
          {previewSource.trim() ? (
            presetId ? (
              <PresentedPostArticle
                renderResult={previewResult}
                presetId={presetId}
                presentation={resolvePresentation(presetId, presentation as Presentation | null | undefined).resolved}
                title={previewMetadata.title}
                excerpt={previewMetadata.excerpt}
                coverAssetSrc={previewMetadata.coverAssetSrc}
              />
            ) : (
              <RichContentFrame node={previewResult.node} />
            )
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              Nothing to preview yet. Add a heading or a first paragraph, then refresh this preview.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
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