import { env } from 'cloudflare:workers'
import { resolveCanonicalRedirect } from '@/server/canonical-host'

export function canonicalHostMiddleware(request: Request): Response | undefined {
  let appHost = ''
  try {
    appHost = new URL(env.APP_URL).hostname
  } catch {
    appHost = ''
  }
  return resolveCanonicalRedirect(request, { appHost })
}