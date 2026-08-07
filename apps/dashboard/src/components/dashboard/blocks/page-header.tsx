import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  /** Optional state line (e.g. editor status). Omit for section pages — the
   *  sticky header and nav already name the section. */
  kicker?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        {kicker ? (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {kicker}
          </p>
        ) : null}
        <h1 className="text-balance font-display text-xl font-semibold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-pretty font-sans text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-6">{action}</div> : null}
    </header>
  )
}
