export type ActivationFirstPostState = 'waiting' | 'draft' | 'live'

export function isOnboardingActivationComplete(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
): boolean {
  return firstPost?.state === 'live'
}

/**
 * 1-based position in the six-step activation journey. Setup and client choice
 * happen before this route; the durable connection/draft/live reads advance
 * the remaining steps without relying on browser-local completion flags.
 */
export function connectOnboardingStep(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
  agentConnected: boolean,
): 3 | 4 | 5 | 6 {
  if (firstPost?.state === 'live') return 6
  if (firstPost?.state === 'draft') return 5
  if (agentConnected) return 4
  return 3
}
