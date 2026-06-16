import { createServerFn } from '@tanstack/react-start'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

export type { AppRouterContext, SessionUser } from '~/server/auth-context-types'

export const loadAppRouterContext = createServerFn({ method: 'GET' }).handler(async () => {
  return resolveAppRouterContext()
})