import { createFileRoute } from '@tanstack/react-router'
import { ActivityPage } from '~/components/dashboard/ActivityPage'

export const Route = createFileRoute('/dashboard/activity')({
  component: ActivityPage,
})