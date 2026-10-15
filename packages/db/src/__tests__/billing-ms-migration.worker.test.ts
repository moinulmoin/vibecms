/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'
import { createDataAccess } from '@vc/db'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

it('0037 converts second-based webhook ordering keys to ms once, seeds subscription_updated_at from the converted watermark, adds NULL cancel flag/apply_nonce, and leaves past_due_since NULL', async () => {
  const migrations = inject('migrations') as D1Migration[]
  const index37 = migrations.findIndex((migration) => migration.name.startsWith('0037_'))
  expect(index37).toBeGreaterThan(0)
  await applyD1Migrations(env.DB, migrations.slice(0, index37))

  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ms-ws-a', 'A', 'ms-ws-a', 1, 1)"),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ms-ws-b', 'B', 'ms-ws-b', 1, 1)"),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ms-ws-c', 'C', 'ms-ws-c', 1, 1)"),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ms-ws-d', 'D', 'ms-ws-d', 1, 1)"),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ms-ws-e', 'E', 'ms-ws-e', 1, 1)"),
    // Legacy seconds, already-ms, and never-webhooked rows.
    env.DB.prepare(`INSERT INTO billing_customers (id, workspace_id, status, current_period_end, webhook_event_id, webhook_updated_at, created_at, updated_at)
      VALUES ('billing_ms-ws-a', 'ms-ws-a', 'active', 1800000000, 'evt_a', 1790000000, 1, 1)`),
    env.DB.prepare(`INSERT INTO billing_customers (id, workspace_id, status, current_period_end, webhook_event_id, webhook_updated_at, created_at, updated_at)
      VALUES ('billing_ms-ws-b', 'ms-ws-b', 'active', 1800000000, 'evt_b', 1790000000250, 1, 1)`),
    env.DB.prepare(`INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at)
      VALUES ('billing_ms-ws-c', 'ms-ws-c', 'none', 1, 1)`),
    // Legacy past_due rows (webhooked and never-webhooked): their true onset is unknown.
    env.DB.prepare(`INSERT INTO billing_customers (id, workspace_id, status, current_period_end, webhook_event_id, webhook_updated_at, created_at, updated_at)
      VALUES ('billing_ms-ws-d', 'ms-ws-d', 'past_due', 1800000000, 'evt_d', 1790000500, 1, 1790000600)`),
    env.DB.prepare(`INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at)
      VALUES ('billing_ms-ws-e', 'ms-ws-e', 'past_due', 1, 1790000700)`),
    env.DB.prepare(`INSERT INTO polar_webhook_receipts (event_id, workspace_id, event_type, source_timestamp, applied_status, created_at)
      VALUES ('evt_a', 'ms-ws-a', 'subscription.active', 1790000000, 'active', 1790000000)`),
    env.DB.prepare(`INSERT INTO polar_webhook_receipts (event_id, workspace_id, event_type, source_timestamp, applied_status, created_at)
      VALUES ('evt_b', 'ms-ws-b', 'subscription.active', 1790000000250, 'active', 1790000000)`),
  ])

  await applyD1Migrations(env.DB, migrations.slice(index37))

  const billing = await env.DB.prepare(
    "SELECT workspace_id, status, webhook_updated_at, subscription_updated_at, current_period_end, cancel_at_period_end, past_due_since, created_at FROM billing_customers WHERE workspace_id LIKE 'ms-ws-%' ORDER BY workspace_id",
  ).all()
  expect(billing.results).toEqual([
    // Legacy seconds: both watermarks become the converted ms value.
    { workspace_id: 'ms-ws-a', status: 'active', webhook_updated_at: 1790000000000, subscription_updated_at: 1790000000000, current_period_end: 1800000000, cancel_at_period_end: null, past_due_since: null, created_at: 1 },
    // Already-ms: left as-is, subscription watermark copied unchanged.
    { workspace_id: 'ms-ws-b', status: 'active', webhook_updated_at: 1790000000250, subscription_updated_at: 1790000000250, current_period_end: 1800000000, cancel_at_period_end: null, past_due_since: null, created_at: 1 },
    // Never webhooked: both watermarks stay NULL.
    { workspace_id: 'ms-ws-c', status: 'none', webhook_updated_at: null, subscription_updated_at: null, current_period_end: null, cancel_at_period_end: null, past_due_since: null, created_at: 1 },
    // No backfill: legacy past_due rows keep a NULL grace clock (no grace).
    { workspace_id: 'ms-ws-d', status: 'past_due', webhook_updated_at: 1790000500000, subscription_updated_at: 1790000500000, current_period_end: 1800000000, cancel_at_period_end: null, past_due_since: null, created_at: 1 },
    { workspace_id: 'ms-ws-e', status: 'past_due', webhook_updated_at: null, subscription_updated_at: null, current_period_end: null, cancel_at_period_end: null, past_due_since: null, created_at: 1 },
  ])
  const receipts = await env.DB.prepare(
    "SELECT event_id, source_timestamp, apply_nonce, created_at FROM polar_webhook_receipts WHERE workspace_id LIKE 'ms-ws-%' ORDER BY event_id",
  ).all()
  // Legacy receipts get no nonce, so a redelivery can never claim them and reapply billing.
  expect(receipts.results).toEqual([
    { event_id: 'evt_a', source_timestamp: 1790000000000, apply_nonce: null, created_at: 1790000000 },
    { event_id: 'evt_b', source_timestamp: 1790000000250, apply_nonce: null, created_at: 1790000000 },
  ])

  // Drizzle reads the nullable flag as boolean | null.
  expect((await createDataAccess(env.DB).billing.getBillingRecord('ms-ws-a'))?.cancelAtPeriodEnd).toBeNull()
  await env.DB.prepare("UPDATE billing_customers SET cancel_at_period_end = 1 WHERE workspace_id = 'ms-ws-a'").run()
  expect((await createDataAccess(env.DB).billing.getBillingRecord('ms-ws-a'))?.cancelAtPeriodEnd).toBe(true)
  expect((await createDataAccess(env.DB).billing.getBillingRecord('ms-ws-d'))?.pastDueSince).toBeNull()
  expect((await createDataAccess(env.DB).billing.getBillingRecord('ms-ws-d'))?.subscriptionUpdatedAt).toBe(1790000500000)
  expect((await createDataAccess(env.DB).billing.getBillingRecord('ms-ws-c'))?.subscriptionUpdatedAt).toBeNull()
})
