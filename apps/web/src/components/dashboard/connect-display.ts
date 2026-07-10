import type { OnboardingConnectStatus } from '~/server/dashboard-pages-fn'

export type DisplayConnection = OnboardingConnectStatus['connection']

/**
 * Resolve the connection state shown to the user from the server's read.
 *
 * A newly revealed token is local evidence while D1 catches up. During that narrow
 * period an empty active-token list can make a new token look absent or revoked, so
 * keep the connection in `waiting`. A revoked status is only surfaced for a fresh
 * reveal when that exact revealed key is the one the server identifies as revoked.
 * With no active token and no selected revocation, `revoked` is stale historical state
 * rather than an error the user can act on, so present the calm `no_token` state.
 */
export function resolveDisplayConnection(
  serverConnection: DisplayConnection | undefined,
  hasFreshToken: boolean,
  stickyConnected: boolean,
  activeTokenCount: number,
  revealedTokenWasRevoked = false,
): DisplayConnection {
  if (serverConnection === 'revoked') {
    if (hasFreshToken && !revealedTokenWasRevoked) return 'waiting'
    if (activeTokenCount === 0 && !revealedTokenWasRevoked) return 'no_token'
    return 'revoked'
  }
  if (hasFreshToken && activeTokenCount === 0 && serverConnection === 'no_token') return 'waiting'
  if (serverConnection === 'no_token') return 'no_token'
  if (stickyConnected) return 'connected'
  return serverConnection ?? 'no_token'
}
