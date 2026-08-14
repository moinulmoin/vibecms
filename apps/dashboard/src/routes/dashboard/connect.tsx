import { createFileRoute, redirect } from '@tanstack/react-router'
import { ConnectPage } from '~/components/dashboard/ConnectPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/connect')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateDashboardSearch,
  component: ConnectPage,
})