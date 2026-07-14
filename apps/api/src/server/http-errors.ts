import { AppError, RateLimitError } from '@vc/core'
import { apiRateLimitHeaders } from '@/server/usage'

export function errorEnvelope(code: string, message: string, details?: unknown, requestId?: string) {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
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

export function jsonAppError(error: unknown, requestId?: string): Response {
  if (error instanceof RateLimitError) {
    return Response.json(errorEnvelope('RATE_LIMIT', error.message, undefined, requestId), {
      status: 429,
      headers: apiRateLimitHeaders(error) as Record<string, string>,
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
    return Response.json(errorEnvelope(code, error.message, undefined, requestId), { status })
  }
  return Response.json(errorEnvelope('INTERNAL_ERROR', 'Request failed', undefined, requestId), { status: 500 })
}