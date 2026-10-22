import { AppError, RateLimitError } from '@vc/core'
import { apiRateLimitHeaders, apiRetryAfterSeconds } from '@/server/usage'

export function errorEnvelope(code: string, message: string, details?: unknown, requestId?: string, retryAfterSeconds?: number) {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(requestId ? { requestId } : {}),
    },
  }
}

export function statusForAppError(error: AppError) {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'BILLING_REQUIRED':
      return 402
    case 'NOT_FOUND':
      return 404
    case 'CONFLICT':
      return 409
    case 'RATE_LIMIT':
      return 429
    case 'VALIDATION_ERROR':
      return 400
    default:
      return error.status >= 400 && error.status < 600 ? error.status : 500
  }
}

// Route request schemas throw ZodError; surface them as input errors, not 500s.
function zodIssueMessage(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== 'ZodError' || !('issues' in error)) return null
  const issues = error.issues
  if (!Array.isArray(issues) || issues.length === 0) return 'Invalid request'
  return issues
    .slice(0, 5)
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return 'input: Invalid value'
      const path = 'path' in issue && Array.isArray(issue.path) ? issue.path.join('.') : 'input'
      const message = 'message' in issue && typeof issue.message === 'string' ? issue.message : 'Invalid value'
      return `${path || 'input'}: ${message}`
    })
    .join('; ')
}

export function jsonAppError(error: unknown, requestId?: string): Response {
  if (error instanceof RateLimitError) {
    const retryAfterSeconds = apiRetryAfterSeconds(error)
    return Response.json(errorEnvelope('RATE_LIMIT', error.message, undefined, requestId, retryAfterSeconds), {
      status: 429,
      headers: {
        ...(apiRateLimitHeaders(error) as Record<string, string> | undefined),
        ...(retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : {}),
      },
    })
  }
  if (error instanceof AppError) {
    const status = statusForAppError(error)
    const code = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'BILLING_REQUIRED',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMIT',
      'VALIDATION_ERROR',
    ].includes(error.code)
      ? error.code
      : 'INTERNAL_ERROR'
    const retryAfterSeconds = code === 'RATE_LIMIT' ? apiRetryAfterSeconds(error) : undefined
    return Response.json(errorEnvelope(code, error.message, undefined, requestId, retryAfterSeconds), {
      status,
      headers: retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
    })
  }
  const validationMessage = zodIssueMessage(error)
  if (validationMessage) {
    return Response.json(errorEnvelope('VALIDATION_ERROR', validationMessage, undefined, requestId), { status: 400 })
  }
  return Response.json(errorEnvelope('INTERNAL_ERROR', 'Request failed', undefined, requestId), { status: 500 })
}
