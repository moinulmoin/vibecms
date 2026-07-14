export type ActivationFirstPostState = 'waiting' | 'draft' | 'live'

export function isOnboardingActivationComplete(
  firstPost: { state: ActivationFirstPostState } | null | undefined,
): boolean {
  return firstPost?.state === 'live'
}
