import { createServerFn } from '@tanstack/react-start'
import { getAuthSessionSmokePayload, resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

export type { AppRouterContext, SessionUser } from '~/server/auth-context-types'

export const loadAppRouterContext = createServerFn({ method: 'GET' }).handler(async () => {
  return resolveAppRouterContext()
})

export const getAuthSessionSmoke = createServerFn({ method: 'GET' }).handler(async () => {
  return getAuthSessionSmokePayload()
})