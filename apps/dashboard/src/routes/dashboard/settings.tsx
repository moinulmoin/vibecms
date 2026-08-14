import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsPage } from '~/components/dashboard/SettingsPage'
import { validateSettingsSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard/settings')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: validateSettingsSearch,
  component: SettingsPage,
})