import { createFileRoute, redirect } from '@tanstack/react-router'
import { MediaPage } from '~/components/dashboard/MediaPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/media')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateDashboardSearch,
  component: MediaPage,
})