import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActivationKeyId,
  clearSessionSecrets,
  clearTokenFlash,
  consumeTokenFlash,
  getActivationKeyId,
  saveTokenFlash,
  isRevealedKeyGone,
} from './token-flash'

const values = new Map<string, string>()

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  },
})

describe('token flash storage', () => {
  beforeEach(() => values.clear())

  it('reveals a saved token once and removes it from storage', () => {
    const flash = { token: 'vc_once', name: 'Claude Code' }

    saveTokenFlash(flash)

    expect(consumeTokenFlash()).toEqual(flash)
    expect(consumeTokenFlash()).toBeNull()
  })

  it('preserves the created key identity across a reload-sized storage round trip', () => {
    const flash = { token: 'vc_once', name: 'Claude Code', id: 'key-revealed-token' }

    saveTokenFlash(flash)

    expect(consumeTokenFlash()).toEqual(flash)
    expect(getActivationKeyId()).toBe(flash.id)

    clearActivationKeyId()

    expect(getActivationKeyId()).toBeNull()
  })

  it('clears the persisted token when the reveal is hidden', () => {
    saveTokenFlash({ token: 'vc_hidden', name: 'Publishing agent' })

    clearTokenFlash()

    expect(consumeTokenFlash()).toBeNull()
  })

  it('removes malformed persisted data instead of revealing it again', () => {
    sessionStorage.setItem('vc_token_flash', '{bad json')

    expect(consumeTokenFlash()).toBeNull()
    expect(sessionStorage.getItem('vc_token_flash')).toBeNull()
  })

  it('forgets the one-time key and activation key when the session changes', () => {
    saveTokenFlash({ token: 'vc_previous_user', name: 'My agent', id: 'key_1' })

    clearSessionSecrets()

    expect(consumeTokenFlash()).toBeNull()
    expect(getActivationKeyId()).toBeNull()
  })

  it('drops a reveal once its key is deleted, but not before the key list has caught up', () => {
    const key = { id: 'key_1', tokenPrefix: 'vc_live_abc', revokedAt: null }
    const flash = { token: 'vc_live_abcdef', name: 'My agent', id: 'key_1', createdAt: 1_000 }
    expect(isRevealedKeyGone(flash, [key], 2_000)).toBe(false)
    expect(isRevealedKeyGone(flash, [], 2_000)).toBe(true)
    expect(isRevealedKeyGone(flash, [{ ...key, revokedAt: 5 }], 2_000)).toBe(true)
    // A list fetched before the key was created can't know about it yet.
    expect(isRevealedKeyGone(flash, [], 500)).toBe(false)
    // Older reveals without an id match on the key prefix.
    expect(isRevealedKeyGone({ token: 'vc_live_abcdef', name: 'My agent' }, [key], 2_000)).toBe(false)
    expect(isRevealedKeyGone({ token: 'vc_live_zzz', name: 'My agent' }, [key], 2_000)).toBe(true)
  })
})
