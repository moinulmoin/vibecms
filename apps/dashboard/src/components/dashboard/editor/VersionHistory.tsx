import type { Asset, Post, PostVersion, PostVersionSummary } from '@vc/core'
import { Button, Skeleton } from '@vc/ui'
import { ArrowLeft, Bot, History, RotateCcw, User } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { formatDateTime, formatRelative } from '~/components/dashboard/DashboardLayout'
import { getPostVersionFn, listPostVersionsFn } from '~/lib/api-client'
import { isAgentActor } from '~/lib/post-review'
import { BodyDiff, MetadataDiff, metadataChanges, snapshotFromVersion, type PostSnapshot } from './DiffView'

export type VersionHistoryProps = {
  postId: string
  post: Pick<Post, 'status' | 'publishedVersionNumber'> | null
  /** What is on screen now (the tip, plus any unsaved edits). */
  current: PostSnapshot
  currentVersionNumber: number | null
  assets: Asset[]
  restorePending: number | null
  restoreBlocked: boolean
  onRestore: (versionNumber: number) => void
}

export function ActorIcon({ type, className = 'size-3.5' }: { type: string | null | undefined; className?: string }) {
  return isAgentActor(type)
    ? <Bot aria-label="Agent" className={className} />
    : <User aria-label="Person" className={className} />
}

export function VersionHistory({ postId, post, current, currentVersionNumber, assets, restorePending, restoreBlocked, onRestore }: VersionHistoryProps) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PostVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PostVersion | null>(null)
  const [viewLoading, setViewLoading] = useState<number | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const liveVersion = post?.status === 'published' ? post.publishedVersionNumber : null

  async function loadVersions() {
    setLoading(true)
    setError(null)
    try {
      setVersions(await listPostVersionsFn({ postId }))
    } catch {
      setError('Could not load the history.')
    } finally {
      setLoading(false)
    }
  }

  async function openVersion(versionNumber: number) {
    setViewError(null)
    setViewLoading(versionNumber)
    try {
      setViewing(await getPostVersionFn({ postId, versionNumber }))
    } catch {
      setViewError('Could not load this version.')
    } finally {
      setViewLoading(null)
    }
  }

  const restoreHelp = restoreBlocked ? 'Wait for your changes to save first.' : 'Brings this version back as the newest draft. Nothing goes live.'

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(true); setViewing(null); void loadVersions() }}>
        <History aria-hidden="true" className="size-4" /> <span className="hidden lg:inline">History</span>
        <span className="sr-only lg:hidden">Version history</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-2xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="icon" className="-ml-2 size-8" aria-label="Back to history" onClick={() => setViewing(null)}>
                    <ArrowLeft className="size-4" />
                  </Button>
                  v{viewing.versionNumber} compared with {currentVersionNumber ? `v${currentVersionNumber}` : 'now'}
                </DialogTitle>
                <DialogDescription>
                  Saved by {viewing.actorName.trim() || 'someone'} · {formatDateTime(viewing.createdAt)}. Red is only in v{viewing.versionNumber}, green is only in the current version.
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1">
                <MetadataDiff changes={metadataChanges(snapshotFromVersion(viewing), current, assets)} />
                <BodyDiff before={viewing.contentMarkdown} after={current.contentMarkdown} />
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--hairline)] pt-4">
                {viewing.versionNumber !== currentVersionNumber ? (
                  <SpaConfirmButton
                    size="sm"
                    variant="outline"
                    confirmLabel={`Restore v${viewing.versionNumber}?`}
                    helperText={restoreHelp}
                    disabled={restorePending !== null || restoreBlocked}
                    onConfirm={() => { onRestore(viewing.versionNumber); setOpen(false) }}
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" /> Restore v{viewing.versionNumber}
                  </SpaConfirmButton>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>History</DialogTitle>
                <DialogDescription>Every saved version of this post. Restoring never changes what is live.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="grid gap-3"><Skeleton className="h-14 rounded-lg" /><Skeleton className="h-14 rounded-lg" /><Skeleton className="h-14 rounded-lg" /></div>
                ) : error ? (
                  <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                    {error}
                    <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={() => void loadVersions()}>Try again</Button>
                  </p>
                ) : versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No saved versions yet.</p>
                ) : (
                  <ol className="grid">
                    {versions.map((version) => {
                      const isLive = liveVersion === version.versionNumber
                      const isCurrent = currentVersionNumber === version.versionNumber
                      return (
                        <li key={version.versionNumber} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-[color:var(--hairline)] py-3 last:border-b-0">
                          <span className="pt-0.5 font-mono text-sm tabular-nums text-foreground">v{version.versionNumber}</span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span className="inline-flex items-center gap-1.5 text-foreground">
                                <ActorIcon type={version.actorType} />
                                {version.actorName.trim() || (isAgentActor(version.actorType) ? 'Agent' : 'You')}
                              </span>
                              <time className="text-muted-foreground" dateTime={new Date(version.createdAt * 1000).toISOString()} title={formatDateTime(version.createdAt)}>
                                {formatRelative(version.createdAt)}
                              </time>
                              {isLive ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                                  <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden />Live
                                </span>
                              ) : null}
                              {isCurrent && !isLive ? <span className="text-xs text-muted-foreground">Latest</span> : null}
                            </p>
                            {version.changeSummary ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{version.changeSummary}</p> : null}
                          </div>
                          <div className="flex items-center gap-1">
                            {!isCurrent ? (
                              <Button type="button" variant="ghost" size="sm" disabled={viewLoading !== null} onClick={() => void openVersion(version.versionNumber)}>
                                {viewLoading === version.versionNumber ? 'Loading…' : 'Compare'}
                              </Button>
                            ) : null}
                            {!isCurrent ? (
                              <SpaConfirmButton
                                size="sm"
                                variant="ghost"
                                confirmLabel="Restore?"
                                helperText={restoreHelp}
                                disabled={restorePending !== null || restoreBlocked}
                                onConfirm={() => { onRestore(version.versionNumber); setOpen(false) }}
                              >
                                {restorePending === version.versionNumber ? 'Restoring…' : 'Restore'}
                              </SpaConfirmButton>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
                {viewError ? <p className="mt-3 text-sm text-destructive" role="alert">{viewError}</p> : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
