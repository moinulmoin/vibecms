import { createFileRoute, redirect } from '@tanstack/react-router'
import { SetupPage } from '~/components/dashboard/SetupPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'
import { queryClient, setupQuery, warm } from '~/lib/queries'

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
  loader: () => warm(queryClient.prefetchQuery(setupQuery), 400),
  component: SetupPage,
})
