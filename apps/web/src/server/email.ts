import { env } from "cloudflare:workers";

type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

const SUBJECTS: Record<OtpType, string> = {
  "sign-in": "Your VibeCMS sign-in code",
  "email-verification": "Verify your VibeCMS email",
  "forget-password": "Your VibeCMS password reset code",
  "change-email": "Confirm your new VibeCMS email",
};

/**
 * Delivers a one-time passcode.
 *
 * Same code path in every environment - the only split is delivery: with a
 * RESEND_API_KEY set we email the code (production), otherwise we log it so the
 * flow stays testable locally without an email provider. The code is also stored
 * (plain) in the `verification` table, which is how automated smoke reads it.
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
  const subject = SUBJECTS[type] ?? SUBJECTS["sign-in"];
  const text = `Your VibeCMS code is ${otp}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`;

  if (!env.RESEND_API_KEY) {
    console.log(`[email-otp] to=${email} type=${type} otp=${otp}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "VibeCMS <onboarding@resend.dev>",
      to: email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    // Better Auth runs sendVerificationOTP via runInBackgroundOrAwait, which catches a thrown
    // error and only logs it - the send request still returns 200. We therefore cannot surface
    // a delivery failure to the user from here, so we log it loudly for the operator (visible in
    // `wrangler tail`). Verify the Resend key and a verified EMAIL_FROM sender before relying on it.
    console.error(`[email-otp] resend failed ${response.status}: ${await response.text()}`);
  }
}
