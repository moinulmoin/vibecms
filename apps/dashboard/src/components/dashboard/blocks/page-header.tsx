import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2.5">
        <h1 className="text-balance font-display text-2xl font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[1.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[46rem] text-pretty font-sans text-[15px] leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}
