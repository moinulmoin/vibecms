import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '~/components/dashboard/SettingsPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/app/settings')({
  validateSearch: validateDashboardSearch,
  component: SettingsPage,
})