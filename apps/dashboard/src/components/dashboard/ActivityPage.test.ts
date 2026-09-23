import { describe, expect, it } from 'vitest'
import { uniqueActivityEvents } from './ActivityPage'

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
