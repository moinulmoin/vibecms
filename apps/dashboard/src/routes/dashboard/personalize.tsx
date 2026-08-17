import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonalizePage } from '~/components/dashboard/PersonalizePage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/personalize')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateDashboardSearch,
  component: PersonalizePage,
})
