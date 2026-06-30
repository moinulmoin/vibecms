import { checkOtpSendBudget } from '~/server/auth-rate-limit'
import { rejectCrossOriginBrowserPost } from '~/server/csrf'

const OTP_SEND_PATH = '/api/auth/email-otp/send-verification-otp'

export async function maybeRejectOtpSendRateLimit(request: Request): Promise<Response | undefined> {
  if (request.method !== 'POST') return undefined
  if (new URL(request.url).pathname !== OTP_SEND_PATH) return undefined

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return undefined

  let email = ''
  try {
    const body = (await request.clone().json()) as { email?: unknown }
    if (typeof body.email === 'string') email = body.email
  } catch {
    return undefined
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined

  const decision = await checkOtpSendBudget(email)
  if (!decision.allowed) {
    return Response.json(
      { error: 'RATE_LIMIT' },
      { status: 429, headers: { 'retry-after': String(decision.retryAfter) } },
    )
  }

  return undefined
}

export function maybeRejectCrossOriginAppPost(request: Request): Response | undefined {
  const pathname = new URL(request.url).pathname
  if (request.method !== 'POST') return undefined
  if (pathname !== '/api/onboarding/ensure' && !pathname.startsWith('/dashboard/')) return undefined
  return rejectCrossOriginBrowserPost(request)
}