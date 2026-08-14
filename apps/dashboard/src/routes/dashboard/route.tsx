import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '~/components/dashboard/DashboardLayout'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (!context.siteSetupComplete) {
      throw redirect({ to: '/dashboard/setup', search: emptyDashboardStatusSearch })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { app, apps, siteDisplayName } = Route.useRouteContext()

  return (
    <AppShell
      siteName={siteDisplayName ?? undefined}
      userEmail={app?.user.email}
      apps={apps}
      currentWorkspaceId={app?.workspaceId}
      currentSiteId={app?.siteId}
      currentRole={app?.actor.role}
    >
      <Outlet />
    </AppShell>
  )
}