import { createDbClient } from '@vc/db'
import * as schema from '@vc/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { env } from 'cloudflare:workers'
import { sendOtpEmail } from '@/server/email'

const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
const githubConfigured = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)

// Local dev reaches the worker through vite's http proxy, so the effective
// origin is the plain-http route host; trust it only outside production.
const trustedOrigins =
  env.APP_ENV === 'production'
    ? [env.BETTER_AUTH_URL, env.APP_URL].filter(Boolean)
    : [
        env.BETTER_AUTH_URL,
        env.APP_URL,
        'http://localhost:3000',
        'http://app.basedui.dev',
      ].filter(Boolean)

// Directory reviewers (OpenAI, Anthropic) must sign in without receiving
// email. When both secrets are set, REVIEWER_EMAIL alone gets REVIEWER_OTP as
// its sign-in code and no email is sent; send budgets and attempt limits still
// apply. Read per request so rotating or deleting the secrets takes effect.
function reviewerCode(email: string): string | undefined {
  const reviewer = env.REVIEWER_EMAIL?.trim().toLowerCase()
  const code = env.REVIEWER_OTP
  if (!reviewer || !code || !/^\d{6}$/.test(code)) return undefined
  return email.toLowerCase() === reviewer ? code : undefined
}

export const auth = betterAuth({
  database: drizzleAdapter(createDbClient(env.DB), {
    provider: 'sqlite',
    schema,
  }),
  socialProviders: {
    ...(googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {}),
    ...(githubConfigured
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID!,
            clientSecret: env.GITHUB_CLIENT_SECRET!,
          },
        }
      : {}),
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      generateOTP({ email, type }) {
        return type === 'sign-in' ? reviewerCode(email) : undefined
      },
      async sendVerificationOTP({ email, otp, type }) {
        if (type === 'sign-in' && reviewerCode(email)) return
        await sendOtpEmail(email, otp, type)
      },
    }),
  ],
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: Array.from(new Set(trustedOrigins)),
  account: {
    accountLinking: {
      // Google/GitHub return provider-verified emails; OTP sign-ins always
      // set emailVerified, so same-email sign-ins link instead of duplicating.
      trustedProviders: ['google', 'github'],
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip'],
    },
    useSecureCookies: env.APP_ENV === 'production',
  },
})

export function googleSignInEnabled() {
  return googleConfigured
}

export function githubSignInEnabled() {
  return githubConfigured
}