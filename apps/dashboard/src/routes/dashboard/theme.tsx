import { createFileRoute, redirect } from '@tanstack/react-router'
import { ThemePage } from '~/components/dashboard/ThemePage'

export const Route = createFileRoute('/dashboard/theme')({
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (context.app.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ThemePage,
})
