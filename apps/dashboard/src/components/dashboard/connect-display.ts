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
 * keep the connection in `waiting`. When the server resolves the exact selected key,
 * a revoked state remains actionable across reloads even when no active key remains.
 * Without exact selection, a latest historical revocation with no active tokens is
 * stale context, so present the calm `no_token` state.
 */
export function resolveDisplayConnection(
  serverConnection: DisplayConnection | undefined,
  hasFreshToken: boolean,
  stickyConnected: boolean,
  activeTokenCount: number,
  selectedKeyWasRevoked = false,
): DisplayConnection {
  if (serverConnection === 'revoked') {
    if (hasFreshToken && !selectedKeyWasRevoked) return 'waiting'
    if (activeTokenCount === 0 && !selectedKeyWasRevoked) return 'no_token'
    return 'revoked'
  }
  if (hasFreshToken && activeTokenCount === 0 && serverConnection === 'no_token') return 'waiting'
  if (serverConnection === 'no_token') return 'no_token'
  if (stickyConnected) return 'connected'
  return serverConnection ?? 'no_token'
}
