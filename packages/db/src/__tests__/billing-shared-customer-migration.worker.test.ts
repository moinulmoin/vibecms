/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

it('0046 keeps every billing row as it was and lets one Polar customer pay for several blogs', async () => {
  const migrations = inject('migrations') as D1Migration[]
  const index46 = migrations.findIndex((migration) => migration.name.startsWith('0046_'))
  expect(index46).toBeGreaterThan(0)
  await applyD1Migrations(env.DB, migrations.slice(0, index46))

  const workspace = env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
  await env.DB.batch(['ws-paid', 'ws-past-due', 'ws-second-blog', 'ws-other'].map((id) => workspace.bind(id, id, id)))
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO billing_customers (id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end,
         created_at, updated_at, webhook_event_id, webhook_updated_at, cancel_at_period_end, past_due_since, subscription_updated_at)
       VALUES ('billing_ws-paid', 'ws-paid', 'cust_person', 'sub_paid', 'active', 2000000000, 10, 20, 'evt_paid', 1700000000123, 1, NULL, 1700000000456)`,
    ),
    env.DB.prepare(
      `INSERT INTO billing_customers (id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end,
         created_at, updated_at, webhook_event_id, webhook_updated_at, cancel_at_period_end, past_due_since, subscription_updated_at)
       VALUES ('billing_ws-past-due', 'ws-past-due', 'cust_other_person', 'sub_past_due', 'past_due', 1900000000, 11, 21, 'evt_due', 1700000000789, 0, 1700000000000, NULL)`,
    ),
  ])
  const before = await env.DB.prepare('SELECT * FROM billing_customers ORDER BY id').all()

  await applyD1Migrations(env.DB, migrations.slice(index46))

  expect((await env.DB.prepare('SELECT * FROM billing_customers ORDER BY id').all()).results).toEqual(before.results)
  // The person who pays for ws-paid pays for a second blog too.
  await env.DB.prepare(
    "INSERT INTO billing_customers (id, workspace_id, polar_customer_id, polar_subscription_id, status, created_at, updated_at) VALUES ('billing_ws-second-blog', 'ws-second-blog', 'cust_person', 'sub_second_blog', 'active', 30, 30)",
  ).run()
  // One subscription still pays for one blog only.
  await expect(
    env.DB.prepare(
      "INSERT INTO billing_customers (id, workspace_id, polar_subscription_id, status, created_at, updated_at) VALUES ('billing_ws-other', 'ws-other', 'sub_paid', 'active', 40, 40)",
    ).run(),
  ).rejects.toThrow()
})
