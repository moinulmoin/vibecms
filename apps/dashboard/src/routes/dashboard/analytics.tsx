import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage, type AnalyticsTab } from '~/components/dashboard/AnalyticsPage'
import { analyticsQuery, queryClient, warm } from '~/lib/queries'
import type { AnalyticsRange } from '~/types/dashboard'

function parseRange(value: unknown): AnalyticsRange | undefined {
  if (value === 'all') return 'all'
  const days = Number(value)
  return days === 7 || days === 90 || days === 365 ? days : undefined
}

export const Route = createFileRoute('/dashboard/analytics')({
  validateSearch: (search: Record<string, unknown>): { range?: AnalyticsRange; tab?: AnalyticsTab } => {
    const range = parseRange(search.range)
    const tab = search.tab === 'agents' ? 'agents' : undefined
    return {
      ...(range === undefined ? {} : { range }),
      ...(tab === undefined ? {} : { tab }),
    }
  },
  loaderDeps: ({ search }) => ({ range: search.range ?? 30 }),
  loader: ({ deps }) => warm(queryClient.prefetchQuery(analyticsQuery(deps.range))),
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  const { range, tab } = Route.useSearch()
  return <AnalyticsPage range={range ?? 30} tab={tab ?? 'people'} />
}
