import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '~/components/dashboard/DashboardLayout'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { contextQuery } from '~/lib/queries'

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
  const routeContext = Route.useRouteContext()
  // Read through the cache so a rename or refresh shows up without navigating.
  const { data } = useQuery({ ...contextQuery, initialData: routeContext })
  const { app, apps, siteDisplayName } = data
  const navigate = useNavigate()

  // A background refresh found the session gone (signed out elsewhere): leave.
  useEffect(() => {
    if (!app) void navigate({ to: '/login', replace: true })
  }, [app, navigate])

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