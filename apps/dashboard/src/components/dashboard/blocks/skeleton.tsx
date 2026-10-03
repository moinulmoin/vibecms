import type { ReactNode } from 'react'
import { cn, Skeleton } from '@vc/ui'

export type PageSkeletonVariant = 'stats' | 'list' | 'table' | 'detail' | 'panels'

type PageSkeletonProps = {
  variant?: PageSkeletonVariant
  /** Set false when the real page header is already on screen. */
  withHeader?: boolean
  className?: string
  children?: ReactNode
}

function SkeletonHeader() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-hidden="true">
      <div className="min-w-0 space-y-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-[32rem]" />
      </div>
      <Skeleton className="h-9 w-24 shrink-0" />
    </div>
  )
}

function SkeletonPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-5 rounded-xl border border-border bg-card p-5 sm:p-6', className)} aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      {children}
    </section>
  )
}

function SkeletonRows({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3', className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  )
}

function SkeletonTable() {
  return (
    <SkeletonPanel>
      <div className="grid gap-3" aria-hidden="true">
        <div className="grid grid-cols-[1.5fr_repeat(3,1fr)] gap-3 border-b border-border pb-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-3/4" />
          ))}
        </div>
        <SkeletonRows count={7} />
      </div>
    </SkeletonPanel>
  )
}

function SkeletonVariant({ variant }: { variant: PageSkeletonVariant }) {
  if (variant === 'stats') {
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
        <SkeletonPanel>
          <SkeletonRows count={5} />
        </SkeletonPanel>
      </>
    )
  }

  if (variant === 'table') return <SkeletonTable />

  if (variant === 'detail') {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <SkeletonPanel>
          <div className="grid gap-4">
            <Skeleton className="h-44 w-full rounded-xl" />
            <SkeletonRows count={4} />
          </div>
        </SkeletonPanel>
        <SkeletonPanel>
          <SkeletonRows count={4} />
        </SkeletonPanel>
      </div>
    )
  }

  if (variant === 'panels') {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonPanel>
          <SkeletonRows count={4} />
        </SkeletonPanel>
        <SkeletonPanel>
          <SkeletonRows count={4} />
        </SkeletonPanel>
      </div>
    )
  }

  return (
    <SkeletonPanel>
      <SkeletonRows count={6} />
    </SkeletonPanel>
  )
}

export function PageSkeleton({ variant = 'list', withHeader = true, className, children }: PageSkeletonProps) {
  return (
    <div className={cn('grid gap-6', className)} aria-busy="true" aria-label="Loading page">
      {withHeader ? <SkeletonHeader /> : null}
      {children ?? <SkeletonVariant variant={variant} />}
    </div>
  )
}
