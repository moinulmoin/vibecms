'use client'

import type { Asset, Post, PostVersion, PostVersionSummary } from '@vc/core'
import { THEME_PRESETS, resolvePresetId } from '@vc/config'
import { Field, FieldDescription, FieldLabel, Input, Select, Textarea } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  archivePostMutation,
  createPostMutation,
  getPostVersionFn,
  listPostVersionsFn,
  loadPostEditorPage,
  publishPostMutation,
  restorePostVersionFn,
  updatePostMutation,
} from '~/server/posts-page-fn'
import { Button, PageHeader, Panel, formatDateTime } from '~/components/dashboard/DashboardLayout'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { Switch } from '~/components/ui/switch'
import { MarkdownEditor, PostSlugFromTitle, UnsavedChangesGuard, serializeForm } from '~/components/dashboard/MarkdownEditor'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { emptyPostsListSearch, emptyPostEditorSearch, postEditorSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { CounterClockwiseClockIcon, EyeOpenIcon, ResetIcon } from '@radix-ui/react-icons'
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
  const [selectedLayout, setSelectedLayout] = useState<string>('standard')
  const [selectedToc, setSelectedToc] = useState<boolean>(false)
  const [presentationDirty, setPresentationDirty] = useState(false)
  const [hasPriorPresentation, setHasPriorPresentation] = useState(false)

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
    void loadPostEditorPage({ data: { postId } })
      .then((result) => {
        if (cancelled) return
        setPost(result.post)
        setAssets(result.assets)
        setMissing(result.missing)
        setPresetId(result.presetId)
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
        ? await updatePostMutation({ data: { postId, ...payload, presentation } })
        : await createPostMutation({ data: { ...payload, presentation } })
      if (result.kind === 'ok' && !postId && result.postId) {
        await navigate({
          to: '/dashboard/posts/$postId/edit',
          params: { postId: result.postId },
          search: postEditorSearch({ ok: result.code }),
        })
        const refreshed = await loadPostEditorPage({ data: { postId: result.postId } })
        setPost(refreshed.post)
        setAssets(refreshed.assets)
        setMissing(refreshed.missing)
        setHasPriorPresentation(presentation !== null)
        setPresentationDirty(false)
        return
      }
      const editorSearch = postEditorSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
      if (postId) {
        await navigate({ to: '/dashboard/posts/$postId/edit', params: { postId }, search: editorSearch })
        if (result.kind === 'ok') {
          const refreshed = await loadPostEditorPage({ data: { postId } })
          setPost(refreshed.post)
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

  // Persist the open editor form before a programmatic action (publish/archive)
  // so unsaved edits are never silently discarded. Returns false if the save was
  // attempted and failed (caller should stop).
  async function persistIfDirty(): Promise<boolean> {
    const form = formRef.current
    if (!postId || !form || !isFormDirty()) return true
    if (!form.checkValidity()) {
      form.reportValidity()
      return false
    }
    const payload = payloadFromForm(new FormData(form))
    const presentation =
      !presentationDirty && !hasPriorPresentation ? null : { layout: selectedLayout, toc: selectedToc }
    const result = await updatePostMutation({ data: { postId, ...payload, presentation } })
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
    return true
  }

  async function handlePublish() {
    if (!postId) return
    setPublishPending(true)
    try {
      if (!(await persistIfDirty())) return
      const result = await publishPostMutation({ data: { postId } })
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
      if (!(await persistIfDirty())) return
      const result = await archivePostMutation({ data: { postId } })
      await navigate({
        to: '/dashboard/posts',
        search: statusSearchFromMutation(result),
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
      const result = await listPostVersionsFn({ data: { postId } })
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
      const v = await getPostVersionFn({ data: { postId, versionNumber } })
      setViewingVersion(v)
    } catch {
      setViewDialogOpen(false)
    } finally {
      setViewingVersionLoading(false)
    }
  }

  async function handleRestoreVersion(versionNumber: number) {
    if (!postId) return
    setRestoreVersionPending(versionNumber)
    try {
      const result = await restorePostVersionFn({ data: { postId, versionNumber } })
      if (result.kind === 'ok') {
        const refreshed = await loadPostEditorPage({ data: { postId } })
        setPost(refreshed.post)
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
      }
    } finally {
      setRestoreVersionPending(null)
    }
  }

  if (loading) {
    return <EditorSkeleton />
  }

  const statusKicker = post ? post.status : 'New post'
  const capability = THEME_PRESETS[resolvePresetId(presetId)].layout

  return (
    <>
      <PageHeader
        kicker={statusKicker}
        title={post ? 'Edit Post' : 'Create Post'}
        description="Write in Markdown, attach a cover image, and keep every save versioned for rollback and audit history."
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard/posts" search={emptyPostsListSearch}>Back to posts</Link>
          </Button>
        }
      />
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
          <Panel title="Draft">
            <div className="grid gap-4">
              <Field>
                <FieldLabel
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                  htmlFor="post-markdown"
                >
                  Markdown
                </FieldLabel>
                <MarkdownEditor
                  assets={assets}
                  defaultValue={post?.contentMarkdown ?? ''}
                  presetId={presetId}
                  presentation={{ layout: selectedLayout, toc: selectedToc }}
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-tags"
                  >
                    Tags
                  </FieldLabel>
                  <Input id="post-tags" name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(', ') ?? ''} />
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-cover"
                  >
                    Cover Image
                  </FieldLabel>
                  <Select id="post-cover" name="coverAssetId" defaultValue={post?.coverAssetId ?? ''}>
                    <option value="">No cover image</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}
                      </option>
                    ))}
                  </Select>
                </Field>
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
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                        className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                {post && post.status !== 'published' ? (
                  <PendingSubmitButton
                    type="button"
                    pending={publishPending}
                    pendingText="Publishing…"
                    onClick={() => void handlePublish()}
                  >
                    Publish
                  </PendingSubmitButton>
                ) : null}
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
                          <ul className="divide-y">
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
                                  {v.actorName} &middot; {relativeTime(v.createdAt)}
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
                Saved by {viewingVersion.actorName} on {formatDateTime(viewingVersion.createdAt)}
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
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {showDiff ? 'Diff vs current' : 'Markdown'}
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
                    <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
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
          <div className="flex justify-end border-t pt-3">
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