import type { Asset, Post, PostVersionSummary } from '@vc/core'
import { THEME_PRESETS, resolvePresetId } from '@vc/config'
import { renderRichContent } from '@vc/content'
import { Button, Skeleton } from '@vc/ui'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, ExternalLink, PanelRightClose, PanelRightOpen, Send, SlidersHorizontal } from 'lucide-react'
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Panel } from '~/components/dashboard/blocks'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { useMediaQuery } from '~/hooks/use-media-query'
import {
  archivePostMutation,
  createPostMutation,
  loadPostEditorPage,
  publishPostMutation,
  restorePostVersionFn,
  updatePostMutation,
} from '~/lib/api-client'
import { emptyPostsListSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import { hasPendingChanges, isAgentActor } from '~/lib/post-review'
import type { EditorSiteInfo, PostEditorPageLoad } from '~/types/dashboard'
import type { PostSnapshot } from './DiffView'
import { PostActionError, postErrorMessage } from './editor-errors'
import { PostMetadataRail, type EditorMetadata } from './PostMetadataRail'
import { parseTags } from './post-fields'
import { PreviewPane } from './PreviewPane'
import { PublishDialog } from './PublishDialog'
import { ReviewView } from './ReviewView'
import { uploadEditorMedia } from './media-upload'
import { useAutosave } from './use-autosave'
import { VersionHistory } from './VersionHistory'

const MarkdownSource = lazy(() => import('./MarkdownSource').then((module) => ({ default: module.MarkdownSource })))
const RichCanvas = lazy(() => import('./RichCanvas').then((module) => ({ default: module.RichCanvas })))

export type EditorLiveState = 'new' | 'draft' | 'unpublished' | 'live' | 'archived'
type EditorView = 'review' | 'edit' | 'split' | 'preview'
type EditorSurface = 'visual' | 'markdown'

const VIEW_STORAGE_KEY = 'vc-editor-view'
const RAIL_STORAGE_KEY = 'vc-editor-rail'
const SPLIT_STORAGE_KEY = 'vc-editor-split'

export function shouldShowPublishAction(post: Pick<Post, 'status' | 'publishedVersionNumber'> | null, currentVersionNumber: number | null) {
  return Boolean(post && post.status !== 'archived' && (post.status !== 'published' || currentVersionNumber !== post.publishedVersionNumber))
}

export function editorLiveState(post: Pick<Post, 'status' | 'publishedVersionNumber'> | null, currentVersionNumber: number | null): EditorLiveState {
  if (!post) return 'new'
  if (post.status === 'archived') return 'archived'
  if (post.status === 'draft') return 'draft'
  return currentVersionNumber !== post.publishedVersionNumber ? 'unpublished' : 'live'
}

/** Waiting on a human decision: unpublished changes to a live post, or an agent's draft. */
export function editorNeedsReview(post: Pick<Post, 'status' | 'publishedVersionNumber'> | null, currentVersionNumber: number | null, tip: Pick<PostVersionSummary, 'actorType'> | null) {
  if (!post || currentVersionNumber == null) return false
  if (hasPendingChanges({ status: post.status, versionNumber: currentVersionNumber, publishedVersionNumber: post.publishedVersionNumber })) return true
  return post.status === 'draft' && isAgentActor(tip?.actorType)
}

export function slugifyPostTitle(title: string) {
  return title.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
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
  return error instanceof Error ? error.message : 'Something went wrong. Your writing is safe here — try again.'
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode); preferences are optional.
  }
}

const STATE_LABEL: Record<EditorLiveState, string> = {
  new: 'New',
  draft: 'Draft',
  unpublished: 'Unpublished changes',
  live: 'Live',
  archived: 'Archived',
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

function SplitPane({ ratio, onRatio, left, right }: { ratio: number; onRatio: (ratio: number) => void; left: ReactNode; right: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const clamp = (value: number) => Math.min(0.72, Math.max(0.28, value))

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const move = (moveEvent: PointerEvent) => onRatio(clamp((moveEvent.clientX - rect.left) / rect.width))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onRatio(clamp(ratio + (event.key === 'ArrowLeft' ? -0.04 : 0.04)))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onRatio(event.key === 'Home' ? 0.28 : 0.72)
    }
  }

  return (
    <div
      ref={containerRef}
      className="grid items-start"
      style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) 1.5rem minmax(0, ${1 - ratio}fr)` }}
    >
      <div className="min-w-0">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize writing and preview"
        aria-valuemin={28}
        aria-valuemax={72}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onRatio(0.5)}
        className="group sticky top-32 flex h-[calc(100dvh-9rem)] cursor-col-resize touch-none justify-center outline-none"
      >
        <span className="w-px bg-[color:var(--hairline)] transition-colors group-hover:bg-ring group-focus-visible:w-0.5 group-focus-visible:bg-ring" />
      </div>
      <div className="sticky top-32 h-[calc(100dvh-9rem)] min-w-0">{right}</div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center rounded-lg border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors ${value === option.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function PostEditorShell({ postId }: { postId?: string }) {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
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
  const [view, setView] = useState<EditorView>(() => readStored(VIEW_STORAGE_KEY, ['edit', 'split', 'preview'] as const, 'edit'))
  const [surface, setSurface] = useState<EditorSurface>('visual')
  const [mobileSettings, setMobileSettings] = useState(false)
  // Split view is tight next to the rail, so it remembers its own preference (closed by default).
  const [railPrefs, setRailPrefs] = useState(() => ({
    normal: readStored(RAIL_STORAGE_KEY, ['open', 'closed'] as const, 'open') === 'open',
    split: readStored(`${RAIL_STORAGE_KEY}-split`, ['open', 'closed'] as const, 'closed') === 'open',
  }))
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY))
      return stored >= 0.28 && stored <= 0.72 ? stored : 0.5
    } catch {
      return 0.5
    }
  })
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savePending, setSavePending] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishVersion, setPublishVersion] = useState<number | null>(null)
  const [publishPending, setPublishPending] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [archivePending, setArchivePending] = useState(false)
  const [restorePending, setRestorePending] = useState<number | null>(null)
  const [discardPending, setDiscardPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [conflict, setConflict] = useState<EditorConflict | null>(null)
  const [unsafeSyntax, setUnsafeSyntax] = useState(false)
  const [surfaceNotice, setSurfaceNotice] = useState<string | null>(null)
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const notesRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!notesOpen) return
    const close = (event: PointerEvent) => {
      if (!notesRef.current?.contains(event.target as Node)) setNotesOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [notesOpen])
  const [safetyCheckPending, setSafetyCheckPending] = useState(false)
  const [slugTouched, setSlugTouched] = useState(Boolean(postId))
  const loadedRef = useRef(false)
  const dirtyBaselineRef = useRef('')
  const serializedRef = useRef('')
  const mutationInFlightRef = useRef(false)
  const assetsRef = useRef<Asset[]>([])
  assetsRef.current = assets
  // Read by saves that run back-to-back before React re-renders.
  const versionRef = useRef<number | null>(null)
  const activePostIdRef = useRef<string | undefined>(postId)
  const activePostId = postId ?? savedPostId
  activePostIdRef.current = activePostId ?? activePostIdRef.current

  const setVersion = useCallback((version: number | null) => {
    versionRef.current = version
    setCurrentVersionNumber(version)
  }, [])

  const capability = THEME_PRESETS[resolvePresetId(presetId)].layout
  const serialized = useMemo(() => serializeEditorState(content, metadata), [content, metadata])
  serializedRef.current = serialized
  const autosaveEnabled = Boolean(
    loadedRef.current
    && !conflict
    && !publishPending
    && !archivePending
    && !discardPending
    && restorePending == null
    && (activePostId ? currentVersionNumber != null : metadata.title.trim().length > 0),
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
    setVersion(result.currentVersionNumber)
    setMissing(result.missing)
    return nextPreset
  }, [setVersion])

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
    if (firstLoad && editorNeedsReview(result.post, result.currentVersionNumber, result.latestVersion)) {
      setView('review')
    }
    loadedRef.current = true
    const nextSerialized = serializeEditorState(nextContent, nextMetadata)
    serializedRef.current = nextSerialized
    dirtyBaselineRef.current = nextSerialized
    return { content: nextContent, metadata: nextMetadata, version: result.currentVersionNumber }
  }, [applyServerPage])

  const persistDraft = useCallback(async (value: string) => {
    if (mutationInFlightRef.current) throw new Error('Another save is still in progress.')
    const parsed = JSON.parse(value) as { content: string; metadata: EditorMetadata }
    const title = parsed.metadata.title.trim()
    const fields = {
      title,
      slug: parsed.metadata.slug.trim() || slugifyPostTitle(title),
      excerpt: parsed.metadata.excerpt.trim(),
      contentMarkdown: parsed.content,
      coverAssetId: parsed.metadata.coverAssetId || null,
      seoTitle: parsed.metadata.seoTitle.trim(),
      seoDescription: parsed.metadata.seoDescription.trim(),
      canonicalUrl: parsed.metadata.canonicalUrl.trim() || null,
      tags: parsed.metadata.tags,
      presentation: { layout: parsed.metadata.layout, toc: parsed.metadata.toc },
    }
    mutationInFlightRef.current = true
    try {
      const existingId = activePostIdRef.current
      if (!existingId) {
        if (!title) throw new Error('Add a title to save this post.')
        const result = await createPostMutation({ ...fields, excerpt: fields.excerpt || undefined, seoTitle: fields.seoTitle || undefined, seoDescription: fields.seoDescription || undefined })
        if (result.kind !== 'ok' || !result.postId) throw new PostActionError(result.code, 'save')
        const newId = result.postId
        activePostIdRef.current = newId
        setSavedPostId(newId)
        setVersion(result.versionNumber ?? 1)
        dirtyBaselineRef.current = value
        // Keep the writer in place: swap the URL without remounting the editor.
        try {
          window.history.replaceState(window.history.state, '', `/dashboard/posts/${newId}/edit`)
        } catch {
          // Non-browser environments keep the /new URL; the post is still saved.
        }
        void loadPostEditorPage({ postId: newId }).then((page) => {
          setPost(page.post)
          setLatestVersion(page.latestVersion)
        }).catch(() => {})
        return { versionNumber: result.versionNumber ?? 1 }
      }
      const expected = versionRef.current
      if (expected == null) throw new Error('This post is still loading. Try again in a moment.')
      const result = await updatePostMutation({ postId: existingId, expectedVersionNumber: expected, ...fields })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new PostActionError(result.code, 'save')
      }
      const nextVersion = result.versionNumber ?? expected
      setVersion(nextVersion)
      setLatestVersion((current) => ({
        versionNumber: nextVersion,
        title,
        slug: fields.slug,
        status: current?.status ?? 'draft',
        changeSummary: current?.versionNumber === nextVersion && current.actorType === 'human' ? current.changeSummary : null,
        actorType: 'human',
        actorName: current?.versionNumber === nextVersion && current.actorType === 'human' ? current.actorName : '',
        createdAt: current?.versionNumber === nextVersion ? current.createdAt : Math.floor(Date.now() / 1000),
      }))
      dirtyBaselineRef.current = value
      return { versionNumber: nextVersion }
    } finally {
      mutationInFlightRef.current = false
    }
  }, [setVersion])

  const captureConflict = useCallback(async (error: unknown) => {
    const postIdNow = activePostIdRef.current
    if (!(error instanceof EditorVersionConflict) || !postIdNow) {
      setActionError(friendlyError(error))
      return
    }
    try {
      const latest = await loadPostEditorPage({ postId: postIdNow })
      setConflict({ latest })
      setActionError(null)
    } catch {
      setActionError('This post changed elsewhere. Your writing is kept here, but the latest version could not be loaded.')
    }
  }, [])

  const autosave = useAutosave({
    serialized,
    enabled: autosaveEnabled,
    save: persistDraft,
    onSaved: () => setActionError(null),
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
      if (!cancelled) setLoadError('Could not load this post.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
    // The autosave instance is stable for the duration of this load effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyLoadedPage, postId])

  /** Save now (Cmd/Ctrl+S or form submit). Autosave covers everything else. */
  const saveNow = useCallback(async () => {
    if (conflict) {
      setActionError('Choose which version to keep before saving.')
      return false
    }
    if (!activePostIdRef.current && !metadata.title.trim()) {
      setActionError('Add a title to save this post.')
      return false
    }
    setActionError(null)
    setSavePending(true)
    try {
      const saved = await autosave.flush()
      return saved
    } catch (error) {
      await captureConflict(error)
      return false
    } finally {
      setSavePending(false)
    }
  }, [autosave, captureConflict, conflict, metadata.title])

  function saveCurrent(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    void saveNow()
  }

  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNowRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function openPublish() {
    setPublishError(null)
    setActionError(null)
    const saved = await saveNow()
    if (!saved || versionRef.current == null || !activePostIdRef.current) {
      if (saved) setActionError('Save the post before publishing.')
      return
    }
    setPublishVersion(versionRef.current)
    setPublishOpen(true)
  }

  async function handlePublish() {
    const postIdNow = activePostIdRef.current
    const approvedVersion = publishVersion
    if (!postIdNow || approvedVersion == null) return
    if (serializedRef.current !== dirtyBaselineRef.current || versionRef.current !== approvedVersion) {
      setPublishError('The post changed after you opened this. Close and review the latest version.')
      return
    }
    const approvedSnapshot = serializedRef.current
    setPublishPending(true)
    setPublishError(null)
    try {
      const result = await publishPostMutation({ postId: postIdNow, expectedVersionNumber: approvedVersion })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new PostActionError(result.code, 'publish')
      }
      const refreshed = await loadPostEditorPage({ postId: postIdNow })
      if (refreshed.post?.publishedVersionNumber !== approvedVersion) {
        throw new Error('Published, but the live version could not be confirmed. Refresh before publishing again.')
      }
      if (serializedRef.current === approvedSnapshot) {
        const applied = applyLoadedPage(refreshed)
        autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
      } else {
        applyServerPage(refreshed)
        autosave.markSaved(approvedSnapshot, refreshed.currentVersionNumber)
      }
      setPublishOpen(false)
      setView((current) => (current === 'review' ? 'edit' : current))
      setActionSuccess(`v${approvedVersion} is live.`)
    } catch (error) {
      if (error instanceof EditorVersionConflict) {
        setPublishOpen(false)
        await captureConflict(error)
      } else {
        setPublishError(friendlyError(error))
      }
    } finally {
      setPublishPending(false)
    }
  }

  async function handleArchive() {
    const postIdNow = activePostIdRef.current
    if (!postIdNow) return
    setActionError(null)
    const saved = await saveNow()
    if (!saved) return
    setArchivePending(true)
    try {
      const result = await archivePostMutation({ postId: postIdNow })
      if (result.kind !== 'ok') throw new PostActionError(result.code, 'archive')
      dirtyBaselineRef.current = serializedRef.current
      await navigate({ to: '/dashboard/posts', search: statusSearchFromMutation(result) })
    } catch (error) {
      await captureConflict(error)
    } finally {
      setArchivePending(false)
    }
  }

  /** Restore a version as the new tip; optionally re-pin it live (discarding pending changes). */
  async function restoreVersion(versionNumber: number, options: { republish?: boolean } = {}) {
    const postIdNow = activePostIdRef.current
    if (!postIdNow) return
    const saved = await saveNow()
    if (!saved || versionRef.current == null) return
    const beforeRestore = serializedRef.current
    setActionError(null)
    try {
      const result = await restorePostVersionFn({ postId: postIdNow, versionNumber, expectedVersionNumber: versionRef.current })
      if (result.kind !== 'ok') {
        if (result.code === 'version_conflict') throw new EditorVersionConflict()
        throw new PostActionError(result.code, 'restore')
      }
      if (options.republish && result.versionNumber != null) {
        const published = await publishPostMutation({ postId: postIdNow, expectedVersionNumber: result.versionNumber })
        if (published.kind !== 'ok') throw new PostActionError(published.code, 'publish')
      }
      const refreshed = await loadPostEditorPage({ postId: postIdNow })
      if (serializedRef.current === beforeRestore) {
        const applied = applyLoadedPage(refreshed)
        autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
        setActionSuccess(options.republish ? 'Changes discarded. The live post is unchanged.' : `Restored v${versionNumber} as the newest draft.`)
      } else {
        applyServerPage(refreshed)
        setConflict({ latest: refreshed })
      }
    } catch (error) {
      await captureConflict(error)
    }
  }

  async function handleRestore(versionNumber: number) {
    setRestorePending(versionNumber)
    try {
      await restoreVersion(versionNumber)
    } finally {
      setRestorePending(null)
    }
  }

  async function handleDiscard(baselineVersion: number, republish: boolean) {
    setDiscardPending(true)
    try {
      await restoreVersion(baselineVersion, { republish })
      setView('edit')
    } finally {
      setDiscardPending(false)
    }
  }

  function loadLatestAfterConflict() {
    if (!conflict) return
    const applied = applyLoadedPage(conflict.latest)
    autosave.markSaved(serializeEditorState(applied.content, applied.metadata), applied.version)
    setActionSuccess(`Loaded the latest version${applied.version ? `, v${applied.version}` : ''}.`)
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
    setActionSuccess('Your version is kept on top of the latest one and will save as the next version.')
  }

  async function copyLocalConflictMarkdown() {
    if (!conflict) return
    const local = JSON.parse(serializedRef.current) as { content: string }
    await navigator.clipboard.writeText(local.content)
    setActionSuccess('Your Markdown is copied.')
  }

  const uploadMedia = useCallback((file: File, altText?: string) => uploadEditorMedia(file, altText, () => assetsRef.current, (nextAssets) => {
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
    if (unsafe) {
      setSurface((current) => {
        if (current === 'visual') setSurfaceNotice('Switched to Markdown so this stays exactly as written. Nothing was lost.')
        return 'markdown'
      })
    }
  }, [])
  const pasteUnsafeMarkdown = useCallback((markdown: string) => {
    setContent((current) => `${current}${current && !current.endsWith('\n') ? '\n\n' : ''}${markdown}`)
    setUnsafeSyntax(true)
    setSurface('markdown')
    setSurfaceNotice('Pasted in Markdown mode to keep the original source exactly.')
  }, [])
  const updateMetadata = useCallback((field: keyof EditorMetadata, value: string | boolean) => {
    if (field === 'slug') setSlugTouched(true)
    setMetadata((current) => ({ ...current, [field]: value }))
  }, [])
  // Once a post has been live its URL is public: never let a title edit move it.
  const slugLocked = slugTouched || Boolean(post && (post.status !== 'draft' || post.publishedVersionNumber != null))
  const updateTitle = useCallback((title: string) => {
    setMetadata((current) => ({ ...current, title, slug: !slugLocked ? slugifyPostTitle(title) : current.slug }))
  }, [slugLocked])

  async function selectSurface(next: EditorSurface) {
    if (next === 'markdown' || !unsafeSyntax) {
      setSurface(next)
      setSurfaceNotice(null)
      return
    }
    setSafetyCheckPending(true)
    try {
      const { visualMarkdownSafety } = await import('./md-adapter')
      const safety = visualMarkdownSafety(serializedRef.current ? (JSON.parse(serializedRef.current) as { content: string }).content : '')
      if (!safety.safe) {
        setSurfaceNotice('Some of this Markdown (like HTML or custom blocks) can only be edited as Markdown. It still previews and publishes normally.')
        return
      }
      setUnsafeSyntax(false)
      setSurfaceNotice(null)
      setSurface('visual')
    } catch {
      setSurfaceNotice('Could not check the visual editor. Your Markdown is unchanged.')
    } finally {
      setSafetyCheckPending(false)
    }
  }

  function selectView(next: EditorView) {
    setView(next)
    setMobileSettings(false)
    if (next !== 'review') writeStored(VIEW_STORAGE_KEY, next)
  }

  function toggleRail() {
    if (!isDesktop) {
      setMobileSettings((current) => !current)
      return
    }
    const key = view === 'split' ? 'split' : 'normal'
    setRailPrefs((current) => {
      writeStored(key === 'split' ? `${RAIL_STORAGE_KEY}-split` : RAIL_STORAGE_KEY, current[key] ? 'closed' : 'open')
      return { ...current, [key]: !current[key] }
    })
  }

  const updateSplit = useCallback((ratio: number) => {
    setSplitRatio(ratio)
    writeStored(SPLIT_STORAGE_KEY, ratio.toFixed(3))
  }, [])

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
      tags: parseTags(metadata.tags),
    }
  }, [assets, metadata])

  const currentSnapshot = useMemo<PostSnapshot>(() => ({
    title: metadata.title,
    slug: metadata.slug,
    excerpt: metadata.excerpt || null,
    tags: parseTags(metadata.tags),
    coverAssetId: metadata.coverAssetId || null,
    seoTitle: metadata.seoTitle || null,
    seoDescription: metadata.seoDescription || null,
    canonicalUrl: metadata.canonicalUrl || null,
    layout: metadata.layout || null,
    toc: metadata.toc,
    contentMarkdown: content,
  }), [content, metadata])

  if (loading) return <div className="grid gap-4"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-[34rem] rounded-xl" /></div>
  if (loadError) {
    return (
      <Panel title="Could not load this post">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </Panel>
    )
  }
  if (missing) return <Panel title="Post not found"><p className="text-sm text-muted-foreground">This post no longer exists.</p></Panel>

  const liveState = editorLiveState(post, currentVersionNumber)
  const autosaveLabel = !activePostId
    ? metadata.title.trim() ? (autosave.status === 'saving' ? 'Saving…' : 'Not saved yet') : 'Add a title to start saving'
    : autosave.status === 'saving' || savePending
      ? 'Saving…'
      : autosave.status === 'error'
        ? 'Not saved'
        : autosave.status === 'saved'
          ? `Saved · v${currentVersionNumber ?? autosave.savedVersion ?? ''}`
          : 'Editing…'
  const reviewAvailable = editorNeedsReview(post, currentVersionNumber, latestVersion)
  const publishActionVisible = Boolean(activePostId && shouldShowPublishAction(post, currentVersionNumber))
  const liveUrl = publicBaseUrl && metadata.slug && (post?.publishedVersionNumber == null || post.publishedSlug) ? `${publicBaseUrl}/${post?.publishedVersionNumber == null ? metadata.slug : post.publishedSlug}` : null
  const effectiveView: EditorView = view === 'review' && !reviewAvailable ? 'edit' : view === 'split' && !isDesktop ? 'edit' : view
  const railOpen = effectiveView === 'split' ? railPrefs.split : railPrefs.normal
  const showRail = isDesktop ? railOpen && effectiveView !== 'review' : mobileSettings
  const siteTheme = site ? { accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } : undefined
  const publishBlockedReason = conflict ? 'Choose which version to keep first.' : null

  const viewOptions: Array<{ value: EditorView; label: string }> = [
    ...(reviewAvailable ? [{ value: 'review' as const, label: 'Review' }] : []),
    { value: 'edit', label: 'Write' },
    ...(isDesktop ? [{ value: 'split' as const, label: 'Split' }] : []),
    { value: 'preview', label: 'Preview' },
  ]

  const renderPreview = (fill: boolean) => (
    <PreviewPane
      fill={fill}
      subscribeSettings={site?.newsletterSettings ?? null}
      onWarnings={setPreviewWarnings}
      source={content}
      metadata={previewMetadata}
      presetId={presetId}
      presentation={{ layout: metadata.layout, toc: metadata.toc }}
      site={site}
      publishedAt={post?.publishedAt}
      updatedAt={post?.updatedAt}
    />
  )
  const preview = renderPreview(false)
  const notes = [...new Set([...renderWarnings, ...(effectiveView === 'edit' ? [] : previewWarnings)])]

  const writing = (
    <div className={`${effectiveView === 'split' ? '' : 'mx-auto max-w-[46rem]'} grid gap-3`}>
      {/* Writing mode sits above the title, where a writer looks first; any
          notice about switching modes reads next to it. */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <Segmented
          label="Editor"
          value={surface}
          onChange={(next) => void selectSurface(next)}
          options={[
            { value: 'visual', label: safetyCheckPending ? 'Checking…' : 'Visual' },
            { value: 'markdown', label: 'Markdown' },
          ]}
        />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" role="status">{surfaceNotice ?? ''}</p>
      </div>
      <input
        id="post-title"
        name="title"
        required
        maxLength={160}
        value={metadata.title}
        onChange={(event) => updateTitle(event.currentTarget.value)}
        placeholder="Title"
        aria-label="Post title"
        className={`w-full border-0 bg-transparent font-display text-3xl font-bold tracking-[-0.03em] text-foreground placeholder:text-muted-foreground/45 focus:outline-none sm:text-[2.5rem] sm:leading-tight ${
          // BlockNote indents blocks for its drag handles; line the title up with the body.
          surface === 'visual' ? 'pl-[54px]' : ''
        }`}
      />
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-xl" />}>
        {surface === 'visual' ? (
          <RichCanvas source={content} assets={assets} presetId={presetId} siteTheme={siteTheme} uploadFile={editorUpload} onChange={setContent} onUnsafeSyntax={unsafeChanged} onUnsafeMarkdownPaste={pasteUnsafeMarkdown} />
        ) : (
          <MarkdownSource value={content} onChange={setContent} uploadFile={editorUpload} />
        )}
      </Suspense>
    </div>
  )

  const main = effectiveView === 'review' && activePostId && post && currentVersionNumber != null ? (
    <ReviewView
      postId={activePostId}
      post={post}
      currentVersionNumber={currentVersionNumber}
      tip={latestVersion}
      current={currentSnapshot}
      assets={assets}
      preview={preview}
      canPublish={!conflict && !publishPending}
      publishBlockedReason={publishBlockedReason}
      discardPending={discardPending}
      onPublish={() => void openPublish()}
      onDiscard={(baseline, republish) => void handleDiscard(baseline, republish)}
      onEdit={() => selectView('edit')}
    />
  ) : effectiveView === 'preview' ? (
    <div className="mx-auto w-full max-w-[64rem]">{preview}</div>
  ) : effectiveView === 'split' ? (
    <SplitPane ratio={splitRatio} onRatio={updateSplit} left={writing} right={renderPreview(true)} />
  ) : writing

  return (
    <form className="grid gap-4" onSubmit={saveCurrent}>
      <Dialog
        open={navigationBlocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && navigationBlocker.status === 'blocked') navigationBlocker.reset()
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave before saving?</DialogTitle>
            <DialogDescription>Your latest edits have not saved yet. Leaving now discards them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => navigationBlocker.status === 'blocked' && navigationBlocker.reset()}>Keep editing</Button>
            <Button type="button" variant="destructive" onClick={() => navigationBlocker.status === 'blocked' && navigationBlocker.proceed()}>Discard and leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        versionNumber={publishVersion}
        liveVersionNumber={post?.status === 'published' ? post.publishedVersionNumber : null}
        liveUrl={liveUrl}
        warnings={notes}
        pending={publishPending}
        error={publishError}
        onConfirm={() => void handlePublish()}
      />
      <h1 className="sr-only">{activePostId ? `Edit ${metadata.title || 'post'}` : 'New post'}</h1>

      <header className="sticky z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color:var(--hairline)] bg-background/95 px-1 py-2.5 backdrop-blur top-14">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/dashboard/posts" search={emptyPostsListSearch}><ArrowLeft aria-hidden="true" className="size-4" /> Posts</Link>
        </Button>
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${liveState === 'live' ? 'bg-brand-bright' : liveState === 'unpublished' ? 'bg-warning' : 'bg-muted-foreground/40'}`} />
          <span className="text-foreground">{STATE_LABEL[liveState]}</span>
          <span role="status" className={`hidden truncate sm:inline ${autosave.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>· {autosaveLabel}</span>
          {autosave.status === 'error' ? <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={autosave.retry}>Retry</Button> : null}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          <Segmented label="View" value={effectiveView} onChange={selectView} options={viewOptions} />
          {post?.status === 'published' && liveUrl ? (
            <Button asChild variant="ghost" size="sm">
              <a href={liveUrl} target="_blank" rel="noreferrer" title="Open the live post">
                <ExternalLink aria-hidden="true" className="size-4" /><span className="sr-only">Open live post</span>
              </a>
            </Button>
          ) : null}
          {activePostId ? (
            <VersionHistory
              postId={activePostId}
              post={post}
              current={currentSnapshot}
              currentVersionNumber={currentVersionNumber}
              assets={assets}
              restorePending={restorePending}
              restoreBlocked={savePending || publishPending || archivePending || autosave.status === 'saving'}
              onRestore={(version) => void handleRestore(version)}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isDesktop ? railOpen : mobileSettings}
            title={isDesktop ? (railOpen ? 'Hide post settings' : 'Show post settings') : 'Post settings'}
            onClick={toggleRail}
            disabled={isDesktop && effectiveView === 'review'}
          >
            {isDesktop ? (railOpen ? <PanelRightClose aria-hidden className="size-4" /> : <PanelRightOpen aria-hidden className="size-4" />) : <SlidersHorizontal aria-hidden className="size-4" />}
            <span className="sr-only">Post settings</span>
          </Button>
          {notes.length > 0 ? (
            <div
              className="relative"
              ref={notesRef}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNotesOpen(false)
              }}
            >
              <Button type="button" variant="ghost" size="sm" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
                <AlertTriangle aria-hidden className="size-4 text-warning" /> {notes.length === 1 ? '1 note' : `${notes.length} notes`}
              </Button>
              {notesOpen ? (
                <div role="dialog" aria-label="Notes before publishing" className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-border bg-popover p-3 text-sm shadow-[var(--shadow-menu)]">
                  <p className="font-medium text-foreground">Check before publishing</p>
                  <ul className="mt-1.5 list-disc space-y-1 ps-5 text-muted-foreground">
                    {notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {(publishActionVisible && effectiveView !== 'review') || !activePostId ? (
            <Button type="button" size="sm" disabled={publishPending || Boolean(conflict) || (!activePostId && !metadata.title.trim())} onClick={() => void openPublish()}>
              <Send aria-hidden="true" className="size-4" /> {currentVersionNumber ? `Publish v${currentVersionNumber}` : 'Publish'}
            </Button>
          ) : null}
        </div>
      </header>

      {conflict ? (
        <section role="alert" className="rounded-lg border border-warning/35 bg-warning/10 p-4">
          <p className="font-medium text-foreground">A newer version was saved elsewhere</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Your writing is kept here and autosave is paused. The post is now on {conflict.latest.currentVersionNumber ? `v${conflict.latest.currentVersionNumber}` : 'a newer version'}{conflict.latest.latestVersion?.actorName ? `, saved by ${conflict.latest.latestVersion.actorName}` : ''}. Choose which one continues.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={reapplyLocalAfterConflict}>Keep mine</Button>
            <SpaConfirmButton type="button" size="sm" variant="outline" confirmLabel="Discard mine?" helperText="Copy your Markdown first if you may need it." onConfirm={loadLatestAfterConflict}>Use theirs</SpaConfirmButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => void copyLocalConflictMarkdown()}>Copy my Markdown</Button>
          </div>
        </section>
      ) : null}
      {actionError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{actionError}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button>
        </div>
      ) : null}
      {actionSuccess ? (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden />
          {actionSuccess}
          {actionSuccess.endsWith('is live.') && liveUrl ? <a className="text-primary underline-offset-4 hover:underline" href={liveUrl} target="_blank" rel="noreferrer">View post</a> : null}
        </p>
      ) : null}

      <div className={showRail && isDesktop ? 'grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]' : 'grid'}>
        {!isDesktop && mobileSettings ? null : <div className="min-w-0">{main}</div>}
        {showRail ? (
          <div className="min-w-0 lg:sticky lg:top-32 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pr-1">
            <PostMetadataRail
              metadata={metadata}
              assets={assets}
              publicBaseUrl={publicBaseUrl}
              supportedLayouts={capability.supportedLayouts}
              supportsToc={capability.supportsToc}
              contentMarkdown={deferredContent}
              onChange={updateMetadata}
              onUploadCover={coverUpload}
            />
            {post && post.status !== 'archived' ? (
              <div className="mt-7 border-t border-[color:var(--hairline)] pt-5">
                <SpaConfirmButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-3 text-muted-foreground"
                  confirmLabel="Archive this post?"
                  pendingLabel="Archiving…"
                  helperText="It leaves your blog. History is kept, and you can restore it."
                  disabled={archivePending}
                  onConfirm={() => handleArchive()}
                >
                  Archive post
                </SpaConfirmButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  )
}
