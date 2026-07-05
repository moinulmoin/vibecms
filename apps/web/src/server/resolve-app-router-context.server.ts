import { getRequest, getRequestHeaders } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { auth } from '~/server/auth'
import { isAppContextHost } from '~/server/canonical-host'
import { ensureOnboarding, getSiteSetup } from '~/server/onboarding'
import type { AppRouterContext, SessionUser } from '~/server/auth-context-types'

export async function resolveAppRouterContext(): Promise<AppRouterContext> {
  const authUrl = env.BETTER_AUTH_URL
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  const signedOut: AppRouterContext = {
    authUrl,
    googleEnabled,
    user: null,
    app: null,
    siteSetupComplete: false,
    siteDisplayName: null,
  }

  // Never resolve/refresh a session off the app host (keeps auth cookies bound to APP_URL); fail closed.
  let requestHost = ''
  try {
    requestHost = new URL(getRequest().url).hostname
  } catch {
    requestHost = ''
  }
  let appHost = ''
  try {
    appHost = new URL(env.APP_URL).hostname
  } catch {
    appHost = ''
  }
  if (!isAppContextHost(requestHost, { appHost })) {
    return signedOut
  }

  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session?.user) return signedOut

  const user: SessionUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
  const app = await ensureOnboarding(user)
  const setup = await getSiteSetup(app)
  return {
    authUrl,
    googleEnabled,
    user,
    app,
    siteSetupComplete: setup.isComplete,
    siteDisplayName: setup.isComplete ? setup.name : null,
  }
}

