import { validateCustomHostname } from '@vc/core'
import { describe, expect, it } from 'vitest'
import { mapCustomHostnameStatus } from './custom-domain'

const opts = { appHost: 'app.vibecms.dev', platformZone: 'vibecms.dev' }

describe('validateCustomHostname', () => {
  it('accepts a normal FQDN and normalizes case + trailing dot + whitespace', () => {
    expect(validateCustomHostname('  Blog.ACME.com.  ', opts)).toEqual({ ok: true, hostname: 'blog.acme.com' })
    expect(validateCustomHostname('www.acme.com', opts)).toEqual({ ok: true, hostname: 'www.acme.com' })
    expect(validateCustomHostname('a.b.example.co.uk', opts)).toEqual({ ok: true, hostname: 'a.b.example.co.uk' })
  })

  it('rejects empty, wildcard, IP, scheme/port/path', () => {
    expect(validateCustomHostname('', opts).ok).toBe(false)
    expect(validateCustomHostname('   ', opts).ok).toBe(false)
    expect(validateCustomHostname('*.acme.com', opts).ok).toBe(false)
    expect(validateCustomHostname('1.2.3.4', opts).ok).toBe(false)
    expect(validateCustomHostname('https://acme.com', opts).ok).toBe(false)
    expect(validateCustomHostname('acme.com:443', opts).ok).toBe(false)
    expect(validateCustomHostname('acme.com/blog', opts).ok).toBe(false)
  })

  it('rejects non-FQDN and invalid labels', () => {
    expect(validateCustomHostname('acme', opts).ok).toBe(false)
    expect(validateCustomHostname('localhost', opts).ok).toBe(false)
    expect(validateCustomHostname('-bad.acme.com', opts).ok).toBe(false)
    expect(validateCustomHostname('bad-.acme.com', opts).ok).toBe(false)
    expect(validateCustomHostname('acme.123', opts).ok).toBe(false)
  })

  it('rejects the platform apex, every platform subdomain, and the app host', () => {
    expect(validateCustomHostname('vibecms.dev', opts).ok).toBe(false)
    expect(validateCustomHostname('foo.vibecms.dev', opts).ok).toBe(false)
    expect(validateCustomHostname('agent-blog.vibecms.dev', opts).ok).toBe(false)
    expect(validateCustomHostname('app.vibecms.dev', opts).ok).toBe(false)
    expect(validateCustomHostname('dev.vibecms.dev', opts).ok).toBe(false)
    // A domain that merely CONTAINS the zone as a substring is still allowed.
    expect(validateCustomHostname('vibecms.dev.acme.com', opts).ok).toBe(true)
  })
})

describe('mapCustomHostnameStatus', () => {
  it('is active only when both hostname and ssl are active', () => {
    expect(mapCustomHostnameStatus({ status: 'active', ssl: { status: 'active' } })).toEqual({
      status: 'active',
      verificationErrors: [],
    })
    expect(mapCustomHostnameStatus({ status: 'active', ssl: { status: 'pending_validation' } }).status).toBe('pending')
    expect(mapCustomHostnameStatus({ status: 'pending', ssl: { status: 'active' } }).status).toBe('pending')
  })

  it('maps terminal-bad hostname or ssl states to failed', () => {
    expect(mapCustomHostnameStatus({ status: 'blocked' }).status).toBe('failed')
    expect(mapCustomHostnameStatus({ status: 'moved' }).status).toBe('failed')
    expect(mapCustomHostnameStatus({ status: 'active', ssl: { status: 'expired' } }).status).toBe('failed')
  })

  it('collects verification + ssl validation errors while pending', () => {
    const result = mapCustomHostnameStatus({
      status: 'pending',
      verification_errors: ['TXT record missing', ''],
      ssl: { status: 'pending_validation', validation_errors: [{ message: 'CNAME not found' }, { message: '' }] },
    })
    expect(result.status).toBe('pending')
    expect(result.verificationErrors).toEqual(['TXT record missing', 'CNAME not found'])
  })

  it('treats an empty payload as pending with no errors', () => {
    expect(mapCustomHostnameStatus({})).toEqual({ status: 'pending', verificationErrors: [] })
  })
})
