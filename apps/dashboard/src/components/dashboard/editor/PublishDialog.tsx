import { Button } from '@vc/ui'
import { AlertTriangle, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'

export type PublishDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionNumber: number | null
  liveVersionNumber: number | null
  liveUrl: string | null
  warnings: string[]
  pending: boolean
  error: string | null
  onConfirm: () => void
}

/** Final human approval: names the exact version and what it replaces. */
export function PublishDialog({ open, onOpenChange, versionNumber, liveVersionNumber, liveUrl, warnings, pending, error, onConfirm }: PublishDialogProps) {
  const label = versionNumber ? `v${versionNumber}` : 'this version'
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish {label}?</DialogTitle>
          <DialogDescription>
            {liveVersionNumber
              ? `${label} replaces live v${liveVersionNumber}.`
              : 'This post goes live on your blog.'}
            {liveUrl ? <span className="mt-1 block break-all font-mono text-xs">{liveUrl}</span> : null}
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 0 ? (
          <div className="grid gap-1.5 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <AlertTriangle aria-hidden className="size-4 text-warning" /> Check before publishing
            </p>
            <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Not yet</Button>
          <Button type="button" disabled={pending || !versionNumber} onClick={onConfirm} autoFocus>
            <Send aria-hidden className="size-4" /> {pending ? 'Publishing…' : `Publish ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
