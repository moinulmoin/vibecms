const APP_PATH_PREFIX = '/dashboard'

export type CanonicalHostContext = {
  /** The canonical app/auth host (APP_URL hostname), e.g. app.vibecms.dev. */
  appHost: string
  /** True in single-domain deployments (self-host / dev app-path mode) where one host serves all. */
  usesAppPath: boolean
}

// Pure host canonicalization (env wired in canonical-host.server.ts). Subdomain mode only:
// app-host root -> /dashboard; keep /dashboard,/login,/api/auth on the app host (GET redirect, else 404).
export function resolveCanonicalRedirect(
  request: Request,
  ctx: CanonicalHostContext,
): Response | undefined {
  if (ctx.usesAppPath) return undefined
  const appHost = ctx.appHost.toLowerCase()
  if (!appHost) return undefined

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return undefined
  }

  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return undefined

  const path = url.pathname

  if (host === appHost) {
    if (path === '/') {
      url.pathname = APP_PATH_PREFIX
      return new Response(null, { status: 308, headers: { location: url.toString() } })
    }
    return undefined
  }

  // Another host (apex marketing or a tenant blog): app/auth surfaces must not be served here.
  const isAppSurface =
    path === APP_PATH_PREFIX ||
    path.startsWith(`${APP_PATH_PREFIX}/`) ||
    path === '/login' ||
    path === '/api/auth' ||
    path.startsWith('/api/auth/')
  if (!isAppSurface) return undefined

  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    url.hostname = appHost
    url.protocol = 'https:'
    url.port = ''
    return new Response(null, { status: 308, headers: { location: url.toString() } })
  }

  // Non-idempotent app-surface request on the wrong host: refuse so no auth/cookie writes off-origin.
  return new Response('Not found', { status: 404 })
}

// True when an auth session may be resolved for this host (app host, or any host in single-domain/local dev).
export function isAppContextHost(host: string, ctx: CanonicalHostContext): boolean {
  if (ctx.usesAppPath) return true
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  return h === ctx.appHost.toLowerCase()
}
