import { createFileRoute } from '@tanstack/react-router'
import { DashboardOverview } from '~/components/dashboard/DashboardOverview'
import { canManageDashboardContent } from '~/lib/dashboard-role'
import { overviewQuery, queryClient, warm } from '~/lib/queries'

export const Route = createFileRoute('/dashboard/')({
  loader: () => warm(queryClient.prefetchQuery(overviewQuery)),
  component: AppOverviewPage,
})

function AppOverviewPage() {
  const { app } = Route.useRouteContext()
  return <DashboardOverview canEdit={canManageDashboardContent(app?.actor.role)} />
}