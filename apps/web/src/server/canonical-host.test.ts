import { describe, expect, it } from 'vitest'
import { isAppContextHost, resolveCanonicalRedirect } from './canonical-host'

// Subdomain (production) mode: marketing on the apex, app/auth on app.vibecms.dev, blogs on subdomains.
const SUBDOMAIN = { appHost: 'app.vibecms.dev', usesAppPath: false }
const req = (url: string, method = 'GET') => new Request(url, { method })

describe('resolveCanonicalRedirect (subdomain mode)', () => {
  it('sends the app-host root to /dashboard', () => {
    const r = resolveCanonicalRedirect(req('https://app.vibecms.dev/'), SUBDOMAIN)
    expect(r?.status).toBe(308)
    expect(r?.headers.get('location')).toBe('https://app.vibecms.dev/dashboard')
  })

  it('leaves app/auth surfaces on the app host untouched', () => {
    expect(resolveCanonicalRedirect(req('https://app.vibecms.dev/dashboard'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://app.vibecms.dev/dashboard/posts'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://app.vibecms.dev/login'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://app.vibecms.dev/api/auth/get-session'), SUBDOMAIN)).toBeUndefined()
  })

  it('leaves marketing and tenant blog content untouched on their own hosts', () => {
    expect(resolveCanonicalRedirect(req('https://vibecms.dev/'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://vibecms.dev/pricing'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://acme.vibecms.dev/'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://acme.vibecms.dev/my-post'), SUBDOMAIN)).toBeUndefined()
  })

  it('redirects GET app surfaces off the apex/tenant hosts to the app host, preserving path + query', () => {
    expect(
      resolveCanonicalRedirect(req('https://vibecms.dev/login'), SUBDOMAIN)?.headers.get('location'),
    ).toBe('https://app.vibecms.dev/login')
    expect(
      resolveCanonicalRedirect(req('https://acme.vibecms.dev/dashboard/posts?status=draft'), SUBDOMAIN)?.headers.get(
        'location',
      ),
    ).toBe('https://app.vibecms.dev/dashboard/posts?status=draft')
  })

  it('refuses non-idempotent app-surface requests on the wrong host with 404 (never sets a cookie off the app origin)', () => {
    const r = resolveCanonicalRedirect(req('https://vibecms.dev/api/auth/sign-in/email', 'POST'), SUBDOMAIN)
    expect(r?.status).toBe(404)
    const r2 = resolveCanonicalRedirect(req('https://acme.vibecms.dev/api/auth/sign-in/email', 'POST'), SUBDOMAIN)
    expect(r2?.status).toBe(404)
  })

  it('does not treat lookalike paths as app surfaces', () => {
    expect(resolveCanonicalRedirect(req('https://acme.vibecms.dev/dashboards'), SUBDOMAIN)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://acme.vibecms.dev/api/authority'), SUBDOMAIN)).toBeUndefined()
  })

  it('never redirects localhost during local dev', () => {
    expect(resolveCanonicalRedirect(req('http://localhost:5173/login'), SUBDOMAIN)).toBeUndefined()
  })
})

describe('resolveCanonicalRedirect (single-domain / app-path mode)', () => {
  const APP_PATH = { appHost: 'dev.vibecms.dev', usesAppPath: true }
  it('never redirects when one host serves everything', () => {
    expect(resolveCanonicalRedirect(req('https://dev.vibecms.dev/'), APP_PATH)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://dev.vibecms.dev/dashboard'), APP_PATH)).toBeUndefined()
    expect(resolveCanonicalRedirect(req('https://dev.vibecms.dev/login'), APP_PATH)).toBeUndefined()
  })
})

describe('isAppContextHost', () => {
  it('allows only the app host in subdomain mode', () => {
    expect(isAppContextHost('app.vibecms.dev', SUBDOMAIN)).toBe(true)
    expect(isAppContextHost('vibecms.dev', SUBDOMAIN)).toBe(false)
    expect(isAppContextHost('acme.vibecms.dev', SUBDOMAIN)).toBe(false)
  })

  it('fails closed when the app host cannot be derived (subdomain mode)', () => {
    expect(isAppContextHost('vibecms.dev', { appHost: '', usesAppPath: false })).toBe(false)
    expect(isAppContextHost('app.vibecms.dev', { appHost: '', usesAppPath: false })).toBe(false)
  })

  it('allows every host in single-domain/app-path mode and local dev', () => {
    expect(isAppContextHost('vibecms.dev', { appHost: 'dev.vibecms.dev', usesAppPath: true })).toBe(true)
    expect(isAppContextHost('localhost', SUBDOMAIN)).toBe(true)
  })
})
