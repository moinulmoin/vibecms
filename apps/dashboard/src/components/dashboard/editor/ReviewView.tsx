import type { Asset, Post, PostVersion, PostVersionSummary } from '@vc/core'
import { Button, Skeleton } from '@vc/ui'
import { Pencil, Send, Undo2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { formatDateTime, formatRelative } from '~/components/dashboard/DashboardLayout'
import { getPostVersionFn, listPostVersionsFn } from '~/lib/api-client'
import { isAgentActor } from '~/lib/post-review'
import { BodyDiff, MetadataDiff, metadataChanges, snapshotFromVersion, type PostSnapshot } from './DiffView'
import { ActorIcon } from './VersionHistory'

export type ReviewViewProps = {
  postId: string
  post: Pick<Post, 'status' | 'publishedVersionNumber'>
  currentVersionNumber: number
  tip: PostVersionSummary | null
  current: PostSnapshot
  assets: Asset[]
  preview: ReactNode
  canPublish: boolean
  publishBlockedReason: string | null
  discardPending: boolean
  onPublish: () => void
  onDiscard: (baselineVersion: number, republish: boolean) => void
  onEdit: () => void
}

type Baseline = { version: PostVersion; kind: 'live' | 'previous' } | null

/** Newest version written by someone other than the tip's author. */
async function findBaseline(postId: string, post: ReviewViewProps['post'], tip: PostVersionSummary | null, currentVersionNumber: number): Promise<Baseline> {
  if (post.status === 'published' && post.publishedVersionNumber != null && post.publishedVersionNumber < currentVersionNumber) {
    const live = await getPostVersionFn({ postId, versionNumber: post.publishedVersionNumber })
    return live ? { version: live, kind: 'live' } : null
  }
  const versions = await listPostVersionsFn({ postId })
  const tipIsAgent = isAgentActor(tip?.actorType)
  const previous = versions.find((version) => version.versionNumber < currentVersionNumber && isAgentActor(version.actorType) !== tipIsAgent)
  if (!previous) return null
  const version = await getPostVersionFn({ postId, versionNumber: previous.versionNumber })
  return version ? { version, kind: 'previous' } : null
}

export function ReviewView({
  postId,
  post,
  currentVersionNumber,
  tip,
  current,
  assets,
  preview,
  canPublish,
  publishBlockedReason,
  discardPending,
  onPublish,
  onDiscard,
  onEdit,
}: ReviewViewProps) {
  const [baseline, setBaseline] = useState<Baseline | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<'changes' | 'preview'>('changes')

  useEffect(() => {
    let cancelled = false
    setBaseline(undefined)
    setLoadError(false)
    findBaseline(postId, post, tip, currentVersionNumber)
      .then((result) => {
        if (cancelled) return
        setBaseline(result)
        if (!result) setTab('preview')
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [postId, post, tip, currentVersionNumber])

  const author = tip?.actorName.trim() || (isAgentActor(tip?.actorType) ? 'Your agent' : 'You')
  const isLiveBaseline = baseline?.kind === 'live'
  const changes = baseline ? metadataChanges(snapshotFromVersion(baseline.version), current, assets) : []
  const headline = isLiveBaseline
    ? `${author} changed this live post`
    : post.status === 'draft'
      ? `${author} wrote this draft`
      : `${author} changed this post`

  return (
    <section aria-label="Review changes" data-testid="review-view" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
            <span aria-hidden="true" className="inline-flex"><ActorIcon type={tip?.actorType} className="size-4 text-muted-foreground" /></span>
            {headline}
          </h2>
          <p className="text-sm text-muted-foreground">
            v{currentVersionNumber}
            {tip ? <> · <time title={formatDateTime(tip.createdAt)}>{formatRelative(tip.createdAt)}</time></> : null}
            {tip?.changeSummary ? <> · {tip.changeSummary}</> : null}
            {baseline ? <> · compared with {isLiveBaseline ? `live v${baseline.version.versionNumber}` : `v${baseline.version.versionNumber} by ${baseline.version.actorName.trim() || 'you'}`}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            <Pencil aria-hidden className="size-4" /> Edit
          </Button>
          {baseline ? (
            <SpaConfirmButton
              size="sm"
              variant="outline"
              confirmLabel={isLiveBaseline ? 'Discard and keep live?' : `Revert to v${baseline.version.versionNumber}?`}
              pendingLabel="Discarding…"
              helperText={isLiveBaseline
                ? `Live v${baseline.version.versionNumber} stays as it is. These changes remain in history.`
                : 'These changes remain in history.'}
              disabled={discardPending}
              onConfirm={() => onDiscard(baseline.version.versionNumber, isLiveBaseline)}
            >
              <Undo2 aria-hidden className="size-4" /> {isLiveBaseline ? 'Discard changes' : `Revert to v${baseline.version.versionNumber}`}
            </SpaConfirmButton>
          ) : null}
          <Button type="button" size="sm" disabled={!canPublish} title={publishBlockedReason ?? undefined} onClick={onPublish}>
            <Send aria-hidden className="size-4" /> Publish v{currentVersionNumber}
          </Button>
        </div>
      </div>

      {baseline !== null ? (
        <div role="tablist" aria-label="Review view" className="flex gap-5 border-b border-[color:var(--hairline)]">
          {(['changes', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 pb-2 text-[0.9375rem] transition-colors ${tab === value ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {value === 'changes' ? 'Changes' : 'Preview'}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'preview' || baseline === null ? (
        preview
      ) : loadError ? (
        <p role="alert" className="text-sm text-destructive">Could not load the earlier version to compare. The preview still shows exactly what will publish.</p>
      ) : baseline === undefined ? (
        <div className="grid gap-3"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-64 rounded-lg" /></div>
      ) : (
        <div className="grid gap-6">
          {changes.length > 0 ? (
            <div className="grid gap-3">
              <h3 className="text-sm font-medium text-foreground">Details</h3>
              <MetadataDiff changes={changes} />
            </div>
          ) : null}
          <div className="grid gap-3">
            <h3 className="text-sm font-medium text-foreground">Body</h3>
            <BodyDiff before={baseline.version.contentMarkdown} after={current.contentMarkdown} />
          </div>
        </div>
      )}
      {publishBlockedReason ? <p className="text-sm text-muted-foreground">{publishBlockedReason}</p> : null}
    </section>
  )
}
