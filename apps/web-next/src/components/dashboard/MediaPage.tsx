'use client'

import { MEDIA } from '@vc/config'
import type { Asset } from '@vc/core'
import { UploadIcon } from '@radix-ui/react-icons'
import { Field, FieldDescription, FieldLabel, Input } from '@vc/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { loadMediaPage } from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

export function MediaPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadPending, setUploadPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadMediaPage()
      .then((data) => {
        if (!cancelled) setAssets(data.assets)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load media.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setUploadPending(true)
    try {
      const response = await fetch('/api/media/upload', { method: 'POST', body: form, credentials: 'include' })
      const result = (await response.json()) as { kind: 'ok' | 'error'; code: string }
      if (response.status === 401) {
        await navigate({ to: '/login' })
        return
      }
      if (result.kind === 'ok') {
        const data = await loadMediaPage()
        setAssets(data.assets)
        await navigate({ to: '/app/media', search: dashboardStatusSearch({ ok: result.code }) })
      } else {
        await navigate({ to: '/app/media', search: dashboardStatusSearch({ error: result.code }) })
      }
    } catch {
      await navigate({ to: '/app/media', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setUploadPending(false)
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!assets) return <p className="font-mono text-sm text-muted-foreground">Loading media…</p>

  return (
    <>
      <PageHeader
        kicker="Media"
        title="Images"
        description={`Upload only blog media: ${MEDIA.formatsLabel}. Native video and generic file hosting stay blocked.`}
      />
      <StatusAlert status={formStatus} />
      <Panel title="Upload Image" meta={`${MEDIA.formatsLabel} · ${MEDIA.maxImageLabel} max`}>
        <form className="grid gap-4 md:grid-cols-[1fr_18rem] md:items-end" onSubmit={(e) => void handleUpload(e)}>
          <Field className="relative min-h-44 place-items-center overflow-hidden rounded-2xl border border-dashed border-border p-6 text-center ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] focus-within:border-brand-bright/50 focus-within:ring-2 focus-within:ring-brand-bright/25">
            <UploadIcon aria-hidden className="mb-3 size-8 text-brand-bright/80" />
            <FieldLabel htmlFor="media-file" className="font-display text-sm font-medium text-foreground">
              Drop in a blog image
            </FieldLabel>
            <FieldDescription id="media-file-help" className="max-w-sm">
              Upload cover art or inline post images. Video and arbitrary files are intentionally blocked.
            </FieldDescription>
            <Input
              id="media-file"
              className="mt-3 max-w-sm bg-background"
              type="file"
              name="file"
              accept={MEDIA.mimeTypes.join(',')}
              required
              aria-describedby="media-file-help"
            />
          </Field>
          <div className="grid gap-3">
            <Field>
              <FieldLabel htmlFor="media-alt">Alt Text</FieldLabel>
              <Input id="media-alt" name="altText" maxLength={180} placeholder="Describe the image for readers" />
            </Field>
            <PendingSubmitButton pendingText="Uploading…" disabled={uploadPending}>
              Upload image
            </PendingSubmitButton>
          </div>
        </form>
      </Panel>
      <Panel title="Library" meta={`${assets.length} assets`}>
        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <article
                className="grid min-w-0 gap-3 overflow-hidden rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
                key={asset.id}
              >
                <img
                  className="aspect-[4/3] w-full rounded-xl bg-muted object-cover ring-1 ring-[color:var(--hairline)]"
                  width={640}
                  height={480}
                  src={`/media-assets/${asset.id}`}
                  alt={asset.altText ?? asset.filename}
                  loading="lazy"
                />
                <div className="min-w-0">
                  <strong className="block truncate font-mono text-sm text-foreground">{asset.filename}</strong>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-brand-bright">
                    {formatBytes(asset.sizeBytes)}
                  </p>
                  <p className="mt-1 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">
                    {asset.altText || 'No alt text'}
                  </p>
                </div>
                <code className="block truncate rounded-lg bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground ring-1 ring-[color:var(--hairline)]">
                  /media-assets/{asset.id}
                </code>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No media yet"
            description="Upload a cover image or inline post image to start building your blog library."
          />
        )}
      </Panel>
    </>
  )
}