import type { ComponentType, ReactNode } from 'react'
import { Card, cn } from '@vc/ui'

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  interactive,
}: {
  label: string
  value: string | number
  detail?: string
  icon?: ComponentType<{ 'aria-hidden'?: boolean; className?: string }>
  interactive?: boolean
}) {
  return (
    <Card
      className={cn(
        'gap-0 p-5 sm:p-6',
        interactive && 'h-full transition-colors hover:border-[color:var(--brand-bright)]/30 hover:bg-muted/40',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">{value}</p>
      {detail ? <p className="mt-1.5 font-sans text-sm leading-5 text-muted-foreground">{detail}</p> : null}
    </Card>
  )
}

export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
}
