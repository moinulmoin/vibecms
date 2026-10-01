const STORAGE_KEY = 'vc_token_flash'
const ACTIVATION_KEY_STORAGE_KEY = 'vc_activation_key_id'

export type TokenFlash = { token: string; name: string; id?: string; createdAt?: number }

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
      (parsed.id === undefined || typeof parsed.id === 'string') &&
      (parsed.createdAt === undefined || typeof parsed.createdAt === 'number')
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}
/**
 * Forget the one-time key reveal and activation key. Call whenever the signed-in
 * user or site changes (sign-out, site switch, login page) so a plaintext key
 * never outlives the session that created it.
 */
export function clearSessionSecrets() {
  try {
    clearTokenFlash()
    clearActivationKeyId()
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
}

/**
 * A one-time reveal is only worth showing while its key still works: a key
 * deleted elsewhere (another tab, onboarding) must not stay on screen or in
 * the install command. Only a key list fetched after the reveal was made can
 * say so; an older list doesn't know about a key created a moment ago.
 */
export function isRevealedKeyGone(
  flash: TokenFlash,
  keys: Array<{ id: string; tokenPrefix: string; revokedAt: number | null }>,
  listFetchedAt: number,
) {
  if (listFetchedAt < (flash.createdAt ?? 0)) return false
  return !keys.some((key) =>
    key.revokedAt == null && (flash.id ? key.id === flash.id : flash.token.startsWith(key.tokenPrefix)),
  )
}
