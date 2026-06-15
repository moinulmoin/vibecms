import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app/media')({
  component: MediaPlaceholder,
})

function MediaPlaceholder() {
  return (
    <PageHeader kicker="Media" title="Media" description="Media library will be ported in the next migration step." />
  )
}