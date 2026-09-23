import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonalizePage } from '~/components/dashboard/PersonalizePage'
import { emptyDashboardStatusSearch, validateDashboardSearch } from '~/lib/dashboard-search'
import { connectQuery, queryClient, warm } from '~/lib/queries'

export const Route = createFileRoute('/dashboard_/personalize')({
  ssr: false,
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (!context.siteSetupComplete) {
      throw redirect({ to: '/dashboard/setup', search: emptyDashboardStatusSearch })
    }
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateDashboardSearch,
  loader: () => warm(queryClient.prefetchQuery(connectQuery), 400),
  component: PersonalizePage,
})
