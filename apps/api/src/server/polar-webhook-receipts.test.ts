import { describe, expect, it } from 'vitest'
import { applyPolarWebhookAtomically, polarEventId } from '@/server/polar-webhook-receipts'

// ── Minimal D1 stub ──────────────────────────────────────────────────────────
// prepare(sql).bind(...vals) → { sql, bindings }; batch() returns preset results.
// No cloudflare:workers import → runs under normal Vitest.

type FakeStmt = { sql: string; bindings: unknown[] }

function makeFakeD1(
  batchResults: Array<Array<{ meta: { changes: number } }>>,
) {
  let batchIdx = 0
  const batchCalls: FakeStmt[][] = []

  const db = {
    prepare(sql: string) {
      return {
        bind(...vals: unknown[]): FakeStmt {
          return { sql, bindings: vals }
        },
      }
    },
    async batch(stmts: FakeStmt[]) {
      batchCalls.push(stmts.map((s) => ({ sql: s.sql, bindings: [...s.bindings] })))
      return batchResults[batchIdx++] ?? stmts.map(() => ({ meta: { changes: 1 } }))
    },
  }

  return { db: db as unknown as D1Database, batchCalls }
}

const baseInput = {
  eventId: 'evt_abc',
  workspaceId: 'ws_1',
  eventType: 'subscription.created',
  sourceTimestamp: 1_000,
  appliedStatus: 'active' as const,
  polarCustomerId: 'cust_1' as string | null,
  polarSubscriptionId: 'sub_1' as string | null,
  currentPeriodEnd: 2_000 as number | null,
}

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

// ── applyPolarWebhookAtomically ───────────────────────────────────────────────

describe('applyPolarWebhookAtomically', () => {
  it('returns applied when receipt + billing both change', async () => {
    const { db } = makeFakeD1([
      [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ],
    ])
    const result = await applyPolarWebhookAtomically(db, { ...baseInput })
    expect(result).toEqual({ kind: 'applied' })
  })

  it('returns duplicate when receipt already exists (re-delivery)', async () => {
    const { db } = makeFakeD1([
      [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ],
    ])
    const result = await applyPolarWebhookAtomically(db, { ...baseInput })
    expect(result).toEqual({ kind: 'duplicate' })
  })

  it('returns stale when receipt is new but billing guard rejects', async () => {
    const { db } = makeFakeD1([
      [
        { meta: { changes: 1 } },
        { meta: { changes: 0 } },
      ],
    ])
    const result = await applyPolarWebhookAtomically(db, { ...baseInput })
    expect(result).toEqual({ kind: 'stale' })
  })

  it('calls db.batch with exactly two statements in one transaction', async () => {
    const { db, batchCalls } = makeFakeD1([
      [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ],
    ])
    await applyPolarWebhookAtomically(db, { ...baseInput })
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0]).toHaveLength(2)
  })

  it('first statement is receipt INSERT with ON CONFLICT DO NOTHING', async () => {
    const { db, batchCalls } = makeFakeD1([
      [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ],
    ])
    await applyPolarWebhookAtomically(db, { ...baseInput })
    const receipt = batchCalls[0][0]
    expect(receipt.sql).toContain('polar_webhook_receipts')
    expect(receipt.sql).toContain('ON CONFLICT(event_id) DO NOTHING')
    expect(receipt.bindings[0]).toBe('evt_abc')
  })

  it('second statement is billing conditional upsert with monotonic guard', async () => {
    const { db, batchCalls } = makeFakeD1([
      [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ],
    ])
    await applyPolarWebhookAtomically(db, { ...baseInput })
    const billing = batchCalls[0][1]
    expect(billing.sql).toContain('billing_customers')
    expect(billing.sql).toContain('ON CONFLICT(workspace_id) DO UPDATE')
    expect(billing.sql).toContain('webhook_updated_at < excluded.webhook_updated_at')
    expect(billing.sql).toContain('webhook_event_id < excluded.webhook_event_id')
    // Bindings include the new monotonic fields
    expect(billing.bindings).toContain('evt_abc')
    expect(billing.bindings).toContain(1_000)
  })

  it('propagates batch errors (atomicity — neither committed)', async () => {
    const db = {
      prepare() {
        return { bind() { return {} } }
      },
      async batch() {
        throw new Error('D1 batch failed')
      },
    }
    await expect(
      applyPolarWebhookAtomically(db as unknown as D1Database, { ...baseInput }),
    ).rejects.toThrow('D1 batch failed')
  })
})
