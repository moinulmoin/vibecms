import { getRequestHeaders } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { auth } from '~/server/auth'
import { ensureOnboarding } from '~/server/onboarding'
import type { AppRouterContext, SessionUser } from '~/server/auth-context-types'

export async function resolveAppRouterContext(): Promise<AppRouterContext> {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  const authUrl = env.BETTER_AUTH_URL
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

  if (!session?.user) {
    return { authUrl, googleEnabled, user: null, app: null }
  }

  const user: SessionUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
  const app = await ensureOnboarding(user)
  return { authUrl, googleEnabled, user, app }
}

export async function getAuthSessionSmokePayload() {
  const ctx = await resolveAppRouterContext()
  if (!ctx.user) return { signedIn: false as const }
  return {
    signedIn: true as const,
    user: ctx.user,
    workspaceId: ctx.app?.workspaceId,
    siteId: ctx.app?.siteId,
  }
}