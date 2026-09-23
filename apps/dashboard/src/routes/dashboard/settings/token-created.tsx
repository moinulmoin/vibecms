import { createFileRoute, redirect } from '@tanstack/react-router'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'

/** Legacy URL: the one-time key now appears on Connect, which reads it from session storage. */
export const Route = createFileRoute('/dashboard/settings/token-created')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/connect', search: emptyDashboardStatusSearch })
  },
})
