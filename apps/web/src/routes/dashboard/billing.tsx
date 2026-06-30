import { createFileRoute } from '@tanstack/react-router'
import { BillingPage } from '~/components/dashboard/BillingPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/billing')({
  validateSearch: validateDashboardSearch,
  component: BillingPage,
})