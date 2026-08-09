'use client'

import { MEDIA } from '@vc/config'
import type { Asset } from '@vc/core'
import {
  Cross2Icon,
  ImageIcon,
  MagnifyingGlassIcon,
  Pencil1Icon,
  TrashIcon,
  UploadIcon,
} from '@radix-ui/react-icons'
import { Card, CopyButton, Field, FieldDescription, FieldLabel, Input, Select, Skeleton, cn } from '@vc/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { Button, EmptyState, LoadError, PageHeader, Panel } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { Checkbox } from '~/components/ui/checkbox'
import { Progress } from '~/components/ui/progress'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { loadMediaPage, updateMediaAltMutation } from '~/lib/api-client'
import { parseMutationResultJson, type ParsedMutationResult } from '~/lib/mutation-result'
import { dashboardStatusSearch } from '~/lib/dashboard-search'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

export function selectedFileFeedback(files: ArrayLike<{ name: string }> | null) {
  if (!files?.length) return null
  if (files.length === 1) return `Selected: ${files[0]?.name ?? 'image'}`
  return `${files.length} images selected`
}

type MediaFilter = 'all' | 'has-alt' | 'missing-alt'

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

type UploadEntry = {
  key: string
  name: string
  progress: number // 0..1
  status: UploadStatus
}

function uploadFileWithProgress(
  file: File,
  altText: string,
  onProgress: (progress: number) => void,
): Promise<ParsedMutationResult> {
  return new Promise<ParsedMutationResult>((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('altText', altText)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media/upload')
    xhr.withCredentials = true
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new Error('unauthorized'))
        return
      }
      try {
        resolve(parseMutationResultJson(JSON.parse(xhr.responseText)))
      } catch {
        reject(new Error('bad-response'))
      }
    }
    xhr.onerror = () => reject(new Error('network'))
    xhr.send(form)
  })
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
            <div key={i} className="grid gap-3 rounded-xl border border-[color:var(--hairline)] p-3">
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
  const [selectedFileMessage, setSelectedFileMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSaveAlt(assetId: string) {
    setAltPending(true)
    try {
      const result = await updateMediaAltMutation({ assetId, altText: altDraft })
      if (result.kind === 'ok') {
        const next = altDraft.trim().slice(0, 180) || null
        setAssets((prev) => prev?.map((asset) => (asset.id === assetId ? { ...asset, altText: next } : asset)) ?? null)
        setEditingAltId(null)
      } else {
        await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ error: result.code }) })
      }
    } catch {
      await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setAltPending(false)
    }
  }

  function openInspector(assetId: string) {
    setEditingAltId(null)
    setInspectorId(assetId)
  }

  function toggleSelected(assetId: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? (prev.includes(assetId) ? prev : [...prev, assetId]) : prev.filter((id) => id !== assetId)))
  }

  function setQueueItem(key: string, patch: Partial<UploadEntry>) {
    setUploadQueue((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)))
  }

  function updateSelectedFiles(files: ArrayLike<{ name: string }> | null) {
    setSelectedFileMessage(selectedFileFeedback(files))
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragActive(false)
    const files = event.dataTransfer?.files
    if (files?.length && fileInputRef.current) {
      fileInputRef.current.files = files
      updateSelectedFiles(files)
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
    const files = fileInputRef.current?.files ? Array.from(fileInputRef.current.files) : []
    if (!files.length) return
    const altText = new FormData(event.currentTarget).get('altText')?.toString() ?? ''
    setUploadPending(true)
    setUploadQueue(files.map((file, index) => ({ key: String(index), name: file.name, progress: 0, status: 'pending' as const })))

    let lastOkCode: string | undefined
    let errorCode: string | null = null
    for (const [index, file] of files.entries()) {
      const key = String(index)
      setQueueItem(key, { status: 'uploading', progress: 0 })
      try {
        const result = await uploadFileWithProgress(file, altText, (progress) => setQueueItem(key, { progress }))
        if (result.kind === 'ok') {
          setQueueItem(key, { status: 'done', progress: 1 })
          lastOkCode = result.code
        } else {
          setQueueItem(key, { status: 'error' })
          errorCode = result.code
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        if (message === 'unauthorized') {
          setUploadPending(false)
          await navigate({ to: '/login' })
          return
        }
        setQueueItem(key, { status: 'error' })
        errorCode = errorCode ?? 'unknown'
      }
    }

    setUploadPending(false)
    if (lastOkCode) {
      const data = await loadMediaPage()
      setAssets(data.assets)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    setSelectedFileMessage(null)
    if (lastOkCode && !errorCode) {
      await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ ok: lastOkCode }) })
    } else if (errorCode) {
      await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ error: errorCode }) })
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
      const result = parseMutationResultJson(await response.json())
      if (result.kind === 'ok') {
        setAssets((prev) => prev?.filter((a) => a.id !== assetId) ?? null)
        await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ ok: result.code }) })
      } else {
        await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ error: result.code }) })
      }
    } catch {
      await navigate({ to: '/dashboard/media', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setDeletingId(null)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!assets) return <MediaSkeleton />

  const usedBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0)
  const usagePercent =
    MEDIA.paidStorageBytes > 0 ? Math.min(100, Math.round((usedBytes / MEDIA.paidStorageBytes) * 100)) : 0
  const storageNearLimit = usagePercent > 80

  const trimmedQuery = searchQuery.trim().toLowerCase()
  const filteredAssets = assets.filter((asset) => {
    if (trimmedQuery && !asset.filename.toLowerCase().includes(trimmedQuery)) return false
    if (filter === 'has-alt' && !asset.altText) return false
    if (filter === 'missing-alt' && asset.altText) return false
    return true
  })

  const inspectorAsset = assets.find((asset) => asset.id === inspectorId) ?? null

  return (
    <>
      <PageHeader
        title="Media library"
        description={`Images only—${MEDIA.formatsLabel}. Use them for covers and inline media; video and generic files stay blocked.`}
        action={
          <div className="grid w-full min-w-60 gap-2 rounded-2xl border border-[color:var(--hairline)] bg-muted/40 p-4 sm:w-72">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Storage
              </p>
              <p
                className={cn(
                  'font-mono text-xs tabular-nums',
                  storageNearLimit ? 'text-amber-400' : 'text-foreground',
                )}
              >
                {formatBytes(usedBytes)} / {MEDIA.paidStorageLabel} · {usagePercent}%
              </p>
            </div>
            <Progress
              value={usagePercent}
              className={cn(
                'h-1.5 [&_[data-slot=progress-indicator]]:bg-brand-bright',
                storageNearLimit && '[&_[data-slot=progress-indicator]]:bg-amber-400',
              )}
            />
            {storageNearLimit ? (
              <p className="font-mono text-[11px] leading-4 text-amber-400/80">
                Almost full — delete unused images to make room.
              </p>
            ) : null}
          </div>
        }
      />

      <Card className="gap-0 p-5 sm:p-6">
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
              <FieldLabel htmlFor="media-file" className="font-display text-base font-medium text-foreground">
                Drag images here, or browse
              </FieldLabel>
              <FieldDescription id="media-file-help" className="max-w-sm">
                Upload cover art or inline post images. Video, arbitrary files, and the unsupported formats stay blocked.
              </FieldDescription>
              {selectedFileMessage ? (
                <p className="mt-2 font-mono text-xs text-primary" role="status">
                  {selectedFileMessage}
                </p>
              ) : null}
              <Input
                ref={fileInputRef}
                id="media-file"
                className="mt-3 max-w-sm bg-background"
                type="file"
                name="file"
                accept={MEDIA.mimeTypes.join(',')}
                multiple
                required
                aria-describedby="media-file-help"
                onChange={(event) => updateSelectedFiles(event.currentTarget.files)}
              />
            </Field>
            {uploadQueue.length ? (
              <ul className="grid gap-2" aria-label="Upload progress">
                {uploadQueue.map((entry) => (
                  <li
                    key={entry.key}
                    className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-[color:var(--hairline)] bg-muted/40 px-3 py-2"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-foreground">{entry.name}</span>
                    <span
                      className={cn(
                        'font-mono text-[11px] tabular-nums',
                        entry.status === 'error'
                          ? 'text-destructive'
                          : entry.status === 'done'
                            ? 'text-primary'
                            : 'text-muted-foreground',
                      )}
                    >
                      {entry.status === 'error'
                        ? 'Failed'
                        : entry.status === 'done'
                          ? 'Uploaded'
                          : entry.status === 'pending'
                            ? 'Queued'
                            : `${Math.round(entry.progress * 100)}%`}
                    </span>
                    {entry.status === 'uploading' ? (
                      <Progress
                        value={Math.round(entry.progress * 100)}
                        className="col-span-2 mt-1 h-1 [&_[data-slot=progress-indicator]]:bg-brand-bright"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field>
                <FieldLabel htmlFor="media-alt">Alt Text</FieldLabel>
                <Input id="media-alt" name="altText" maxLength={180} placeholder="Describe the image for readers" />
              </Field>
              <PendingSubmitButton pending={uploadPending} pendingText="Uploading…">
                Upload {uploadQueue.length > 1 ? `${uploadQueue.length} images` : 'image'}
              </PendingSubmitButton>
            </div>
          </form>

          <div className="grid content-start gap-3 rounded-xl border border-[color:var(--hairline)] bg-card p-4">
            <p className="font-mono text-[11px] font-medium text-muted-foreground">Upload limits</p>
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
          </div>
        </div>
      </Card>

      <Panel
        title="Library"
        meta={[
          `${filteredAssets.length} ${filteredAssets.length === 1 ? 'asset' : 'assets'}`,
          selectedIds.length ? `${selectedIds.length} selected` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by filename"
              aria-label="Search media by filename"
              className="pl-9 pr-9"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Cross2Icon className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as MediaFilter)}
            aria-label="Filter media"
            className="sm:w-48"
          >
            <option value="all">All images</option>
            <option value="has-alt">Has alt text</option>
            <option value="missing-alt">Missing alt text</option>
          </Select>
        </div>

        {assets.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="No media yet"
            description="Upload a cover image or inline post image to start building your blog library."
            action={
              <Button
                type="button"
                onClick={() => {
                  fileInputRef.current?.focus()
                  fileInputRef.current?.click()
                }}
              >
                Upload image
              </Button>
            }
          />
        ) : filteredAssets.length === 0 ? (
          <EmptyState
            icon={<MagnifyingGlassIcon />}
            title="No matching images"
            description="Try a different filename or clear the filter."
            action={
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchQuery('')
                  setFilter('all')
                }}
              >
                Clear search & filters
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAssets.map((asset) => {
              const isSelected = selectedIds.includes(asset.id)
              return (
                <article
                  key={asset.id}
                  className={cn(
                    'group grid min-w-0 gap-3 overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-card p-3 transition-colors hover:border-border',
                    isSelected && 'ring-2 ring-brand-bright ring-offset-2 ring-offset-background',
                  )}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted">
                    <button
                      type="button"
                      onClick={() => openInspector(asset.id)}
                      aria-label={`View details for ${asset.filename}`}
                      className="absolute inset-0 w-full rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <img
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        width={640}
                        height={480}
                        src={`/media-assets/${asset.id}`}
                        alt={asset.altText ?? asset.filename}
                        loading="lazy"
                      />
                    </button>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleSelected(asset.id, checked === true)}
                      aria-label={`Select ${asset.filename}`}
                      className={cn(
                        'absolute right-2 top-2 z-10 size-4 bg-background/90 focus-visible:ring-offset-1',
                        isSelected ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
                      )}
                    />
                  </div>
                  <div className="min-w-0">
                    <button type="button" onClick={() => openInspector(asset.id)} className="block w-full min-w-0 text-left">
                      <strong className="block truncate font-mono text-sm text-foreground">{asset.filename}</strong>
                    </button>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {formatBytes(asset.sizeBytes)}
                      {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                    </p>
                  </div>
                  <code className="block truncate rounded-lg bg-background/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    /media-assets/{asset.id}
                  </code>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span
                      className={cn(
                        'inline-flex items-center font-mono text-[11px]',
                        asset.altText ? 'text-muted-foreground' : 'text-amber-500/80',
                      )}
                    >
                      {asset.altText ? 'Alt: set' : 'Alt: missing'}
                    </span>
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
              )
            })}
          </div>
        )}
      </Panel>

      <Sheet
        open={inspectorId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInspectorId(null)
            setEditingAltId(null)
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-4 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="truncate font-mono">{inspectorAsset?.filename ?? 'Image'}</SheetTitle>
            <SheetDescription>Media asset details</SheetDescription>
          </SheetHeader>
          {inspectorAsset ? (
            <>
              <div className="overflow-hidden rounded-2xl bg-muted">
                <img
                  className="size-full object-contain"
                  src={`/media-assets/${inspectorAsset.id}`}
                  alt={inspectorAsset.altText ?? inspectorAsset.filename}
                />
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-sans text-muted-foreground">Dimensions</dt>
                  <dd className="font-mono text-xs text-foreground">
                    {inspectorAsset.width && inspectorAsset.height
                      ? `${inspectorAsset.width} × ${inspectorAsset.height}`
                      : 'Unknown'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-sans text-muted-foreground">File size</dt>
                  <dd className="font-mono text-xs text-foreground">{formatBytes(inspectorAsset.sizeBytes)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-sans text-muted-foreground">Type</dt>
                  <dd className="font-mono text-xs text-foreground">{inspectorAsset.mimeType}</dd>
                </div>
              </dl>

              <Field>
                <div className="flex items-center gap-3">
                  <FieldLabel htmlFor="inspector-asset-url">URL</FieldLabel>
                  <CopyButton value={`/media-assets/${inspectorAsset.id}`} iconOnly className="h-7 w-7" />
                </div>
                <code
                  id="inspector-asset-url"
                  className="mt-1.5 block truncate rounded-lg bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground"
                >
                  /media-assets/{inspectorAsset.id}
                </code>
              </Field>

              {editingAltId === inspectorAsset.id ? (
                <Field>
                  <FieldLabel htmlFor={`inspector-alt-${inspectorAsset.id}`}>Alt Text</FieldLabel>
                  <Input
                    id={`inspector-alt-${inspectorAsset.id}`}
                    value={altDraft}
                    onChange={(event) => setAltDraft(event.target.value)}
                    maxLength={180}
                    placeholder="Describe the image for readers"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={altPending}
                      onClick={() => void handleSaveAlt(inspectorAsset.id)}
                    >
                      {altPending ? 'Saving…' : 'Save'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingAltId(null)}>
                      Cancel
                    </Button>
                  </div>
                </Field>
              ) : (
                <Field>
                  <FieldLabel>Alt Text</FieldLabel>
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 font-sans text-sm leading-6 text-foreground">
                      {inspectorAsset.altText || (
                        <span className="text-muted-foreground">No alt text yet</span>
                      )}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingAltId(inspectorAsset.id)
                        setAltDraft(inspectorAsset.altText ?? '')
                      }}
                    >
                      <Pencil1Icon className="size-3.5" aria-hidden />
                      Edit
                    </Button>
                  </div>
                </Field>
              )}

              <SheetFooter className="mt-auto">
                <SpaConfirmButton
                  size="sm"
                  variant="outline"
                  confirmLabel={
                    <span className="flex items-center gap-1.5">
                      <TrashIcon className="size-3.5" aria-hidden />
                      Confirm delete
                    </span>
                  }
                  helperText="Permanently removes the file from storage."
                  disabled={deletingId === inspectorAsset.id}
                  onConfirm={() => {
                    setInspectorId(null)
                    void handleDelete(inspectorAsset.id)
                  }}
                  className="w-full text-muted-foreground hover:text-destructive"
                >
                  <TrashIcon className="size-3.5" aria-hidden />
                  Delete image
                </SpaConfirmButton>
                <SheetClose asChild>
                  <Button type="button" variant="ghost" className="w-full">
                    Close
                  </Button>
                </SheetClose>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
