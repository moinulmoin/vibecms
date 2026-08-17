import { describe, expect, it } from 'vitest'
import { connectOnboardingStep, isOnboardingActivationComplete } from './connect-onboarding'

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

describe('Connect onboarding step', () => {
  it('stays on Connect agent while nothing has connected', () => {
    expect(connectOnboardingStep(undefined, false)).toBe(3)
    expect(connectOnboardingStep({ state: 'waiting' }, false)).toBe(3)
  })

  it('advances to First post once the agent connects or a draft exists', () => {
    expect(connectOnboardingStep({ state: 'waiting' }, true)).toBe(4)
    expect(connectOnboardingStep({ state: 'draft' }, false)).toBe(4)
    expect(connectOnboardingStep({ state: 'live' }, false)).toBe(4)
  })
})
