import { createFileRoute, redirect } from '@tanstack/react-router'
import { MediaPage } from '~/components/dashboard/MediaPage'
import { validateDashboardSearch } from '~/lib/dashboard-search'
import { mediaQuery, queryClient, warm } from '~/lib/queries'

export const Route = createFileRoute('/dashboard/media')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateDashboardSearch,
  loader: () => warm(queryClient.prefetchQuery(mediaQuery)),
  component: MediaPage,
})
