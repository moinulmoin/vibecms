const STORAGE_KEY = 'vc_token_flash'
const ACTIVATION_KEY_STORAGE_KEY = 'vc_activation_key_id'

export type TokenFlash = { token: string; name: string; id?: string }

export function saveActivationKeyId(id: string) {
  sessionStorage.setItem(ACTIVATION_KEY_STORAGE_KEY, id)
}

export function getActivationKeyId(): string | null {
  const id = sessionStorage.getItem(ACTIVATION_KEY_STORAGE_KEY)
  return id?.trim() ? id : null
}

export function clearActivationKeyId() {
  sessionStorage.removeItem(ACTIVATION_KEY_STORAGE_KEY)
}

export function saveTokenFlash(flash: TokenFlash) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flash))
  if (flash.id) saveActivationKeyId(flash.id)
}

export function clearTokenFlash() {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function consumeTokenFlash(): TokenFlash | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  clearTokenFlash()
  try {
    const parsed = JSON.parse(raw) as TokenFlash
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.name === 'string' &&
      (parsed.id === undefined || typeof parsed.id === 'string')
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}