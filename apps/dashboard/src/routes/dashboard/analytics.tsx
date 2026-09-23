import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage } from '~/components/dashboard/AnalyticsPage'
import { analyticsQuery, queryClient, warm } from '~/lib/queries'
import type { AnalyticsRange } from '~/types/dashboard'

function parseRange(value: unknown): AnalyticsRange | undefined {
  if (value === 'all') return 'all'
  const days = Number(value)
  return days === 7 || days === 90 || days === 365 ? days : undefined
}

export const Route = createFileRoute('/dashboard/analytics')({
  validateSearch: (search: Record<string, unknown>): { range?: AnalyticsRange } => {
    const range = parseRange(search.range)
    return range === undefined ? {} : { range }
  },
  loaderDeps: ({ search }) => ({ range: search.range ?? 30 }),
  loader: ({ deps }) => warm(queryClient.prefetchQuery(analyticsQuery(deps.range))),
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  const { range } = Route.useSearch()
  return <AnalyticsPage range={range ?? 30} />
}
