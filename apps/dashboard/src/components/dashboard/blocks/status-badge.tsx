import type { ReactNode } from 'react'
import { Badge, cn } from '@vc/ui'

type Status = 'published' | 'live' | 'active' | 'draft' | 'archived' | 'failed' | 'pending' | string

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  if (status === 'published' || status === 'live' || status === 'active') {
    return (
      <Badge
        className={cn(
          'gap-1.5 border-brand-bright/30 bg-brand-bright/10 capitalize text-primary',
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        {status}
      </Badge>
    )
  }
  if (status === 'archived') {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1.5 border-dashed capitalize text-muted-foreground/70', className)}
      >
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        {status}
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge
        variant="outline"
        className={cn('border-destructive/30 bg-destructive/10 capitalize text-destructive', className)}
      >
        {status}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn('capitalize', className)}>
      {status}
    </Badge>
  )
}
