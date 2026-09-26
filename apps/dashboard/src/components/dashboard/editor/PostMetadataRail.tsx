import type { Asset } from '@vc/core'
import { Field, FieldLabel, Input, Select, Textarea } from '@vc/ui'
import { useQuery } from '@tanstack/react-query'
import { ImageOff, ImagePlus, X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Switch } from '~/components/ui/switch'
import { loadPostsPage } from '~/lib/api-client'
import { queryKeys } from '~/lib/queries'
import { altFromFileName } from './image-alt'
import { firstParagraph, parseTags } from './post-fields'

export { firstParagraph, parseTags }

export type EditorMetadata = {
  title: string
  slug: string
  tags: string
  excerpt: string
  coverAssetId: string
  layout: string
  toc: boolean
  seoTitle: string
  seoDescription: string
  canonicalUrl: string
}

export type PostMetadataRailProps = {
  metadata: EditorMetadata
  assets: Asset[]
  publicBaseUrl?: string | null
  supportedLayouts: readonly string[]
  supportsToc: boolean
  /** Body Markdown, used for the excerpt and description fallbacks. */
  contentMarkdown?: string
  onChange: (field: keyof EditorMetadata, value: string | boolean) => void
  onUploadCover?: (file: File, altText: string) => Promise<Asset | undefined>
}

const MAX_TAGS = 20
const COVER_PREVIEW_COUNT = 8

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-sm font-medium text-foreground">{children}</h3>
}

const labelClass = 'text-sm font-normal text-muted-foreground'

function TagInput({ value, suggestions, onChange }: { value: string; suggestions: string[]; onChange: (value: string) => void }) {
  const tags = parseTags(value)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  // -1 = nothing highlighted: Enter/comma keep exactly what was typed until
  // the writer arrows into the suggestions (so "go" never becomes "django").
  const [active, setActive] = useState(-1)
  const inputId = useId()
  const listId = useId()
  const lower = new Set(tags.map((tag) => tag.toLowerCase()))
  const query = draft.trim().toLowerCase()
  const matches = suggestions
    .filter((tag) => !lower.has(tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)))
    .slice(0, 6)
  const open = focused && matches.length > 0 && (query.length > 0 || tags.length === 0)

  function commit(next: string[]) {
    onChange(next.slice(0, MAX_TAGS).join(', '))
  }
  function add(tag: string) {
    const clean = tag.replace(/,/g, ' ').trim()
    if (!clean || lower.has(clean.toLowerCase())) {
      setDraft('')
      return
    }
    commit([...tags, clean])
    setDraft('')
    setActive(-1)
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && draft.trim())) {
      const picked = open && event.key !== ',' && active >= 0 ? matches[active] : undefined
      if (!picked && !draft.trim() && event.key !== ',') return
      event.preventDefault()
      add(picked ?? draft)
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      commit(tags.slice(0, -1))
    } else if (event.key === 'ArrowDown' && open) {
      event.preventDefault()
      setActive((index) => (index + 1) % matches.length)
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault()
      setActive((index) => (index <= 0 ? matches.length - 1 : index - 1))
    } else if (event.key === 'Escape') {
      setFocused(false)
    }
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
        onClick={() => document.getElementById(inputId)?.focus()}
      >
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-1 text-sm text-foreground">
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(event) => { event.stopPropagation(); commit(tags.filter((item) => item !== tag)) }}
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Add tag"
          placeholder={tags.length ? '' : 'Add a tag'}
          disabled={tags.length >= MAX_TAGS}
          className="min-w-[6rem] flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          onChange={(event) => { setDraft(event.currentTarget.value); setActive(-1) }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (draft.trim()) add(draft) }}
        />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-menu)]">
          {matches.map((tag, index) => (
            <li key={tag} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm ${index === active ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                onMouseDown={(event) => { event.preventDefault(); add(tag) }}
                onMouseEnter={() => setActive(index)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function CoverPicker({
  assets,
  value,
  onChange,
  onUpload,
}: {
  assets: Asset[]
  value: string
  onChange: (value: string) => void
  onUpload?: (file: File, altText: string) => Promise<Asset | undefined>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [showAll, setShowAll] = useState(false)
  const [pending, setPending] = useState<{ file: File; alt: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const images = assets.filter((asset) => asset.mimeType.startsWith('image/'))
  const selected = images.find((asset) => asset.id === value)
  const visible = showAll ? images : images.slice(0, COVER_PREVIEW_COUNT)
  if (selected && !visible.includes(selected)) visible.unshift(selected)

  async function upload() {
    if (!pending || !onUpload) return
    setUploading(true)
    setError(null)
    try {
      const asset = await onUpload(pending.file, pending.alt.trim())
      if (asset) onChange(asset.id)
      setPending(null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed. Try again.')
    } finally {
      setUploading(false)
    }
  }

  const tile = 'relative aspect-[4/3] overflow-hidden rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="Cover image" className="grid grid-cols-3 gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          onClick={() => onChange('')}
          className={`${tile} flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground ${!value ? 'border-foreground' : 'border-border hover:border-ring/50'}`}
        >
          <ImageOff aria-hidden className="size-4" /> None
        </button>
        {visible.map((asset) => (
          <button
            key={asset.id}
            type="button"
            role="radio"
            aria-checked={asset.id === value}
            title={asset.altText || asset.filename}
            onClick={() => onChange(asset.id)}
            className={`${tile} ${asset.id === value ? 'border-foreground ring-2 ring-foreground/20' : 'border-border hover:border-ring/50'}`}
          >
            <img src={`/media-assets/${asset.id}?w=320`} alt={asset.altText || asset.filename} loading="lazy" className="size-full object-cover" />
          </button>
        ))}
        {onUpload ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`${tile} flex flex-col items-center justify-center gap-1 border-dashed border-border text-xs text-muted-foreground hover:border-ring/50 hover:text-foreground`}
          >
            <ImagePlus aria-hidden className="size-4" /> Upload
          </button>
        ) : null}
      </div>
      {images.length > COVER_PREVIEW_COUNT ? (
        <button type="button" className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Show fewer' : `Show all ${images.length} images`}
        </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) setPending({ file, alt: altFromFileName(file.name) })
        }}
      />
      {pending ? (
        <div className="grid gap-2 border-t border-[color:var(--hairline)] pt-3">
          <p className="truncate text-sm text-foreground">{pending.file.name}</p>
          <Input
            autoFocus
            value={pending.alt}
            maxLength={180}
            placeholder="Describe the image for screen readers"
            aria-label="Cover image description"
            onChange={(event) => setPending({ ...pending, alt: event.currentTarget.value })}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void upload() } }}
          />
          <div className="flex gap-2">
            <button type="button" disabled={uploading} onClick={() => void upload()} className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Upload and use'}
            </button>
            <button type="button" disabled={uploading} onClick={() => setPending(null)} className="px-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}

function LinkPreview({ title, description, url, cover }: { title: string; description: string; url: string; cover?: Asset }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {cover ? <img src={`/media-assets/${cover.id}?w=640`} alt="" className="aspect-[1.91/1] w-full object-cover" /> : null}
      <div className="grid gap-0.5 p-3">
        <p className="truncate font-mono text-xs text-muted-foreground">{url}</p>
        <p className="line-clamp-2 text-sm font-medium text-foreground">{title || 'Untitled post'}</p>
        {description ? <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  )
}

function useExistingTags() {
  const query = useQuery({
    queryKey: queryKeys.posts({ tagSource: true }),
    queryFn: ({ signal }) => loadPostsPage({}, signal),
    staleTime: 5 * 60_000,
  })
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const post of query.data?.posts ?? []) for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
  }, [query.data])
}

export function PostMetadataRail({
  metadata,
  assets,
  publicBaseUrl,
  supportedLayouts,
  supportsToc,
  contentMarkdown = '',
  onChange,
  onUploadCover,
}: PostMetadataRailProps) {
  const existingTags = useExistingTags()
  const derivedExcerpt = useMemo(() => firstParagraph(contentMarkdown), [contentMarkdown])
  const cover = assets.find((asset) => asset.id === metadata.coverAssetId)
  const host = publicBaseUrl ? publicBaseUrl.replace(/^https?:\/\//, '') : 'your-blog'
  const url = `${host}/${metadata.slug || 'your-post'}`
  const effectiveDescription = metadata.seoDescription.trim() || metadata.excerpt.trim() || derivedExcerpt

  return (
    <aside aria-label="Post settings" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-7">
      <section className="grid min-w-0 gap-4">
        <SectionTitle>Post</SectionTitle>
        <Field>
          <FieldLabel htmlFor="post-slug" className={labelClass}>URL</FieldLabel>
          <div className="flex min-w-0 items-center rounded-xl border border-border bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <span className="max-w-[45%] shrink truncate pl-3 font-mono text-xs text-muted-foreground" title={publicBaseUrl ?? undefined}>{host}/</span>
            <input
              id="post-slug"
              name="slug"
              value={metadata.slug}
              required
              maxLength={120}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              className="h-9 min-w-0 flex-1 bg-transparent pr-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              placeholder="from-the-title"
              onChange={(event) => onChange('slug', event.currentTarget.value.toLowerCase().replace(/\s+/g, '-'))}
            />
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="post-excerpt" className={labelClass}>Excerpt</FieldLabel>
          <Textarea
            id="post-excerpt"
            name="excerpt"
            value={metadata.excerpt}
            maxLength={500}
            rows={3}
            placeholder={derivedExcerpt || 'Shown in lists. Uses the first paragraph when empty.'}
            onChange={(event) => onChange('excerpt', event.currentTarget.value)}
          />
          {metadata.excerpt.length > 400 ? <p className="text-right font-mono text-xs tabular-nums text-muted-foreground">{metadata.excerpt.length}/500</p> : null}
        </Field>
        <Field>
          <FieldLabel className={labelClass}>Tags</FieldLabel>
          <TagInput value={metadata.tags} suggestions={existingTags} onChange={(value) => onChange('tags', value)} />
        </Field>
      </section>

      <section className="grid min-w-0 gap-4 border-t border-[color:var(--hairline)] pt-6">
        <SectionTitle>Cover</SectionTitle>
        <CoverPicker assets={assets} value={metadata.coverAssetId} onChange={(value) => onChange('coverAssetId', value)} onUpload={onUploadCover} />
      </section>

      <section className="grid min-w-0 gap-4 border-t border-[color:var(--hairline)] pt-6">
        <SectionTitle>Layout</SectionTitle>
        {supportedLayouts.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="post-layout" className="sr-only">Article layout</FieldLabel>
            <Select id="post-layout" name="layout" value={metadata.layout} onChange={(event) => onChange('layout', event.currentTarget.value)}>
              {supportedLayouts.map((layout) => <option key={layout} value={layout}>{layout.charAt(0).toUpperCase() + layout.slice(1)}</option>)}
            </Select>
          </Field>
        ) : null}
        {supportsToc ? (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="post-toc" className="text-sm text-muted-foreground">Table of contents</label>
            <Switch id="post-toc" checked={metadata.toc} onCheckedChange={(checked) => onChange('toc', checked)} />
          </div>
        ) : null}
      </section>

      <section className="grid min-w-0 gap-4 border-t border-[color:var(--hairline)] pt-6">
        <SectionTitle>Search and sharing</SectionTitle>
        <LinkPreview
          title={metadata.seoTitle.trim() || metadata.title}
          description={effectiveDescription}
          url={url}
          cover={cover}
        />
        <Field>
          <FieldLabel htmlFor="post-seo-title" className={labelClass}>Title</FieldLabel>
          <Input id="post-seo-title" name="seoTitle" value={metadata.seoTitle} maxLength={70} placeholder={metadata.title || 'Same as the post title'} onChange={(event) => onChange('seoTitle', event.currentTarget.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="post-seo-description" className={labelClass}>Description</FieldLabel>
          <Textarea
            id="post-seo-description"
            name="seoDescription"
            value={metadata.seoDescription}
            maxLength={180}
            rows={3}
            placeholder={metadata.excerpt.trim() || derivedExcerpt || 'Same as the excerpt'}
            onChange={(event) => onChange('seoDescription', event.currentTarget.value)}
          />
          {metadata.seoDescription.length > 140 ? <p className="text-right font-mono text-xs tabular-nums text-muted-foreground">{metadata.seoDescription.length}/180</p> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="post-canonical-url" className={labelClass}>Canonical URL</FieldLabel>
          <Input
            id="post-canonical-url"
            name="canonicalUrl"
            type="url"
            value={metadata.canonicalUrl}
            maxLength={2048}
            placeholder={publicBaseUrl && metadata.slug ? `${publicBaseUrl}/${metadata.slug}` : 'Only if this was first published elsewhere'}
            onChange={(event) => onChange('canonicalUrl', event.currentTarget.value)}
          />
        </Field>
      </section>
    </aside>
  )
}
