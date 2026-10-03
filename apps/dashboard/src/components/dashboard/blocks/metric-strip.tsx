import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

/** Dense label / value / detail row used for the Overview + Analytics number
 *  strips. Matches the Analytics `MetricStrip` pattern. */
export function MetricStrip({
  metrics,
  variant = 'surface',
  columns = 4,
}: {
  metrics: { label: string; value: ReactNode; detail?: string }[]
  variant?: 'surface' | 'inset'
  /** Columns at xl; match the number of metrics so no cell sits empty. */
  columns?: 2 | 3 | 4
}) {
  return (
    <div
      className={cn(
        'grid overflow-hidden sm:grid-cols-2',
        columns === 2 ? 'xl:grid-cols-2' : columns === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4',
        variant === 'surface'
          ? 'rounded-xl border border-border bg-card'
          : 'rounded-xl bg-muted/30',
      )}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={cn(
            'min-w-0 px-4 py-5 sm:px-5 sm:py-6',
            index < metrics.length - 1 && 'border-b border-[color:var(--hairline)]',
            index % 2 === 0 && 'sm:border-r sm:border-[color:var(--hairline)]',
            index >= metrics.length - 2 && 'sm:border-b-0',
            'xl:border-b-0 xl:border-r-0',
            index > 0 && 'xl:border-l xl:border-[color:var(--hairline)]',
          )}
        >
          <p className="text-sm text-muted-foreground">{metric.label}</p>
          <p className="mt-2.5 font-display text-3xl font-semibold tabular-nums tracking-[-0.04em] text-foreground sm:text-4xl">
            {metric.value}
          </p>
          {metric.detail ? <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{metric.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
