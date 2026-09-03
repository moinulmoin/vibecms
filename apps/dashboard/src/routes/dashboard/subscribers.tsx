import { createFileRoute, redirect } from '@tanstack/react-router'
import { SubscribersPage } from '~/components/dashboard/SubscribersPage'

type SubscribersSearch = {
  q: string | undefined
  status: string | undefined
  page: number
}

function validateSubscribersSearch(search: Record<string, unknown>): SubscribersSearch {
  const rawPage = typeof search.page === 'number' ? search.page : Number(search.page)
  return {
    q: typeof search.q === 'string' ? search.q : undefined,
    status: typeof search.status === 'string' ? search.status : undefined,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  }
}

export const Route = createFileRoute('/dashboard/subscribers')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateSubscribersSearch,
  component: SubscribersRoutePage,
})

function SubscribersRoutePage() {
  const { app } = Route.useRouteContext()
  return <SubscribersPage search={Route.useSearch()} canExport={app?.actor.role === 'owner'} />
}
