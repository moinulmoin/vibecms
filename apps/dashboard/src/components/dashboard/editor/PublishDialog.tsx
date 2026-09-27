import { Button } from '@vc/ui'
import { AlertTriangle, Send } from 'lucide-react'
import { useState } from 'react'
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
  onSchedule: (publishAt: number) => void
}

/** Final human approval: names the exact version and what it replaces. */
export function PublishDialog({ open, onOpenChange, versionNumber, liveVersionNumber, liveUrl, warnings, pending, error, onConfirm, onSchedule }: PublishDialogProps) {
  const label = versionNumber ? `v${versionNumber}` : 'this version'
  const [mode, setMode] = useState<'now' | 'schedule'>('now')
  const [localTime, setLocalTime] = useState('')
  const [timeError, setTimeError] = useState<string | null>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
  function confirm() {
    if (mode === 'now') return onConfirm()
    const timestamp = new Date(localTime).getTime()
    if (!localTime || !Number.isFinite(timestamp) || timestamp <= Date.now()) {
      setTimeError('Choose a future date and time.')
      return
    }
    setTimeError(null)
    onSchedule(Math.floor(timestamp / 1000))
  }
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
        <fieldset className="grid gap-2 text-sm">
          <legend className="mb-1 font-medium">When to publish</legend>
          <label className="flex items-center gap-2"><input type="radio" name="publish-mode" checked={mode === 'now'} onChange={() => setMode('now')} /> Publish now</label>
          <label className="flex items-center gap-2"><input type="radio" name="publish-mode" checked={mode === 'schedule'} onChange={() => setMode('schedule')} /> Schedule</label>
          {mode === 'schedule' ? <label className="grid gap-1 text-muted-foreground">Date and time · {timezone}
            <input type="datetime-local" className="rounded-md border border-border bg-background px-3 py-2 text-foreground" value={localTime} onChange={(event) => setLocalTime(event.target.value)} />
          </label> : null}
        </fieldset>
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
        {timeError ? <p role="alert" className="text-sm text-destructive">{timeError}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Not yet</Button>
          <Button type="button" disabled={pending || !versionNumber} onClick={confirm} autoFocus>
            <Send aria-hidden className="size-4" /> {pending ? 'Saving…' : mode === 'now' ? `Publish ${label}` : `Schedule ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
