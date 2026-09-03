'use client'

import type { Asset, Post, PostVersionSummary } from '@vc/core'
import { THEME_PRESETS, resolvePresetId } from '@vc/config'
import { renderRichContent } from '@vc/content'
import { Button, Skeleton } from '@vc/ui'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { Archive, ArrowLeft, ExternalLink, Save, Send } from 'lucide-react'
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Panel } from '~/components/dashboard/blocks'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import {
  archivePostMutation,
  createPostMutation,
  loadPostEditorPage,
  publishPostMutation,
  restorePostVersionFn,
  updatePostMutation,
} from '~/lib/api-client'
import { emptyPostsListSearch, postEditorSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import type { EditorSiteInfo, PostEditorPageLoad } from '~/types/dashboard'
import { PostMetadataRail, type EditorMetadata } from './PostMetadataRail'
import { PreviewPane } from './PreviewPane'
import { uploadEditorMedia } from './media-upload'
import { useAutosave } from './use-autosave'
import { VersionHistory } from './VersionHistory'

const MarkdownSource = lazy(() => import('./MarkdownSource').then((module) => ({ default: module.MarkdownSource })))
const RichCanvas = lazy(() => import('./RichCanvas').then((module) => ({ default: module.RichCanvas })))

export type EditorLiveState = 'new' | 'draft' | 'unpublished' | 'live' | 'archived'
export const EDITOR_TABS = ['write', 'source', 'preview', 'settings'] as const
type EditorMode = (typeof EDITOR_TABS)[number]

export function shouldShowPublishAction(post: Pick<Post, 'status' | 'publishedVersionNumber'> | null, currentVersionNumber: number | null) {
  return Boolean(post && post.status !== 'archived' && (post.status !== 'published' || currentVersionNumber !== post.publishedVersionNumber))
}

export function editorLiveState(post: Pick<Post, 'status' | 'publishedVersionNumber'> | null, currentVersionNumber: number | null): EditorLiveState {
  if (!post) return 'new'
  if (post.status === 'archived') return 'archived'
  if (post.status === 'draft') return 'draft'
  return currentVersionNumber !== post.publishedVersionNumber ? 'unpublished' : 'live'
}

export function slugifyPostTitle(title: string) {
  return title.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

function metadataFromPost(post: Post | null, layout: string, toc: boolean): EditorMetadata {
  return {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    tags: post?.tags.join(', ') ?? '',
    excerpt: post?.excerpt ?? '',
    coverAssetId: post?.coverAssetId ?? '',
    layout,
    toc,
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
    canonicalUrl: post?.canonicalUrl ?? '',
  }
}

function serializeEditorState(content: string, metadata: EditorMetadata) {
  return JSON.stringify({ content, metadata })
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

function stateLabel(state: EditorLiveState) {
  return state === 'unpublished' ? 'Unpublished' : state.charAt(0).toUpperCase() + state.slice(1)
}

class EditorVersionConflict extends Error {
  constructor() {
    super('This post changed elsewhere while you were editing.')
    this.name = 'EditorVersionConflict'
  }
}

type EditorConflict = {
  latest: PostEditorPageLoad
}

export function PostEditorShell({ postId }: { postId?: string }) {
  const navigate = useNavigate()
  const [savedPostId, setSavedPostId] = useState<string | undefined>(postId)
  const [post, setPost] = useState<Post | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [site, setSite] = useState<EditorSiteInfo | null>(null)
  const [presetId, setPresetId] = useState('minimal')
  const [publicBaseUrl, setPublicBaseUrl] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<PostVersionSummary | null>(null)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [metadata, setMetadata] = useState<EditorMetadata>(() => metadataFromPost(null, 'standard', false))
  const [mode, setMode] = useState<EditorMode>('write')
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savePending, setSavePending] = useState(false)
  const [publishPending, setPublishPending] = useState(false)
  const [archivePending, setArchivePending] = useState(false)
  const [restorePending, setRestorePending] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [conflict, setConflict] = useState<EditorConflict | null>(null)
  const [unsafeSyntax, setUnsafeSyntax] = useState(false)
  const [safetyCheckPending, setSafetyCheckPending] = useState(false)
  const [slugTouched, setSlugTouched] = useState(Boolean(postId))
  const loadedRef = useRef(false)
  const dirtyBaselineRef = useRef('')
  const serializedRef = useRef('')
  const mutationInFlightRef = useRef(false)
  const assetsRef = useRef<Asset[]>([])
  assetsRef.current = assets
  const activePostId = postId ?? savedPostId

  const capability = THEME_PRESETS[resolvePresetId(presetId)].layout
  const serialized = useMemo(() => serializeEditorState(content, metadata), [content, metadata])
  serializedRef.current = serialized
  const autosaveEnabled = Boolean(
    activePostId
    && currentVersionNumber != null
    && loadedRef.current
    && !conflict
    && !savePending
    && !publishPending
    && !archivePending
    && restorePending == null,
  )
  const deferredContent = useDeferredValue(content)
  const renderWarnings = useMemo(
    () => renderRichContent(deferredContent, { presetId, pageTitle: metadata.title }).warnings,
    [deferredContent, metadata.title, presetId],
  )

  const applyServerPage = useCallback((result: PostEditorPageLoad) => {
    const nextPreset = resolvePresetId(result.presetId)
    setPost(result.post)
    setAssets(result.assets)
    setSite(result.site)
    setPresetId(nextPreset)
    setPublicBaseUrl(result.publicBaseUrl)
    setLatestVersion(result.latestVersion)
    setCurrentVersionNumber(result.currentVersionNumber)
    setMissing(result.missing)
    return nextPreset
  }, [])

  const applyLoadedPage = useCallback((result: PostEditorPageLoad) => {
    const firstLoad = !loadedRef.current
    const nextPreset = applyServerPage(result)
    const nextCapability = THEME_PRESETS[nextPreset].layout
    const nextMetadata = metadataFromPost(result.post, result.post?.presentation?.layout ?? nextCapability.default.layout, result.post?.presentation?.toc ?? nextCapability.default.toc)
    const nextContent = result.post?.contentMarkdown ?? ''
    setMetadata(nextMetadata)
    setContent(nextContent)
    setActionError(null)
    setConflict(null)
    if (firstLoad && (result.latestVersion?.actorType === 'agent' || result.latestVersion?.actorType === 'api_key')) {
      setMode('source')
    }
    loadedRef.current = true
    const nextSerialized = serializeEditorState(nextContent, nextMetadata)
    serializedRef.current = nextSerialized
    dirtyBaselineRef.current = nextSerialized
    return { content: nextContent, metadata: nextMetadata, version: result.currentVersionNumber }
  }, [applyServerPage])

  const persistDraft = useCallback(async (value: string) => {
    if (!activePostId || currentVersionNumber == null) throw new Error('Save this new post before using autosave.')
    if (mutationInFlightRef.current) throw new Error('Another save is still in progress.')
    const parsed = JSON.parse(value) as { content: string; metadata: EditorMetadata }
    mutationInFlightRef.current = true
    try {
      const result = await updatePostMutation({
        postId: activePostId,
        expectedVersionNumber: currentVersionNumber,
        title: parsed.metadata.title.trim(),
        slug: parsed.metadata.slug.trim(),
        excerpt: parsed.metadata.excerpt.trim() || undefined,
        contentMarkdown: parsed.content,
        coverAssetId: parsed.metadata.coverAssetId || null,
        seoTitle: parsed.metadata.seoTitle.trim() || undefined,
        seoDescription: parsed.metadata.seoDescription.trim() || undefined,
        canonicalUrl: parsed.metadata.canonicalUrl.trim() || null,
        tags: parsed.metadata.tags,
        presentation: { layout: parsed.metadata.layout, toc: parsed.metadata.toc },
      })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new Error(`Save failed (${result.code}).`)
      }
      const nextVersion = result.versionNumber ?? currentVersionNumber
      setCurrentVersionNumber(nextVersion)
      dirtyBaselineRef.current = value
      return { versionNumber: nextVersion }
    } finally {
      mutationInFlightRef.current = false
    }
  }, [activePostId, currentVersionNumber])

  const captureConflict = useCallback(async (error: unknown) => {
    if (!(error instanceof EditorVersionConflict) || !activePostId) {
      setActionError(friendlyError(error))
      return
    }
    try {
      const latest = await loadPostEditorPage({ postId: activePostId })
      setConflict({ latest })
      setActionError(null)
    } catch {
      setActionError('This post changed elsewhere. Your local draft is preserved, but the latest version could not be loaded.')
    }
  }, [activePostId])

  const autosave = useAutosave({
    serialized,
    enabled: autosaveEnabled,
    save: persistDraft,
    onSaved: (result) => {
      if (result?.versionNumber != null) setCurrentVersionNumber(result.versionNumber)
    },
    onError: (error) => void captureConflict(error),
  })

  const shouldBlockNavigation = useCallback(
    () => loadedRef.current && serializedRef.current !== dirtyBaselineRef.current,
    [],
  )
  const navigationBlocker = useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: shouldBlockNavigation,
    withResolver: true,
  })

  useEffect(() => {
    let cancelled = false
    void loadPostEditorPage({ postId }).then((result) => {
      if (cancelled) return
      const applied = applyLoadedPage(result)
      autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
    }).catch(() => {
      if (!cancelled) setLoadError('Could not load this post. Refresh to try again.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
    // The autosave instance is stable for the duration of this load effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyLoadedPage, postId])

  async function saveCurrent(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (conflict) {
      setActionError('Resolve the version conflict before saving.')
      return
    }
    setActionError(null)
    setActionSuccess(null)
    setSavePending(true)
    const submitted = serializedRef.current
    const submittedDraft = JSON.parse(submitted) as { content: string; metadata: EditorMetadata }
    try {
      if (!activePostId) {
        const result = await createPostMutation({
          title: submittedDraft.metadata.title.trim(), slug: submittedDraft.metadata.slug.trim(), excerpt: submittedDraft.metadata.excerpt.trim() || undefined,
          contentMarkdown: submittedDraft.content, coverAssetId: submittedDraft.metadata.coverAssetId || null,
          seoTitle: submittedDraft.metadata.seoTitle.trim() || undefined, seoDescription: submittedDraft.metadata.seoDescription.trim() || undefined,
          canonicalUrl: submittedDraft.metadata.canonicalUrl.trim() || null, tags: submittedDraft.metadata.tags,
          presentation: { layout: submittedDraft.metadata.layout, toc: submittedDraft.metadata.toc },
        })
        if (result.kind !== 'ok' || !result.postId) throw new Error(`Save failed (${result.code}).`)
        setSavedPostId(result.postId)
        dirtyBaselineRef.current = submitted
        autosave.markSaved(submitted, result.versionNumber)
        const refreshed = await loadPostEditorPage({ postId: result.postId })
        if (serializedRef.current === submitted) {
          const applied = applyLoadedPage(refreshed)
          autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
          await navigate({ to: '/dashboard/posts/$postId/edit', params: { postId: result.postId }, search: postEditorSearch({ ok: result.code }) })
        } else {
          applyServerPage(refreshed)
          autosave.markSaved(submitted, refreshed.currentVersionNumber)
          setActionSuccess(`Saved${refreshed.currentVersionNumber ? ` v${refreshed.currentVersionNumber}` : ''}. Newer local changes remain unsaved.`)
        }
        return
      }
      const result = await persistDraft(submitted)
      autosave.markSaved(submitted, result.versionNumber)
      const refreshed = await loadPostEditorPage({ postId: activePostId })
      if (serializedRef.current === submitted) {
        const applied = applyLoadedPage(refreshed)
        autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
        await navigate({ to: '/dashboard/posts/$postId/edit', params: { postId: activePostId }, search: postEditorSearch({ ok: 'updated' }) })
      } else {
        applyServerPage(refreshed)
        autosave.markSaved(submitted, refreshed.currentVersionNumber)
        setActionSuccess(`Saved${refreshed.currentVersionNumber ? ` v${refreshed.currentVersionNumber}` : ''}. Newer local changes remain unsaved.`)
      }
    } catch (error) {
      await captureConflict(error)
    } finally {
      setSavePending(false)
    }
  }

  async function persistIfDirty() {
    if (!activePostId || currentVersionNumber == null) throw new Error('Save this post before publishing.')
    const submitted = serializedRef.current
    if (submitted === dirtyBaselineRef.current) return currentVersionNumber
    const result = await persistDraft(submitted)
    autosave.markSaved(submitted, result.versionNumber)
    return result.versionNumber ?? currentVersionNumber
  }

  async function handlePublish() {
    if (!activePostId || currentVersionNumber == null) return
    if (conflict) {
      setActionError('Resolve the version conflict before publishing.')
      return
    }
    if (serialized !== dirtyBaselineRef.current || autosave.status !== 'saved') {
      setActionError('Save the draft before approving it. Publishing never changes the version you reviewed.')
      return
    }
    const approvedVersion = currentVersionNumber
    const approvedSnapshot = serializedRef.current
    setPublishPending(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      const result = await publishPostMutation({ postId: activePostId, expectedVersionNumber: approvedVersion })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new Error(`Publish failed (${result.code}).`)
      }
      const refreshed = await loadPostEditorPage({ postId: activePostId })
      if (refreshed.post?.publishedVersionNumber !== approvedVersion) {
        throw new Error('The publish completed, but the live version could not be verified. Refresh before publishing again.')
      }
      if (serializedRef.current === approvedSnapshot) {
        const applied = applyLoadedPage(refreshed)
        autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
        setActionSuccess(`Published and verified v${approvedVersion} as the live version.`)
      } else {
        applyServerPage(refreshed)
        autosave.markSaved(approvedSnapshot, refreshed.currentVersionNumber)
        setActionSuccess(`Published and verified v${approvedVersion}. Newer local changes remain unsaved.`)
      }
    } catch (error) {
      await captureConflict(error)
    } finally {
      setPublishPending(false)
    }
  }

  async function handleArchive() {
    if (!activePostId) return
    setArchivePending(true)
    setActionError(null)
    try {
      await persistIfDirty()
      const result = await archivePostMutation({ postId: activePostId })
      if (result.kind !== 'ok') throw new Error(`Archive failed (${result.code}).`)
      await navigate({ to: '/dashboard/posts', search: statusSearchFromMutation(result) })
    } catch (error) {
      await captureConflict(error)
    } finally {
      setArchivePending(false)
    }
  }

  async function handleRestore(versionNumber: number) {
    if (!activePostId || currentVersionNumber == null) return
    if (serializedRef.current !== dirtyBaselineRef.current || autosave.status !== 'saved') {
      setActionError('Save your local changes before restoring a version.')
      return
    }
    const beforeRestore = serializedRef.current
    setRestorePending(versionNumber)
    setActionError(null)
    try {
      const result = await restorePostVersionFn({ postId: activePostId, versionNumber, expectedVersionNumber: currentVersionNumber })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new Error(`Restore failed (${result.code}).`)
      }
      const refreshed = await loadPostEditorPage({ postId: activePostId })
      if (serializedRef.current === beforeRestore) {
        const applied = applyLoadedPage(refreshed)
        autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
        setActionSuccess(`Restored v${versionNumber} as a new draft version.`)
      } else {
        applyServerPage(refreshed)
        setConflict({ latest: refreshed })
        setActionSuccess(null)
      }
    } catch (error) {
      await captureConflict(error)
    } finally {
      setRestorePending(null)
    }
  }

  function loadLatestAfterConflict() {
    if (!conflict) return
    const applied = applyLoadedPage(conflict.latest)
    autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
    setActionSuccess(`Loaded the latest saved version${applied.version ? `, v${applied.version}` : ''}.`)
  }

  function reapplyLocalAfterConflict() {
    if (!conflict) return
    const latest = conflict.latest
    const nextPreset = resolvePresetId(latest.presetId)
    const nextCapability = THEME_PRESETS[nextPreset].layout
    const latestMetadata = metadataFromPost(
      latest.post,
      latest.post?.presentation?.layout ?? nextCapability.default.layout,
      latest.post?.presentation?.toc ?? nextCapability.default.toc,
    )
    const latestSerialized = serializeEditorState(latest.post?.contentMarkdown ?? '', latestMetadata)
    applyServerPage(latest)
    dirtyBaselineRef.current = latestSerialized
    autosave.markSaved(latestSerialized, latest.currentVersionNumber)
    setConflict(null)
    setActionError(null)
    setActionSuccess('Your local draft is preserved on top of the latest version. Review it, then save again.')
  }

  async function copyLocalConflictMarkdown() {
    if (!conflict) return
    const local = JSON.parse(serializedRef.current) as { content: string }
    await navigator.clipboard.writeText(local.content)
    setActionSuccess('Local Markdown copied.')
  }

  const uploadMedia = useCallback((file: File, altText = file.name) => uploadEditorMedia(file, altText, assetsRef.current, (nextAssets) => {
    assetsRef.current = nextAssets
    setAssets(nextAssets)
  }, () => navigate({ to: '/login' })), [navigate])
  const editorUpload = useCallback(async (file: File) => {
    const asset = await uploadMedia(file)
    if (!asset) throw new Error('Upload did not return an image.')
    return `/media-assets/${asset.id}`
  }, [uploadMedia])
  const coverUpload = useCallback((file: File, altText: string) => uploadMedia(file, altText), [uploadMedia])
  const unsafeChanged = useCallback((unsafe: boolean) => {
    setUnsafeSyntax(unsafe)
    if (unsafe) setMode('source')
  }, [])
  const updateMetadata = useCallback((field: keyof EditorMetadata, value: string | boolean) => {
    if (field === 'slug') setSlugTouched(true)
    setMetadata((current) => ({ ...current, [field]: value }))
  }, [])
  const updateTitle = useCallback((title: string) => {
    setMetadata((current) => ({ ...current, title, slug: !slugTouched ? slugifyPostTitle(title) : current.slug }))
  }, [slugTouched])

  async function selectMode(nextMode: EditorMode) {
    if (nextMode !== 'write' || !unsafeSyntax) {
      setMode(nextMode)
      return
    }
    setSafetyCheckPending(true)
    try {
      const { visualMarkdownSafety } = await import('./md-adapter')
      const currentDraft = JSON.parse(serializedRef.current) as { content: string }
      const safety = visualMarkdownSafety(currentDraft.content)
      if (!safety.safe) {
        setActionError('Write mode still cannot round-trip this Markdown exactly. Keep editing in Source, then choose Write to check again.')
        return
      }
      setUnsafeSyntax(false)
      setActionError(null)
      setMode('write')
    } catch {
      setActionError('Could not verify visual editing safety. Your Markdown is unchanged; try again.')
    } finally {
      setSafetyCheckPending(false)
    }
  }

  useEffect(() => {
    if (serialized !== dirtyBaselineRef.current) setActionSuccess(null)
  }, [serialized])

  const previewMetadata = useMemo(() => {
    const cover = assets.find((asset) => asset.id === metadata.coverAssetId)
    return {
      title: metadata.title,
      excerpt: metadata.excerpt,
      coverAssetSrc: cover ? `/media-assets/${cover.id}` : undefined,
      coverAssetAlt: cover?.altText ?? undefined,
      coverAssetWidth: cover?.width ?? undefined,
      coverAssetHeight: cover?.height ?? undefined,
      tags: metadata.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    }
  }, [assets, metadata])

  if (loading) return <div className="grid gap-4"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-[34rem] rounded-xl" /></div>
  if (loadError) return <Panel title="Could not load post"><p className="text-sm text-muted-foreground">{loadError}</p></Panel>
  if (missing) return <Panel title="Post not found"><p className="text-sm text-muted-foreground">This post no longer exists.</p></Panel>

  const liveState = editorLiveState(post, currentVersionNumber)
  const autosaveLabel = !activePostId || currentVersionNumber == null
    ? 'Not saved yet'
    : autosave.status === 'saving'
      ? 'Saving…'
      : autosave.status === 'error'
        ? 'Unsaved — retry'
        : autosave.status === 'saved'
          ? `Saved · v${autosave.savedVersion ?? currentVersionNumber} · ${autosave.savedAt ? 'just now' : 'loaded'}`
          : 'Unsaved changes'
  const hasUnsavedChanges = serialized !== dirtyBaselineRef.current || autosave.status !== 'saved'
  const canPublishExact = !hasUnsavedChanges && !conflict && currentVersionNumber != null
  const currentActor = latestVersion?.versionNumber === currentVersionNumber && latestVersion.actorName.trim()
    ? latestVersion.actorName
    : null
  const publishSummary = currentVersionNumber == null
    ? 'Save the post before publishing.'
    : canPublishExact
      ? `Confirm you reviewed exact v${currentVersionNumber}${currentActor ? `, saved by ${currentActor}` : ''}. ${renderWarnings.length === 0 ? 'Preview has no renderer warnings.' : `${renderWarnings.length} renderer warning${renderWarnings.length === 1 ? '' : 's'} must be reviewed.`}`
      : 'Save all changes before reviewing the exact version to publish.'
  const publishActionVisible = Boolean(activePostId && shouldShowPublishAction(post, currentVersionNumber))

  return (
    <form className="grid gap-4" onSubmit={(event) => void saveCurrent(event)}>
      <Dialog
        open={navigationBlocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && navigationBlocker.status === 'blocked') navigationBlocker.reset()
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave with unsaved changes?</DialogTitle>
            <DialogDescription>Your latest local edits have not been saved. Leaving now will discard them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => navigationBlocker.status === 'blocked' && navigationBlocker.reset()}>Stay and keep editing</Button>
            <Button type="button" variant="destructive" onClick={() => navigationBlocker.status === 'blocked' && navigationBlocker.proceed()}>Discard and leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <h1 className="sr-only">{activePostId ? `Edit ${metadata.title || 'post'}` : 'New post'}</h1>
      <header className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 backdrop-blur lg:top-20">
        <Button asChild variant="ghost" size="sm"><Link to="/dashboard/posts" search={emptyPostsListSearch}><ArrowLeft aria-hidden="true" className="size-4" /> Posts</Link></Button>
        <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"><span className={`size-2 rounded-full ${liveState === 'live' ? 'bg-brand-bright' : liveState === 'unpublished' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />{stateLabel(liveState)}</span>
        <span role="status" className={`font-mono text-[11px] ${autosave.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{autosaveLabel}</span>
        {autosave.status === 'error' ? <Button type="button" variant="ghost" size="sm" onClick={autosave.retry}>Retry</Button> : null}
        <div className="ms-auto flex items-center gap-1.5">
          {post?.status === 'published' && publicBaseUrl ? <a href={`${publicBaseUrl}/${post.slug}`} target="_blank" rel="noreferrer" className="hidden font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline">Open live <ExternalLink aria-hidden="true" className="inline size-3" /></a> : null}
          {activePostId ? <VersionHistory compact postId={activePostId} post={post} currentContent={content} latestVersion={latestVersion} restorePending={restorePending} restoreBlocked={hasUnsavedChanges || savePending || publishPending || archivePending} onRestore={(version) => void handleRestore(version)} /> : null}
          <PendingSubmitButton size="sm" variant="outline" pending={savePending} pendingText="Saving…"><Save aria-hidden="true" className="size-4" /> Save</PendingSubmitButton>
          {publishActionVisible ? (
            <SpaConfirmButton
              size="sm"
              variant="default"
              confirmationKey={currentVersionNumber ?? 'unsaved'}
              confirmLabel={currentVersionNumber == null ? 'Confirm publish' : `Confirm v${currentVersionNumber}`}
              pendingLabel="Publishing…"
              helperText={publishSummary}
              disabled={publishPending || !canPublishExact}
              onConfirm={() => void handlePublish()}
            >
              <Send aria-hidden="true" className="size-4" /> {currentVersionNumber == null ? 'Publish' : `Publish v${currentVersionNumber}`}
            </SpaConfirmButton>
          ) : null}
        </div>
      </header>

      {publishActionVisible ? (
        <p className="px-1 font-mono text-[11px] leading-5 text-muted-foreground" role="status">
          Review gate · {publishSummary}
        </p>
      ) : null}

      {unsafeSyntax ? <div role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"><strong className="font-medium text-foreground">Source mode is protecting this Markdown.</strong> <span className="text-muted-foreground">Visual editing is unavailable while conversion would change exact bytes. Fix the syntax in Source, then choose Write to check again. Preview, version history, and publishing still work.</span></div> : null}
      {renderWarnings.length > 0 ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"><p className="font-medium">Review before publishing</p><ul className="mt-1 list-disc space-y-1 ps-5 text-muted-foreground">{renderWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {conflict ? (
        <section role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="font-medium text-foreground">A newer saved version exists</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Your local draft is preserved and autosave is paused. The server is now on {conflict.latest.currentVersionNumber ? `v${conflict.latest.currentVersionNumber}` : 'a newer version'}{conflict.latest.latestVersion?.actorName ? `, saved by ${conflict.latest.latestVersion.actorName}` : ''}. Choose which content should become the next version.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={reapplyLocalAfterConflict}>Keep mine as next version</Button>
            <SpaConfirmButton type="button" size="sm" variant="outline" confirmLabel="Discard mine and load latest" helperText="Your local Markdown will no longer be shown. Copy it first if you may need it." onConfirm={loadLatestAfterConflict}>Load latest</SpaConfirmButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => void copyLocalConflictMarkdown()}>Copy my Markdown</Button>
          </div>
        </section>
      ) : null}
      {actionError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><span>{actionError}</span><Button type="button" variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button></div> : null}
      {actionSuccess ? <div role="status" className="rounded-lg border border-brand-bright/30 bg-brand-bright/10 px-3 py-2 text-sm text-foreground">{actionSuccess}</div> : null}

      <nav className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1" aria-label="Editor mode">
        {EDITOR_TABS.map((item) => {
          const visualDisabled = item === 'write' && unsafeSyntax
          return <button key={item} type="button" aria-pressed={mode === item} disabled={visualDisabled && safetyCheckPending} title={visualDisabled ? 'Recheck whether this Markdown is safe for visual editing' : undefined} onClick={() => void selectMode(item)} className={`rounded-md px-3 py-1.5 font-mono text-xs capitalize transition-colors ${mode === item ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'} disabled:cursor-wait disabled:opacity-45 ${item === 'settings' ? 'md:hidden' : ''}`}>{visualDisabled && safetyCheckPending ? 'Checking…' : item}</button>
        })}
      </nav>

      <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {mode === 'write' ? <div className="mx-auto max-w-[50rem] space-y-4"><input id="post-title" name="title" required maxLength={160} value={metadata.title} onChange={(event) => updateTitle(event.currentTarget.value)} placeholder="Post title" aria-label="Post title" className="w-full border-0 bg-transparent font-display text-3xl font-bold tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none sm:text-[2.5rem]" /><p className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{publicBaseUrl && metadata.slug ? `${publicBaseUrl}/${metadata.slug}` : 'slug will generate from title'}</p><Suspense fallback={<Skeleton className="h-[32rem] rounded-xl" />}><RichCanvas source={content} assets={assets} presetId={presetId} siteTheme={site ? { accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } : undefined} uploadFile={editorUpload} onChange={setContent} onUnsafeSyntax={unsafeChanged} /></Suspense></div> : null}
          {mode === 'source' ? (
            <div className="mx-auto max-w-[50rem] space-y-4">
              <input id="post-title" name="title" required maxLength={160} value={metadata.title} onChange={(event) => updateTitle(event.currentTarget.value)} placeholder="Post title" aria-label="Post title" className="w-full border-0 bg-transparent font-display text-3xl font-bold tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none sm:text-[2.5rem]" />
              <p className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{publicBaseUrl && metadata.slug ? `${publicBaseUrl}/${metadata.slug}` : 'slug will generate from title'}</p>
              <Suspense fallback={<Skeleton className="h-[32rem] rounded-xl" />}><MarkdownSource value={content} onChange={setContent} uploadFile={editorUpload} /></Suspense>
            </div>
          ) : null}
          {mode === 'preview' ? <PreviewPane source={content} metadata={previewMetadata} presetId={presetId} presentation={{ layout: metadata.layout, toc: metadata.toc }} site={site} publishedAt={post?.publishedAt} updatedAt={post?.updatedAt} /> : null}
        </div>
        <div className={`${mode === 'settings' ? 'mt-4 block' : 'hidden'} min-w-0 md:mt-0 md:block`}>
          <PostMetadataRail
            metadata={metadata}
            assets={assets}
            publicBaseUrl={publicBaseUrl}
            supportedLayouts={capability.supportedLayouts}
            supportsToc={capability.supportsToc}
            onChange={updateMetadata}
            onUploadCover={coverUpload}
          />
          {post && post.status !== 'archived' ? (
            <div className="mt-6 border-t border-[color:var(--hairline)] pt-4">
              <SpaConfirmButton
                type="button"
                variant="outline"
                size="sm"
                confirmLabel="Confirm archive"
                helperText="Archiving hides this post from the public blog."
                disabled={archivePending}
                onConfirm={() => void handleArchive()}
              >
                <Archive aria-hidden="true" className="size-4" /> Archive post
              </SpaConfirmButton>
            </div>
          ) : null}
        </div>
      </div>
    </form>
  )
}
