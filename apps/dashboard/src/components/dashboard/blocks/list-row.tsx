import type { ReactNode } from 'react'
import { cn } from '@vc/ui'

/** One row in a list/feed (activity, posts, domains). Title + meta on the
 *  left, optional actions on the right. */
export function ListRow({
  title,
  meta,
  description,
  actions,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--hairline)] bg-background px-4 py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {title}
          {meta}
        </div>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Grid-based data row used by the list pages (posts, activity). Kept for
 *  continuity with the previous `DataRow`; prefer `ListRow` for new work. */
export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border border-[color:var(--hairline)] bg-background px-4 py-3.5 text-sm sm:items-center',
        className,
      )}
    >
      {children}
    </div>
  )
}
