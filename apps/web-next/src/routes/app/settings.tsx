import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app/settings')({
  component: SettingsPlaceholder,
})

function SettingsPlaceholder() {
  return (
    <PageHeader
      kicker="Settings"
      title="Settings"
      description="Tokens, billing, and site settings will be ported in the next migration step."
    />
  )
}