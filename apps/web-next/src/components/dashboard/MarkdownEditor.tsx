'use client'

import { parseMarkdown } from '~/lib/markdown'
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
}

type EditorMode = 'write' | 'preview'

export function MarkdownEditor({ assets, defaultValue }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: defaultValue.length, end: defaultValue.length })
  const [mode, setMode] = useState<EditorMode>('write')
  const [previewSource, setPreviewSource] = useState(defaultValue)
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? '')

  const preview = useMemo(() => parseMarkdown(previewSource), [previewSource])
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
      <div className="flex flex-col gap-3 rounded-2xl p-3 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex w-full rounded-xl bg-muted/60 p-1 ring-1 ring-[color:var(--hairline)] sm:w-auto"
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
            <a className="font-medium text-brand-bright underline underline-offset-4" href="/app/media">
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
          className="min-h-[22rem] font-mono text-sm leading-6 ring-1 ring-[color:var(--hairline)] sm:min-h-[32rem]"
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
          className="min-h-[22rem] overflow-x-auto rounded-2xl p-4 font-sans text-sm leading-7 text-foreground ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] sm:min-h-[32rem] sm:p-5 [&_a]:font-medium [&_a]:text-brand-bright [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold sm:[&_h1]:text-3xl [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold sm:[&_h2]:text-2xl [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold sm:[&_h3]:text-xl [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-6"
          aria-label="Markdown preview"
        >
          {preview.length > 0 ? preview : <p className="font-mono text-xs text-muted-foreground">Nothing to preview yet.</p>}
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

export function UnsavedChangesGuard({ message = 'You have unsaved changes.' }: { message?: string }) {
  const markerRef = useRef<HTMLParagraphElement>(null)
  const [warning, setWarning] = useState(false)

  useEffect(() => {
    const form = markerRef.current?.closest('form')
    if (!(form instanceof HTMLFormElement)) return

    const initialValue = serializeForm(form)
    let submitting = false
    const isDirty = () => serializeForm(form) !== initialValue

    const handleSubmit = (event: SubmitEvent) => {
      if (isDirty()) {
        event.preventDefault()
        setWarning(true)
        return
      }
      setWarning(false)
      submitting = true
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submitting || !isDirty()) return
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

    form.addEventListener('submit', handleSubmit)
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      form.removeEventListener('submit', handleSubmit)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [message])

  return (
    <p
      ref={markerRef}
      role="status"
      aria-live="polite"
      className={
        warning
          ? 'rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 font-sans text-sm text-destructive ring-1 ring-[color:var(--hairline)] lg:col-span-2'
          : 'hidden'
      }
    >
      Save the draft before publishing or archiving unsaved changes.
    </p>
  )
}

function serializeForm(form: HTMLFormElement) {
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