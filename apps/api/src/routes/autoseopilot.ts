import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  MANAGED_BODY_LIMIT,
  ManagedInternalError,
  managedProvisionRequestSchema,
  managedRevokeRequestSchema,
  getManagedSite,
  provisionManagedSite,
  revokeManagedSite,
} from '@/server/autoseopilot-managed'

type ManagedRouteEnv = {
  Bindings: Cloudflare.Env
  Variables: {
    correlationId: string
  }
}

const SECRET_HEADER = 'X-AUTOSEOPILOT-INTERNAL-SECRET'
const CORRELATION_HEADER = 'X-Correlation-Id'
const CORRELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SECRETISH_CORRELATION_RE =
  /(?:vc_(?:live|test)_|bearer|authorization|token|secret|password|@)/i

function errorBody(
  code: string,
  message: string,
  correlationId: string,
) {
  return { error: { code, message, correlationId } }
}

function validCorrelationId(value: string, internalSecret: string | undefined) {
  return (
    CORRELATION_ID_RE.test(value) &&
    !SECRETISH_CORRELATION_RE.test(value) &&
    value !== internalSecret
  )
}

function correlationId(request: Request, internalSecret: string | undefined) {
  const supplied = request.headers.get(CORRELATION_HEADER)
  if (supplied !== null && validCorrelationId(supplied, internalSecret)) return supplied
  return crypto.randomUUID()
}

async function sameSecret(expected: string, supplied: string) {
  const encoder = new TextEncoder()
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
  ])
  const left = new Uint8Array(expectedHash)
  const right = new Uint8Array(suppliedHash)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

async function parseJson<T>(request: Request) {
  try {
    return { value: await request.json<T>() }
  } catch {
    return { error: 'Invalid JSON body.' }
  }
}

export const autoseopilotRoutes = new Hono<ManagedRouteEnv>()

autoseopilotRoutes.onError((_, c) => {
  const id =
    c.get('correlationId') ??
    correlationId(c.req.raw, c.env.AUTOSEOPILOT_INTERNAL_SECRET)
  c.header('Cache-Control', 'no-store')
  c.header('X-Correlation-Id', id)
  return c.json(errorBody('INTERNAL_ERROR', 'Request failed.', id), 500)
})

autoseopilotRoutes.use('*', async (c, next) => {
  const id = correlationId(c.req.raw, c.env.AUTOSEOPILOT_INTERNAL_SECRET)
  c.header('Cache-Control', 'no-store')
  c.header('X-Correlation-Id', id)
  c.set('correlationId', id)

  if (!c.env.AUTOSEOPILOT_INTERNAL_SECRET) {
    return c.json(errorBody('NOT_FOUND', 'Not found', id), 404)
  }
  const supplied = c.req.header(SECRET_HEADER) ?? ''
  if (!(await sameSecret(c.env.AUTOSEOPILOT_INTERNAL_SECRET, supplied))) {
    return c.json(errorBody('UNAUTHORIZED', 'Authentication required', id), 401)
  }
  const suppliedCorrelation = c.req.header(CORRELATION_HEADER)
  if (
    suppliedCorrelation !== undefined &&
    !validCorrelationId(suppliedCorrelation, c.env.AUTOSEOPILOT_INTERNAL_SECRET)
  ) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid correlation ID.', id), 400)
  }
  await next()
})

autoseopilotRoutes.use(
  '*',
  bodyLimit({
    maxSize: MANAGED_BODY_LIMIT,
    onError: (c) => {
      const id = c.get('correlationId')
      return c.json(errorBody('REQUEST_TOO_LARGE', 'Request body is too large.', id), 413)
    },
  }),
)

autoseopilotRoutes.put('/sites/:externalWorkspaceId', async (c) => {
  const id = c.get('correlationId')
  const params = c.req.param('externalWorkspaceId')
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) {
    return c.json(errorBody('VALIDATION_ERROR', 'JSON body required.', id), 400)
  }
  const parsedParams = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params)
  if (!parsedParams) return c.json(errorBody('VALIDATION_ERROR', 'Invalid external workspace ID', id), 400)
  const body = await parseJson<unknown>(c.req.raw)
  if ('error' in body) return c.json(errorBody('VALIDATION_ERROR', body.error ?? 'Invalid JSON body.', id), 400)
  const result = managedProvisionRequestSchema.safeParse(body.value)
  if (!result.success) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid request.', id), 400)
  }
  try {
    const resultWithReceipt = await provisionManagedSite(c.env, params, result.data, id)
    return c.json(resultWithReceipt.receipt, resultWithReceipt.status)
  } catch (error) {
    return handleManagedError(c, error, id)
  }
})

autoseopilotRoutes.get('/sites/:externalWorkspaceId', async (c) => {
  const id = c.get('correlationId')
  const externalWorkspaceId = c.req.param('externalWorkspaceId')
  try {
    return c.json(await getManagedSite(c.env, externalWorkspaceId, id), 200)
  } catch (error) {
    return handleManagedError(c, error, id)
  }
})

autoseopilotRoutes.post('/sites/:externalWorkspaceId/revoke', async (c) => {
  const id = c.get('correlationId')
  const externalWorkspaceId = c.req.param('externalWorkspaceId')
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) {
    return c.json(errorBody('VALIDATION_ERROR', 'JSON body required.', id), 400)
  }
  const body = await parseJson<unknown>(c.req.raw)
  if ('error' in body) return c.json(errorBody('VALIDATION_ERROR', body.error ?? 'Invalid JSON body.', id), 400)
  const result = managedRevokeRequestSchema.safeParse(body.value)
  if (!result.success) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid request.', id), 400)
  }
  try {
    const resultWithReceipt = await revokeManagedSite(c.env, externalWorkspaceId, result.data, id)
    return c.json(resultWithReceipt.receipt, resultWithReceipt.status)
  } catch (error) {
    return handleManagedError(c, error, id)
  }
})

function handleManagedError(
  c: {
    json: (body: unknown, status: 400 | 401 | 404 | 409 | 413 | 500) => Response
  },
  error: unknown,
  id: string,
) {
  if (error instanceof ManagedInternalError) {
    return c.json(errorBody(error.code, error.message, id), error.status)
  }
  return c.json(errorBody('INTERNAL_ERROR', 'Request failed.', id), 500)
}
