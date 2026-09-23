import { createFileRoute, redirect } from '@tanstack/react-router'
import { SubscribersPage, SUBSCRIBERS_PAGE_SIZE, subscribersParams } from '~/components/dashboard/SubscribersPage'
import { newsletterQuery, queryClient, subscribersQuery, warm } from '~/lib/queries'

type SubscribersSearch = {
  q: string | undefined
  status: string | undefined
  page: number
  tab?: 'form'
}

function validateSubscribersSearch(search: Record<string, unknown>): SubscribersSearch {
  const rawPage = typeof search.page === 'number' ? search.page : Number(search.page)
  return {
    q: typeof search.q === 'string' ? search.q : undefined,
    status: typeof search.status === 'string' ? search.status : undefined,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    ...(search.tab === 'form' ? { tab: 'form' as const } : {}),
  }
}

export const Route = createFileRoute('/dashboard/subscribers')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateSubscribersSearch,
  loaderDeps: ({ search }) => ({ q: search.q, status: search.status, page: search.page, tab: search.tab }),
  loader: ({ deps, context }) =>
    deps.tab === 'form' && context.app?.actor.role === 'owner'
      ? warm(queryClient.prefetchQuery(newsletterQuery))
      : warm(queryClient.prefetchQuery(subscribersQuery(subscribersParams(deps, SUBSCRIBERS_PAGE_SIZE)))),
  component: SubscribersRoutePage,
})

function SubscribersRoutePage() {
  const { app } = Route.useRouteContext()
  return <SubscribersPage search={Route.useSearch()} canExport={app?.actor.role === 'owner'} />
}
