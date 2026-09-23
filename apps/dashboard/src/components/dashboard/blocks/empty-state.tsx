import type { ReactNode } from 'react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}) {
  return (
    <Empty className={compact ? 'gap-2 border-0 p-0 text-left sm:items-start' : 'flex-none py-16'}>
      <EmptyHeader className={compact ? 'max-w-none flex-row items-center gap-2' : undefined}>
        {icon ? <EmptyMedia variant="icon" className={compact ? 'mb-0 size-6 [&_svg:not([class*=size-])]:size-3' : undefined}>{icon}</EmptyMedia> : null}
        <EmptyContent className={compact ? 'w-auto max-w-none min-w-0 flex-row flex-wrap items-baseline gap-x-2 gap-y-0' : undefined}>
          <EmptyTitle className={compact ? undefined : 'text-base font-semibold'}>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyContent>
      </EmptyHeader>
      {action ? <div className={compact ? 'flex flex-wrap gap-2' : 'mt-1 flex flex-wrap justify-center gap-2'}>{action}</div> : null}
    </Empty>
  )
}
