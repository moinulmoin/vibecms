import { Badge, cn } from '@vc/ui'

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

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: Status
  className?: string
  label?: string
}) {
  const normalized = status.trim().toLowerCase()
  const tone = STATUS_TONES[normalized] ?? 'muted'
  const displayLabel = label ?? statusLabel(status)

  if (tone === 'success') {
    return (
      <Badge
        className={cn(
          'gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary',
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        {displayLabel}
      </Badge>
    )
  }

  if (tone === 'warning') {
    return (
      <Badge
        className={cn(
          'border-warning/35 bg-warning/10 text-warning',
          className,
        )}
      >
        {displayLabel}
      </Badge>
    )
  }

  if (tone === 'error') {
    return (
      <Badge
        className={cn('border-destructive/30 bg-destructive/10 text-destructive', className)}
      >
        {displayLabel}
      </Badge>
    )
  }

  if (tone === 'draft') {
    return (
      <Badge className={cn('border-border bg-muted text-foreground', className)}>
        {displayLabel}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={cn('border-dashed text-muted-foreground', className)}>
      {displayLabel}
    </Badge>
  )
}
