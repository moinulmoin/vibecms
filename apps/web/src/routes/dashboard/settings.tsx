import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '~/components/dashboard/SettingsPage'
import { validateSettingsSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/settings')({
  validateSearch: validateSettingsSearch,
  component: SettingsPage,
})