import { env } from 'cloudflare:workers'

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
    const result = await env.DB.prepare(
      `INSERT INTO rate_limits (id, count, expires_at, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET count = rate_limits.count + 1, updated_at = excluded.updated_at
       WHERE rate_limits.count < ?`,
    )
      .bind(id, windowEnd, ts, ts, OTP_SEND_MAX)
      .run()

    if (Math.random() < 0.02) {
      await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(ts).run()
    }

    if (result.meta.changes > 0) return { allowed: true, retryAfter: 0 }
    return { allowed: false, retryAfter: Math.max(windowEnd - ts, 1) }
  } catch (error) {
    console.error(`[otp-rate-limit] check failed, allowing send: ${error}`)
    return { allowed: true, retryAfter: 0 }
  }
}