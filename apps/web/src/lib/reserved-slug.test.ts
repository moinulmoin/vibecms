import { describe, expect, it } from 'vitest'
import { isReservedSiteSlug } from '@vc/validators'

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
