import { createFileRoute } from '@tanstack/react-router'
import { DashboardOverview } from '~/components/dashboard/DashboardOverview'

export const Route = createFileRoute('/dashboard/')({
  component: AppOverviewPage,
})

function AppOverviewPage() {
  return <DashboardOverview />
}