import { describe, expect, it } from 'vitest'
import { polarCancelAtPeriodEnd, polarEventId, polarSourceTimestampMs } from '@/server/polar-webhook-receipts'

// Pure helpers only. applyPolarWebhookAtomically's D1 behavior (monotonic
// guard, duplicate/stale, cancel flag COALESCE) is covered against real D1 in
// billing-webhook.worker.test.ts.

// ── polarEventId ──────────────────────────────────────────────────────────────

describe('polarEventId', () => {
  it('uses event.id when present', async () => {
    expect(await polarEventId({ id: 'evt_123' }, '{}', new Headers())).toBe('evt_123')
  })

  it('falls back to webhook-id header', async () => {
    const h = new Headers({ 'webhook-id': 'hdr_456' })
    expect(await polarEventId({}, '{}', h)).toBe('hdr_456')
  })

  it('falls back to deterministic payload hash', async () => {
    const id = await polarEventId({}, '{"a":1}', new Headers())
    expect(id.startsWith('payload:')).toBe(true)
    // Same payload → same id (deterministic)
    const id2 = await polarEventId({}, '{"a":1}', new Headers())
    expect(id).toBe(id2)
  })
})

// ── polarSourceTimestampMs ────────────────────────────────────────────────────

describe('polarSourceTimestampMs', () => {
  const modified = new Date('2026-10-01T12:00:00.250Z')
  const envelope = new Date('2026-10-01T12:00:05.000Z')
  const created = new Date('2026-09-01T00:00:00.000Z')
  const header = new Headers({ 'webhook-timestamp': '1790000000' })

  it('prefers modifiedAt, keeping millisecond precision', () => {
    expect(polarSourceTimestampMs({ timestamp: envelope }, { modifiedAt: modified, createdAt: created }, header))
      .toBe(modified.getTime())
    expect(polarSourceTimestampMs({}, { modified_at: modified.toISOString() }, header)).toBe(modified.getTime())
  })

  it('falls back to the envelope timestamp when modifiedAt is null', () => {
    expect(polarSourceTimestampMs({ timestamp: envelope }, { modifiedAt: null, createdAt: created }, header))
      .toBe(envelope.getTime())
  })

  it('falls back to the webhook-timestamp header (seconds → ms)', () => {
    expect(polarSourceTimestampMs({}, { createdAt: created }, header)).toBe(1_790_000_000_000)
  })

  it('falls back to createdAt, then now', () => {
    expect(polarSourceTimestampMs({}, { created_at: created.toISOString() }, new Headers())).toBe(created.getTime())
    expect(polarSourceTimestampMs({}, {}, new Headers(), 42)).toBe(42)
  })
})

// ── polarCancelAtPeriodEnd ────────────────────────────────────────────────────

describe('polarCancelAtPeriodEnd', () => {
  it('reads the flag from subscription events, including uncancel (false)', () => {
    expect(polarCancelAtPeriodEnd('subscription.canceled', { cancelAtPeriodEnd: true })).toBe(true)
    expect(polarCancelAtPeriodEnd('subscription.uncanceled', { cancel_at_period_end: false })).toBe(false)
  })

  it('is null (leave unchanged) for checkout events and missing flags', () => {
    expect(polarCancelAtPeriodEnd('checkout.updated', { cancelAtPeriodEnd: true })).toBeNull()
    expect(polarCancelAtPeriodEnd('subscription.updated', {})).toBeNull()
  })
})
