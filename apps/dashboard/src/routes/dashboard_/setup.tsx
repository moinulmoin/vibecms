import { createFileRoute, redirect } from '@tanstack/react-router'
import { SetupPage } from '~/components/dashboard/SetupPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard_/setup')({
  ssr: false,
  validateSearch: validateDashboardSearch,
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (context.siteSetupComplete) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: SetupPage,
})
