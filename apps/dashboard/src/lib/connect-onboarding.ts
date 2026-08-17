export type ActivationFirstPostState = 'waiting' | 'draft' | 'live'

export function isOnboardingActivationComplete(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
): boolean {
  return firstPost?.state === 'live'
}

/**
 * 1-based position in the four-step onboarding journey (Blog setup, Make it
 * yours, Connect agent, First post) for the connect-route progress rail.
 * Blog setup and Make it yours come before the connect route, so the rail
 * starts at step 3; an established connection or an existing draft moves it
 * to step 4.
 */
export function connectOnboardingStep(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
  agentConnected: boolean,
): 3 | 4 {
  if (agentConnected || firstPost?.state === 'draft' || firstPost?.state === 'live') {
    return 4
  }
  return 3
}
