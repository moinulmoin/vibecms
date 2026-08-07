import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

/** Dense label / value / detail row used for the Overview + Analytics number
 *  strips. Matches the Analytics `MetricStrip` pattern. */
export function MetricStrip({ metrics }: { metrics: { label: string; value: ReactNode; detail?: string }[] }) {
  return (
    <div className="grid gap-0 overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-card sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="min-w-0 px-5 py-5 sm:px-6 sm:py-6 xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:border-[color:var(--hairline)]"
        >
          <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{metric.label}</p>
          <p className="mt-3 font-display text-3xl font-semibold tabular-nums tracking-[-0.035em] text-foreground sm:text-4xl">
            {metric.value}
          </p>
          {metric.detail ? <p className="mt-2 text-sm leading-5 text-muted-foreground">{metric.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
