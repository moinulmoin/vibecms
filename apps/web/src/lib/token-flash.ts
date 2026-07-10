const STORAGE_KEY = 'vc_token_flash'

export type TokenFlash = { token: string; name: string; id?: string }

export function saveTokenFlash(flash: TokenFlash) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flash))
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