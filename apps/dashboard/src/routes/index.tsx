import { createFileRoute, redirect } from '@tanstack/react-router'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: '/login' })
    }
    if (!context.siteSetupComplete) {
      throw redirect({ to: '/dashboard/setup', search: emptyDashboardStatusSearch })
    }
    throw redirect({ to: '/dashboard' })
  },
})