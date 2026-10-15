import { checkOtpSendBudget, type OtpSendDecision } from '@/server/auth-rate-limit'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'

const AUTH_BASE_PATH = '/api/auth'
const OTP_SEND_ROUTE = '/email-otp/send-verification-otp'
const OTP_SEND_TYPE = 'sign-in'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sign-in is email OTP plus optional Google/GitHub; there are no passwords.
// Every route Better Auth 1.6.x registers (core + emailOTP plugin) that can send
// email or set/verify a password is refused here, before auth.handler runs.
// Re-audit node_modules/better-auth/dist/api/index.mjs (getEndpoints) and
// dist/plugins/email-otp/index.mjs on every better-auth upgrade.
const BLOCKED_AUTH_PATHS: Record<string, true> = {
  // Email-sending
  '/send-verification-email': true,
  '/verify-email': true, // core link verification; sends in the change-email flow
  '/sign-up/email': true,
  '/sign-in/email': true,
  '/request-password-reset': true,
  '/change-email': true,
  '/delete-user': true,
  '/email-otp/request-password-reset': true,
  '/forget-password/email-otp': true, // deprecated alias of /email-otp/request-password-reset
  '/email-otp/request-email-change': true,
  // Password set/verify (no credential accounts exist)
  '/reset-password': true,
  '/change-password': true,
  '/verify-password': true,
  '/email-otp/reset-password': true,
}
const BLOCKED_AUTH_PREFIX = '/reset-password/' // GET /reset-password/:token

function invalidOtpSend(): Response {
  return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
}

async function rejectOtpSend(
  request: Request,
  checkBudget: (email: string) => Promise<OtpSendDecision>,
): Promise<Response | undefined> {
  // Fail closed: anything this guard cannot budget never reaches Better Auth's sender.
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return invalidOtpSend()
  }
  if (!body || typeof body !== 'object' || !('email' in body) || !('type' in body)) return invalidOtpSend()
  if (body.type !== OTP_SEND_TYPE || typeof body.email !== 'string') return invalidOtpSend()
  // Better Auth lowercases (without trimming) before sending; budget the same recipient.
  const recipient = body.email.toLowerCase()
  if (!EMAIL_PATTERN.test(recipient)) return invalidOtpSend()

  const decision = await checkBudget(recipient)
  if (!decision.allowed) {
    return Response.json(
      { error: 'RATE_LIMIT', retryAfter: decision.retryAfter },
      { status: 429, headers: { 'retry-after': String(decision.retryAfter) } },
    )
  }
  return undefined
}

/**
 * Runs before `auth.handler`. Returns a response to short-circuit the request,
 * or undefined to let Better Auth handle it.
 */
export async function guardAuthRequest(
  request: Request,
  checkBudget: (email: string) => Promise<OtpSendDecision> = checkOtpSendBudget,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return undefined
  // Normalize (slashes, case) so neither the blocklist nor the send budget
  // depends on how Better Auth's router matches path variants.
  const path = pathname.slice(AUTH_BASE_PATH.length).replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1').toLowerCase()
  if (Object.hasOwn(BLOCKED_AUTH_PATHS, path) || path.startsWith(BLOCKED_AUTH_PREFIX)) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  if (path !== OTP_SEND_ROUTE) return undefined
  // Only the canonical POST form may reach the sender, and it is always budgeted.
  if (pathname !== `${AUTH_BASE_PATH}${OTP_SEND_ROUTE}` || request.method !== 'POST') {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  return rejectOtpSend(request, checkBudget)
}

export function maybeRejectCrossOriginAppPost(request: Request): Response | undefined {
  const pathname = new URL(request.url).pathname
  if (request.method !== 'POST') return undefined
  if (pathname !== '/api/onboarding/ensure' && !pathname.startsWith('/dashboard/') && !pathname.startsWith('/api/dashboard/')) return undefined
  return rejectCrossOriginBrowserPost(request)
}
