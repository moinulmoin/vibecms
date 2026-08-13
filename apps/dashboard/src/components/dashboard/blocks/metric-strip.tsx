import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

/** Dense label / value / detail row used for the Overview + Analytics number
 *  strips. Matches the Analytics `MetricStrip` pattern. */
export function MetricStrip({
  metrics,
  variant = 'surface',
}: {
  metrics: { label: string; value: ReactNode; detail?: string }[]
  variant?: 'surface' | 'inset'
}) {
  return (
    <div
      className={cn(
        'grid overflow-hidden sm:grid-cols-2 xl:grid-cols-4',
        variant === 'surface'
          ? 'rounded-2xl border border-foreground/[0.065] bg-card'
          : 'rounded-xl bg-muted/30',
      )}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={cn(
            'min-w-0 px-4 py-5 sm:px-5 sm:py-6',
            index < metrics.length - 1 && 'border-b border-foreground/[0.065]',
            index % 2 === 0 && 'sm:border-r sm:border-foreground/[0.065]',
            index >= metrics.length - 2 && 'sm:border-b-0',
            'xl:border-b-0 xl:border-r-0',
            index > 0 && 'xl:border-l xl:border-foreground/[0.065]',
          )}
        >
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{metric.label}</p>
          <p className="mt-2.5 font-display text-3xl font-semibold tabular-nums tracking-[-0.04em] text-foreground sm:text-4xl">
            {metric.value}
          </p>
          {metric.detail ? <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{metric.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
