import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonalizePage } from '~/components/dashboard/PersonalizePage'
import { emptyDashboardStatusSearch, validateDashboardSearch } from '~/lib/dashboard-search'

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
  component: PersonalizePage,
})
