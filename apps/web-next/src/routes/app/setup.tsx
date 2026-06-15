import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app/setup')({
  component: SetupPlaceholder,
})

function SetupPlaceholder() {
  return (
    <PageHeader
      kicker="Setup"
      title="Site setup"
      description="Onboarding form will be ported in the auth/setup migration step."
    />
  )
}