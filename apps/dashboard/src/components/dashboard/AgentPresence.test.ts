import { describe, expect, it } from 'vitest'
import { ACTIVE_WINDOW_SECONDS, activeAgents, newestAgentRequest, presenceLabel } from './AgentPresence'

const key = (id: string, lastUsedAt: number | null, revokedAt: number | null = null) => ({
  id, name: id, tokenPrefix: `vc_${id}`, scopes: [], createdAt: 0, lastUsedAt, revokedAt,
})

describe('agent presence', () => {
  it('counts only live keys used within the window, most recent first', () => {
    const now = 10_000
    const active = activeAgents([
      key('Quiet agent', now - ACTIVE_WINDOW_SECONDS - 1),
      key('Never used', null),
      key('Revoked agent', now - 5, now - 1),
      key('Claude', now - 30),
      key('Codex', now - 3),
    ], now)
    expect(active.map((k) => k.name)).toEqual(['Codex', 'Claude'])
  })

  it('names one agent and counts several', () => {
    expect(presenceLabel([])).toBeNull()
    expect(presenceLabel([{ name: 'My agent' }])).toBe('My agent is working')
    expect(presenceLabel([{ name: 'Claude' }, { name: 'Codex' }])).toBe('2 agents are working')
  })

  it('finds the newest request from a live key', () => {
    expect(newestAgentRequest([])).toBe(0)
    expect(newestAgentRequest([key('a', null), key('b', 40), key('c', 90, 95)])).toBe(40)
  })
})
