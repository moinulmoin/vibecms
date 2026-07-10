import type { OnboardingConnectStatus } from '~/server/dashboard-pages-fn'

export type DisplayConnection = OnboardingConnectStatus['connection']

/**
 * Resolve the connection state shown to the user from the server's read.
 *
 * A freshly revealed one-time token is authoritative local evidence that a usable token
 * was just created. D1 read-replica propagation can briefly make the server report the
 * new key as `no_token` or `revoked`; while that token flash is still present we display
 * those temporary reads as `waiting` instead of a misleading "revoked". A real later
 * `connected` read is always honored, and the sticky-connected flag keeps the display
 * from regressing to waiting between polls. Once the flash is cleared, `no_token` and
 * `revoked` are authoritative again.
 */
export function resolveDisplayConnection(
  serverConnection: DisplayConnection | undefined,
  hasFreshToken: boolean,
  stickyConnected: boolean,
): DisplayConnection {
  if (hasFreshToken && (serverConnection === 'no_token' || serverConnection === 'revoked')) {
    return 'waiting'
  }
  if (serverConnection === 'no_token' || serverConnection === 'revoked') {
    return serverConnection
  }
  if (stickyConnected) return 'connected'
  return serverConnection ?? 'no_token'
}
