import { createFileRoute } from '@tanstack/react-router'
import { BillingRequiredPage } from '~/components/dashboard/BillingRequiredPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/app/billing')({
  validateSearch: validateDashboardSearch,
  component: BillingRequiredPage,
})