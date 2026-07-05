import { env } from 'cloudflare:workers'
import { resolveCanonicalRedirect } from '~/server/canonical-host'

// Env-wired host canonicalization; pure logic + tests in canonical-host.ts.
export function canonicalHostRedirect(request: Request): Response | undefined {
  let appHost = ''
  try {
    appHost = new URL(env.APP_URL).hostname.toLowerCase()
  } catch {
    return undefined
  }
  return resolveCanonicalRedirect(request, { appHost })
}
