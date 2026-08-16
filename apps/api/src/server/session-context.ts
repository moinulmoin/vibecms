import { env } from 'cloudflare:workers'
import { auth, githubSignInEnabled, googleSignInEnabled } from '@/server/auth'
import { readAppSelection } from '@/server/app-selection'
import { isAppContextHost } from '@/server/canonical-host'
import { getSiteSetup, resolveUserAppContext } from '@/server/onboarding'
import type { AppRouterContext, SessionUser } from '@/server/auth-context-types'

export async function resolveAppSessionContext(request: Request): Promise<AppRouterContext> {
  const googleEnabled = googleSignInEnabled()
  const githubEnabled = githubSignInEnabled()
  const signedOut: AppRouterContext = {
    googleEnabled,
    githubEnabled,
    user: null,
    app: null,
    apps: [],
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
  const { app, apps } = await resolveUserAppContext(
    user,
    await readAppSelection(request),
  )
  const setup = await getSiteSetup(app)
  const selected = apps.find((choice) => choice.siteId === app.siteId)
  const setupComplete = selected?.managed !== null || setup.isComplete
  return {
    googleEnabled,
    githubEnabled,
    user,
    app,
    apps,
    siteSetupComplete: setupComplete,
    siteDisplayName: setupComplete ? setup.name : null,
  }
}

export async function requireAppFromRequest(request: Request) {
  const ctx = await resolveAppSessionContext(request)
  if (!ctx.app) {
    return { error: Response.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 }) }
  }
  return { app: ctx.app, ctx }
}