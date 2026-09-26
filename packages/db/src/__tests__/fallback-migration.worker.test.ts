/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { expect, inject, it } from 'vitest'
import { createPublicBlogReadModel } from '../read-models/public-blog'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

it('leaves legacy SQL excerpts empty, clears old garbled values, then persists the correct public fallback', async () => {
  const migrations = inject('migrations') as D1Migration[]
  const index26 = migrations.findIndex((migration) => migration.name.startsWith('0026_'))
  const index28 = migrations.findIndex((migration) => migration.name.startsWith('0028_'))
  expect(index26).toBeGreaterThan(0)
  expect(index28).toBeGreaterThan(index26)
  await applyD1Migrations(env.DB, migrations.slice(0, index26))
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('fallback-ws', 'Fallback', 'fallback-ws', 1, 1)").run()
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES ('fallback-site', 'fallback-ws', 'Fallback', 'fallback-site', 1, 1)").run()
  await env.DB.prepare(`INSERT INTO posts
    (id, site_id, title, slug, content_markdown, status, published_at,
     created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
    VALUES ('fallback-post', 'fallback-site', 'Legacy', 'legacy', '# Heading', 'published', 2,
      'human', 'fallback-user', 'human', 'fallback-user', 1, 2)`).run()
  await env.DB.prepare(`INSERT INTO post_versions
    (id, post_id, site_id, version_number, title, slug, content_markdown, status,
     created_by_type, created_by_id, created_at)
    VALUES ('fallback-version', 'fallback-post', 'fallback-site', 1, 'Legacy', 'legacy',
      '# Heading' || char(10) || char(10) || '1. List item' || char(10) || char(10) || 'Read [the guide](https://example.com).',
      'draft', 'human', 'fallback-user', 1)`).run()
  await env.DB.prepare("UPDATE posts SET published_version_id = 'fallback-version' WHERE id = 'fallback-post'").run()
  await applyD1Migrations(env.DB, migrations.slice(index26, index28))
  const stored = () => env.DB.prepare("SELECT fallback_excerpt FROM post_versions WHERE id = 'fallback-version'").first<{ fallback_excerpt: string | null }>()
  expect((await stored())?.fallback_excerpt).toBeNull()
  await env.DB.prepare("UPDATE post_versions SET fallback_excerpt = 'Read the guide(https://example.com).' WHERE id = 'fallback-version'").run()
  await applyD1Migrations(env.DB, migrations.slice(index28))
  expect((await stored())?.fallback_excerpt).toBeNull()
  const readModel = createPublicBlogReadModel(env.DB)
  const rows = await readModel.listPublishedPostSummaries('fallback-site', 3, 10)
  expect(rows[0]?.excerpt).toBe('Read the guide.')
  expect((await stored())?.fallback_excerpt).toBe('Read the guide.')
  expect((await readModel.listPublishedPostSummaries('fallback-site', 3, 10))[0]?.excerpt).toBe('Read the guide.')
})
