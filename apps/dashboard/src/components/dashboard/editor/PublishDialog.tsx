import { Button, Input } from '@vc/ui'
import { AlertTriangle, CalendarClock, Send } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'

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

type Mode = 'now' | 'schedule'

const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** "Asia/Nicosia" → "Nicosia time"; the viewer's own clock is what they pick in. */
export function timezoneLabel(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!timeZone) return 'your local time'
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ')
  return city ? `${city} time` : timeZone
}

/** Quick picks, computed from "now" in the viewer's timezone. */
export function quickPicks(now = new Date()): Array<{ id: string; label: string; at: Date }> {
  const inAnHour = new Date(now.getTime() + 60 * 60_000)
  inAnHour.setMinutes(Math.ceil(inAnHour.getMinutes() / 15) * 15, 0, 0)
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const monday = new Date(now)
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7))
  monday.setHours(9, 0, 0, 0)
  return [
    { id: 'hour', label: 'In an hour', at: inAnHour },
    { id: 'tomorrow', label: 'Tomorrow, 9:00', at: tomorrow },
    { id: 'monday', label: 'Monday, 9:00', at: monday },
  ]
}

function relative(at: Date, now = new Date()) {
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 36) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

const OPTION =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-bright/50 has-[[data-state=checked]]:bg-brand-bright/[0.04]'

/** Final human approval: names the exact version, what it replaces, and when it goes live. */
export function PublishDialog({ open, onOpenChange, versionNumber, liveVersionNumber, liveUrl, warnings, pending, error, onConfirm, onSchedule }: PublishDialogProps) {
  const label = versionNumber ? `v${versionNumber}` : 'this version'
  const [mode, setMode] = useState<Mode>('now')
  const picks = quickPicks()
  const [date, setDate] = useState(() => dateValue(picks[1]!.at))
  const [time, setTime] = useState(() => timeValue(picks[1]!.at))
  const [timeError, setTimeError] = useState<string | null>(null)

  const at = new Date(`${date}T${time}`)
  const valid = Number.isFinite(at.getTime()) && at.getTime() > Date.now()
  const whenText = valid
    ? at.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  const shortWhen = valid ? at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null

  function confirm() {
    if (mode === 'now') return onConfirm()
    if (!valid) {
      setTimeError('Pick a time in the future.')
      return
    }
    setTimeError(null)
    onSchedule(Math.floor(at.getTime() / 1000))
  }

  function choose(next: Date) {
    setDate(dateValue(next))
    setTime(timeValue(next))
    setTimeError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="gap-5 sm:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle>Publish {label}</DialogTitle>
          <DialogDescription>
            {liveVersionNumber ? `${label} replaces live v${liveVersionNumber}.` : 'This post goes live on your blog.'}
            {liveUrl ? <span className="mt-1 block break-all font-mono text-xs">{liveUrl}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-3">
          <legend className="sr-only">When to publish</legend>
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as Mode)} className="grid gap-2 sm:grid-cols-2">
            <label htmlFor="publish-now" className={OPTION}>
              <RadioGroupItem id="publish-now" value="now" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Now</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">Goes live right away</span>
              </span>
            </label>
            <label htmlFor="publish-schedule" className={OPTION}>
              <RadioGroupItem id="publish-schedule" value="schedule" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Schedule</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">Pick when it goes live</span>
              </span>
            </label>
          </RadioGroup>

          {mode === 'schedule' ? (
            <div className="grid gap-3 rounded-lg bg-muted/40 p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
                {picks.map((pick) => {
                  const selected = dateValue(pick.at) === date && timeValue(pick.at) === time
                  return (
                    <button
                      key={pick.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => choose(pick.at)}
                      className="min-h-8 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground transition-colors hover:bg-muted aria-pressed:border-brand-bright/50 aria-pressed:bg-brand-bright/10"
                    >
                      {pick.label}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Date
                  <Input type="date" value={date} min={dateValue(new Date())} onChange={(event) => { setDate(event.target.value); setTimeError(null) }} className="h-9 tabular-nums" />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Time
                  <Input type="time" value={time} step={300} onChange={(event) => { setTime(event.target.value); setTimeError(null) }} className="h-9 tabular-nums" />
                </label>
              </div>
              <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground" aria-live="polite">
                <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-bright" />
                {whenText ? (
                  <span>
                    Goes live <span className="font-medium text-foreground">{whenText}</span>, {timezoneLabel()} ({relative(at)}). Your agent can move or cancel it.
                  </span>
                ) : (
                  <span>Pick a date and time in the future ({timezoneLabel()}).</span>
                )}
              </p>
            </div>
          ) : null}
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
          <Button type="button" disabled={pending || !versionNumber || (mode === 'schedule' && !valid)} onClick={confirm}>
            {mode === 'now' ? <Send aria-hidden className="size-4" /> : <CalendarClock aria-hidden className="size-4" />}
            {pending ? 'Saving…' : mode === 'now' ? `Publish ${label} now` : `Schedule ${label}${shortWhen ? ` · ${shortWhen}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
