import { createFileRoute } from '@tanstack/react-router'
import { DashboardOverview } from '~/components/dashboard/DashboardOverview'
import { canManageDashboardContent } from '~/lib/dashboard-role'

export const Route = createFileRoute('/dashboard/')({
  component: AppOverviewPage,
})

function AppOverviewPage() {
  const { app } = Route.useRouteContext()
  return <DashboardOverview canEdit={canManageDashboardContent(app?.actor.role)} />
}