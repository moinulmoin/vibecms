export type OnboardingPublishState = 'none' | 'live' | 'already_live'

export function isOnboardingActivationComplete(
  publish: { state: OnboardingPublishState } | null | undefined,
): boolean {
  return publish?.state === 'live'
}
