import { describe, expect, it } from 'vitest'
import { activitySummary, isSystemActor } from './activity-copy'

describe('activity copy', () => {
  it('names agent keys consistently and quotes the key name', () => {
    expect(activitySummary('api_key.created', 'Created API key My agent')).toBe('Created agent key “My agent”')
    expect(activitySummary('api_key.revoked', 'Revoked API key My agent')).toBe('Deleted an agent key')
    expect(activitySummary('post.published', 'Published Hello')).toBe('Published Hello')
  })
  it('recognizes system actors', () => {
    expect(isSystemActor('system', 'x')).toBe(true)
    expect(isSystemActor(undefined, 'System')).toBe(true)
    expect(isSystemActor('human', 'Sam')).toBe(false)
  })
})
