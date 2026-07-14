import { env } from 'cloudflare:workers'
import { auth, googleSignInEnabled } from '@/server/auth'
import { isAppContextHost } from '@/server/canonical-host'
import { ensureOnboarding, getSiteSetup } from '@/server/onboarding'
import type { AppRouterContext, SessionUser } from '@/server/auth-context-types'

export async function resolveAppSessionContext(request: Request): Promise<AppRouterContext> {
  const googleEnabled = googleSignInEnabled()
  const signedOut: AppRouterContext = {
    googleEnabled,
    user: null,
    app: null,
    siteSetupComplete: false,
    siteDisplayName: null,
  }

  let requestHost = ''
  try {
    requestHost = new URL(request.url).hostname
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

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return signedOut

  const user: SessionUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
  const app = await ensureOnboarding(user)
  const setup = await getSiteSetup(app)
  return {
    googleEnabled,
    user,
    app,
    siteSetupComplete: setup.isComplete,
    siteDisplayName: setup.isComplete ? setup.name : null,
  }
}

export async function requireAppFromRequest(request: Request) {
  const ctx = await resolveAppSessionContext(request)
  if (!ctx.app) {
    return { error: Response.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 }) }
  }
  return { app: ctx.app, ctx }
}