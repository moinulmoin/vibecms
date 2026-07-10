import { beforeEach, describe, expect, it } from 'vitest'
import { clearTokenFlash, consumeTokenFlash, saveTokenFlash } from './token-flash'

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
})
