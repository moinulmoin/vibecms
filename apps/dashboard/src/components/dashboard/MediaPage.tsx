import { MEDIA } from '@vc/config'
import type { Asset } from '@vc/core'
import { Image as ImageIcon, LockKeyhole, Search, Trash2, Upload, X } from 'lucide-react'
import { CopyButton, Field, FieldLabel, Input, Select, Textarea, cn } from '@vc/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton } from '~/components/dashboard/blocks'
import { Checkbox } from '~/components/ui/checkbox'
import { Progress } from '~/components/ui/progress'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { useToast } from '~/components/Toaster'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { DashboardApiError, dashboardMutationHeaders, dashboardMutationSignal, handleDashboardSiteChanged, notifyDashboardMutation, updateMediaAltMutation } from '~/lib/api-client'
import { parseMutationResultJson, type ParsedMutationResult } from '~/lib/mutation-result'
import { mediaQuery, queryKeys } from '~/lib/queries'

type MediaData = { assets: Asset[]; mediaGate?: { effective: boolean; selfHosted: boolean } }

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(0)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

export function selectedFileFeedback(files: ArrayLike<{ name: string }> | null) {
  if (!files?.length) return null
  if (files.length === 1) return `Selected: ${files[0]?.name ?? 'image'}`
  return `${files.length} images selected`
}

function assetUrl(asset: Pick<Asset, 'id'>) {
  return `/media-assets/${asset.id}`
}

type UploadEntry = { key: string; name: string; progress: number; status: 'pending' | 'uploading' | 'done' | 'error' }

function uploadFileWithProgress(file: File, onProgress: (progress: number) => void): Promise<ParsedMutationResult> {
  return new Promise<ParsedMutationResult>((resolve, reject) => {
    const signal = dashboardMutationSignal()
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const form = new FormData()
    form.append('file', file)
    form.append('altText', '')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media/upload')
    xhr.withCredentials = true
    for (const [name, value] of Object.entries(dashboardMutationHeaders())) xhr.setRequestHeader(name, value)
    const abort = () => xhr.abort()
    signal.addEventListener('abort', abort, { once: true })
    xhr.onloadend = () => signal.removeEventListener('abort', abort)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new Error('unauthorized'))
        return
      }
      if (xhr.status === 409) {
        try {
          if ((JSON.parse(xhr.responseText) as { error?: { code?: string } }).error?.code === 'site_changed') {
            const error = new DashboardApiError(409, 'site_changed', 'Selected site changed')
            handleDashboardSiteChanged(error)
            reject(error)
            return
          }
        } catch { /* Use the existing response error below. */ }
      }
      try {
        resolve(parseMutationResultJson(JSON.parse(xhr.responseText)))
      } catch {
        reject(new Error('bad-response'))
      }
    }
    xhr.onerror = () => reject(new Error('network'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.send(form)
  })
}

async function deleteAsset(assetId: string): Promise<'ok' | 'error' | 'unauthorized'> {
  const response = await fetch('/api/media/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...dashboardMutationHeaders() },
    body: JSON.stringify({ assetId }),
    credentials: 'include',
    signal: dashboardMutationSignal(),
  }).finally(notifyDashboardMutation)
  if (response.status === 409) {
    const body = await response.json() as { error?: { code?: string } }
    if (body.error?.code === 'site_changed') {
      const error = new DashboardApiError(409, 'site_changed', 'Selected site changed')
      handleDashboardSiteChanged(error)
      throw error
    }
    return 'error'
  }
  if (response.status === 401) return 'unauthorized'
  const result = parseMutationResultJson(await response.json())
  return result.kind === 'ok' ? 'ok' : 'error'
}

function AltEditor({ asset, onSaved }: { asset: Asset; onSaved: (altText: string | null) => void }) {
  const { toast } = useToast()
  const [value, setValue] = useState(asset.altText ?? '')
  const [pending, setPending] = useState(false)
  useEffect(() => setValue(asset.altText ?? ''), [asset.id, asset.altText])
  const dirty = value.trim() !== (asset.altText ?? '')

  async function save() {
    setPending(true)
    try {
      const result = await updateMediaAltMutation({ assetId: asset.id, altText: value })
      if (result.kind !== 'ok') {
        toast(resolveFormStatus({ error: result.code }) ?? { variant: 'error', title: 'Not saved', message: 'Try again.' })
        return
      }
      onSaved(value.trim().slice(0, 180) || null)
      toast({ variant: 'success', title: 'Alt text saved', message: 'Screen readers and search engines will use it.' })
    } catch {
      toast({ variant: 'error', title: 'Not saved', message: 'Check your connection and try again.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={`alt-${asset.id}`}>Alt text</FieldLabel>
      <Textarea
        id={`alt-${asset.id}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={180}
        rows={3}
        placeholder="Describe the image for people who can’t see it"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm tabular-nums text-muted-foreground">{value.length}/180</span>
        <Button type="button" size="sm" disabled={!dirty || pending} onClick={() => void save()}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Field>
  )
}

export function MediaPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const query = useQuery(mediaQuery)
  const [dragActive, setDragActive] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [liveAnnounce, setLiveAnnounce] = useState<string | null>(null)
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [missingAltOnly, setMissingAltOnly] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const data = query.data as MediaData | undefined
  const assets = data?.assets ?? null

  function setAssets(update: (prev: Asset[]) => Asset[]) {
    queryClient.setQueryData(queryKeys.media, (prev: MediaData | undefined) =>
      prev ? { ...prev, assets: update(prev.assets) } : prev,
    )
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || uploading) return
    setUploading(true)
    setUploadQueue(files.map((file, index) => ({ key: `${index}:${file.name}`, name: file.name, progress: 0, status: 'pending' })))
    const patch = (key: string, next: Partial<UploadEntry>) =>
      setUploadQueue((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)))

    let failures = 0
    let errorCode: string | null = null
    for (const [index, file] of files.entries()) {
      const key = `${index}:${file.name}`
      patch(key, { status: 'uploading' })
      try {
        const result = await uploadFileWithProgress(file, (progress) => patch(key, { progress }))
        if (result.kind === 'ok') patch(key, { status: 'done', progress: 1 })
        else {
          patch(key, { status: 'error' })
          failures += 1
          errorCode = result.code
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'unauthorized') {
          setUploading(false)
          await navigate({ to: '/login' })
          return
        }
        patch(key, { status: 'error' })
        failures += 1
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    const succeeded = files.length - failures
    setLiveAnnounce(failures ? `${succeeded} of ${files.length} images uploaded.` : `${files.length === 1 ? '1 image' : `${files.length} images`} uploaded.`)
    if (succeeded) {
      // Other screens list images too (Settings share image, editor pickers).
      notifyDashboardMutation()
      await queryClient.invalidateQueries({ queryKey: queryKeys.media })
    }
    if (failures) {
      toast(
        resolveFormStatus({ error: errorCode ?? 'unknown' }) ?? {
          variant: 'error',
          title: 'Upload failed',
          message: 'Try again.',
        },
      )
    } else {
      window.setTimeout(() => setUploadQueue([]), 1500)
    }
  }

  async function handleDelete(assetId: string) {
    try {
      const outcome = await deleteAsset(assetId)
      if (outcome === 'unauthorized') {
        await navigate({ to: '/login' })
        return
      }
      if (outcome === 'error') {
        toast({ variant: 'error', title: 'Image not deleted', message: 'It may still be used in a post.' })
        return
      }
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId))
      setSelectedIds((prev) => prev.filter((id) => id !== assetId))
      setLiveAnnounce('Image deleted.')
    } catch {
      toast({ variant: 'error', title: 'Image not deleted', message: 'Check your connection and try again.' })
    }
  }

  // Optimistic bulk delete: tiles vanish immediately; a partial failure puts
  // back only the failed ones, in their original grid order.
  async function handleBulkDelete() {
    if (!assets || selectedIds.length === 0 || bulkDeleting) return
    const ids = selectedIds
    const snapshot = assets
    const label = ids.length === 1 ? '1 image' : `${ids.length} images`
    setBulkDeleting(true)
    setSelectedIds([])
    setAssets(() => snapshot.filter((asset) => !ids.includes(asset.id)))
    const failed: string[] = []
    for (const [index, assetId] of ids.entries()) {
      setLiveAnnounce(`Deleting ${index + 1} of ${ids.length}…`)
      try {
        const outcome = await deleteAsset(assetId)
        if (outcome === 'unauthorized') {
          setBulkDeleting(false)
          await navigate({ to: '/login' })
          return
        }
        if (outcome === 'error') failed.push(assetId)
      } catch {
        failed.push(assetId)
      }
    }
    if (failed.length > 0) {
      setAssets(() => snapshot.filter((asset) => !ids.includes(asset.id) || failed.includes(asset.id)))
      setLiveAnnounce(
        failed.length === 1
          ? '1 image could not be deleted and was restored.'
          : `${failed.length} images could not be deleted and were restored.`,
      )
    } else {
      setLiveAnnounce(`${label} deleted.`)
    }
    setBulkDeleting(false)
  }

  const header = (
    <PageHeader
      title="Media"
      description={`Images for covers and posts. ${MEDIA.formatsLabel}, up to ${MEDIA.maxImageLabel} each.`}
    />
  )

  if (query.isError && !data) {
    return (
      <>
        {header}
        <LoadError message="Your images didn’t load." onRetry={() => void query.refetch()} />
      </>
    )
  }
  if (!assets) {
    return (
      <>
        {header}
        <PageSkeleton variant="panels" withHeader={false} />
      </>
    )
  }

  const canUpload = data?.mediaGate == null ? true : data.mediaGate.effective || data.mediaGate.selfHosted
  const usedBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0)
  const usagePercent = MEDIA.paidStorageBytes > 0 ? Math.min(100, Math.round((usedBytes / MEDIA.paidStorageBytes) * 100)) : 0
  const nearLimit = usagePercent > 80
  const trimmed = searchQuery.trim().toLowerCase()
  const filteredAssets = assets.filter(
    (asset) => (!trimmed || asset.filename.toLowerCase().includes(trimmed)) && (!missingAltOnly || !asset.altText),
  )
  const missingAltCount = assets.filter((asset) => !asset.altText).length
  const inspectorAsset = assets.find((asset) => asset.id === inspectorId) ?? null

  return (
    <>
      <p className="sr-only" role="status">
        {liveAnnounce}
      </p>
      <PageHeader
        title="Media"
        description={`Images for covers and posts. ${MEDIA.formatsLabel}, up to ${MEDIA.maxImageLabel} each.`}
        action={
          canUpload ? (
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload aria-hidden data-icon="inline-start" /> Upload images
            </Button>
          ) : undefined
        }
      />

      {canUpload ? (
        <div
          onDragEnter={(event) => {
            event.preventDefault()
            dragDepth.current += 1
            setDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            dragDepth.current = 0
            setDragActive(false)
            void uploadFiles(Array.from(event.dataTransfer?.files ?? []))
          }}
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3.5 text-sm transition-colors',
            dragActive ? 'border-brand-bright/60 bg-muted/60' : 'border-border',
          )}
        >
          <p className="text-muted-foreground">
            {dragActive ? (
              <span className="text-foreground">Drop to upload</span>
            ) : (
              <>
                Drag images here, or{' '}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4 hover:text-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  browse
                </button>
                .
              </>
            )}
          </p>
          <p className={cn('tabular-nums', nearLimit ? 'text-warning' : 'text-muted-foreground')}>
            {formatBytes(usedBytes)} of {MEDIA.paidStorageLabel} used
            {nearLimit ? ' · almost full' : ''}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={MEDIA.mimeTypes.join(',')}
            multiple
            aria-label="Choose images to upload"
            onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files ?? []))}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3.5" data-testid="media-upload-locked">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="flex-1 text-sm text-muted-foreground">
            Uploading new images is part of the paid plan. Images you already have keep working.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
              See plans
            </Link>
          </Button>
        </div>
      )}

      {uploadQueue.length ? (
        <ul className="grid gap-2" aria-label="Uploads">
          {uploadQueue.map((entry) => (
            <li key={entry.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
              <span className="truncate text-foreground">{entry.name}</span>
              <span
                className={cn(
                  'tabular-nums',
                  entry.status === 'error' ? 'text-destructive' : entry.status === 'done' ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {entry.status === 'error'
                  ? 'Failed'
                  : entry.status === 'done'
                    ? 'Uploaded'
                    : entry.status === 'pending'
                      ? 'Waiting'
                      : `${Math.round(entry.progress * 100)}%`}
              </span>
              {entry.status === 'uploading' ? (
                <Progress value={Math.round(entry.progress * 100)} className="col-span-2 h-1 [&_[data-slot=progress-indicator]]:bg-brand-bright" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {assets.length === 0 ? (
        <EmptyState
          icon={<ImageIcon />}
          title="No images yet"
          description={canUpload ? 'Upload a cover or an image for a post. Agents can upload here too.' : 'Images you or your agents add show up here.'}
          action={
            canUpload ? (
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden data-icon="inline-start" /> Upload images
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by file name"
                aria-label="Search images by file name"
                className="pl-9 pr-9"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <Select
              value={missingAltOnly ? 'missing-alt' : 'all'}
              onChange={(event) => setMissingAltOnly(event.target.value === 'missing-alt')}
              aria-label="Filter images"
              className="w-full sm:w-52"
            >
              <option value="all">All images</option>
              <option value="missing-alt">Missing alt text ({missingAltCount})</option>
            </Select>
            <p className="text-sm tabular-nums text-muted-foreground sm:ml-auto">
              {filteredAssets.length} {filteredAssets.length === 1 ? 'image' : 'images'}
            </p>
          </div>

          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={filteredAssets.length > 0 && filteredAssets.every((asset) => selectedIds.includes(asset.id))}
                  onCheckedChange={(checked) => setSelectedIds(checked === true ? filteredAssets.map((asset) => asset.id) : [])}
                  aria-label={`Select all ${filteredAssets.length} images`}
                />
                {selectedIds.length} selected
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
              <div className="ms-auto">
                <SpaConfirmButton
                  size="sm"
                  variant="outline"
                  confirmLabel={`Confirm delete ${selectedIds.length}`}
                  pendingLabel="Deleting…"
                  helperText="Deleted images can’t be recovered."
                  disabled={bulkDeleting}
                  onConfirm={() => void handleBulkDelete()}
                >
                  <Trash2 aria-hidden data-icon="inline-start" />
                  Delete {selectedIds.length === 1 ? '1 image' : `${selectedIds.length} images`}
                </SpaConfirmButton>
              </div>
            </div>
          ) : null}

          {filteredAssets.length === 0 ? (
            <EmptyState
              compact
              icon={<Search />}
              title="No matches."
              description="Try another name or show all images."
            />
          ) : (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-label="Images">
              {filteredAssets.map((asset) => {
                const selected = selectedIds.includes(asset.id)
                return (
                  <li key={asset.id} className="group grid min-w-0 gap-2">
                    <div
                      className={cn(
                        'relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted',
                        selected && 'border-brand-bright/60 ring-1 ring-brand-bright/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setInspectorId(asset.id)}
                        aria-label={`Open ${asset.filename}`}
                        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <img
                          className="size-full object-cover"
                          width={640}
                          height={480}
                          src={assetUrl(asset)}
                          alt={asset.altText ?? ''}
                          loading="lazy"
                        />
                      </button>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          setSelectedIds((prev) =>
                            checked === true ? [...new Set([...prev, asset.id])] : prev.filter((id) => id !== asset.id),
                          )
                        }
                        aria-label={`Select ${asset.filename}`}
                        className={cn(
                          'absolute left-2 top-2 z-10 bg-background/90',
                          selected || selectedIds.length
                            ? 'opacity-100'
                            : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                        )}
                      />
                      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <CopyButton
                          value={assetUrl(asset)}
                          label={`Copy link to ${asset.filename}`}
                          copiedLabel="Link copied"
                          iconOnly
                          variant="secondary"
                          className="size-8"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <strong className="block truncate text-sm font-medium text-foreground">{asset.filename}</strong>
                      <p className="text-sm text-muted-foreground">
                        {formatBytes(asset.sizeBytes)}
                        {asset.altText ? null : <span className="text-warning"> · No alt text</span>}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <Sheet open={inspectorId !== null} onOpenChange={(open) => (!open ? setInspectorId(null) : undefined)}>
        <SheetContent side="right" className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="truncate">{inspectorAsset?.filename ?? 'Image'}</SheetTitle>
            <SheetDescription>
              {inspectorAsset
                ? `${inspectorAsset.width && inspectorAsset.height ? `${inspectorAsset.width} × ${inspectorAsset.height} · ` : ''}${formatBytes(inspectorAsset.sizeBytes)}`
                : ''}
            </SheetDescription>
          </SheetHeader>
          {inspectorAsset ? (
            <div className="grid gap-5 px-4">
              <div className="overflow-hidden rounded-lg border border-border bg-muted">
                <img className="max-h-80 w-full object-contain" src={assetUrl(inspectorAsset)} alt={inspectorAsset.altText ?? ''} />
              </div>
              <AltEditor
                asset={inspectorAsset}
                onSaved={(altText) =>
                  setAssets((prev) => prev.map((asset) => (asset.id === inspectorAsset.id ? { ...asset, altText } : asset)))
                }
              />
              <div className="grid gap-2">
                <p className="text-sm font-medium text-foreground">Use it</p>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={assetUrl(inspectorAsset)} label="Copy link" copiedLabel="Copied" />
                  <CopyButton
                    value={`![${inspectorAsset.altText ?? ''}](${assetUrl(inspectorAsset)})`}
                    label="Copy Markdown"
                    copiedLabel="Copied"
                  />
                </div>
              </div>
            </div>
          ) : null}
          {inspectorAsset ? (
            <SheetFooter className="mt-auto">
              <SpaConfirmButton
                variant="ghost"
                confirmLabel="Delete image"
                pendingLabel="Deleting…"
                helperText="Deleted images can’t be recovered."
                onConfirm={async () => {
                  const id = inspectorAsset.id
                  setInspectorId(null)
                  await handleDelete(id)
                }}
                className="w-full text-muted-foreground hover:text-destructive"
              >
                <Trash2 aria-hidden data-icon="inline-start" /> Delete image
              </SpaConfirmButton>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
