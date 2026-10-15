import { describe, expect, it } from 'vitest'
import { isReservedSiteSlug, siteAddressFromText, siteAddressIssue } from '@vc/validators'

describe('isReservedSiteSlug', () => {
  it('reserves platform / infra / auth / brand names (case-insensitive)', () => {
    for (const slug of ['app', 'www', 'api', 'mcp', 'dashboard', 'admin', 'mail', 'support', 'billing', 'security', 'vibecms', 'blog']) {
      expect(isReservedSiteSlug(slug)).toBe(true)
    }
    expect(isReservedSiteSlug('APP')).toBe(true)
    expect(isReservedSiteSlug('  Www  ')).toBe(true)
  })

  it('allows normal tenant slugs, including ones that merely contain a reserved word', () => {
    for (const slug of ['joe', 'my-blog', 'myapp', 'app-blog', 'apple', 'apis', 'supportive', 'devlog']) {
      expect(isReservedSiteSlug(slug)).toBe(false)
    }
  })
})

describe('siteAddressFromText / siteAddressIssue (shared by setup client and server)', () => {
  it('normalizes names the same way the server saves them', () => {
    expect(siteAddressFromText('Café Notes!')).toBe('cafe-notes')
    expect(siteAddressFromText("Ada's  Log")).toBe('adas-log')
    expect(siteAddressFromText('x-')).toBe('x')
    for (const name of ['!!!???', '🙂🙂', 'Полевые заметки', '']) expect(siteAddressFromText(name)).toBe('')
  })

  it('reports reserved, too-short and empty addresses', () => {
    expect(siteAddressIssue('admin')).toBe('slug_reserved')
    expect(siteAddressIssue('www')).toBe('slug_reserved')
    expect(siteAddressIssue('x')).toBe('address_too_short')
    expect(siteAddressIssue('ab')).toBe('address_too_short')
    expect(siteAddressIssue('')).toBe('address_required')
    expect(siteAddressIssue('abc')).toBeNull()
  })

  it('keeps an existing short address valid when it is unchanged', () => {
    expect(siteAddressIssue('xy', 'xy')).toBeNull()
    expect(siteAddressIssue('xz', 'xy')).toBe('address_too_short')
  })
})
