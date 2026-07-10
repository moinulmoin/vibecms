import { describe, expect, it } from 'vitest'
import { resolveDisplayConnection } from './connect-display'

describe('resolveDisplayConnection', () => {
  describe('fresh token flash suppresses D1-propagation lag', () => {
    it('shows waiting when the server briefly reads no_token right after creation', () => {
      expect(resolveDisplayConnection('no_token', true, false)).toBe('waiting')
    })

    it('shows waiting when the server briefly reads revoked right after creation', () => {
      expect(resolveDisplayConnection('revoked', true, false)).toBe('waiting')
    })
  })

  describe('connected precedence', () => {
    it('honors a real connected read even while the flash is present', () => {
      expect(resolveDisplayConnection('connected', true, false)).toBe('connected')
    })

    it('never regresses from connected to waiting once sticky', () => {
      expect(resolveDisplayConnection('waiting', false, true)).toBe('connected')
      expect(resolveDisplayConnection('waiting', true, true)).toBe('connected')
    })
  })

  describe('authoritative server behavior once the flash is cleared', () => {
    it('shows revoked as revoked (ordinary revoked behavior)', () => {
      expect(resolveDisplayConnection('revoked', false, false)).toBe('revoked')
    })

    it('shows no_token when there is no flash and no key', () => {
      expect(resolveDisplayConnection('no_token', false, false)).toBe('no_token')
    })
  })

  it('passes waiting through unchanged when no fresh token is present', () => {
    expect(resolveDisplayConnection('waiting', false, false)).toBe('waiting')
  })

  it('treats an undefined read as no_token', () => {
    expect(resolveDisplayConnection(undefined, false, false)).toBe('no_token')
  })
})
