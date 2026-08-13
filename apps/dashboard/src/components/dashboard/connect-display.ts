import type { OnboardingConnectStatus } from '~/types/dashboard'

export type DisplayConnection = OnboardingConnectStatus['connection']

export const ACTIVATION_KEY_MISS_LIMIT = 4

export function shouldClearMissingActivationKey(hasMatchingFreshToken: boolean, consecutiveMisses: number) {
  return !hasMatchingFreshToken || consecutiveMisses >= ACTIVATION_KEY_MISS_LIMIT
}

/**
 * Resolve the connection state shown to the user from the server's read.
 *
 * A newly revealed token is local evidence while D1 catches up. During that narrow
 * period an empty active-token list can make a new token look absent or revoked, so
 * keep the connection in `waiting`. Once the active-token list is authoritatively
 * empty and there is no fresh reveal, any historical revocation is stale context,
 * including an old selected key left in session storage. Present the calm
 * `no_token` state instead.
 */
export function resolveDisplayConnection(
  serverConnection: DisplayConnection | undefined,
  hasFreshToken: boolean,
  stickyConnected: boolean,
  activeTokenCount: number | null,
  selectedKeyWasRevoked = false,
): DisplayConnection {
  if (activeTokenCount === 0 && !hasFreshToken) return 'no_token'
  if (serverConnection === 'revoked') {
    if (hasFreshToken && !selectedKeyWasRevoked) return 'waiting'
    return 'revoked'
  }
  if (hasFreshToken && activeTokenCount === 0 && serverConnection === 'no_token') return 'waiting'
  if (serverConnection === 'no_token') return 'no_token'
  if (stickyConnected) return 'connected'
  return serverConnection ?? 'no_token'
}
