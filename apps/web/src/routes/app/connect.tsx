import { createFileRoute } from '@tanstack/react-router'
import { ConnectPage } from '~/components/dashboard/ConnectPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/app/connect')({
  validateSearch: validateDashboardSearch,
  component: ConnectPage,
})