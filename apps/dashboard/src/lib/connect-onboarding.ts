export type ActivationFirstPostState = 'waiting' | 'draft' | 'live'

export function isOnboardingActivationComplete(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
): boolean {
  return firstPost?.state === 'live'
}

/**
 * 1-based position in the three-step onboarding journey (Blog setup, Connect
 * agent, First post) for the connect-route progress rail. Blog setup is
 * complete by the time the connect route renders, so the rail starts at
 * step 2; an established connection or an existing draft moves it to step 3.
 */
export function connectOnboardingStep(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
  agentConnected: boolean,
): 2 | 3 {
  if (agentConnected || firstPost?.state === 'draft' || firstPost?.state === 'live') {
    return 3
  }
  return 2
}
