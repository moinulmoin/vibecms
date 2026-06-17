import { env } from 'cloudflare:workers'

/** Absolute site origin (e.g. https://dev.vibecms.dev) for absolute SSR meta URLs (og:image). */
export function ogOrigin(): string {
  try {
    return env.APP_URL ? new URL(env.APP_URL).origin : ''
  } catch {
    return ''
  }
}
