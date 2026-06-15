import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app/activity')({
  component: ActivityPlaceholder,
})

function ActivityPlaceholder() {
  return (
    <PageHeader
      kicker="Activity"
      title="Activity"
      description="Activity log will be ported in the next migration step."
    />
  )
}