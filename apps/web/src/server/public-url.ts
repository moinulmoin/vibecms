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

// Blog URL mode: explicit PUBLIC_BLOG_URL_MODE, else infer (app-path when no real blog domain or it equals APP_URL host).
export function publicBlogUsesAppPath(): boolean {
  const mode = env.PUBLIC_BLOG_URL_MODE?.trim().toLowerCase()
  if (mode === 'app-path') return true
  if (mode === 'subdomain') return false
  const baseDomain = publicBlogBaseDomain()
  if (!baseDomain) return true
  try {
    return baseDomain === new URL(env.APP_URL).hostname.toLowerCase()
  } catch {
    return false
  }
}

export function publicUrlForHostname(hostname: string | null) {
  if (!hostname) return null
  if (publicBlogUsesAppPath()) return null
  return `${isLocalDefaultHostname(hostname) ? 'http' : 'https'}://${hostname}`
}

export function appPublicBlogUrl(slug: string) {
  const appUrl = env.APP_URL || 'http://localhost:3000'
  return new URL(`/blog/${slug}`, appUrl).href
}
