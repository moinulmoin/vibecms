import { env } from 'cloudflare:workers'

export function publicBlogBaseDomain() {
  const raw = env.PUBLIC_BLOG_DOMAIN?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const hostname = url.hostname.toLowerCase()
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1')
      return null
    return hostname
  } catch {
    return null
  }
}

export function defaultHostname(slug: string) {
  return `${slug}.${publicBlogBaseDomain() ?? 'localhost'}`
}

export function isLocalDefaultHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost')
}

// Host-only public blog URL for an active hostname (null when unset/local).
export function publicUrlForHostname(hostname: string | null) {
  if (!hostname) return null
  return `${isLocalDefaultHostname(hostname) ? 'http' : 'https'}://${hostname}`
}

/** The dashboard/app host (e.g. `app.vibecms.dev`) — reserved from user locations. */
export function appHost() {
  try {
    return new URL(env.APP_URL).hostname.toLowerCase()
  } catch {
    return ''
  }
}
