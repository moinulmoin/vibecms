import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <h2 className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
        {meta ? <div className="font-mono text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {children}
    </section>
  )
}
