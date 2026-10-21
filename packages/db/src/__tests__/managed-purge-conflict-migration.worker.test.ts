/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

it('0040 gives the existing claim checkout attempts the 48-hour guard, and the conflict record its notice state', async () => {
  const migrations = inject('migrations') as D1Migration[]
  const index40 = migrations.findIndex((migration) => migration.name.startsWith('0040_'))
  expect(index40).toBeGreaterThan(0)
  await applyD1Migrations(env.DB, migrations.slice(0, index40))

  // A checkout attempt from before the guard existed.
  await env.DB.prepare(
    "INSERT INTO autoseopilot_claim_checkouts (workspace_id, created_at, expires_at) VALUES ('ws-legacy-attempt', 1000, 2000)",
  ).run()

  await applyD1Migrations(env.DB, migrations.slice(index40))

  const attempt = await env.DB.prepare(
    'SELECT created_at, guard_until, resolved_at FROM autoseopilot_claim_checkouts WHERE workspace_id = ?',
  )
    .bind('ws-legacy-attempt')
    .first<{ created_at: number; guard_until: number; resolved_at: number | null }>()
  expect(attempt?.created_at).toBe(1000)
  // 48 hours from the moment the checkout was opened, not from the migration.
  expect(attempt?.guard_until).toBe(1000 + 48 * 60 * 60)
  expect(attempt?.resolved_at).toBeNull()

  // The conflict record carries the notice state, so a notice that was never
  // accepted stays owed.
  await env.DB.prepare(
    `INSERT INTO autoseopilot_purge_conflicts (
       id, workspace_id, site_id, polar_customer_id, polar_subscription_id,
       polar_order_id, polar_checkout_id, event_id, event_type, applied_status,
       notified_at, created_at
     ) VALUES ('purge-conflict-ws-legacy-attempt-evt', 'ws-legacy-attempt', NULL, NULL, 'sub_legacy', NULL, NULL, 'evt', 'subscription.active', 'active', NULL, 5)`,
  ).run()
  const conflict = await env.DB.prepare(
    'SELECT notified_at, created_at FROM autoseopilot_purge_conflicts WHERE id = ?',
  )
    .bind('purge-conflict-ws-legacy-attempt-evt')
    .first<{ notified_at: number | null; created_at: number }>()
  expect(conflict?.notified_at).toBeNull()
  expect(conflict?.created_at).toBe(5)
})
