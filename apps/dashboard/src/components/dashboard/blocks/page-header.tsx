import type { ReactNode } from 'react'

/** The one page header used across the dashboard: title, optional one-line description, actions. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-balance font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[44rem] text-pretty text-base leading-7 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}
