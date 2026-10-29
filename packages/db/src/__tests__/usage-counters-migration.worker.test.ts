/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

it('0047 preserves every existing counter column while allowing another key in the same site-minute', async () => {
  const migrations = inject('migrations')
  await applyD1Migrations(env.DB, migrations.filter((migration) => migration.name < '0047_'))
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('counter-legacy-ws', 'Legacy', 'counter-legacy-ws', 1, 2)"),
    env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES ('counter-legacy-site', 'counter-legacy-ws', 'Legacy', 'counter-legacy-site', 3, 4)"),
    env.DB.prepare(`INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at) VALUES
      ('token:legacy-a:calls:2026-10-28T14:12Z', 'counter-legacy-ws', 'counter-legacy-site', '2026-10-28T14:12Z', 'calls', 17, 11, 12),
      ('workspace:counter-legacy-ws:calls:2026-10-28', 'counter-legacy-ws', NULL, '2026-10-28', 'calls', 420, 21, 22),
      ('workspace:counter-legacy-ws:writes:2026-10', 'counter-legacy-ws', NULL, '2026-10', 'writes', 0, 31, 32)`),
  ])
  const before = (await env.DB.prepare('SELECT * FROM usage_counters ORDER BY id').all()).results

  await applyD1Migrations(env.DB, migrations.filter((migration) => migration.name >= '0047_'))

  expect((await env.DB.prepare('SELECT * FROM usage_counters ORDER BY id').all()).results).toEqual(before)
  // A preservation-only assertion would pass even if this rebuild never ran.
  // The second key must coexist with the migrated first key's exact tuple.
  await env.DB.prepare(`INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
    VALUES ('token:legacy-b:calls:2026-10-28T14:12Z', 'counter-legacy-ws', 'counter-legacy-site', '2026-10-28T14:12Z', 'calls', 1, 41, 42)`).run()
  expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM usage_counters').first<{ count: number }>())?.count).toBe(before.length + 1)
})
