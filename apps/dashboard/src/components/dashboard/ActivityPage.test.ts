import { describe, expect, it } from 'vitest'
import { activityChanges, activityDayLabel, groupByDay, parseChange, splitSummary, uniqueActivityEvents } from './ActivityPage'

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

  it('labels structural choices and template defaults', () => {
    expect(activityChanges({ action: 'site.updated', summary: '', actor_type: 'human', actor_name: 'Ada', created_at: 1,
      before: { themeChrome: null, themeIndex: 'list', themeHeader: 'plain' },
      after: { themeChrome: 'sidebar', themeIndex: 'grid', themeHeader: 'card' },
    })).toEqual(['Navigation: template default → Sidebar', 'Home page: List → Grid', 'Article header: Plain → Card'])
    expect(parseChange('Home page “List” → “Grid”')).toEqual({ label: 'Home page', before: 'List', after: 'Grid' })
  })

  it('uses existing post changes and leaves older site events at their summary', () => {
    expect(activityChanges({ action: 'post.updated', summary: '', actor_type: 'human', actor_name: 'Ada', created_at: 1, changes: ['Title “Old” → “New”'] })).toEqual(['Title “Old” → “New”'])
    expect(activityChanges({ action: 'site.updated', summary: 'Updated site', actor_type: 'human', actor_name: 'Ada', created_at: 1 })).toEqual([])
  })
})

describe('readable activity', () => {
  it('reads server and client change lines as label, before, after', () => {
    expect(parseChange('Template “Magazine” → “Editorial”')).toEqual({ label: 'Template', before: 'Magazine', after: 'Editorial' })
    expect(parseChange('Signup heading “Join: now” → “Subscribe”')).toEqual({ label: 'Signup heading', before: 'Join: now', after: 'Subscribe' })
    expect(parseChange('Accent: blue → rust')).toEqual({ label: 'Accent', before: 'blue', after: 'rust' })
    expect(parseChange('Corners “sm” → template default')).toEqual({ label: 'Corners', before: 'sm', after: 'template default' })
    expect(parseChange('URL /old → /new')).toEqual({ label: 'URL', before: '/old', after: '/new' })
    expect(parseChange('Body +1,204 characters')).toEqual({ label: 'Body', text: '+1,204 characters' })
    expect(parseChange('Navigation links changed')).toEqual({ label: '', text: 'Navigation links changed' })
  })

  it('drops the status line when the summary already says it', () => {
    expect(activityChanges({ action: 'post.archived', summary: 'Archived Notes', actor_type: 'api_key', actor_name: 'Agent', created_at: 1,
      changes: ['Status draft → archived'] })).toEqual([])
    expect(activityChanges({ action: 'post.updated', summary: 'Edited Notes', actor_type: 'api_key', actor_name: 'Agent', created_at: 1,
      changes: ['Status draft → published'] })).toEqual(['Status draft → published'])
  })

  it('groups by calendar day with words a person uses', () => {
    const now = new Date(2026, 9, 1, 15, 0)
    const at = (d: Date) => Math.floor(d.getTime() / 1000)
    expect(activityDayLabel(at(new Date(2026, 9, 1, 0, 5)), now)).toBe('Today')
    expect(activityDayLabel(at(new Date(2026, 8, 30, 23, 59)), now)).toBe('Yesterday')
    expect(activityDayLabel(at(new Date(2026, 8, 28, 12)), now)).toContain(new Date(2026, 8, 28).toLocaleDateString(undefined, { weekday: 'long' }))
    expect(activityDayLabel(at(new Date(2025, 8, 28, 12)), now)).toContain('2025')
    const groups = groupByDay([
      { ...event('a'), created_at: at(new Date(2026, 9, 1, 14)) },
      { ...event('b'), created_at: at(new Date(2026, 9, 1, 9)) },
      { ...event('c'), created_at: at(new Date(2026, 8, 30, 9)) },
    ], now)
    expect(groups.map((g) => [g.label, g.events.length])).toEqual([['Today', 2], ['Yesterday', 1]])
  })

  it('sets the post title apart from the verb', () => {
    expect(splitSummary('Edited Terminal notes (tags)', 'post')).toEqual({ verb: 'Edited', subject: 'Terminal notes', detail: 'tags' })
    expect(splitSummary('Archived Why (really) versions', 'post')).toEqual({ verb: 'Archived', subject: 'Why (really) versions', detail: '' })
    expect(splitSummary('Created My post (part 2)', 'post')).toEqual({ verb: 'Created', subject: 'My post (part 2)', detail: '' })
    expect(splitSummary('Archived Launch (scheduled publish canceled)', 'post')).toEqual({ verb: 'Archived', subject: 'Launch', detail: 'scheduled publish canceled' })
    expect(splitSummary('Changed the theme', 'site')).toEqual({ verb: 'Changed the theme', subject: '', detail: '' })
  })
})
