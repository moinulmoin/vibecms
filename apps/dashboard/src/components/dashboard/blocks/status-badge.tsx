import { cn } from '@vc/ui'

type Status = string
type StatusTone = 'success' | 'warning' | 'error' | 'draft' | 'muted'

const STATUS_TONES: Record<string, StatusTone> = {
  live: 'success',
  published: 'success',
  active: 'success',
  connected: 'success',
  verified: 'success',
  confirmed: 'success',
  pending: 'warning',
  waiting: 'warning',
  provisioning: 'warning',
  past_due: 'warning',
  unpaid: 'warning',
  stalled: 'warning',
  recovery: 'warning',
  failed: 'error',
  error: 'error',
  draft: 'draft',
  new: 'draft',
  free_plan: 'draft',
  unpublished: 'draft',
  archived: 'muted',
  canceled: 'muted',
  none: 'muted',
  disabled: 'muted',
  unknown: 'muted',
}

/** Sentence case, like the rest of the UI ("Past due", not "Past Due"). Labels passed in are shown as written. */
function statusLabel(status: string) {
  const text = status.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const TONE_STYLES: Record<StatusTone, { text: string; dot: string }> = {
  success: { text: 'text-foreground/85', dot: 'bg-brand-bright' },
  warning: { text: 'text-warning', dot: 'bg-warning' },
  error: { text: 'text-destructive', dot: 'bg-destructive' },
  draft: { text: 'text-muted-foreground', dot: 'border border-muted-foreground/70 bg-transparent' },
  muted: { text: 'text-muted-foreground', dot: 'border border-dashed border-muted-foreground/60 bg-transparent' },
}

/**
 * Status as a dot and a word, not a pill. Lists stay quiet; color only shows
 * up where it means something (live, needs you, broken).
 */
export function StatusBadge({
  status,
  className,
  label,
}: {
  status: Status
  className?: string
  label?: string
}) {
  const tone = STATUS_TONES[status.trim().toLowerCase()] ?? 'muted'
  const styles = TONE_STYLES[tone]
  return (
    <span
      data-slot="status"
      data-tone={tone}
      className={cn('inline-flex w-fit shrink-0 items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap', styles.text, className)}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', styles.dot)} />
      {label ?? statusLabel(status)}
    </span>
  )
}
