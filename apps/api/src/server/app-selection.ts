import { env } from 'cloudflare:workers'

export type AppSelection = {
  workspaceId: string
  siteId: string
}

const DEVELOPMENT_COOKIE = 'vc_app_selection'
const PRODUCTION_COOKIE = '__Host-vc_app_selection'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function cookieName() {
  return String(env.APP_ENV) === 'production'
    ? PRODUCTION_COOKIE
    : DEVELOPMENT_COOKIE
}

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const decoded = atob(padded)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function cookieValue(request: Request, name: string) {
  const raw = request.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export async function readAppSelection(request: Request): Promise<AppSelection | null> {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret) return null
  const value = cookieValue(request, cookieName())
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0 || separator === value.length - 1) return null
  try {
    const payload = value.slice(0, separator)
    const signature = decodeBase64Url(value.slice(separator + 1))
    const verified = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      signature,
      new TextEncoder().encode(payload),
    )
    if (!verified) return null
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as Partial<AppSelection>
    if (
      typeof parsed.workspaceId !== 'string' ||
      !parsed.workspaceId ||
      typeof parsed.siteId !== 'string' ||
      !parsed.siteId
    ) {
      return null
    }
    return { workspaceId: parsed.workspaceId, siteId: parsed.siteId }
  } catch {
    return null
  }
}

export async function appSelectionCookie(selection: AppSelection) {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required')
  const payload = base64Url(
    new TextEncoder().encode(JSON.stringify(selection)),
  )
  const signature = base64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await signingKey(secret),
        new TextEncoder().encode(payload),
      ),
    ),
  )
  const secure = String(env.APP_ENV) === 'production' ? '; Secure' : ''
  return `${cookieName()}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`
}
