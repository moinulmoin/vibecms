import type { AppChoice, AppUserContext } from '@/server/onboarding'

export type SessionUser = { id: string; name: string; email: string }

export type AppRouterContext = {
  googleEnabled: boolean
  user: SessionUser | null
  app: AppUserContext | null
  apps: AppChoice[]
  /** From D1 site row; false when signed out or setup incomplete. */
  siteSetupComplete: boolean
  siteDisplayName: string | null
}