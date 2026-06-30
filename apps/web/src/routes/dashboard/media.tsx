import { createFileRoute } from '@tanstack/react-router'
import { MediaPage } from '~/components/dashboard/MediaPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/media')({
  validateSearch: validateDashboardSearch,
  component: MediaPage,
})