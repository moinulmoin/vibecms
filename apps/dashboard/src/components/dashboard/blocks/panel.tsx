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
        'flex flex-col gap-4 rounded-xl border border-[color:var(--hairline)] bg-card p-5 sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  )
}
