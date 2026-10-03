import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage, type ActivityActor } from '~/components/dashboard/ActivityPage'
import { activityQuery, queryClient, warm } from '~/lib/queries'

type ActivitySearch = { actor?: Exclude<ActivityActor, 'all'> }

export const Route = createFileRoute('/dashboard/activity')({
  validateSearch: (search: Record<string, unknown>): ActivitySearch =>
    search.actor === 'human' || search.actor === 'agent' ? { actor: search.actor } : {},
  loaderDeps: ({ search }) => ({ actor: (search.actor ?? 'all') as ActivityActor }),
  loader: ({ deps }) =>
    warm(queryClient.prefetchInfiniteQuery(activityQuery(deps.actor))),
  component: ActivityRoute,
})

function ActivityRoute() {
  const { actor } = Route.useSearch()
  return <ActivityPage actor={actor ?? 'all'} />
}
