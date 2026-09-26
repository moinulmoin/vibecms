import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

/** A bordered, flat surface for one bounded group of controls. Never nest these. */
export function Panel({
  title,
  description,
  meta,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
          {description ? <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {meta ? <div className="text-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Unboxed section: heading + content separated by whitespace, not a card. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('grid content-start gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
          {description ? <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
