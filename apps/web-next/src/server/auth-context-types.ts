import type { AppUserContext } from '~/server/onboarding'

export type SessionUser = { id: string; name: string; email: string }

export type AppRouterContext = {
  authUrl: string
  googleEnabled: boolean
  user: SessionUser | null
  app: AppUserContext | null
}