'use client'

import type { Post, PostVersion, PostVersionSummary } from '@vc/core'
import { Badge, Button, Skeleton } from '@vc/ui'
import { Eye, History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemTitle } from '~/components/ui/item'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { formatDateTime } from '~/components/dashboard/DashboardLayout'
import { diffLines, type DiffLine } from '~/lib/diff'
import { getPostVersionFn, listPostVersionsFn } from '~/lib/api-client'

function relativeTime(tsSeconds: number) {
  const diffMs = Date.now() - tsSeconds * 1000
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d ago`
  return formatDateTime(tsSeconds)
}

export type VersionHistoryProps = {
  postId: string
  post: Pick<Post, 'status' | 'publishedVersionNumber'> | null
  currentContent: string
  latestVersion: PostVersionSummary | null
  restorePending: number | null
  restoreBlocked: boolean
  onRestore: (versionNumber: number) => void
}

export function VersionHistory({ postId, post, currentContent, latestVersion, restorePending, restoreBlocked, onRestore, compact = false }: VersionHistoryProps & { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PostVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PostVersion | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)

  async function loadVersions() {
    setLoading(true)
    setError(null)
    try {
      setVersions(await listPostVersionsFn({ postId }))
    } catch {
      setError('Could not load version history. Try again.')
    } finally {
      setLoading(false)
    }
  }
  async function openVersion(versionNumber: number) {
    setViewing(null)
    setViewError(null)
    setShowDiff(false)
    setViewLoading(true)
    try {
      setViewing(await getPostVersionFn({ postId, versionNumber }))
    } catch {
      setViewError('Could not load this version. Close the dialog and try again.')
    } finally {
      setViewLoading(false)
    }
  }
  async function reviewChanges() {
    if (post?.publishedVersionNumber == null) return
    setOpen(false)
    await openVersion(post.publishedVersionNumber)
    setShowDiff(true)
  }

  const isPinned = viewing != null && post?.publishedVersionNumber != null && viewing.versionNumber === post.publishedVersionNumber

  return (
    <>
      {compact ? (
        <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(true); void loadVersions() }}>
          <History aria-hidden="true" className="size-4" /> History
        </Button>
      ) : (
        <div className="grid gap-2">
          <Button type="button" variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => { setOpen(true); void loadVersions() }}>
            <History aria-hidden="true" className="size-4" /> Version history
          </Button>
          {post?.publishedVersionNumber != null && latestVersion?.versionNumber !== post.publishedVersionNumber ? (
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => void reviewChanges()}>
              <Eye aria-hidden="true" className="size-4" /> Review changes
            </Button>
          ) : null}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>Past saved versions of this post.</DialogDescription>
          </DialogHeader>
          {restoreBlocked ? (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Save your local changes before restoring a version.
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="grid gap-3"><Skeleton className="h-16 rounded-lg" /><Skeleton className="h-16 rounded-lg" /></div>
            ) : error ? <p className="text-sm text-destructive" role="alert">{error}</p> : versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions saved yet.</p> : (
              <ItemGroup>
                {versions.map((version) => (
                  <Item key={version.versionNumber} variant="outline">
                    <ItemHeader>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">v{version.versionNumber}</Badge>
                        {latestVersion?.versionNumber === version.versionNumber ? <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">Current</Badge> : null}
                      </div>
                    </ItemHeader>
                    <ItemContent>
                      <ItemTitle>{version.title}</ItemTitle>
                      <ItemDescription>{version.actorName.trim() ? `${version.actorName} · ` : ''}{relativeTime(version.createdAt)}</ItemDescription>
                      {version.changeSummary ? <p className="text-xs italic text-muted-foreground">{version.changeSummary}</p> : null}
                    </ItemContent>
                    <ItemActions className="pt-1">
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void openVersion(version.versionNumber)} disabled={restorePending !== null}>
                        <Eye aria-hidden="true" className="size-3.5" /> View
                      </Button>
                      <SpaConfirmButton
                        size="sm"
                        variant="outline"
                        confirmLabel="Confirm restore"
                        helperText={restoreBlocked ? 'Save your local changes before restoring a version.' : 'This replaces the current saved draft with this version.'}
                        disabled={restorePending !== null || restoreBlocked}
                        onConfirm={() => onRestore(version.versionNumber)}
                      >
                        <RotateCcw aria-hidden="true" className="size-3.5" /> Restore
                      </SpaConfirmButton>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={viewing !== null || viewLoading || viewError !== null} onOpenChange={(nextOpen) => { if (!nextOpen) { setViewing(null); setViewError(null) } }}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{viewLoading ? 'Loading…' : viewing ? `v${viewing.versionNumber} · ${viewing.title}` : 'Version'}</DialogTitle>
            {viewing ? <DialogDescription>{viewing.actorName.trim() ? `Saved by ${viewing.actorName} on ${formatDateTime(viewing.createdAt)}` : `Saved ${formatDateTime(viewing.createdAt)}`}</DialogDescription> : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {viewLoading ? <Skeleton className="h-48" /> : viewError ? <p className="py-4 text-sm text-destructive" role="alert">{viewError}</p> : viewing ? (
              <div className="grid gap-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-muted-foreground">{showDiff ? (isPinned ? `Public v${viewing.versionNumber} → current tip` : 'Diff vs current') : 'Markdown'}</p>
                  <Button type="button" variant={showDiff ? 'default' : 'outline'} size="sm" aria-pressed={showDiff} onClick={() => setShowDiff((value) => !value)}>Compare with current</Button>
                </div>
                {showDiff ? <div className="max-h-80 overflow-y-auto rounded-lg bg-muted/40 p-2 font-mono text-xs leading-relaxed">{diffLines(viewing.contentMarkdown, currentContent).map((line: DiffLine, index) => <div key={index} className={`flex gap-2 px-1 ${line.type === 'add' ? 'bg-brand-bright/10 text-primary' : line.type === 'del' ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'}`}><span className="w-4 shrink-0 select-none text-center">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span><span className="whitespace-pre-wrap break-words">{line.text || '\u00a0'}</span></div>)}</div> : <pre className="max-h-80 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{viewing.contentMarkdown}</pre>}
              </div>
            ) : null}
          </div>
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
