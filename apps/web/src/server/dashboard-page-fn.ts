import { createServerFn } from '@tanstack/react-start'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'
import { getDashboardData } from '~/server/cms-dashboard'

export const loadDashboardOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await resolveAppRouterContext()
  if (!ctx.app) {
    throw new Error('UNAUTHORIZED')
  }
  return getDashboardData(ctx.app)
})