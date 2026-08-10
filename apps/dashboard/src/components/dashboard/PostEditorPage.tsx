'use client'

import type { Asset, Post, PostVersion, PostVersionSummary } from '@vc/core'
import { MEDIA, THEME_PRESETS, resolvePresetId } from '@vc/config'
import { Field, FieldDescription, FieldLabel, Input, Select, Textarea } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  archivePostMutation,
  createPostMutation,
  getPostVersionFn,
  listPostVersionsFn,
  loadPostEditorPage,
  loadMediaPage,
  publishPostMutation,
  restorePostVersionFn,
  updatePostMutation,
} from '~/lib/api-client'
import { Button, PageHeader, Panel, formatDateTime } from '~/components/dashboard/DashboardLayout'
import { Badge, Card } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { StatusBadge } from '~/components/dashboard/blocks'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { MarkdownEditor, PostSlugFromTitle, UnsavedChangesGuard, serializeForm } from '~/components/dashboard/MarkdownEditor'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useMediaQuery } from '~/hooks/use-media-query'
import type { EditorSiteInfo } from '~/types/dashboard'
import { emptyDashboardStatusSearch, emptyPostsListSearch, emptyPostEditorSearch, postEditorSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { ArchiveIcon, ChevronDownIcon, ChevronLeftIcon, CounterClockwiseClockIcon, EyeOpenIcon, ResetIcon, RocketIcon, UploadIcon } from '@radix-ui/react-icons'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Separator } from "@vc/ui"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from '~/components/ui/item'
import { diffLines, type DiffLine } from '~/lib/diff'
import { parseMutationResultJson } from '~/lib/mutation-result'

function tagsFromForm(form: FormData) {
  const raw = form.get('tags')
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function payloadFromForm(form: FormData) {
  const cover = form.get('coverAssetId')
  return {
    title: String(form.get('title') ?? '').trim(),
    slug: String(form.get('slug') ?? '').trim(),
    excerpt: String(form.get('excerpt') ?? '').trim() || undefined,
    contentMarkdown: String(form.get('contentMarkdown') ?? ''),
    coverAssetId: typeof cover === 'string' && cover.length > 0 ? cover : null,
    seoTitle: String(form.get('seoTitle') ?? '').trim() || undefined,
    seoDescription: String(form.get('seoDescription') ?? '').trim() || undefined,
    canonicalUrl: String(form.get('canonicalUrl') ?? '').trim() || null,
    tags: tagsFromForm(form).join(', '),
  }
}

export function shouldShowPublishAction(
  post: Pick<Post, 'status' | 'publishedVersionNumber'> | null,
  currentVersionNumber: number | null,
): boolean {
  return Boolean(post && (post.status !== 'published' || currentVersionNumber !== post.publishedVersionNumber))
}

export type EditorLiveState = 'new' | 'draft' | 'unpublished' | 'live' | 'archived'

export function editorLiveState(
  post: Pick<Post, 'status' | 'publishedVersionNumber'> | null,
  currentVersionNumber: number | null,
): EditorLiveState {
  if (!post) return 'new'
  if (post.status === 'archived') return 'archived'
  if (post.status === 'draft') return 'draft'
  return currentVersionNumber !== post.publishedVersionNumber ? 'unpublished' : 'live'
}

function PostStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />
}

// ---------------------------------------------------------------------------
// Editor state strip: version, status, last-saved, publish CTA.
// Rendered above the writing surface so the author always sees the state.
// ---------------------------------------------------------------------------
function EditorStateStrip({
  post,
  currentVersionNumber,
  latestVersion,
  publicBaseUrl,
  publishPending,
  onPublish,
  onReviewChanges,
}: {
  post: Post
  currentVersionNumber: number | null
  latestVersion: PostVersionSummary | null
  publicBaseUrl: string | null
  publishPending: boolean
  onPublish: () => void
  onReviewChanges: () => void
}) {
  const state = editorLiveState(post, currentVersionNumber)
  const liveUrl =
    post.status === 'published' && publicBaseUrl ? `${publicBaseUrl}/${post.slug}` : null

  // State signal — one colored dot + label. Green = live, amber = ahead of the
  // public version, muted = nothing public yet. This is the strip's headline.
  const stateSignal =
    state === 'live' ? (
      <span className="flex items-center gap-2 font-mono text-xs font-medium text-primary">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright/40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        </span>
        All changes live
      </span>
    ) : state === 'unpublished' ? (
      <span className="flex items-center gap-2 font-mono text-xs font-medium text-amber-600 dark:text-amber-400">
        <span className="size-2 rounded-full bg-amber-500" />
        Unpublished changes
      </span>
    ) : state === 'draft' ? (
      <span className="flex items-center gap-2 font-mono text-xs font-medium text-muted-foreground">
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        Draft
      </span>
    ) : (
      <span className="flex items-center gap-2 font-mono text-xs font-medium text-muted-foreground">
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        Archived
      </span>
    )

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[color:var(--hairline)] bg-background px-4 py-2.5">
      {/* Quiet metadata — version + last saved read as one cluster, never compete */}
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="tabular-nums">v{currentVersionNumber ?? '—'}</span>
        {latestVersion ? (
          <>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span className="truncate">
              Saved {relativeTime(latestVersion.createdAt)}
              {latestVersion.actorName.trim() ? ` by ${latestVersion.actorName}` : ''}
            </span>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {state === 'unpublished' ? (
          <Button type="button" variant="outline" size="sm" onClick={onReviewChanges}>
            <EyeOpenIcon aria-hidden data-icon="inline-start" /> Review changes
          </Button>
        ) : null}
        {liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open live ↗
          </a>
        ) : null}
        {stateSignal}
        {shouldShowPublishAction(post, currentVersionNumber) ? (
          <PendingSubmitButton
            type="button"
            size="sm"
            pending={publishPending}
            pendingText="Publishing…"
            onClick={onPublish}
          >
            <RocketIcon aria-hidden data-icon="inline-start" />
            {post.status === 'published' ? 'Publish changes' : 'Publish'}
          </PendingSubmitButton>
        ) : null}
      </div>
    </div>
  )
}

export function NewPostEditorPage() {
  return <PostEditorShell postId={undefined} />
}

export function EditPostEditorPage({ postId }: { postId: string }) {
  return <PostEditorShell postId={postId} />
}

function EditorSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Skeleton className="h-[34rem] rounded-2xl" />
        <div className="grid gap-3">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    </>
  )
}

function relativeTime(tsSeconds: number): string {
  const diffMs = Date.now() - tsSeconds * 1000
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d ago`
  return formatDateTime(tsSeconds)
}

function CharCounter({ targetId, max }: { targetId: string; max: number }) {
  const [len, setLen] = useState(0)
  useEffect(() => {
    const el = document.getElementById(targetId) as HTMLInputElement | HTMLTextAreaElement | null
    if (!el) return
    const update = () => setLen(el.value.length)
    update()
    el.addEventListener('input', update)
    return () => el.removeEventListener('input', update)
  }, [targetId])
  return (
    <span
      className={`font-mono text-[11px] tabular-nums ${
        len >= max
          ? 'text-destructive'
          : len > max * 0.9
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground'
      }`}
    >
      {len}/{max}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Collapsible rail section — cleaner than Panel for sidebar groups.
// ---------------------------------------------------------------------------
function RailSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string
  meta?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 p-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-6"
          >
            <span className="flex items-center gap-2">
              <span className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </span>
              {meta}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transform-none data-[state=open]:rotate-180"
              data-state={open ? 'open' : 'closed'}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-[color:var(--hairline)] px-5 py-4 sm:px-6">
            {children}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function PostEditorShell({ postId }: { postId?: string }) {
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savePending, setSavePending] = useState(false)
  const [publishPending, setPublishPending] = useState(false)
  const [archivePending, setArchivePending] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const [versions, setVersions] = useState<PostVersionSummary[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<PostVersion | null>(null)
  const [viewingVersionLoading, setViewingVersionLoading] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [restoreVersionPending, setRestoreVersionPending] = useState<number | null>(null)
  const [presetId, setPresetId] = useState<string>('minimal')
  const [site, setSite] = useState<EditorSiteInfo | null>(null)
  const [latestVersion, setLatestVersion] = useState<PostVersionSummary | null>(null)
  const [publicBaseUrl, setPublicBaseUrl] = useState<string | null>(null)
  const isNarrow = useMediaQuery('(max-width: 1023px)')
  const [mobileTab, setMobileTab] = useState<'write' | 'preview' | 'settings'>('write')
  const [selectedLayout, setSelectedLayout] = useState<string>('standard')
  const [selectedToc, setSelectedToc] = useState<boolean>(false)
  const [presentationDirty, setPresentationDirty] = useState(false)
  const [hasPriorPresentation, setHasPriorPresentation] = useState(false)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number | null>(null)
  const [selectedCoverAssetId, setSelectedCoverAssetId] = useState('')
  const [coverUploadPending, setCoverUploadPending] = useState(false)
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const coverAltInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const baselineRef = useRef<string>('')
  const captureBaseline = () => {
    if (formRef.current) baselineRef.current = serializeForm(formRef.current)
  }
  const isFormDirty = () =>
    presentationDirty || (formRef.current ? serializeForm(formRef.current) !== baselineRef.current : false)

  // Track title for SEO inheritance display
  const [currentTitle, setCurrentTitle] = useState('')
  const [currentSlug, setCurrentSlug] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadPostEditorPage({ postId })
      .then((result) => {
        if (cancelled) return
        setPost(result.post)
        setAssets(result.assets)
        setMissing(result.missing)
        setSelectedCoverAssetId(result.post?.coverAssetId ?? '')
        setPresetId(result.presetId)
        setSite(result.site)
        setLatestVersion(result.latestVersion)
        setPublicBaseUrl(result.publicBaseUrl)
        setCurrentVersionNumber(result.currentVersionNumber)
        setCurrentTitle(result.post?.title ?? '')
        setCurrentSlug(result.post?.slug ?? '')
        const cap = THEME_PRESETS[resolvePresetId(result.presetId)].layout
        setSelectedLayout(result.post?.presentation?.layout ?? cap.default.layout)
        setSelectedToc(result.post?.presentation?.toc ?? cap.default.toc)
        setHasPriorPresentation(result.post?.presentation != null)
        setPresentationDirty(false)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load this post. Refresh to try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!formRef.current) return
    setSavePending(true)
    try {
      const form = new FormData(formRef.current)
      const payload = payloadFromForm(form)
      if (postId) {
        if (currentVersionNumber == null) return
        const result = await updatePostMutation({
          postId,
          expectedVersionNumber: currentVersionNumber,
          ...payload,
          presentation: { layout: selectedLayout, toc: selectedToc },
        })
        if (result.kind === 'ok') {
          const refreshed = await loadPostEditorPage({ postId })
          setPost(refreshed.post)
          setLatestVersion(refreshed.latestVersion)
          setCurrentVersionNumber(refreshed.currentVersionNumber)
          setPresentationDirty(false)
          captureBaseline()
          await navigate({
            to: '/dashboard/posts/$postId/edit',
            params: { postId },
            search: postEditorSearch({ ok: result.code }),
          })
          return
        }
        await navigate({
          to: '/dashboard/posts/$postId/edit',
          params: { postId },
          search: postEditorSearch({ error: result.code }),
        })
      } else {
        const result = await createPostMutation({
          ...payload,
          presentation: { layout: selectedLayout, toc: selectedToc },
        })
        if (result.kind === 'ok' && result.postId) {
          await navigate({
            to: '/dashboard/posts/$postId/edit',
            params: { postId: result.postId },
            search: postEditorSearch({ ok: result.code }),
          })
          return
        }
        await navigate({
          to: '/dashboard/posts/new',
          search: postEditorSearch({ error: result.code }),
        })
      }
    } catch {
      await navigate({
        to: postId
          ? '/dashboard/posts/$postId/edit'
          : '/dashboard/posts/new',
        ...(postId ? { params: { postId } } : {}),
        search: postEditorSearch({ error: 'unknown' }),
      })
    } finally {
      setSavePending(false)
    }
  }

  async function persistIfDirty(): Promise<number | null | false> {
    if (!isFormDirty()) return currentVersionNumber
    if (!formRef.current) return false
    const form = new FormData(formRef.current)
    const payload = payloadFromForm(form)
    if (!postId || currentVersionNumber == null) return false
    const result = await updatePostMutation({
      postId,
      expectedVersionNumber: currentVersionNumber,
      ...payload,
      presentation: { layout: selectedLayout, toc: selectedToc },
    })
    if (result.kind !== 'ok') return false
    const refreshed = await loadPostEditorPage({ postId })
    setPost(refreshed.post)
    setLatestVersion(refreshed.latestVersion)
    setCurrentVersionNumber(refreshed.currentVersionNumber)
    setPresentationDirty(false)
    captureBaseline()
    return refreshed.currentVersionNumber
  }

  async function handlePublish() {
    if (!postId) return
    setPublishPending(true)
    try {
      const savedVersionNumber = await persistIfDirty()
      if (savedVersionNumber === false) return
      if (savedVersionNumber === null) return
      const result = await publishPostMutation({ postId, expectedVersionNumber: savedVersionNumber })
      await navigate({
        to: '/dashboard/posts',
        search: statusSearchFromMutation(result),
      })
    } finally {
      setPublishPending(false)
    }
  }

  async function handleArchive() {
    if (!postId) return
    setArchivePending(true)
    try {
      const savedVersionNumber = await persistIfDirty()
      if (savedVersionNumber === false) return
      const result = await archivePostMutation({ postId })
      if (result.kind === 'ok') {
        await navigate({
          to: '/dashboard/posts',
          search: statusSearchFromMutation(result),
        })
        return
      }
      await navigate({
        to: '/dashboard/posts/$postId/edit',
        params: { postId },
        search: postEditorSearch({ error: result.code }),
      })
    } catch {
      await navigate({
        to: '/dashboard/posts/$postId/edit',
        params: { postId },
        search: postEditorSearch({ error: 'unknown' }),
      })
    } finally {
      setArchivePending(false)
    }
  }

  async function handleVersionDrawerOpenChange(open: boolean) {
    setVersionDrawerOpen(open)
    if (!open || !postId) return
    setVersionsLoading(true)
    setVersions([])
    try {
      const result = await listPostVersionsFn({ postId })
      setVersions(result)
    } finally {
      setVersionsLoading(false)
    }
  }

  async function handleViewVersion(versionNumber: number) {
    if (!postId) return
    setViewDialogOpen(true)
    setViewingVersion(null)
    setShowDiff(false)
    setViewingVersionLoading(true)
    try {
      const v = await getPostVersionFn({ postId, versionNumber })
      setViewingVersion(v)
    } catch {
      setViewDialogOpen(false)
    } finally {
      setViewingVersionLoading(false)
    }
  }

  async function handleReviewChanges() {
    if (post?.publishedVersionNumber == null) return
    await handleViewVersion(post.publishedVersionNumber)
    setShowDiff(true)
  }

  async function handleRestoreVersion(versionNumber: number) {
    if (!postId || currentVersionNumber == null) return
    setRestoreVersionPending(versionNumber)
    try {
      const result = await restorePostVersionFn({
        postId,
        versionNumber,
        expectedVersionNumber: currentVersionNumber,
      })
      if (result.kind === 'ok') {
        const refreshed = await loadPostEditorPage({ postId })
        setPost(refreshed.post)
        setSite(refreshed.site)
        setLatestVersion(refreshed.latestVersion)
        setPublicBaseUrl(refreshed.publicBaseUrl)
        setCurrentVersionNumber(refreshed.currentVersionNumber)
        const cap = THEME_PRESETS[resolvePresetId(refreshed.presetId)].layout
        setSelectedLayout(refreshed.post?.presentation?.layout ?? cap.default.layout)
        setSelectedToc(refreshed.post?.presentation?.toc ?? cap.default.toc)
        setHasPriorPresentation(refreshed.post?.presentation != null)
        setPresentationDirty(false)
        setFormKey((k) => k + 1)
        setVersionDrawerOpen(false)
        await navigate({
          to: '/dashboard/posts/$postId/edit',
          params: { postId },
          search: postEditorSearch({ ok: result.code }),
        })
        return
      }
      await navigate({
        to: '/dashboard/posts/$postId/edit',
        params: { postId },
        search: postEditorSearch({ error: result.code }),
      })
    } catch {
      await navigate({
        to: '/dashboard/posts/$postId/edit',
        params: { postId },
        search: postEditorSearch({ error: 'unknown' }),
      })
    } finally {
      setRestoreVersionPending(null)
    }
  }

  async function handleCoverUpload() {
    const file = coverFileInputRef.current?.files?.[0]
    if (!file) return
    setCoverUploadPending(true)
    setCoverUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('altText', coverAltInputRef.current?.value ?? '')
      const response = await fetch('/api/media/upload', { method: 'POST', body: form, credentials: 'include' })
      if (response.status === 401) {
        await navigate({ to: '/login' })
        return
      }
      const result = parseMutationResultJson(await response.json())
      if (result.kind === 'ok') {
        const data = await loadMediaPage()
        setAssets(data.assets)
        const uploaded = data.assets[data.assets.length - 1]
        if (uploaded) setSelectedCoverAssetId(uploaded.id)
        if (coverFileInputRef.current) coverFileInputRef.current.value = ''
        if (coverAltInputRef.current) coverAltInputRef.current.value = ''
      } else {
        setCoverUploadError(result.code)
      }
    } catch {
      setCoverUploadError('Upload failed. Try again.')
    } finally {
      setCoverUploadPending(false)
    }
  }

  if (loading) {
    return <EditorSkeleton />
  }

  const capability = THEME_PRESETS[resolvePresetId(presetId)].layout
  const selectedCoverAsset = assets.find((asset) => asset.id === selectedCoverAssetId) ?? null
  const viewingIsPinned =
    viewingVersion != null &&
    post?.publishedVersionNumber != null &&
    viewingVersion.versionNumber === post.publishedVersionNumber

  // Derived values for SEO inheritance display
  const derivedSeoTitle = post?.seoTitle || currentTitle || 'Post title'
  const derivedCanonical = publicBaseUrl && currentSlug ? `${publicBaseUrl}/${currentSlug}` : null

  return (
    <>
      <PageHeader
        kicker={post ? undefined : 'New post'}
        title={post ? 'Edit post' : 'Create post'}
        description="Write in Markdown, then check the exact public page in Preview before you publish."
        action={
          <div className="flex items-center gap-2">
            {post && <PostStatusBadge status={post.status} />}
            <Button asChild variant="outline">
              <Link to="/dashboard/posts" search={emptyPostsListSearch}><ChevronLeftIcon aria-hidden data-icon="inline-start" /> Back to posts</Link>
            </Button>
          </div>
        }
      />
      {post ? (
        <EditorStateStrip
          post={post}
          currentVersionNumber={currentVersionNumber}
          latestVersion={latestVersion}
          publicBaseUrl={publicBaseUrl}
          publishPending={publishPending}
          onPublish={() => void handlePublish()}
          onReviewChanges={() => void handleReviewChanges()}
        />
      ) : null}
      {loadError ? (
        <Panel title="Could not load post">
          <div className="grid gap-3">
            <p className="font-sans text-sm text-muted-foreground">{loadError}</p>
            <Button type="button" variant="outline" className="w-fit" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : missing ? (
        <Panel title="Post Not Found">
          <p className="font-sans text-sm text-muted-foreground">Post not found.</p>
        </Panel>
      ) : (
        <form
          key={formKey}
          ref={formRef}
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
          onSubmit={(event) => void handleSave(event)}
        >
          <UnsavedChangesGuard message="You have unsaved post changes. Leave without saving?" resetKey={post} />
          <PostSlugFromTitle enabled={!post} />
          {isNarrow ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--hairline)] p-2">
              <Tabs
                value={mobileTab}
                onValueChange={(value) => setMobileTab(value as typeof mobileTab)}
                className="min-w-0 flex-1 gap-0"
              >
                <TabsList aria-label="Editor sections" className="w-full">
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </Tabs>
              <PendingSubmitButton size="sm" pending={savePending} pendingText="Saving…">
                Save
              </PendingSubmitButton>
            </div>
          ) : null}

          {/* Writing surface — no panel wrapper, just the title and body */}
          <div className={isNarrow && mobileTab === 'settings' ? 'hidden' : undefined}>
            <input
              id="post-title"
              name="title"
              required
              maxLength={160}
              defaultValue={post?.title ?? ''}
              placeholder="Post title"
              aria-label="Post title"
              className="w-full border-0 bg-transparent font-display text-3xl font-bold tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none sm:text-4xl"
              onInput={(e) => setCurrentTitle(e.currentTarget.value)}
            />
            <div className="mt-1 mb-6 flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {publicBaseUrl && currentSlug ? `${publicBaseUrl.replace('https://', '')}/${currentSlug}` : 'slug will generate from title'}
              </span>
            </div>
            {/* PostSlugFromTitle writes into the slug input in the rail */}
            <MarkdownEditor
              assets={assets}
              defaultValue={post?.contentMarkdown ?? ''}
              presetId={presetId}
              presentation={{ layout: selectedLayout, toc: selectedToc }}
              site={site}
              siteTheme={site ? { accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } : undefined}
              publishedAt={post?.publishedAt ?? null}
              mode={isNarrow ? (mobileTab === 'preview' ? 'preview' : 'write') : undefined}
            />
          </div>

          {/* Rail — settings, actions, versions */}
          <aside className={isNarrow && mobileTab !== 'settings' ? 'hidden' : 'grid gap-3 lg:sticky lg:top-6'}>
            {/* Slug override */}
            <RailSection title="Slug" defaultOpen={!post}>
              <Field>
                <Input
                  id="post-slug"
                  className="font-mono text-sm"
                  name="slug"
                  required
                  maxLength={120}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  defaultValue={post?.slug ?? ''}
                  placeholder="auto-generated-from-title"
                  onInput={(e) => setCurrentSlug(e.currentTarget.value)}
                />
                <FieldDescription className="font-sans">
                  Lowercase letters, numbers, and hyphens. Auto-generated from the title.
                </FieldDescription>
              </Field>
            </RailSection>

            {/* Excerpt */}
            <RailSection title="Excerpt">
              <Field>
                <Textarea
                  id="post-excerpt"
                  name="excerpt"
                  maxLength={500}
                  rows={3}
                  defaultValue={post?.excerpt ?? ''}
                  placeholder="First paragraph of the post will be used if left empty."
                />
                <div className="flex justify-end">
                  <CharCounter targetId="post-excerpt" max={500} />
                </div>
              </Field>
            </RailSection>

            {/* Tags */}
            <RailSection title="Tags">
              <Field>
                <Input id="post-tags" name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(', ') ?? ''} />
              </Field>
            </RailSection>

            {/* Featured image */}
            <RailSection title="Featured image">
              <Field>
                <Select
                  id="post-cover"
                  name="coverAssetId"
                  value={selectedCoverAssetId}
                  onChange={(event) => setSelectedCoverAssetId(event.currentTarget.value)}
                >
                  <option value="">No featured image</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.filename}</option>
                  ))}
                </Select>
                {selectedCoverAsset ? (
                  <div className="flex min-w-0 items-center gap-3 pt-2">
                    <img
                      src={`/media-assets/${selectedCoverAsset.id}`}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded-md object-cover"
                    />
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium text-foreground">{selectedCoverAsset.filename}</p>
                      {!selectedCoverAsset.altText ? (
                        <p className="text-destructive text-xs">
                          Add alt text in <Link to="/dashboard/media" search={emptyDashboardStatusSearch} className="underline underline-offset-4">Media</Link>
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <details className="mt-2 rounded-lg bg-muted/50 p-3">
                  <summary className="cursor-pointer font-mono text-[11px] font-medium text-foreground marker:text-muted-foreground">
                    Upload new
                  </summary>
                  <div className="grid gap-3 pt-3">
                    <Input
                      ref={coverFileInputRef}
                      type="file"
                      accept={MEDIA.mimeTypes.join(',')}
                    />
                    <Input
                      ref={coverAltInputRef}
                      maxLength={180}
                      placeholder="Alt text"
                    />
                    {coverUploadError ? (
                      <p className="text-sm text-destructive" role="alert">{coverUploadError}</p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={coverUploadPending}
                      onClick={() => void handleCoverUpload()}
                    >
                      <UploadIcon className="size-4" aria-hidden="true" />
                      {coverUploadPending ? 'Uploading…' : 'Upload'}
                    </Button>
                  </div>
                </details>
              </Field>
            </RailSection>

            {/* SEO — shows inherited values by default */}
            <RailSection title="Search & sharing">
              <div className="grid gap-3">
                <div>
                  <p className="font-mono text-[11px] font-medium text-muted-foreground">SEO title</p>
                  <p className="mt-0.5 text-sm text-foreground">{derivedSeoTitle}</p>
                  <Input
                    id="post-seo-title"
                    name="seoTitle"
                    maxLength={70}
                    defaultValue={post?.seoTitle ?? ''}
                    placeholder={`Same as post title`}
                    className="mt-1"
                  />
                </div>
                <div>
                  <p className="font-mono text-[11px] font-medium text-muted-foreground">Canonical URL</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {derivedCanonical ?? 'Set after first save'}
                  </p>
                  <Input
                    id="post-canonical-url"
                    name="canonicalUrl"
                    type="text"
                    maxLength={2048}
                    defaultValue={post?.canonicalUrl ?? ''}
                    placeholder="Override canonical URL"
                    className="mt-1"
                  />
                </div>
              </div>
            </RailSection>

            {/* Layout */}
            <RailSection title="Layout">
              <div className="grid gap-4">
                <Field>
                  <FieldLabel htmlFor="post-layout" className="font-mono text-[11px] font-medium text-muted-foreground">
                    Article layout
                  </FieldLabel>
                  <Select
                    id="post-layout"
                    value={selectedLayout}
                    onChange={(e) => { setSelectedLayout(e.currentTarget.value); setPresentationDirty(true) }}
                  >
                    {capability.supportedLayouts.map((l) => (
                      <option key={l} value={l}>
                        {l.charAt(0).toUpperCase() + l.slice(1)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {capability.supportsToc ? (
                  <Field>
                    <div className="flex items-center gap-3">
                      <Switch
                        id="post-toc"
                        checked={selectedToc}
                        onCheckedChange={(checked) => { setSelectedToc(checked); setPresentationDirty(true) }}
                      />
                      <FieldLabel htmlFor="post-toc" className="font-mono text-[11px] font-medium text-muted-foreground">
                        Table of contents
                      </FieldLabel>
                    </div>
                  </Field>
                ) : null}
              </div>
            </RailSection>

            {/* Versions + Archive */}
            {postId ? (
              <RailSection title="History">
                <div className="grid gap-2">
                  <Sheet
                    open={versionDrawerOpen}
                    onOpenChange={(open) => void handleVersionDrawerOpenChange(open)}
                  >
                    <SheetTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-start gap-2"
                      >
                        <CounterClockwiseClockIcon className="size-4" aria-hidden="true" />
                        Version history
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
                      <SheetHeader>
                        <SheetTitle>Version history</SheetTitle>
                        <SheetDescription>
                          Past saved versions of this post.
                        </SheetDescription>
                      </SheetHeader>
                      <Separator />
                      <ScrollArea className="max-h-[26rem] min-h-0 flex-1">
                        {versionsLoading ? (
                          <div className="grid gap-3 p-4">
                            <Skeleton className="h-16 rounded-lg" />
                            <Skeleton className="h-16 rounded-lg" />
                          </div>
                        ) : versions.length === 0 ? (
                          <p className="p-4 text-sm text-muted-foreground">No versions saved yet.</p>
                        ) : (
                          <ItemGroup className="p-4">
                            {versions.map((v) => (
                              <Item key={v.versionNumber} variant="outline">
                                <ItemHeader>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="font-mono text-xs">
                                      v{v.versionNumber}
                                    </Badge>
                                    {latestVersion?.versionNumber === v.versionNumber ? (
                                      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
                                        <span className="size-1.5 rounded-full bg-brand-bright" />
                                        Current
                                      </Badge>
                                    ) : null}
                                  </div>
                                </ItemHeader>
                                <ItemContent>
                                  <ItemTitle>{v.title}</ItemTitle>
                                  <ItemDescription>
                                    {v.actorName.trim() ? `${v.actorName} · ` : ''}
                                    {relativeTime(v.createdAt)}
                                  </ItemDescription>
                                  {v.changeSummary ? (
                                    <p className="text-xs italic text-muted-foreground">{v.changeSummary}</p>
                                  ) : null}
                                </ItemContent>
                                <ItemActions className="pt-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => void handleViewVersion(v.versionNumber)}
                                    disabled={restoreVersionPending !== null}
                                  >
                                    <EyeOpenIcon className="size-3.5" aria-hidden="true" />
                                    View
                                  </Button>
                                  <SpaConfirmButton
                                    size="sm"
                                    confirmLabel="Confirm restore"
                                    helperText="This overwrites the current draft with this version."
                                    disabled={restoreVersionPending !== null}
                                    onConfirm={() => void handleRestoreVersion(v.versionNumber)}
                                  >
                                    <ResetIcon className="size-3.5" aria-hidden="true" />
                                    Restore
                                  </SpaConfirmButton>
                                </ItemActions>
                              </Item>
                            ))}
                          </ItemGroup>
                        )}
                      </ScrollArea>
                    </SheetContent>
                  </Sheet>
                  {post && post.status !== 'archived' ? (
                    <SpaConfirmButton
                      size="sm"
                      variant="outline"
                      confirmLabel="Confirm archive"
                      helperText="Archiving hides this post from the public blog."
                      disabled={archivePending}
                      onConfirm={() => void handleArchive()}
                      className="justify-start"
                    >
                      <ArchiveIcon aria-hidden data-icon="inline-start" /> Archive post
                    </SpaConfirmButton>
                  ) : null}
                </div>
              </RailSection>
            ) : null}

            {/* Sticky save/publish */}
            <div className="grid gap-2 lg:sticky lg:bottom-6">
              <PendingSubmitButton pending={savePending} pendingText="Saving…">
                Save draft
              </PendingSubmitButton>
              {postId && shouldShowPublishAction(post, currentVersionNumber) ? (
                <Button
                  type="button"
                  variant="default"
                  disabled={publishPending}
                  onClick={() => void handlePublish()}
                >
                  {publishPending ? 'Publishing…' : post?.status === 'published' ? 'Publish changes' : 'Publish'}
                </Button>
              ) : null}
            </div>
          </aside>
        </form>
      )}

      {/* Version viewer dialog */}
      <Dialog
        open={viewDialogOpen}
        onOpenChange={(open) => {
          setViewDialogOpen(open)
          if (!open) {
            setViewingVersion(null)
            setShowDiff(false)
          }
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {viewingVersionLoading
                ? 'Loading...'
                : viewingVersion
                  ? `v${viewingVersion.versionNumber} - ${viewingVersion.title}`
                  : 'Version'}
            </DialogTitle>
            {viewingVersion ? (
              <DialogDescription>
                {viewingVersion.actorName.trim()
                  ? `Saved by ${viewingVersion.actorName} on ${formatDateTime(viewingVersion.createdAt)}`
                  : `Saved ${formatDateTime(viewingVersion.createdAt)}`}
                {viewingVersion.changeSummary ? ` - ${viewingVersion.changeSummary}` : ''}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {viewingVersionLoading ? (
              <div className="grid gap-3 p-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-40" />
              </div>
            ) : viewingVersion ? (
              <div className="grid gap-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <PostStatusBadge status={viewingVersion.status} />
                  <span className="font-mono text-xs text-muted-foreground">{viewingVersion.slug}</span>
                </div>
                {viewingVersion.excerpt ? (
                  <p className="text-sm italic text-muted-foreground">{viewingVersion.excerpt}</p>
                ) : null}
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-mono text-[11px] font-medium text-muted-foreground">
                      {showDiff
                        ? viewingIsPinned
                          ? `Public v${viewingVersion.versionNumber} → current tip`
                          : 'Diff vs current'
                        : 'Markdown'}
                    </p>
                    <Button
                      type="button"
                      variant={showDiff ? 'default' : 'outline'}
                      size="sm"
                      className="gap-1.5"
                      aria-pressed={showDiff}
                      onClick={() => setShowDiff((v) => !v)}
                    >
                      Compare with current
                    </Button>
                  </div>
                  {showDiff ? (
                    <div className="max-h-64 overflow-y-auto rounded-lg bg-muted/40 p-2 font-mono text-xs leading-relaxed">
                      {diffLines(viewingVersion.contentMarkdown, post?.contentMarkdown ?? '').map(
                        (line: DiffLine, i: number) => {
                          const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
                          const rowClass =
                            line.type === 'add'
                              ? 'bg-brand-bright/10 text-brand-bright-foreground dark:text-primary'
                              : line.type === 'del'
                                ? 'bg-destructive/10 text-destructive'
                                : 'text-muted-foreground'
                          return (
                            <div key={i} className={`flex gap-2 px-1 ${rowClass}`}>
                              <span className="w-4 shrink-0 select-none text-center">{sign}</span>
                              <span className="whitespace-pre-wrap break-words">
                                {line.text || '\u00A0'}
                              </span>
                            </div>
                          )
                        },
                      )}
                    </div>
                  ) : (
                    <pre className="max-h-64 overflow-y-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {viewingVersion.contentMarkdown}
                    </pre>
                  )}
                </div>
                {viewingVersion.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {viewingVersion.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end border-t border-[color:var(--hairline)] pt-3">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                Close
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
