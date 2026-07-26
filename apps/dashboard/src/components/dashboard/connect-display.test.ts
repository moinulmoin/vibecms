import { describe, expect, it } from 'vitest'
import { resolveDisplayConnection, shouldClearMissingActivationKey } from './connect-display'

describe('resolveDisplayConnection', () => {
  describe('fresh token flash suppresses D1-propagation lag', () => {
    it('shows waiting when the server briefly reads no_token right after creation', () => {
      expect(resolveDisplayConnection('no_token', true, false, 0)).toBe('waiting')
    })

    it('shows waiting when the server briefly reads revoked before the new token reaches the active list', () => {
      expect(resolveDisplayConnection('revoked', true, false, 0)).toBe('waiting')
    })
  })

  describe('revocation and zero-token handling', () => {
    it('suppresses stale revoked status when no active token remains', () => {
      expect(resolveDisplayConnection('revoked', false, false, 0)).toBe('no_token')
    })

    it('reports revocation for the exact selected token during the reveal', () => {
      expect(resolveDisplayConnection('revoked', true, false, 0, true)).toBe('revoked')
    })

    it('keeps an exact selected revocation actionable after reload', () => {
      expect(resolveDisplayConnection('revoked', false, false, 0, true)).toBe('revoked')
    })

    it('reports revoked for an active previously saved token', () => {
      expect(resolveDisplayConnection('revoked', false, false, 1)).toBe('revoked')
    })
  })

  describe('connected precedence', () => {
    it('honors a real connected read even while the flash is present', () => {
      expect(resolveDisplayConnection('connected', true, false, 1)).toBe('connected')
    })

    it('never regresses from connected to waiting once sticky', () => {
      expect(resolveDisplayConnection('waiting', false, true, 1)).toBe('connected')
      expect(resolveDisplayConnection('waiting', true, true, 1)).toBe('connected')
    })
  })

  it('passes waiting through unchanged when no fresh token is present', () => {
    expect(resolveDisplayConnection('waiting', false, false, 1)).toBe('waiting')
  })

  it('treats an undefined read as no_token', () => {
    expect(resolveDisplayConnection(undefined, false, false, 0)).toBe('no_token')
  })
})

describe('shouldClearMissingActivationKey', () => {
  it('allows three fresh-key misses for propagation lag, then recovers', () => {
    expect(shouldClearMissingActivationKey(true, 1)).toBe(false)
    expect(shouldClearMissingActivationKey(true, 3)).toBe(false)
    expect(shouldClearMissingActivationKey(true, 4)).toBe(true)
  })

  it('clears a missing selection immediately when no fresh reveal matches', () => {
    expect(shouldClearMissingActivationKey(false, 1)).toBe(true)
  })
})
