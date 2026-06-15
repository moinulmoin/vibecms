import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app')({
  ssr: false,
  beforeLoad: ({ context, location }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (location.pathname !== '/app/setup' && !context.siteSetupComplete) {
      throw redirect({ to: '/app/setup' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { app, authUrl, siteDisplayName } = Route.useRouteContext()

  return (
    <AppShell siteName={siteDisplayName ?? undefined} userEmail={app?.user.email} authUrl={authUrl}>
      <Outlet />
    </AppShell>
  )
}