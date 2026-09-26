import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsPage } from '~/components/dashboard/SettingsPage'
import { validateSettingsSearch } from '~/lib/dashboard-search'
import { queryClient, settingsQuery, warm } from '~/lib/queries'
import { canManageDashboardSettings } from '~/lib/dashboard-role'

function SettingsRoutePage() {
  const context = Route.useRouteContext()
  return <SettingsPage canEdit={canManageDashboardSettings(context.app?.actor.role)} />
}

export const Route = createFileRoute('/dashboard/settings')({
  beforeLoad: ({ context, search }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
    if (search.tab === 'theme') {
      throw redirect({ to: '/dashboard/theme' })
    }
    if (search.tab === 'newsletter') {
      throw redirect({ to: '/dashboard/subscribers', search: { q: undefined, status: undefined, page: 1, tab: 'form' } })
    }
  },
  validateSearch: validateSettingsSearch,
  loader: () => warm(queryClient.prefetchQuery(settingsQuery)),
  component: SettingsRoutePage,
})
