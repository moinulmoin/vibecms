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
        'flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-1 py-3.5 last:border-b-0',
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
 *  continuity with the previous `DataRow`; prefer `ListRow` for new work.
 *
 *  A row whose content includes an `a[data-row-key]` is itself clickable:
 *  clicking anywhere that is NOT an interactive element activates that key
 *  link (Marble-style row navigation). Modifier-clicks and text selection
 *  are left alone — the key link itself remains the focusable, middle-
 *  clickable target with full link semantics. */
export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="presentation"
      className={cn(
        'grid gap-2 border-b border-[color:var(--hairline)] px-1 py-3.5 text-sm transition-colors last:border-b-0 sm:items-center',
        'has-[a[data-row-key]]:cursor-pointer has-[a[data-row-key]]:hover:bg-foreground/[0.02]',
        className,
      )}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const target = event.target as HTMLElement
        if (target.closest('a,button,[role="button"],input,select,textarea,summary,label')) return
        if (window.getSelection()?.toString()) return
        const keyLink = event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-key]')
        keyLink?.click()
      }}
    >
      {children}
    </div>
  )
}
