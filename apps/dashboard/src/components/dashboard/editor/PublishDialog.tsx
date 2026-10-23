import { Button, Input } from '@vc/ui'
import type { ScheduledPublish } from '@vc/core'
import { Link } from '@tanstack/react-router'
import type { SeoFinding } from '~/types/dashboard'
import { AlertTriangle, CalendarClock, ExternalLink, Send } from 'lucide-react'
import { useRef, useState, type RefObject } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'

export type PublishDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionNumber: number | null
  liveVersionNumber: number | null
  liveUrl: string | null
  warnings: string[]
  /** Open error-severity findings from the SEO check; listed, never blocking. */
  seoFindings?: SeoFinding[]
  /** Jump back to the SEO section in the settings rail. */
  onReviewSeo?: () => void
  pending: boolean
  error: string | null
  /** Mutation code behind `error`; plan caps (`billing_required`, `draft_limit`, `media_quota_free`) link straight to plans. */
  errorCode?: string | null
  /** The post's current schedule, so a pending one is explained before it is replaced or bypassed. */
  scheduledPublish?: ScheduledPublish | null
  /** Element to focus after close; defaults to whatever had focus when the dialog opened. */
  returnFocusRef?: RefObject<HTMLElement | null>
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

const MAX_SEO_ERRORS_SHOWN = 5

const OPTION =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-bright/50 has-[[data-state=checked]]:bg-brand-bright/[0.04]'

/** Plan caps the dashboard resolves on the billing tab (same set as the editor action error). */
const PLAN_CAP_CODES = ['billing_required', 'draft_limit', 'media_quota_free']

/** Final human approval: names the exact version, what it replaces, and when it goes live. */
export function PublishDialog({ open, onOpenChange, versionNumber, liveVersionNumber, liveUrl, warnings, seoFindings, onReviewSeo, pending, error, errorCode, scheduledPublish, returnFocusRef, onConfirm, onSchedule }: PublishDialogProps) {
  // Only free sites are non-indexable; like SeoSection, that finding gets the plan reason and a billing link instead of the generic check copy.
  const siteNotIndexable = (seoFindings ?? []).some((finding) => finding.code === 'site-not-indexable')
  const seoErrors = (seoFindings ?? []).filter((finding) => finding.severity === 'error' && finding.code !== 'site-not-indexable')
  // Long findings lists (dozens of broken links) used to push the footer off
  // the viewport; cap the visible rows and point the rest at the rail.
  const visibleSeoErrors = seoErrors.slice(0, MAX_SEO_ERRORS_SHOWN)
  const hiddenSeoErrors = seoErrors.length - visibleSeoErrors.length
  const label = versionNumber ? `v${versionNumber}` : 'this version'
  const [mode, setMode] = useState<Mode>('now')
  const picks = quickPicks()
  const [date, setDate] = useState(() => dateValue(picks[1]!.at))
  const [time, setTime] = useState(() => timeValue(picks[1]!.at))
  const [timeError, setTimeError] = useState<string | null>(null)
  // Every opening is a fresh approval: start from Now with a fresh default time.
  // Adjusted during render (not in an effect) so there is no extra commit or loop.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode('now')
      setDate(dateValue(picks[1]!.at))
      setTime(timeValue(picks[1]!.at))
      setTimeError(null)
    }
  }
  // Callers open this after an async save, so there is no DialogTrigger to
  // return to; remember what had focus when it opened.
  const openerRef = useRef<HTMLElement | null>(null)

  const at = new Date(`${date}T${time}`)
  const valid = Number.isFinite(at.getTime()) && at.getTime() > Date.now()
  const whenText = valid
    ? at.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  const shortWhen = valid ? at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const activeSchedule = scheduledPublish && (scheduledPublish.status === 'pending' || scheduledPublish.status === 'processing')
    ? scheduledPublish
    : null

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
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-[30rem]"
        onOpenAutoFocus={() => {
          const active = document.activeElement
          openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
        }}
        onCloseAutoFocus={(event) => {
          // Leave focus alone if a follow-up action (e.g. Review SEO) already moved it.
          if (document.activeElement && document.activeElement !== document.body) return
          const target = returnFocusRef?.current ?? openerRef.current
          if (!target?.isConnected) return
          event.preventDefault()
          target.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === 'schedule' ? `Schedule ${label}` : `Publish ${label}`}</DialogTitle>
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

        {activeSchedule ? (
          <p className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
            <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              {activeSchedule.status === 'processing'
                ? <>v{activeSchedule.versionNumber} is going live on schedule right now.</>
                : <>v{activeSchedule.versionNumber} is scheduled to go live <span className="font-medium text-foreground">{new Date(activeSchedule.publishAt * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>.</>}{' '}
              {mode === 'schedule'
                ? activeSchedule.status === 'pending' ? 'Scheduling replaces that time.' : null
                : activeSchedule.status === 'pending' ? 'Publishing now does not cancel it; unschedule it if it should not go live then.' : null}
            </span>
          </p>
        ) : null}

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
        {seoErrors.length > 0 ? (
          <div className="grid gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <AlertTriangle aria-hidden className="size-4 text-destructive" /> SEO {seoErrors.length === 1 ? 'issue' : 'issues'} to fix
            </p>
            <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
              {visibleSeoErrors.map((finding, index) => <li key={`${finding.code}:${finding.position ?? index}`}>{finding.message}</li>)}
            </ul>
            {hiddenSeoErrors > 0 || onReviewSeo ? (
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-muted-foreground">
                {hiddenSeoErrors > 0 ? <span>and {hiddenSeoErrors} more.</span> : null}
                {onReviewSeo ? (
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onReviewSeo}>
                    {hiddenSeoErrors > 0 ? 'Review all in the SEO section' : 'Review'}
                  </Button>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
        {siteNotIndexable ? (
          <p className="text-[13px] leading-5 text-muted-foreground">
            <span className="block text-foreground">Search engines don’t index posts on the free plan.</span>
            Subscribe in{' '}
            <Link
              to="/dashboard/settings"
              search={{ ok: undefined, error: undefined, tab: 'billing' }}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Settings &gt; Billing
            </Link>{' '}
            so this post can appear in search results.
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="grid gap-2 text-sm text-destructive">
            <p>{error}</p>
            {errorCode && PLAN_CAP_CODES.includes(errorCode) ? (
              <Button asChild size="sm" variant="outline" className="justify-self-start">
                <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }} target="_blank" rel="noopener noreferrer">
                  Upgrade to Cloud <ExternalLink aria-hidden data-icon="inline-end" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
        {timeError ? <p role="alert" className="text-sm text-destructive">{timeError}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={pending || !versionNumber || (mode === 'schedule' && !valid)} onClick={confirm}>
            {mode === 'now' ? <Send aria-hidden className="size-4" /> : <CalendarClock aria-hidden className="size-4" />}
            {pending ? 'Saving…' : mode === 'now' ? `Publish ${label} now` : `Schedule ${label}${shortWhen ? ` · ${shortWhen}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
