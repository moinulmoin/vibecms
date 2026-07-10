import { describe, expect, it } from 'vitest'
import { isOnboardingActivationComplete } from './connect-onboarding'

describe('Connect onboarding activation', () => {
  it('completes only after the onboarding agent publishes', () => {
    expect(isOnboardingActivationComplete({ state: 'live' })).toBe(true)
  })

  it('treats existing published content as context, not activation', () => {
    expect(isOnboardingActivationComplete({ state: 'already_live' })).toBe(false)
  })

  it('keeps incomplete and missing status active', () => {
    expect(isOnboardingActivationComplete({ state: 'none' })).toBe(false)
    expect(isOnboardingActivationComplete(null)).toBe(false)
    expect(isOnboardingActivationComplete(undefined)).toBe(false)
  })
})
