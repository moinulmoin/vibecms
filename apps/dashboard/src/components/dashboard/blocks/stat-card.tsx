import type { ComponentType, ReactNode } from 'react'
import { cn } from '@vc/ui'

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
    <div
      className={cn(
        'h-full px-4 py-5 sm:px-5 sm:py-6',
        interactive && 'transition-colors duration-150 hover:bg-muted/35 active:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2.5 font-display text-3xl font-semibold tabular-nums tracking-[-0.04em] text-foreground">{value}</p>
      {detail ? <p className="mt-1.5 font-sans text-sm leading-5 text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid overflow-hidden rounded-2xl border border-foreground/[0.065] bg-card sm:grid-cols-2 xl:grid-cols-4',
        '[&>*]:border-b [&>*]:border-foreground/[0.065] [&>*:last-child]:border-b-0',
        'sm:[&>*:nth-child(odd)]:border-r sm:[&>*:nth-child(n+3)]:border-b-0',
        'xl:[&>*]:border-b-0 xl:[&>*:not(:last-child)]:border-r',
        className,
      )}
    >
      {children}
    </div>
  )
}
