import { createFileRoute } from '@tanstack/react-router'
import { SetupPage } from '~/components/dashboard/SetupPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/app/setup')({
  validateSearch: validateDashboardSearch,
  component: SetupPage,
})