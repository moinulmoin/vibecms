import { describe, expect, it } from 'vitest'
import { isOnboardingActivationComplete } from './connect-onboarding'

describe('Connect onboarding activation', () => {
  it('completes only after the first post goes live', () => {
    expect(isOnboardingActivationComplete({ state: 'live' })).toBe(true)
  })

  it('stays incomplete while waiting or in draft', () => {
    expect(isOnboardingActivationComplete({ state: 'waiting' })).toBe(false)
    expect(isOnboardingActivationComplete({ state: 'draft' })).toBe(false)
  })

  it('keeps incomplete and missing status active', () => {
    expect(isOnboardingActivationComplete(null)).toBe(false)
    expect(isOnboardingActivationComplete(undefined)).toBe(false)
  })
})
