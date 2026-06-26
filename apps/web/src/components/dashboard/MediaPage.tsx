'use client'

import { MEDIA } from '@vc/config'
import type { Asset } from '@vc/core'
import { Pencil1Icon, TrashIcon, UploadIcon } from '@radix-ui/react-icons'
import { Field, FieldDescription, FieldLabel, Input } from '@vc/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { Button, EmptyState, LoadError, PageHeader, Panel } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { Card } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { loadMediaPage, updateMediaAltMutation } from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

function MediaSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="h-48 rounded-2xl" />
      <Card className="gap-0 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid gap-3 rounded-2xl bg-muted/50 p-3">
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

export function MediaPage() {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadPending, setUploadPending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [editingAltId, setEditingAltId] = useState<string | null>(null)
  const [altDraft, setAltDraft] = useState('')
  const [altPending, setAltPending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSaveAlt(assetId: string) {
    setAltPending(true)
    try {
      const result = await updateMediaAltMutation({ data: { assetId, altText: altDraft } })
      if (result.kind === 'ok') {
        const next = altDraft.trim().slice(0, 180) || null
        setAssets((prev) => prev?.map((asset) => (asset.id === assetId ? { ...asset, altText: next } : asset)) ?? null)
        setEditingAltId(null)
      } else {
        await navigate({ to: '/app/media', search: dashboardStatusSearch({ error: result.code }) })
      }
    } finally {
      setAltPending(false)
    }
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragActive(false)
    const files = event.dataTransfer?.files
    if (files?.length && fileInputRef.current) {
      fileInputRef.current.files = files
    }
  }

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

  async function handleDelete(assetId: string) {
    setDeletingId(assetId)
    try {
      const response = await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId }),
        credentials: 'include',
      })
      if (response.status === 401) {
        await navigate({ to: '/login' })
        return
      }
      const result = (await response.json()) as { kind: 'ok' | 'error'; code: string }
      if (result.kind === 'ok') {
        setAssets((prev) => prev?.filter((a) => a.id !== assetId) ?? null)
        await navigate({ to: '/app/media', search: dashboardStatusSearch({ ok: result.code }) })
      } else {
        await navigate({ to: '/app/media', search: dashboardStatusSearch({ error: result.code }) })
      }
    } catch {
      await navigate({ to: '/app/media', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setDeletingId(null)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!assets) return <MediaSkeleton />

  const usedBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0)
  const usagePercent =
    MEDIA.paidStorageBytes > 0 ? Math.min(100, Math.round((usedBytes / MEDIA.paidStorageBytes) * 100)) : 0

  return (
    <>
      <PageHeader
        kicker="Media"
        title="Images"
        description={`Upload only blog media: ${MEDIA.formatsLabel}. Native video and generic file hosting stay blocked.`}
      />

      <Card className="gap-0 p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
          <form
            className="grid gap-4"
            onSubmit={(e) => void handleUpload(e)}
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragActive) setDragActive(true)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragActive(false)
            }}
            onDrop={handleDrop}
          >
            <Field
              className={`relative min-h-44 place-items-center overflow-hidden rounded-2xl border border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? 'border-brand-bright/60 bg-muted'
                  : 'border-[color:var(--hairline)] bg-muted/50 focus-within:bg-muted'
              }`}
            >
              <UploadIcon aria-hidden className="mb-3 size-8 text-primary/80" />
              <FieldLabel htmlFor="media-file" className="font-display text-sm font-medium text-foreground">
                Drag an image here, or browse
              </FieldLabel>
              <FieldDescription id="media-file-help" className="max-w-sm">
                Upload cover art or inline post images. Video and arbitrary files are intentionally blocked.
              </FieldDescription>
              <Input
                ref={fileInputRef}
                id="media-file"
                className="mt-3 max-w-sm bg-background"
                type="file"
                name="file"
                accept={MEDIA.mimeTypes.join(',')}
                required
                aria-describedby="media-file-help"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field>
                <FieldLabel htmlFor="media-alt">Alt Text</FieldLabel>
                <Input id="media-alt" name="altText" maxLength={180} placeholder="Describe the image for readers" />
              </Field>
              <PendingSubmitButton pending={uploadPending} pendingText="Uploading…">
                Upload image
              </PendingSubmitButton>
            </div>
          </form>

          <div className="grid content-start gap-3 rounded-2xl bg-muted/50 p-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Upload limits
            </p>
            <dl className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="font-sans text-muted-foreground">Formats</dt>
                <dd className="font-mono text-xs text-foreground">{MEDIA.formatsLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-sans text-muted-foreground">Max size</dt>
                <dd className="font-mono text-xs text-foreground">{MEDIA.maxImageLabel}</dd>
              </div>
            </dl>
            <div className="mt-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Storage
                </p>
                <p className="font-mono text-xs tabular-nums text-foreground">
                  {formatBytes(usedBytes)} / {MEDIA.paidStorageLabel}
                </p>
              </div>
              <Progress
                value={usagePercent}
                className="h-1.5 [&_[data-slot=progress-indicator]]:bg-brand-bright"
              />
            </div>
          </div>
        </div>
      </Card>

      <Panel title="Library" meta={`${assets.length} assets`}>
        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <article
                className="group grid min-w-0 gap-3 overflow-hidden rounded-2xl bg-muted/50 p-3 transition-colors hover:bg-muted"
                key={asset.id}
              >
                <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted">
                  <img
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    width={640}
                    height={480}
                    src={`/media-assets/${asset.id}`}
                    alt={asset.altText ?? asset.filename}
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0">
                  <strong className="block truncate font-mono text-sm text-foreground">{asset.filename}</strong>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {formatBytes(asset.sizeBytes)}
                  </p>
                  {editingAltId === asset.id ? (
                    <div className="mt-2 grid gap-2">
                      <Input
                        value={altDraft}
                        onChange={(event) => setAltDraft(event.target.value)}
                        maxLength={180}
                        placeholder="Describe the image for readers"
                        aria-label="Alt text"
                        className="h-8 text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={altPending}
                          onClick={() => void handleSaveAlt(asset.id)}
                        >
                          {altPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={altPending}
                          onClick={() => setEditingAltId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAltId(asset.id)
                        setAltDraft(asset.altText ?? '')
                      }}
                      className="mt-1 inline-flex items-center gap-1.5 text-left font-sans text-xs leading-5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      <Pencil1Icon className="size-3 shrink-0" aria-hidden="true" />
                      <span className="line-clamp-2">{asset.altText || 'Add alt text'}</span>
                    </button>
                  )}
                </div>
                <code className="block truncate rounded-lg bg-background/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  /media-assets/{asset.id}
                </code>
                <div className="flex items-center justify-end pt-0.5">
                  <SpaConfirmButton
                    size="sm"
                    variant="ghost"
                    confirmLabel={
                      <span className="flex items-center gap-1.5">
                        <TrashIcon className="size-3.5" aria-hidden />
                        Confirm delete
                      </span>
                    }
                    helperText="Permanently removes the file from storage."
                    disabled={deletingId === asset.id}
                    onConfirm={() => void handleDelete(asset.id)}
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <TrashIcon className="size-3.5" aria-hidden />
                    Delete
                  </SpaConfirmButton>
                </div>
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
