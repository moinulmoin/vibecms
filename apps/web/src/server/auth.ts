import { createDbClient } from '@vc/db'
import * as schema from '@vc/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { env } from 'cloudflare:workers'
import { sendOtpEmail } from '~/server/email'

const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

export const auth = betterAuth({
  database: drizzleAdapter(createDbClient(env.DB), {
    provider: 'sqlite',
    schema,
  }),
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : undefined,
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      async sendVerificationOTP({ email, otp, type }) {
        await sendOtpEmail(email, otp, type)
      },
    }),
    tanstackStartCookies(),
  ],
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: Array.from(
    new Set([env.BETTER_AUTH_URL, env.APP_URL, 'http://localhost:3000'].filter(Boolean)),
  ),
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip'],
    },
  },
})

export function googleSignInEnabled() {
  return googleConfigured
}