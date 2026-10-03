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
const EXTERNAL_WORKSPACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function safeExternalWorkspaceId(value: string) {
  return EXTERNAL_WORKSPACE_ID_RE.test(value) ? value.toLowerCase() : null
}

function logManagedLifecycle(input: {
  operation: 'provision' | 'status' | 'revoke'
  outcome: 'success' | 'conflict' | 'failure'
  correlationId: string
  externalWorkspaceId: string
  status: number
  code: string
  lifecycleRevision?: number
  lifecycleStatus?: 'active' | 'revoked'
}) {
  const entry = {
    level: input.outcome === 'success' ? 'info' : input.outcome === 'conflict' ? 'warn' : 'error',
    event: 'autoseopilot_managed_lifecycle',
    operation: input.operation,
    outcome: input.outcome,
    status: input.status,
    code: input.code,
    correlationId: input.correlationId,
    externalWorkspaceId: safeExternalWorkspaceId(input.externalWorkspaceId),
    ...(input.lifecycleRevision === undefined ? {} : { lifecycleRevision: input.lifecycleRevision }),
    ...(input.lifecycleStatus === undefined ? {} : { lifecycleStatus: input.lifecycleStatus }),
  }
  const log = input.outcome === 'success'
    ? console.info
    : input.outcome === 'conflict'
      ? console.warn
      : console.error
  log(JSON.stringify(entry))
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
    logManagedLifecycle({
      operation: 'provision',
      outcome: 'success',
      correlationId: id,
      externalWorkspaceId: params,
      status: resultWithReceipt.status,
      code: resultWithReceipt.status === 201 ? 'PROVISIONED' : 'REPLAYED',
      lifecycleRevision: resultWithReceipt.receipt.lifecycle.revision,
      lifecycleStatus: resultWithReceipt.receipt.lifecycle.status,
    })
    return c.json(resultWithReceipt.receipt, resultWithReceipt.status)
  } catch (error) {
    return handleManagedError(c, error, id, 'provision', params)
  }
})

autoseopilotRoutes.get('/sites/:externalWorkspaceId', async (c) => {
  const id = c.get('correlationId')
  const externalWorkspaceId = c.req.param('externalWorkspaceId')
  try {
    const receipt = await getManagedSite(c.env, externalWorkspaceId, id)
    logManagedLifecycle({
      operation: 'status',
      outcome: 'success',
      correlationId: id,
      externalWorkspaceId,
      status: 200,
      code: 'STATUS_READ',
      lifecycleRevision: receipt.lifecycle.revision,
      lifecycleStatus: receipt.lifecycle.status,
    })
    return c.json(receipt, 200)
  } catch (error) {
    return handleManagedError(c, error, id, 'status', externalWorkspaceId)
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
    logManagedLifecycle({
      operation: 'revoke',
      outcome: 'success',
      correlationId: id,
      externalWorkspaceId,
      status: resultWithReceipt.status,
      code: resultWithReceipt.receipt.lifecycle.status === 'revoked' ? 'REVOKED' : 'RECONCILED',
      lifecycleRevision: resultWithReceipt.receipt.lifecycle.revision,
      lifecycleStatus: resultWithReceipt.receipt.lifecycle.status,
    })
    return c.json(resultWithReceipt.receipt, resultWithReceipt.status)
  } catch (error) {
    return handleManagedError(c, error, id, 'revoke', externalWorkspaceId)
  }
})

function handleManagedError(
  c: {
    json: (body: unknown, status: 400 | 401 | 404 | 409 | 413 | 500) => Response
  },
  error: unknown,
  id: string,
  operation: 'provision' | 'status' | 'revoke',
  externalWorkspaceId: string,
) {
  if (error instanceof ManagedInternalError) {
    logManagedLifecycle({
      operation,
      outcome: error.status === 409 ? 'conflict' : 'failure',
      correlationId: id,
      externalWorkspaceId,
      status: error.status,
      code: error.code,
    })
    return c.json(errorBody(error.code, error.message, id), error.status)
  }
  logManagedLifecycle({
    operation,
    outcome: 'failure',
    correlationId: id,
    externalWorkspaceId,
    status: 500,
    code: 'INTERNAL_ERROR',
  })
  return c.json(errorBody('INTERNAL_ERROR', 'Request failed.', id), 500)
}
