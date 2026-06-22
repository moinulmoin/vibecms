import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage } from '~/components/dashboard/ActivityPage'

export const Route = createFileRoute('/app/activity')({
  component: ActivityPage,
})