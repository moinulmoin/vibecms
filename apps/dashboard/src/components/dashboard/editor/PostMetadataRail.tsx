'use client'

import type { Asset } from '@vc/core'
import { Field, FieldDescription, FieldLabel, Input, Select, Textarea } from '@vc/ui'
import { useRef, useState } from 'react'
import { Switch } from '~/components/ui/switch'

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
  onChange: (field: keyof EditorMetadata, value: string | boolean) => void
  onUploadCover?: (file: File, altText: string) => Promise<Asset | undefined>
}

export function PostMetadataRail({
  metadata,
  assets,
  publicBaseUrl,
  supportedLayouts,
  supportsToc,
  onChange,
  onUploadCover,
}: PostMetadataRailProps) {
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [coverAlt, setCoverAlt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const selectedCover = assets.find((asset) => asset.id === metadata.coverAssetId)
  const canonicalPreview = publicBaseUrl && metadata.slug ? `${publicBaseUrl}/${metadata.slug}` : 'Set after first save'

  async function uploadCover() {
    const file = coverInputRef.current?.files?.[0]
    if (!file || !onUploadCover) return
    setUploading(true)
    setUploadError(null)
    try {
      const asset = await onUploadCover(file, coverAlt)
      if (asset) {
        onChange('coverAssetId', asset.id)
        setCoverAlt('')
        if (coverInputRef.current) coverInputRef.current.value = ''
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed. Try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <aside aria-label="Post settings" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Post details</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Shape the public URL and the way this post appears in lists.</p>
        </div>
        <Field>
          <FieldLabel htmlFor="post-slug" className="font-mono text-[11px] font-medium text-muted-foreground">Slug</FieldLabel>
          <Input
            id="post-slug"
            name="slug"
            value={metadata.slug}
            required
            maxLength={120}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            className="font-mono text-sm"
            placeholder="auto-generated-from-title"
            onChange={(event) => onChange('slug', event.currentTarget.value)}
          />
          <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="post-tags" className="font-mono text-[11px] font-medium text-muted-foreground">Tags</FieldLabel>
          <Input id="post-tags" name="tags" value={metadata.tags} placeholder="launch, notes" onChange={(event) => onChange('tags', event.currentTarget.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="post-excerpt" className="font-mono text-[11px] font-medium text-muted-foreground">Excerpt</FieldLabel>
          <Textarea id="post-excerpt" name="excerpt" value={metadata.excerpt} maxLength={500} rows={3} placeholder="First paragraph if left empty" onChange={(event) => onChange('excerpt', event.currentTarget.value)} />
          <p className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{metadata.excerpt.length}/500</p>
        </Field>
      </section>

      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-t border-[color:var(--hairline)] pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Presentation</p>
        <Field>
          <FieldLabel htmlFor="post-cover" className="font-mono text-[11px] font-medium text-muted-foreground">Featured image</FieldLabel>
          <Select id="post-cover" name="coverAssetId" value={metadata.coverAssetId} onChange={(event) => onChange('coverAssetId', event.currentTarget.value)}>
            <option value="">No featured image</option>
            {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
          </Select>
          {selectedCover ? (
            <div className="flex min-w-0 items-center gap-3 pt-1">
              <img src={`/media-assets/${selectedCover.id}`} alt={selectedCover.altText ?? ''} className="h-14 w-20 rounded-md object-cover" />
              <p className="truncate text-xs text-muted-foreground">{selectedCover.filename}</p>
            </div>
          ) : null}
        </Field>
        {onUploadCover ? (
          <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
            <p className="font-mono text-[11px] font-medium text-foreground">Upload new</p>
            <Input ref={coverInputRef} type="file" accept="image/*" aria-label="Cover image file" />
            <Input value={coverAlt} maxLength={180} placeholder="Alt text" aria-label="Cover image alt text" onChange={(event) => setCoverAlt(event.currentTarget.value)} />
            {uploadError ? <p className="text-xs text-destructive" role="alert">{uploadError}</p> : null}
            <button type="button" className="w-fit rounded-md border border-border px-2.5 py-1.5 font-mono text-xs text-foreground hover:bg-accent disabled:opacity-50" disabled={uploading} onClick={() => void uploadCover()}>
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
          </div>
        ) : null}
        <Field>
          <FieldLabel htmlFor="post-layout" className="font-mono text-[11px] font-medium text-muted-foreground">Article layout</FieldLabel>
          <Select id="post-layout" name="layout" value={metadata.layout} onChange={(event) => onChange('layout', event.currentTarget.value)}>
            {supportedLayouts.map((layout) => <option key={layout} value={layout}>{layout.charAt(0).toUpperCase() + layout.slice(1)}</option>)}
          </Select>
        </Field>
        {supportsToc ? (
          <div className="flex items-center gap-3">
            <Switch id="post-toc" checked={metadata.toc} onCheckedChange={(checked) => onChange('toc', checked)} />
            <FieldLabel htmlFor="post-toc" className="font-mono text-[11px] font-medium text-muted-foreground">Table of contents</FieldLabel>
          </div>
        ) : null}
      </section>

      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-t border-[color:var(--hairline)] pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Search &amp; sharing</p>
        <Field>
          <FieldLabel htmlFor="post-seo-title" className="font-mono text-[11px] font-medium text-muted-foreground">SEO title</FieldLabel>
          <Input id="post-seo-title" name="seoTitle" value={metadata.seoTitle} maxLength={70} placeholder={metadata.title || 'Same as post title'} onChange={(event) => onChange('seoTitle', event.currentTarget.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="post-seo-description" className="font-mono text-[11px] font-medium text-muted-foreground">SEO description</FieldLabel>
          <Textarea id="post-seo-description" name="seoDescription" value={metadata.seoDescription} maxLength={160} rows={3} placeholder="A concise description for search results" onChange={(event) => onChange('seoDescription', event.currentTarget.value)} />
          <p className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{metadata.seoDescription.length}/160</p>
        </Field>
        <Field>
          <FieldLabel htmlFor="post-canonical-url" className="font-mono text-[11px] font-medium text-muted-foreground">Canonical URL</FieldLabel>
          <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{canonicalPreview}</p>
          <Input id="post-canonical-url" name="canonicalUrl" value={metadata.canonicalUrl} maxLength={2048} placeholder="Override canonical URL" onChange={(event) => onChange('canonicalUrl', event.currentTarget.value)} />
        </Field>
      </section>
    </aside>
  )
}
