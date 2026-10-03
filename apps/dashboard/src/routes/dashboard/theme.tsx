import { createFileRoute, redirect } from '@tanstack/react-router'
import { ThemePage } from '~/components/dashboard/ThemePage'
import { canManageDashboardSettings } from '~/lib/dashboard-role'

function ThemeRoutePage() {
  const context = Route.useRouteContext()
  return <ThemePage canEdit={canManageDashboardSettings(context.app?.actor.role)} />
}

export const Route = createFileRoute('/dashboard/theme')({
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (context.app.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ThemeRoutePage,
})
