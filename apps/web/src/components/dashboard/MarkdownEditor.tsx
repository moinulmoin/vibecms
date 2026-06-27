'use client'

import { renderRichContent, RichContentFrame } from '~/lib/markdown'
import { PresentedPostArticle } from '~/components/PresentedPostArticle'
import { resolvePresentation, type Presentation } from '@vc/config'
import { Button, FieldDescription, Select, Textarea } from '@vc/ui'
import { EyeOpenIcon, ImageIcon, Pencil2Icon } from '@radix-ui/react-icons'
import { useEffect, useMemo, useRef, useState } from 'react'

type MarkdownAsset = {
  id: string
  filename: string
}
type MarkdownEditorProps = {
  assets: MarkdownAsset[]
  defaultValue: string
  presetId?: string
  presentation?: { layout?: string; toc?: boolean }
}

type EditorMode = 'write' | 'preview'

export function MarkdownEditor({ assets, defaultValue, presetId, presentation }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: defaultValue.length, end: defaultValue.length })
  const [mode, setMode] = useState<EditorMode>('write')
  const [previewSource, setPreviewSource] = useState(defaultValue)
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? '')

  const previewResult = useMemo(() => renderRichContent(previewSource), [previewSource])
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0]

  function showWrite() {
    setMode('write')
  }

  function showPreview() {
    setPreviewSource(textareaRef.current?.value ?? '')
    setMode('preview')
  }

  function rememberSelection() {
    const textarea = textareaRef.current
    if (!textarea) return
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  function insertImage() {
    const textarea = textareaRef.current
    if (!textarea || !selectedAsset) return

    const imageMarkdown = `![${altTextFor(selectedAsset.filename)}](/media-assets/${selectedAsset.id})`
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
    if (mode === 'preview') setPreviewSource(nextValue)
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
            className="h-8 flex-1 gap-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.1em] sm:flex-none"
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
            className="h-8 flex-1 gap-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.1em] sm:flex-none"
            aria-pressed={mode === 'preview'}
            onClick={showPreview}
          >
            <EyeOpenIcon className="size-4" aria-hidden="true" />
            Preview
          </Button>
        </div>
        {assets.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              aria-label="Image to insert"
              className="h-9 min-w-0 font-mono text-xs sm:w-56"
              value={selectedAssetId}
              onChange={(event) => setSelectedAssetId(event.currentTarget.value)}
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 justify-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em]"
              onClick={insertImage}
            >
              <ImageIcon className="size-4" aria-hidden="true" />
              Insert image
            </Button>
          </div>
        ) : (
          <FieldDescription className="font-sans">
            No image assets yet.{' '}
            <a className="font-medium text-primary underline underline-offset-4" href="/app/media">
              Upload images
            </a>{' '}
            to insert them here.
          </FieldDescription>
        )}
      </div>

      <FieldDescription className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        Supports headings, bold, italic, links, lists, code, and quotes.
      </FieldDescription>

      <div className={mode === 'write' ? 'block' : 'hidden'}>
        <Textarea
          ref={textareaRef}
          id="post-markdown"
          name="contentMarkdown"
          className="min-h-[22rem] font-mono text-sm leading-6 sm:min-h-[32rem]"
          maxLength={500000}
          defaultValue={defaultValue}
          onChange={rememberSelection}
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
          {previewSource.trim() ? (
            presetId ? (
              <PresentedPostArticle
                renderResult={previewResult}
                presetId={presetId}
                presentation={resolvePresentation(presetId, presentation as Presentation | null | undefined).resolved}
              />
            ) : (
              <RichContentFrame node={previewResult.node} />
            )
          ) : (
            <p className="font-mono text-xs text-muted-foreground">Nothing to preview yet.</p>
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

function altTextFor(filename: string) {
  return (
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/[\[\]]/g, '')
      .trim() || 'image'
  )
}