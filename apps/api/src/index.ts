import { Hono, type Context } from 'hono'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { timeout } from 'hono/timeout'
import { HTTPException } from 'hono/http-exception'
import { auth } from '@/server/auth'
import { maybeRejectOtpSendRateLimit } from '@/server/auth-guards'
import { apiV1App } from '@/server/api/app'
import { handleMcpRequest } from '@/server/mcp'
import { handlePolarWebhook } from '@/server/billing'
import { handleExport } from '@/server/export'
import { uploadAssetForApp } from '@/server/media'
import { serveAsset } from '@/server/media'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'
import { ensureOnboarding } from '@/server/onboarding'
import { authenticateBearerToken } from '@/server/api-keys'
import { apiError, boundedIntegerParam, forceQuotaForSmoke, postStatusParam } from '@/server/api-params'
import { getPosts } from '@/server/cms'
import { enforceApiBudget } from '@/server/usage'
import { canonicalHostMiddleware } from '@/server/canonical-host-middleware'
import { requireAppFromRequest } from '@/server/session-context'
import { deleteAssetForApp } from '@/server/media'
import { dashboardRoutes } from '@/routes/dashboard'
import { errorEnvelope, jsonAppError } from '@/server/http-errors'
import { runWithExecutionContext } from '@/server/execution-scope'
import { rpcHandleSubscribe } from '@/rpc/public'

type AppEnv = {
  Bindings: Cloudflare.Env
  Variables: { requestId: string }
}

export const app = new Hono<AppEnv>()

const NO_STORE = 'no-store'

function requestLog(c: Context<AppEnv>, status: number, durationMs: number) {
  return {
    service: 'vibecms-api',
    requestId: c.get('requestId'),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    durationMs,
    cfRay: c.req.header('cf-ray') ?? null,
  }
}

export function redactErrorText(value: string | undefined) {
  if (!value) return undefined
  return value
    .slice(0, 2_000)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(authorization|cookie|token|secret|otp|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b\d{6}\b/g, '[redacted-otp]')
}

app.use('*', async (c, next) => {
  const redirect = canonicalHostMiddleware(c.req.raw)
  if (redirect) return redirect
  await next()
})

app.use('*', requestId())
app.use('*', async (c, next) => {
  c.set('requestId', c.get('requestId') ?? crypto.randomUUID())
  await next()
  c.res.headers.set('X-Request-ID', c.get('requestId'))
})

app.use('*', secureHeaders())

app.use('/api/auth/*', bodyLimit({ maxSize: 64 * 1024 }))
app.use('/api/dashboard/*', bodyLimit({ maxSize: 4 * 1024 * 1024 }))
app.use('/api/subscribe', bodyLimit({ maxSize: 4 * 1024 }))
app.use('/api/v1/*', bodyLimit({ maxSize: 16 * 1024 * 1024 }))
app.use('/mcp', bodyLimit({ maxSize: 16 * 1024 * 1024 }))

app.use('*', async (c, next) => {
  const startedAt = Date.now()
  await next()
  const durationMs = Date.now() - startedAt
  if (c.res.status >= 500) {
    console.error(JSON.stringify({ level: 'error', event: 'request_failed', ...requestLog(c, c.res.status, durationMs) }))
  } else if (durationMs >= 1_500) {
    console.warn(JSON.stringify({ level: 'warn', event: 'slow_request', ...requestLog(c, c.res.status, durationMs) }))
  }
})
app.use('/api/auth/*', async (c, next) => {
  c.res.headers.set('Cache-Control', NO_STORE)
  await next()
})

app.use('/api/dashboard/*', async (c, next) => {
  c.res.headers.set('Cache-Control', NO_STORE)
  await next()
})

app.use('/api/subscribe', async (c, next) => {
  c.res.headers.set('Cache-Control', NO_STORE)
  await next()
})

app.use('/api/v1/*', async (c, next) => {
  c.res.headers.set('Cache-Control', NO_STORE)
  await next()
})

app.use('/mcp', async (c, next) => {
  c.res.headers.set('Cache-Control', NO_STORE)
  await next()
})

app.get('/api/health/live', (c) =>
  c.json({
    ok: true,
    service: 'vibecms-api',
    version: c.env.CF_VERSION_METADATA?.id ?? null,
  }),
)

app.get('/api/health/ready', async (c) => {
  c.header('Cache-Control', NO_STORE)
  const [database, assets] = await Promise.allSettled([
    c.env.DB.prepare('SELECT 1').first(),
    c.env.ASSETS_BUCKET.list({ limit: 1 }),
  ])
  const checks = {
    database: database.status === 'fulfilled' ? 'ready' : 'unavailable',
    assets: assets.status === 'fulfilled' ? 'ready' : 'unavailable',
  }
  const ready = database.status === 'fulfilled' && assets.status === 'fulfilled'
  if (!ready) return c.json({ ok: false, status: 'unavailable', checks }, 503)
  return c.json({ ok: true, status: 'ready', checks })
})

app.post('/api/subscribe', async (c) => rpcHandleSubscribe({ request: c.req.raw }))

app.all('/api/auth/*', async (c) => {
  const rateLimited = await maybeRejectOtpSendRateLimit(c.req.raw)
  if (rateLimited) return rateLimited
  return auth.handler(c.req.raw)
})

app.route('/api/dashboard', dashboardRoutes)

app.post(
  '/api/onboarding/ensure',
  bodyLimit({ maxSize: 8 * 1024 }),
  async (c) => {
    const csrf = rejectCrossOriginBrowserPost(c.req.raw)
    if (csrf) return csrf
    const authCtx = await requireAppFromRequest(c.req.raw)
    if ('error' in authCtx) return authCtx.error
    await ensureOnboarding(authCtx.app.user)
    return c.json({ ok: true })
  },
)

app.post('/api/polar/webhook', bodyLimit({ maxSize: 256 * 1024 }), timeout(30_000), async (c) =>
  handlePolarWebhook(c.req.raw),
)

app.get('/api/export.json', async (c) => {
  const authCtx = await requireAppFromRequest(c.req.raw)
  if ('error' in authCtx) return authCtx.error
  return handleExport(authCtx.app)
})

app.post('/api/media/upload', bodyLimit({ maxSize: 12 * 1024 * 1024 }), async (c) => {
  const csrf = rejectCrossOriginBrowserPost(c.req.raw)
  if (csrf) return csrf
  const authCtx = await requireAppFromRequest(c.req.raw)
  if ('error' in authCtx) return authCtx.error
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ kind: 'error', code: 'upload_missing_file' })
  const altText = typeof form.get('altText') === 'string' ? String(form.get('altText')) : undefined
  return c.json(await uploadAssetForApp(authCtx.app, file, altText))
})

app.post('/api/media/delete', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
  const csrf = rejectCrossOriginBrowserPost(c.req.raw)
  if (csrf) return csrf
  const authCtx = await requireAppFromRequest(c.req.raw)
  if ('error' in authCtx) return authCtx.error
  const body = await c.req.json<{ assetId: string }>()
  return c.json(await deleteAssetForApp(authCtx.app, body.assetId))
})

app.get('/media-assets/:assetId', async (c) => serveAsset(c.req.param('assetId')))

app.get('/api/posts', async (c) => {
  const authResult = await authenticateBearerToken(c.req.raw)
  if (!authResult) return c.json({ error: 'UNAUTHORIZED' }, 401)
  try {
    await enforceApiBudget({
      workspaceId: authResult.workspaceId,
      siteId: authResult.siteId,
      tokenId: authResult.tokenId,
      kind: 'read',
      force: forceQuotaForSmoke(c.req.raw),
    })
    const url = new URL(c.req.raw.url)
    const limit = boundedIntegerParam(url.searchParams.get('limit'), 20, 1, 100)
    const offset = boundedIntegerParam(url.searchParams.get('offset'), 0, 0, 10_000)
    const posts = await getPosts(
      {
        user: { id: 'api', name: authResult.actor.name, email: 'api' },
        workspaceId: authResult.workspaceId,
        siteId: authResult.siteId,
        actor: authResult.actor,
      },
      postStatusParam(url.searchParams.get('status')),
      url.searchParams.get('search') || undefined,
      limit,
      offset,
    )
    return c.json({ posts, pagination: { limit, offset, count: posts.length } })
  } catch (error) {
    return apiError(error)
  }
})

app.all('/api/v1/*', (c) => apiV1App.fetch(c.req.raw))
app.all('/mcp', (c) => handleMcpRequest(c.req.raw))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const response = err.getResponse()
    response.headers.set('X-Request-ID', c.get('requestId'))
    return response
  }
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_exception',
      ...requestLog(c, 500, 0),
      error: {
        name: err.name,
        message: redactErrorText(err.message),
        stack: redactErrorText(err.stack),
      },
    }),
  )
  return jsonAppError(err, c.get('requestId'))
})

app.notFound((c) => {
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/') || path === '/mcp') {
    return c.json(errorEnvelope('NOT_FOUND', 'Not found', undefined, c.get('requestId')), 404)
  }
  return c.env.ASSETS.fetch(c.req.raw)
})

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Response | Promise<Response> {
    return runWithExecutionContext(ctx, () => app.fetch(request, env, ctx))
  },
}