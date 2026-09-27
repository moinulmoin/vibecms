import { describe, expect, it } from 'vitest'
import { activityChanges, uniqueActivityEvents } from './ActivityPage'

const event = (id: string | undefined, created = 1) => ({
  id,
  action: 'post.updated',
  summary: `Updated ${id ?? 'legacy'}`,
  actor_type: 'human',
  actor_name: 'Ada',
  created_at: created,
})

describe('uniqueActivityEvents', () => {
  it('drops rows that shifted onto the next offset page after new activity', () => {
    const pages = [
      { events: [event('e5'), event('e4'), event('e3')] },
      // Two new events were written before "Show older": e3 comes back.
      { events: [event('e3'), event('e2'), event('e1')] },
    ]
    expect(uniqueActivityEvents(pages).map((e) => e.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1'])
  })

  it('keeps legacy rows without ids', () => {
    expect(uniqueActivityEvents([{ events: [event(undefined), event(undefined)] }])).toHaveLength(2)
  })
})

describe('activityChanges', () => {
  it('labels site, theme, signup, and voice differences for people', () => {
    expect(activityChanges({ action: 'site.theme.updated', summary: '', actor_type: 'human', actor_name: 'Ada', created_at: 1,
      before: { accent: 'blue', font: 'geist', template: 'minimal', radius: 'sm', width: 'normal', mode: 'light' },
      after: { accent: 'rust', font: 'serif', template: 'editorial', radius: 'lg', width: 'wide', mode: 'dark' },
    })).toEqual(['Accent: blue → rust', 'Font: geist → serif', 'Template: minimal → editorial', 'Corners: sm → lg', 'Reading width: normal → wide', 'Color mode: light → dark'])
    expect(activityChanges({ action: 'site.updated', summary: '', actor_type: 'human', actor_name: 'Ada', created_at: 1,
      before: { name: 'Old', description: 'Before', signupHeading: 'Join', voiceTone: 'Casual' },
      after: { name: 'New', description: 'After', signupHeading: 'Subscribe', voiceTone: 'Direct' },
    })).toEqual(['Name: Old → New', 'Description: Before → After', 'Signup heading: Join → Subscribe', 'Voice tone: Casual → Direct'])
    expect(activityChanges({ action: 'site.updated', summary: 'Updated the signup form', actor_type: 'human', actor_name: 'Ada', created_at: 1,
      before: { enabled: false, heading: 'Join', subtext: 'Old copy', buttonLabel: 'Join' },
      after: { enabled: true, heading: 'Subscribe', subtext: 'New copy', buttonLabel: 'Notify me' },
    })).toEqual(['Signup form: Off → On', 'Signup heading: Join → Subscribe', 'Signup description: Old copy → New copy', 'Signup button: Join → Notify me'])
  })

  it('uses existing post changes and leaves older site events at their summary', () => {
    expect(activityChanges({ action: 'post.updated', summary: '', actor_type: 'human', actor_name: 'Ada', created_at: 1, changes: ['Title “Old” → “New”'] })).toEqual(['Title “Old” → “New”'])
    expect(activityChanges({ action: 'site.updated', summary: 'Updated site', actor_type: 'human', actor_name: 'Ada', created_at: 1 })).toEqual([])
  })
})
