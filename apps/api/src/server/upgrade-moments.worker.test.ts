/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { app } from '@/index'
import { hashApiToken } from '@/server/api-keys'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

// What an agent sees at the free plan's marks (brief: upgrade moments).
const UPGRADE_LINK = 'https://basedui.dev/#pricing'
const NOW = Math.floor(Date.now() / 1000)
// 1x1 PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

type Blog = { workspaceId: string; siteId: string; token: string }

async function seedBlog(suffix: string, plan: 'free' | 'cloud' | 'managed-grace'): Promise<Blog> {
  const blog = {
    workspaceId: `upgrade-ws-${suffix}`,
    siteId: `upgrade-site-${suffix}`,
    token: `vc_test_upgrade_${suffix}_${'a'.repeat(32)}`,
  }
  const statements = [
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(blog.workspaceId, suffix, blog.workspaceId, NOW, NOW),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(blog.siteId, blog.workspaceId, `Blog ${suffix}`, blog.siteId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Agent', ?, ?, ?, 'Agent', 'owner', ?, ?)`,
    ).bind(
      `upgrade-key-${suffix}`, blog.siteId, blog.token.slice(0, 18), await hashApiToken(blog.token, env.TOKEN_PEPPER),
      JSON.stringify(['posts:read', 'posts:create', 'posts:publish', 'assets:write']), NOW, NOW,
    ),
  ]
  if (plan === 'managed-grace') {
    // AutoSEOPilot-managed, revoked three days ago: inside the claim grace, read as hosted free.
    statements.push(
      env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
        .bind(`upgrade-owner-${suffix}`, 'Owner', `${suffix}@upgrade.example.test`, NOW, NOW),
      env.DB.prepare(
        `INSERT INTO autoseopilot_managed_sites (
           id, external_workspace_id, owner_user_id, workspace_id, site_id, credential_id, credential_generation,
           api_key_id, entitlement_status, entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'revoked', NULL, 2, ?, ?, ?)`,
      ).bind(`upgrade-binding-${suffix}`, `upgrade-external-${suffix}`, `upgrade-owner-${suffix}`, blog.workspaceId, blog.siteId,
        `upgrade-credential-${suffix}`, `upgrade-key-${suffix}`, NOW - 10 * 86400, NOW - 3 * 86400, NOW - 3 * 86400),
    )
  }
  if (plan === 'cloud') {
    statements.push(
      env.DB.prepare('INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?, ?)')
        .bind(`upgrade-billing-${suffix}`, blog.workspaceId, NOW + 30 * 86400, NOW, NOW),
    )
  }
  await env.DB.batch(statements)
  return blog
}

/** Brings the blog to `total` published posts without going through the API. */
async function seedPublishedUpTo(blog: Blog, total: number) {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM posts WHERE site_id = ? AND status = 'published'").bind(blog.siteId).first<{ n: number }>()
  const statements: D1PreparedStatement[] = []
  for (let index = row?.n ?? 0; index < total; index += 1) {
    const postId = `${blog.siteId}-seeded-${index}`
    statements.push(
      env.DB.prepare(`INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Seeded.', 'published', ?, 'api_key', 'seed', 'api_key', 'seed', ?, ?)`).bind(postId, blog.siteId, `Seeded ${index}`, `seeded-${index}`, NOW, NOW, NOW),
      env.DB.prepare(`INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at)
        VALUES (?, ?, ?, 1, ?, ?, 'Seeded.', 'published', 'api_key', 'seed', 'seed', ?)`).bind(`${postId}-v1`, postId, blog.siteId, `Seeded ${index}`, `seeded-${index}`, NOW),
      env.DB.prepare('UPDATE posts SET published_version_id = ? WHERE id = ?').bind(`${postId}-v1`, postId),
    )
  }
  if (statements.length) await env.DB.batch(statements)
}

async function seedImagesUpTo(blog: Blog, total: number) {
  const statements: D1PreparedStatement[] = []
  for (let index = 0; index < total; index += 1) {
    statements.push(
      env.DB.prepare(`INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, created_by_type, created_by_id, created_at, updated_at)
        VALUES (?, ?, ?, 'seed.png', 'image/png', 10, 'api_key', 'seed', ?, ?)`).bind(`${blog.siteId}-asset-${index}`, blog.siteId, `${blog.siteId}/seed-${index}.png`, NOW, NOW),
    )
  }
  await env.DB.batch(statements)
}

async function call(blog: Blog, path: string, body: unknown) {
  // The worker test configuration limits each workspace to one API call.
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(blog.workspaceId).run()
  const response = await app.fetch(new Request(`https://app.basedui.dev${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${blog.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env)
  return { status: response.status, body: await response.json() as Record<string, any> }
}

/** Creates a draft and publishes it through the agent API. */
async function publishNew(blog: Blog, slug: string) {
  const created = await call(blog, '/api/v1/posts', { title: slug, slug, contentMarkdown: 'A new post.' })
  expect(created.status).toBe(201)
  return call(blog, `/api/v1/posts/${created.body.id}/publish`, { expectedVersionNumber: created.body.currentVersionNumber })
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

describe('free plan upgrade moments for agents', () => {
  it('tells the agent at the 20th published post, with 5 left and the upgrade link, and not at the 19th', async () => {
    const blog = await seedBlog('close', 'free')
    await seedPublishedUpTo(blog, 18)

    const nineteenth = await publishNew(blog, 'post-nineteen')
    expect(nineteenth.status).toBe(200)
    expect(JSON.stringify(nineteenth.body)).not.toContain(UPGRADE_LINK)
    expect(nineteenth.body.planNotice).toBeUndefined()

    const twentieth = await publishNew(blog, 'post-twenty')
    expect(twentieth.status).toBe(200)
    expect(twentieth.body.planNotice).toContain('5')
    expect(twentieth.body.planNotice).toContain(UPGRADE_LINK)
  })

  it('refuses the 26th post naming the limit of 25, that published posts stay online, and the upgrade link', async () => {
    const blog = await seedBlog('limit', 'free')
    await seedPublishedUpTo(blog, 25)

    const refused = await publishNew(blog, 'post-twenty-six')
    expect(refused.status).toBe(402)
    expect(refused.body.error.message).toContain('25')
    expect(refused.body.error.message).toMatch(/published posts stay online/i)
    expect(refused.body.error.message).toContain(UPGRADE_LINK)
  })

  it('gives a Cloud blog none of these messages at 20 posts, 26 posts or 80 images, and a managed blog in its claim grace none at 20', async () => {
    const blog = await seedBlog('cloud', 'cloud')
    await seedPublishedUpTo(blog, 19)

    const twentieth = await publishNew(blog, 'cloud-twenty')
    expect(twentieth.status).toBe(200)
    expect(JSON.stringify(twentieth.body)).not.toContain(UPGRADE_LINK)

    await seedPublishedUpTo(blog, 25)
    const twentySixth = await publishNew(blog, 'cloud-twenty-six')
    expect(twentySixth.status).toBe(200)
    expect(JSON.stringify(twentySixth.body)).not.toContain(UPGRADE_LINK)

    await seedImagesUpTo(blog, 79)
    const eightieth = await call(blog, '/api/v1/assets', { filename: 'eighty.png', mimeType: 'image/png', dataBase64: PNG_BASE64, altText: 'A dot' })
    expect(eightieth.status).toBe(201)
    expect(JSON.stringify(eightieth.body)).not.toContain(UPGRADE_LINK)

    // An AutoSEOPilot-managed blog in its claim grace is not offered the free-plan notice either.
    const managed = await seedBlog('managed', 'managed-grace')
    await seedPublishedUpTo(managed, 19)
    const managedTwentieth = await publishNew(managed, 'managed-twenty')
    expect(managedTwentieth.status).toBe(200)
    expect(managedTwentieth.body.planNotice).toBeUndefined()
  })
})
