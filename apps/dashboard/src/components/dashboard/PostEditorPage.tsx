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
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { Switch } from '~/components/ui/switch'
import { MarkdownEditor, PostSlugFromTitle, UnsavedChangesGuard, serializeForm } from '~/components/dashboard/MarkdownEditor'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import type { EditorSiteInfo } from '~/types/dashboard'
import { emptyDashboardStatusSearch, emptyPostsListSearch, emptyPostEditorSearch, postEditorSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { CounterClockwiseClockIcon, EyeOpenIcon, ResetIcon, UploadIcon } from '@radix-ui/react-icons'
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

/**
 * The review strip's single source of truth for "what is public right now".
 * 'unpublished' = the saved tip is ahead of the pinned public version — the
 * exact state where a human review decision is required.
 */
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
  if (status === 'published') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 capitalize text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        {status}
      </Badge>
    )
  }
  if (status === 'archived') {
    return (
      <Badge variant="outline" className="gap-1.5 border-dashed capitalize text-muted-foreground/70">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        {status}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

/**
 * The review strip: what is public right now, who changed what last, and the
 * publish decision — in one calm line between the header and the work surface.
 * Renders only for an existing post (new posts have no public state to report).
 */
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
  const unpublishedCount =
    state === 'unpublished' && currentVersionNumber != null && post.publishedVersionNumber != null
      ? currentVersionNumber - post.publishedVersionNumber
      : 0
  const liveUrl =
    post.status === 'published' && publicBaseUrl ? `${publicBaseUrl}/${post.slug}` : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/50 px-4 py-3">
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        v{currentVersionNumber ?? '—'}
      </span>
      {state === 'live' ? (
        <span className="flex items-center gap-1.5 font-mono text-xs text-primary">
          <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
          All changes live
        </span>
      ) : state === 'unpublished' ? (
        <span className="flex items-center gap-1.5 font-mono text-xs text-amber-600 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {unpublishedCount > 0
            ? `${unpublishedCount} unpublished ${unpublishedCount === 1 ? 'change' : 'changes'}`
            : 'Unpublished changes'}
        </span>
      ) : state === 'draft' ? (
        <span className="font-mono text-xs text-muted-foreground">Draft — nothing public yet</span>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">Archived — hidden from the public blog</span>
      )}
      {latestVersion ? (
        <span className="font-mono text-xs text-muted-foreground">
          Last saved {relativeTime(latestVersion.createdAt)}
          {latestVersion.actorName.trim() ? ` by ${latestVersion.actorName}` : ''}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {state === 'unpublished' ? (
          <Button type="button" variant="outline" size="sm" onClick={onReviewChanges}>
            Review changes
          </Button>
        ) : null}
        {liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-primary underline-offset-4 hover:underline"
          >
            Open live ↗
          </a>
        ) : null}
        {shouldShowPublishAction(post, currentVersionNumber) ? (
          <PendingSubmitButton
            type="button"
            size="sm"
            pending={publishPending}
            pendingText="Publishing…"
            onClick={onPublish}
          >
            {post.status === 'published' ? 'Publish changes' : 'Publish'}
          </PendingSubmitButton>
        ) : null}
      </span>
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

// Live character counter for a capped field; reads the input by id and listens
// to input events so the surrounding form stays uncontrolled.
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
  // Track the editor form so Publish/Archive can persist unsaved edits first
  // (they navigate programmatically and would otherwise discard them).
  const formRef = useRef<HTMLFormElement>(null)
  const baselineRef = useRef<string>('')
  const captureBaseline = () => {
    if (formRef.current) baselineRef.current = serializeForm(formRef.current)
  }
  const isFormDirty = () =>
    presentationDirty || (formRef.current ? serializeForm(formRef.current) !== baselineRef.current : false)

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

  // Snapshot the saved form state once it has rendered, so isFormDirty() and the
  // Publish/Archive save-first logic compare against the persisted baseline.
  useEffect(() => {
    if (!loading && !missing) captureBaseline()
    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [loading, missing, formKey, post])
  async function handleCoverUpload() {
    const file = coverFileInputRef.current?.files?.[0]
    const altText = coverAltInputRef.current?.value.trim() ?? ''
    if (!file || !altText) {
      setCoverUploadError('Choose an image and describe it before uploading.')
      return
    }

    const form = new FormData()
    form.set('file', file)
    form.set('altText', altText)
    setCoverUploadPending(true)
    setCoverUploadError(null)
    try {
      const priorIds = new Set(assets.map((asset) => asset.id))
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (response.status === 401) {
        await navigate({ to: '/login' })
        return
      }
      const result = parseMutationResultJson(await response.json())
      if (result.kind !== 'ok') {
        setCoverUploadError(result.code === 'upload_too_large'
          ? `Images must be ${MEDIA.maxImageLabel} or smaller.`
          : 'The image could not be uploaded. Check the file type and try again.')
        return
      }
      const loaded = await loadMediaPage()
      setAssets(loaded.assets)
      const uploaded = loaded.assets.find((asset) => !priorIds.has(asset.id)) ?? loaded.assets[0]
      if (uploaded) setSelectedCoverAssetId(uploaded.id)
      if (coverFileInputRef.current) coverFileInputRef.current.value = ''
      if (coverAltInputRef.current) coverAltInputRef.current.value = ''
    } catch {
      setCoverUploadError('The image could not be uploaded. Try again.')
    } finally {
      setCoverUploadPending(false)
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }
    setSavePending(true)
    try {
      const payload = payloadFromForm(new FormData(form))
      const presentation =
        !presentationDirty && !hasPriorPresentation
          ? null
          : { layout: selectedLayout, toc: selectedToc }
      const result = postId
        ? currentVersionNumber == null
          ? { kind: 'error' as const, code: 'unknown' }
          : await updatePostMutation({ postId, expectedVersionNumber: currentVersionNumber, ...payload, presentation })
        : await createPostMutation({ ...payload, presentation })
      if (result.kind === 'ok' && !postId && result.postId) {
        await navigate({
          to: '/dashboard/posts/$postId/edit',
          params: { postId: result.postId },
          search: postEditorSearch({ ok: result.code }),
        })
        const refreshed = await loadPostEditorPage({ postId: result.postId })
        setPost(refreshed.post)
        setAssets(refreshed.assets)
        setMissing(refreshed.missing)
        setSite(refreshed.site)
        setLatestVersion(refreshed.latestVersion)
        setPublicBaseUrl(refreshed.publicBaseUrl)
        setCurrentVersionNumber(refreshed.currentVersionNumber)
        setHasPriorPresentation(presentation !== null)
        setPresentationDirty(false)
        return
      }
      const editorSearch = postEditorSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
      if (postId) {
        await navigate({ to: '/dashboard/posts/$postId/edit', params: { postId }, search: editorSearch })
        if (result.kind === 'ok') {
          const refreshed = await loadPostEditorPage({ postId })
          setPost(refreshed.post)
          setSite(refreshed.site)
          setLatestVersion(refreshed.latestVersion)
          setPublicBaseUrl(refreshed.publicBaseUrl)
          setCurrentVersionNumber(refreshed.currentVersionNumber)
          setHasPriorPresentation(presentation !== null)
          setPresentationDirty(false)
        }
      } else {
        await navigate({ to: '/dashboard/posts/new', search: editorSearch })
      }
    } finally {
      setSavePending(false)
    }
  }

  async function persistIfDirty(): Promise<number | null | false> {
    const form = formRef.current
    if (!postId || !form || !isFormDirty()) return currentVersionNumber
    if (!form.checkValidity()) {
      form.reportValidity()
      return false
    }
    const payload = payloadFromForm(new FormData(form))
    const presentation =
      !presentationDirty && !hasPriorPresentation ? null : { layout: selectedLayout, toc: selectedToc }
    if (currentVersionNumber == null) return false
    const result = await updatePostMutation({
      postId,
      expectedVersionNumber: currentVersionNumber,
      ...payload,
      presentation,
    })
    if (result.kind !== 'ok') {
      await navigate({
        to: '/dashboard/posts/$postId/edit',
        params: { postId },
        search: postEditorSearch({ error: result.code }),
      })
      return false
    }
    setHasPriorPresentation(presentation !== null)
    setPresentationDirty(false)
    captureBaseline()
    const savedVersionNumber = result.versionNumber ?? null
    setCurrentVersionNumber(savedVersionNumber)
    return savedVersionNumber
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

  // Review-before-publish: open the pinned public version diffed against the
  // saved tip, so the decision is made on evidence, not blind trust.
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

  if (loading) {
    return <EditorSkeleton />
  }

  const capability = THEME_PRESETS[resolvePresetId(presetId)].layout
  const selectedCoverAsset = assets.find((asset) => asset.id === selectedCoverAssetId) ?? null
  const viewingIsPinned =
    viewingVersion != null &&
    post?.publishedVersionNumber != null &&
    viewingVersion.versionNumber === post.publishedVersionNumber

  return (
    <>
      <PageHeader
        kicker={post ? undefined : 'New post'}
        title={post ? 'Edit post' : 'Create post'}
        description="Write in Markdown, then check the exact public page in Preview before you publish."
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard/posts" search={emptyPostsListSearch}>Back to posts</Link>
          </Button>
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
          <Panel title="Content">
            <div className="grid gap-4">
              <Field>
                <FieldLabel
                  className="font-mono text-[11px] font-medium text-muted-foreground"
                  htmlFor="post-title"
                >
                  Title
                </FieldLabel>
                <Input
                  id="post-title"
                  className="h-11 font-display text-lg font-semibold tracking-[-0.02em]"
                  name="title"
                  required
                  maxLength={160}
                  defaultValue={post?.title ?? ''}
                />
              </Field>
              <Field>
                <FieldLabel
                  className="font-mono text-[11px] font-medium text-muted-foreground"
                  htmlFor="post-markdown"
                >
                  Markdown
                </FieldLabel>
                <MarkdownEditor
                  assets={assets}
                  defaultValue={post?.contentMarkdown ?? ''}
                  presetId={presetId}
                  presentation={{ layout: selectedLayout, toc: selectedToc }}
                  site={site}
                  siteTheme={site ? { accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } : undefined}
                  publishedAt={post?.publishedAt ?? null}
                />
                <FieldDescription className="font-sans">
                  Markdown is rendered with the same safe renderer as the public blog.
                </FieldDescription>
              </Field>
            </div>
          </Panel>
          <aside className="grid gap-3 lg:sticky lg:top-6">
            <Panel title="Publish Settings" meta={<PostStatusBadge status={post?.status ?? 'draft'} />}>
              <div className="grid gap-4">
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium text-muted-foreground"
                    htmlFor="post-slug"
                  >
                    Slug
                  </FieldLabel>
                  <Input
                    id="post-slug"
                    className="font-mono text-sm"
                    name="slug"
                    required
                    maxLength={120}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    aria-describedby="post-slug-help"
                    defaultValue={post?.slug ?? ''}
                  />
                  <FieldDescription id="post-slug-help" className="font-sans">
                    Lowercase letters, numbers, and hyphens.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium text-muted-foreground"
                    htmlFor="post-excerpt"
                  >
                    Excerpt
                  </FieldLabel>
                  <Textarea id="post-excerpt" name="excerpt" maxLength={500} rows={4} defaultValue={post?.excerpt ?? ''} />
                  <div className="flex justify-end">
                    <CharCounter targetId="post-excerpt" max={500} />
                  </div>
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium text-muted-foreground"
                    htmlFor="post-tags"
                  >
                    Tags
                  </FieldLabel>
                  <Input id="post-tags" name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(', ') ?? ''} />
                </Field>
            <Field>
              <FieldLabel htmlFor="post-cover">Featured image</FieldLabel>
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
              <FieldDescription>
                Appears above the article and becomes its Open Graph and Twitter image.
              </FieldDescription>
              {selectedCoverAsset ? (
                <div className="flex min-w-0 items-center gap-3 pt-1">
                  <img
                    src={`/media-assets/${selectedCoverAsset.id}`}
                    alt=""
                    className="h-20 w-32 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-foreground">{selectedCoverAsset.filename}</p>
                    <p className="text-muted-foreground">
                      {selectedCoverAsset.width && selectedCoverAsset.height
                        ? `${selectedCoverAsset.width} × ${selectedCoverAsset.height}`
                        : 'Dimensions unavailable'}
                    </p>
                    {selectedCoverAsset.altText ? (
                      <p className="line-clamp-2 text-muted-foreground">{selectedCoverAsset.altText}</p>
                    ) : (
                      <p className="text-destructive">
                        Add alt text in <Link to="/dashboard/media" search={emptyDashboardStatusSearch} className="underline underline-offset-4">Media</Link> before publishing.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
              <details className="rounded-lg bg-muted/50 p-3">
                <summary className="cursor-pointer font-mono text-[11px] font-medium text-foreground marker:text-muted-foreground">
                  Upload a new image
                </summary>
                <div className="grid gap-3 pt-3">
                  <Field>
                    <FieldLabel htmlFor="post-cover-upload">Image</FieldLabel>
                    <Input
                      ref={coverFileInputRef}
                      id="post-cover-upload"
                      type="file"
                      accept={MEDIA.mimeTypes.join(',')}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="post-cover-upload-alt">Alt text</FieldLabel>
                    <Input
                      ref={coverAltInputRef}
                      id="post-cover-upload-alt"
                      maxLength={180}
                      placeholder="Describe what the image shows"
                    />
                  </Field>
                  {coverUploadError ? (
                    <p className="text-sm text-destructive" role="alert">{coverUploadError}</p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={coverUploadPending}
                    onClick={() => void handleCoverUpload()}
                  >
                    <UploadIcon className="size-4" aria-hidden="true" />
                    {coverUploadPending ? 'Uploading…' : 'Upload and select'}
                  </Button>
                </div>
              </details>
            </Field>
                <details className="rounded-xl bg-muted/50 p-3">
                  <summary className="cursor-pointer font-mono text-[11px] font-medium text-foreground marker:text-muted-foreground">
                    Search & sharing
                  </summary>
                  <FieldDescription className="mt-1 font-sans">
                    Optional overrides fall back to your post title and excerpt.
                  </FieldDescription>
                  <div className="grid gap-4 pt-4">
                    <Field>
                      <FieldLabel
                        className="font-mono text-[11px] font-medium text-muted-foreground"
                        htmlFor="post-seo-title"
                      >
                        SEO Title <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                      </FieldLabel>
                      <Input
                        id="post-seo-title"
                        name="seoTitle"
                        maxLength={70}
                        defaultValue={post?.seoTitle ?? ''}
                        placeholder="Falls back to the post title"
                      />
                      <div className="flex justify-end">
                        <CharCounter targetId="post-seo-title" max={70} />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel
                        className="font-mono text-[11px] font-medium text-muted-foreground"
                        htmlFor="post-seo-description"
                      >
                        SEO Description <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                      </FieldLabel>
                      <Textarea
                        id="post-seo-description"
                        name="seoDescription"
                        maxLength={180}
                        rows={3}
                        defaultValue={post?.seoDescription ?? ''}
                        placeholder="Falls back to the excerpt"
                      />
                      <div className="flex justify-end">
                        <CharCounter targetId="post-seo-description" max={180} />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel
                        className="font-mono text-[11px] font-medium text-muted-foreground"
                        htmlFor="post-canonical-url"
                      >
                        Canonical URL <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                      </FieldLabel>
                      <Input
                        id="post-canonical-url"
                        name="canonicalUrl"
                        type="text"
                        maxLength={2048}
                        defaultValue={post?.canonicalUrl ?? ''}
                        placeholder="Overrides the default canonical URL for SEO"
                      />
                    </Field>
                  </div>
                </details>
                <p className="rounded-xl bg-muted/50 p-3 font-sans text-sm leading-6 text-muted-foreground">
                  Every save creates a post version and activity event, whether the change comes from you, an API token, or
                  an agent.
                </p>
              </div>
            </Panel>
            <Panel title="Presentation">
              <div className="grid gap-4">
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium text-muted-foreground"
                    htmlFor="post-layout"
                  >
                    Layout
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
                  <FieldDescription className="font-sans">
                    Controls the article structure on the public blog.
                  </FieldDescription>
                </Field>
                {capability.supportsToc ? (
                  <Field>
                    <div className="flex items-center gap-3">
                      <Switch
                        id="post-toc"
                        checked={selectedToc}
                        onCheckedChange={(checked) => { setSelectedToc(checked); setPresentationDirty(true) }}
                      />
                      <FieldLabel
                        className="font-mono text-[11px] font-medium text-muted-foreground"
                        htmlFor="post-toc"
                      >
                        Table of contents
                      </FieldLabel>
                    </div>
                    <FieldDescription className="font-sans">
                      Inserts a TOC block above the article body.
                    </FieldDescription>
                  </Field>
                ) : null}
              </div>
            </Panel>
            <Panel title="Actions">
              <div className="grid gap-2">
                <PendingSubmitButton pending={savePending} pendingText="Saving…">
                  Save draft
                </PendingSubmitButton>
                {post && post.status !== 'archived' ? (
                  <SpaConfirmButton
                    confirmLabel="Confirm archive"
                    helperText="Archiving hides this post from the public blog."
                    disabled={archivePending}
                    onConfirm={() => void handleArchive()}
                  >
                    Archive
                  </SpaConfirmButton>
                ) : null}
                {postId ? (
                  <Sheet
                    open={versionDrawerOpen}
                    onOpenChange={(open) => void handleVersionDrawerOpenChange(open)}
                  >
                    <SheetTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-start gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <CounterClockwiseClockIcon className="size-4" aria-hidden="true" />
                        Version history
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
                      <SheetHeader>
                        <SheetTitle>Version history</SheetTitle>
                        <SheetDescription>
                          Past saved versions of this post. Restore to roll back content to a previous state.
                        </SheetDescription>
                      </SheetHeader>
                      <Separator />
                      <div className="flex-1 overflow-y-auto">
                        {versionsLoading ? (
                          <div className="grid gap-3 p-4">
                            <Skeleton className="h-16 rounded-lg" />
                            <Skeleton className="h-16 rounded-lg" />
                            <Skeleton className="h-16 rounded-lg" />
                          </div>
                        ) : versions.length === 0 ? (
                          <p className="p-4 text-sm text-muted-foreground">No versions saved yet.</p>
                        ) : (
                          <ul className="divide-y divide-[color:var(--hairline)]">
                            {versions.map((v) => (
                              <li key={v.versionNumber} className="flex flex-col gap-2 p-4">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-xs">
                                    v{v.versionNumber}
                                  </Badge>
                                  <PostStatusBadge status={v.status} />
                                </div>
                                <p className="text-sm font-medium leading-snug">{v.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {v.actorName.trim() ? `${v.actorName} · ` : ''}
                                  {relativeTime(v.createdAt)}
                                </p>
                                {v.changeSummary ? (
                                  <p className="text-xs italic text-muted-foreground">{v.changeSummary}</p>
                                ) : null}
                                <div className="flex gap-1.5 pt-1">
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
                                    helperText="This overwrites the current draft content with this version."
                                    disabled={restoreVersionPending !== null}
                                    onConfirm={() => void handleRestoreVersion(v.versionNumber)}
                                  >
                                    <ResetIcon className="size-3.5" aria-hidden="true" />
                                    Restore
                                  </SpaConfirmButton>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </SheetContent>
                  </Sheet>
                ) : null}
              </div>
            </Panel>
          </aside>
        </form>
      )}
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
                {viewingVersion.seoTitle || viewingVersion.seoDescription ? (
                  <div className="grid gap-1.5">
                    {viewingVersion.seoTitle ? (
                      <p className="text-sm">
                        <span className="font-medium">SEO title: </span>
                        {viewingVersion.seoTitle}
                      </p>
                    ) : null}
                    {viewingVersion.seoDescription ? (
                      <p className="text-sm">
                        <span className="font-medium">SEO description: </span>
                        {viewingVersion.seoDescription}
                      </p>
                    ) : null}
                  </div>
                ) : null}
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