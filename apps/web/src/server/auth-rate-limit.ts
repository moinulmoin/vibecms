import { env } from "cloudflare:workers";

// OTP send budget per recipient email. Generous for real use (you rarely need more
// than a handful of codes in an hour) while making inbox-flooding / email-cost abuse
// impractical. Keyed on the recipient email - the asset under attack - not source IP,
// which an attacker can rotate and which would punish users behind shared NAT.
const OTP_SEND_MAX = 5;
const OTP_SEND_WINDOW_SECONDS = 3600;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export type OtpSendDecision = { allowed: boolean; retryAfter: number };

/**
 * Durable per-recipient-email cap on OTP sends, stored in D1 so it holds across Worker
 * isolates (Better Auth's default memory limiter does not). The conditional UPDATE is
 * atomic - D1 serializes it - so concurrent sends cannot overshoot the cap.
 */
export async function checkOtpSendBudget(email: string): Promise<OtpSendDecision> {
  const normalized = email.toLowerCase();
  // Empty/garbage input is left for Better Auth's own validation to reject.
  if (!normalized) return { allowed: true, retryAfter: 0 };

  const ts = nowSeconds();
  const bucket = Math.floor(ts / OTP_SEND_WINDOW_SECONDS);
  const windowEnd = (bucket + 1) * OTP_SEND_WINDOW_SECONDS;
  const id = `otp-send:${normalized}:${bucket}`;

  try {
    const result = await env.DB.prepare(
      `INSERT INTO rate_limits (id, count, expires_at, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET count = rate_limits.count + 1, updated_at = excluded.updated_at
       WHERE rate_limits.count < ?`,
    )
      .bind(id, windowEnd, ts, ts, OTP_SEND_MAX)
      .run();

    // Opportunistically prune expired buckets so the table stays bounded without a cron.
    if (Math.random() < 0.02) {
      await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(ts).run();
    }

    if (result.meta.changes > 0) return { allowed: true, retryAfter: 0 };
    return { allowed: false, retryAfter: Math.max(windowEnd - ts, 1) };
  } catch (error) {
    // Fail open: a storage hiccup must never lock everyone out of sign-in. The limiter
    // is an abuse guard, not a correctness invariant, so availability wins here.
    console.error(`[otp-rate-limit] check failed, allowing send: ${error}`);
    return { allowed: true, retryAfter: 0 };
  }
}
