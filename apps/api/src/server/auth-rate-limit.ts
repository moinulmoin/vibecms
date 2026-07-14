import { env } from 'cloudflare:workers'
import { createDataAccess } from '@vc/db'

const OTP_SEND_MAX = 5
const OTP_SEND_WINDOW_SECONDS = 3600

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export type OtpSendDecision = { allowed: boolean; retryAfter: number }

export async function checkOtpSendBudget(email: string): Promise<OtpSendDecision> {
  const normalized = email.toLowerCase()
  if (!normalized) return { allowed: true, retryAfter: 0 }

  const ts = nowSeconds()
  const bucket = Math.floor(ts / OTP_SEND_WINDOW_SECONDS)
  const windowEnd = (bucket + 1) * OTP_SEND_WINDOW_SECONDS
  const id = `otp-send:${normalized}:${bucket}`

  try {
    const rateLimits = createDataAccess(env.DB).rateLimits
    const { allowed } = await rateLimits.increment({
      id,
      windowExpiresAt: windowEnd,
      max: OTP_SEND_MAX,
      now: ts,
    })

    // Probabilistic cleanup of expired buckets; failure here must not affect the decision.
    if (Math.random() < 0.02) {
      await rateLimits.deleteExpired(ts)
    }

    if (allowed) return { allowed: true, retryAfter: 0 }
    return { allowed: false, retryAfter: Math.max(windowEnd - ts, 1) }
  } catch (error) {
    // Fail open - allow the send if the rate-limit check itself errors.
    console.error(`[otp-rate-limit] check failed, allowing send: ${error}`)
    return { allowed: true, retryAfter: 0 }
  }
}
