import { createFileRoute } from '@tanstack/react-router'
import { TokenCreatedPage } from '~/components/dashboard/TokenCreatedPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/settings/token-created')({
  validateSearch: validateDashboardSearch,
  component: TokenCreatedPage,
})