/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { app } from '@/index'

const INTERNAL_SECRET = 'managed-route-test-secret'
const EXTERNAL_WORKSPACE_ID = '00000000-0000-4000-8000-000000000901'
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000902'
const TOKEN = ['vc', 'test', 'a'.repeat(32)].join('_') + '_'
const ROTATED_TOKEN = ['vc', 'test', 'b'.repeat(32)].join('_') + '_'
const RECONCILE_TOKEN = ['vc', 'test', 'c'.repeat(32)].join('_') + '_'
const RACE_FIRST_TOKEN = ['vc', 'test', 'd'.repeat(32)].join('_') + '_'
const RACE_SECOND_TOKEN = ['vc', 'test', 'e'.repeat(32)].join('_') + '_'

const configuredEnv = {
  ...env,
  AUTOSEOPILOT_INTERNAL_SECRET: INTERNAL_SECRET,
} as typeof env

function request(
  path: string,
  init: RequestInit = {},
  environment: typeof env = configuredEnv,
) {
  const headers = new Headers(init.headers)
  headers.set('X-AUTOSEOPILOT-INTERNAL-SECRET', INTERNAL_SECRET)
  return app.fetch(new Request(`https://app.basedui.dev${path}`, { ...init, headers }), environment)
}

function provisionBody(overrides: Record<string, unknown> = {}) {
  return {
    ownerEmail: 'managed-route-owner@example.test',
    siteName: 'Managed Route Site',
    credential: {
      rawToken: TOKEN,
      credentialId: CREDENTIAL_ID,
      generation: 1,
    },
    entitlement: {
      status: 'active',
      expiresAt: null,
    },
    ...overrides,
  }
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

describe('managed AutoSEOPilot internal routes', () => {
  it('hides the route when the internal secret is unset', async () => {
    const response = await app.fetch(
      new Request(`https://app.basedui.dev/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`),
      { ...env, AUTOSEOPILOT_INTERNAL_SECRET: undefined } as typeof env,
    )

    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('NOT_FOUND')
  })

  it('requires the internal secret and validates JSON requests', async () => {
    const missing = await app.fetch(
      new Request(`https://app.basedui.dev/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`),
      { ...env, AUTOSEOPILOT_INTERNAL_SECRET: INTERNAL_SECRET } as typeof env,
    )
    expect(missing.status).toBe(401)

    const wrongSecret = await app.fetch(
      new Request(`https://app.basedui.dev/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`, {
        headers: { 'X-AUTOSEOPILOT-INTERNAL-SECRET': 'wrong-secret' },
      }),
      configuredEnv,
    )
    expect(wrongSecret.status).toBe(401)

    const missingPepper = await request(
      `/internal/autoseopilot/sites/00000000-0000-4000-8000-000000000903`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(provisionBody()),
      },
      { ...configuredEnv, TOKEN_PEPPER: undefined } as typeof env,
    )
    expect(missingPepper.status).toBe(500)
    expect((await json(missingPepper)).error.code).toBe('INTERNAL_ERROR')

    const missingPublicDomain = await request(
      `/internal/autoseopilot/sites/00000000-0000-4000-8000-000000000906`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(provisionBody()),
      },
      { ...configuredEnv, PUBLIC_BLOG_DOMAIN: '' },
    )
    expect(missingPublicDomain.status).toBe(500)
    expect((await json(missingPublicDomain)).error.code).toBe('INTERNAL_ERROR')

    const malformed = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    )
    expect(malformed.status).toBe(400)
    expect((await json(malformed)).error.code).toBe('VALIDATION_ERROR')

    const unknownField = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...provisionBody(), unexpected: true }),
      },
    )
    expect(unknownField.status).toBe(400)
    expect((await json(unknownField)).error.code).toBe('VALIDATION_ERROR')

    const longCorrelation = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'X-Correlation-Id': 'x'.repeat(129),
        },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(longCorrelation.status).toBe(400)
    expect((await json(longCorrelation)).error.code).toBe('VALIDATION_ERROR')

    const secretCorrelation = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'X-Correlation-Id': TOKEN,
        },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(secretCorrelation.status).toBe(400)
    expect((await json(secretCorrelation)).error.code).toBe('VALIDATION_ERROR')

    const prefixedSecretCorrelation = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'X-Correlation-Id': `corr_${TOKEN}`,
        },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(prefixedSecretCorrelation.status).toBe(400)
    expect((await json(prefixedSecretCorrelation)).error.code).toBe('VALIDATION_ERROR')

    const impossibleExpiry = await request(
      `/internal/autoseopilot/sites/00000000-0000-4000-8000-000000000904`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            entitlement: { status: 'active', expiresAt: '2023-02-29T00:00:00Z' },
          }),
        ),
      },
    )
    expect(impossibleExpiry.status).toBe(400)
    expect((await json(impossibleExpiry)).error.code).toBe('VALIDATION_ERROR')
  })

  it('provisions, replays, rotates, revokes, and recovers a managed site', async () => {
    const correlationId = 'managed-route-provision'
    const first = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(first.status).toBe(201)
    expect(first.headers.get('X-Correlation-Id')).toBe(correlationId)
    const firstBody = await json(first)
    expect(firstBody).toMatchObject({
      externalWorkspaceId: EXTERNAL_WORKSPACE_ID,
      entitlement: { status: 'active', effective: true },
      lifecycle: { revision: 1, status: 'active' },
      correlationId,
    })
    expect(firstBody.publicUrl).toMatch(/^https:\/\//)
    expect(JSON.stringify(firstBody)).not.toContain(TOKEN)
    expect(JSON.stringify(firstBody)).not.toContain('managed-route-owner@example.test')
    const audit = await env.DB
      .prepare(
        'SELECT request_id FROM activity_events WHERE site_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(firstBody.siteId, 'autoseopilot.managed.provisioned')
      .first<{ request_id: string | null }>()
    expect(audit?.request_id).toBe(correlationId)

    const countsBeforeReplay = await env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM sites WHERE id = ?) AS sites,
           (SELECT COUNT(*) FROM api_keys WHERE site_id = ?) AS keys,
           (SELECT COUNT(*) FROM autoseopilot_managed_sites WHERE external_workspace_id = ?) AS bindings`,
      )
      .bind(firstBody.siteId, firstBody.siteId, EXTERNAL_WORKSPACE_ID)
      .first<{ sites: number; keys: number; bindings: number }>()

    const replay = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(replay.status).toBe(200)
    expect((await json(replay)).lifecycle.revision).toBe(1)

    const countsAfterReplay = await env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM sites WHERE id = ?) AS sites,
           (SELECT COUNT(*) FROM api_keys WHERE site_id = ?) AS keys,
           (SELECT COUNT(*) FROM autoseopilot_managed_sites WHERE external_workspace_id = ?) AS bindings`,
      )
      .bind(firstBody.siteId, firstBody.siteId, EXTERNAL_WORKSPACE_ID)
      .first<{ sites: number; keys: number; bindings: number }>()
    expect(countsAfterReplay).toEqual(countsBeforeReplay)

    const ownerConflict = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(provisionBody({ ownerEmail: 'other@example.test' })),
      },
    )
    expect(ownerConflict.status).toBe(409)
    expect((await json(ownerConflict)).error.code).toBe('OWNER_CONFLICT')

    const tokenConflict = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: { rawToken: ROTATED_TOKEN, credentialId: CREDENTIAL_ID, generation: 1 },
          }),
        ),
      },
    )
    expect(tokenConflict.status).toBe(409)
    expect((await json(tokenConflict)).error.code).toBe('CREDENTIAL_CONFLICT')

    const credentialIdConflict = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: {
              rawToken: ROTATED_TOKEN,
              credentialId: '00000000-0000-4000-8000-000000000905',
              generation: 1,
            },
          }),
        ),
      },
    )
    expect(credentialIdConflict.status).toBe(409)
    expect((await json(credentialIdConflict)).error.code).toBe('CREDENTIAL_CONFLICT')

    const gap = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: { rawToken: ROTATED_TOKEN, credentialId: CREDENTIAL_ID, generation: 3 },
          }),
        ),
      },
    )
    expect(gap.status).toBe(409)
    expect((await json(gap)).error.code).toBe('GENERATION_GAP')

    const rotated = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: { rawToken: ROTATED_TOKEN, credentialId: CREDENTIAL_ID, generation: 2 },
          }),
        ),
      },
    )
    expect(rotated.status).toBe(200)
    const rotatedBody = await json(rotated)
    expect(rotatedBody.lifecycle).toEqual({ revision: 2, status: 'active' })
    expect(rotatedBody.apiKeyId).not.toBe(firstBody.apiKeyId)

    const activeRevokedPut = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: {
              rawToken: ROTATED_TOKEN,
              credentialId: CREDENTIAL_ID,
              generation: 2,
            },
            entitlement: { status: 'revoked', expiresAt: null },
          }),
        ),
      },
    )
    expect(activeRevokedPut.status).toBe(409)
    expect((await json(activeRevokedPut)).error.code).toBe('CONFLICT')

    const staleRevoke = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId: CREDENTIAL_ID, generation: 1 }),
      },
    )
    expect(staleRevoke.status).toBe(409)
    expect((await json(staleRevoke)).error.code).toBe('STALE_GENERATION')

    await env.DB.prepare(
      `INSERT INTO posts (
         id, site_id, title, slug, content_markdown, status,
         created_by_type, created_by_id, updated_by_type, updated_by_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'draft', 'system', ?, 'system', ?, ?, ?)`,
    )
      .bind(
        'managed-route-post-901',
        firstBody.siteId,
        'Managed content',
        'managed-content',
        '# Managed content',
        'autoseopilot',
        'autoseopilot',
        2_000_000_000,
        2_000_000_000,
      )
      .run()
    await env.DB.prepare(
      `INSERT INTO post_versions (
         id, post_id, site_id, version_number, title, slug, content_markdown,
         status, created_by_type, created_by_id, created_at
       ) VALUES (?, ?, ?, 1, ?, ?, ?, 'draft', 'system', ?, ?)`,
    )
      .bind(
        'managed-route-version-901',
        'managed-route-post-901',
        firstBody.siteId,
        'Managed content',
        'managed-content',
        '# Managed content',
        'autoseopilot',
        2_000_000_000,
      )
      .run()
    await env.DB.prepare(
      `INSERT INTO activity_events (
         id, site_id, actor_type, actor_id, actor_name, action,
         entity_type, entity_id, summary, created_at
       ) VALUES (?, ?, 'system', 'autoseopilot', 'AutoSEOPilot',
         'managed.test.seed', 'post', ?, ?, ?)`,
    )
      .bind('managed-route-activity-901', firstBody.siteId, 'managed-route-post-901', 'Seeded activity', 2_000_000_000)
      .run()
    const domainBefore = await env.DB
      .prepare("SELECT hostname FROM domains WHERE site_id = ? AND type = 'default'")
      .bind(firstBody.siteId)
      .first<{ hostname: string }>()

    const secretReason = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialId: CREDENTIAL_ID,
          generation: 2,
          reason: `token=${ROTATED_TOKEN}`,
        }),
      },
    )
    expect(secretReason.status).toBe(400)
    expect((await json(secretReason)).error.code).toBe('VALIDATION_ERROR')

    const revoke = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId: CREDENTIAL_ID, generation: 2, reason: 'test' }),
      },
    )
    expect(revoke.status).toBe(200)
    const revokedBody = await json(revoke)
    expect(revokedBody.lifecycle).toEqual({ revision: 3, status: 'revoked' })
    expect(revokedBody.entitlement).toMatchObject({ status: 'revoked', effective: false })
    expect(
      await env.DB
        .prepare("SELECT hostname FROM domains WHERE site_id = ? AND type = 'default'")
        .bind(firstBody.siteId)
        .first<{ hostname: string }>(),
    ).toMatchObject({ hostname: domainBefore?.hostname })

    const revokedPut = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: {
              rawToken: ROTATED_TOKEN,
              credentialId: CREDENTIAL_ID,
              generation: 2,
            },
            entitlement: { status: 'revoked', expiresAt: null },
          }),
        ),
      },
    )
    expect(revokedPut.status).toBe(200)
    expect((await json(revokedPut)).lifecycle.revision).toBe(3)

    const idempotentRevoke = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId: CREDENTIAL_ID, generation: 2 }),
      },
    )
    expect(idempotentRevoke.status).toBe(200)
    expect((await json(idempotentRevoke)).lifecycle.revision).toBe(3)

    const reusedRevokedToken = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: {
              rawToken: ROTATED_TOKEN,
              credentialId: CREDENTIAL_ID,
              generation: 3,
            },
          }),
        ),
      },
    )
    expect(reusedRevokedToken.status).toBe(409)
    expect((await json(reusedRevokedToken)).error.code).toBe('CREDENTIAL_CONFLICT')

    const reusedHistoricalToken = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          provisionBody({
            credential: {
              rawToken: TOKEN,
              credentialId: CREDENTIAL_ID,
              generation: 3,
            },
          }),
        ),
      },
    )
    expect(reusedHistoricalToken.status).toBe(409)
    expect((await json(reusedHistoricalToken)).error.code).toBe('CREDENTIAL_CONFLICT')

    const staleReactivation = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(provisionBody()),
      },
    )
    expect(staleReactivation.status).toBe(409)
    expect((await json(staleReactivation)).error.code).toBe('STALE_GENERATION')

    const localHostname = `${firstBody.siteId}.localhost`
    await env.DB
      .prepare("UPDATE domains SET hostname = ? WHERE site_id = ? AND type = 'default'")
      .bind(localHostname, firstBody.siteId)
      .run()
    const recovery = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`)
    expect(recovery.status).toBe(200)
    const recoveryBody = await json(recovery)
    expect(recoveryBody.lifecycle).toEqual({ revision: 3, status: 'revoked' })
    expect(recoveryBody.publicUrl).toMatch(/^https:\/\//)
    expect(
      await env.DB
        .prepare("SELECT hostname FROM domains WHERE site_id = ? AND type = 'default'")
        .bind(firstBody.siteId)
        .first<{ hostname: string }>(),
    ).toMatchObject({ hostname: localHostname })

    const unknown = await request(
      '/internal/autoseopilot/sites/00000000-0000-4000-8000-000000000999',
    )
    expect(unknown.status).toBe(404)
    expect((await json(unknown)).error.code).toBe('NOT_FOUND')

    const revokedKey = await env.DB
      .prepare('SELECT revoked_at FROM api_keys WHERE id = ?')
      .bind(rotatedBody.apiKeyId)
      .first<{ revoked_at: number | null }>()
    expect(revokedKey?.revoked_at).not.toBeNull()
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM posts WHERE id = ?')
        .bind('managed-route-post-901')
        .first<{ count: number }>(),
    ).toMatchObject({ count: 1 })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM post_versions WHERE id = ?')
        .bind('managed-route-version-901')
        .first<{ count: number }>(),
    ).toMatchObject({ count: 1 })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM activity_events WHERE id = ?')
        .bind('managed-route-activity-901')
        .first<{ count: number }>(),
    ).toMatchObject({ count: 1 })
    const domainAfter = await env.DB
      .prepare("SELECT hostname FROM domains WHERE site_id = ? AND type = 'default'")
      .bind(firstBody.siteId)
      .first<{ hostname: string }>()
    expect(domainAfter?.hostname).toBe(localHostname)
  })

  it('rejects oversized bodies and bearer access after revoke', async () => {
    const oversized = await request(
      `/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'content-length': String(65 * 1024),
        },
        body: 'x'.repeat(65 * 1024),
      },
    )
    expect(oversized.status).toBe(413)
    expect((await json(oversized)).error.code).toBe('REQUEST_TOO_LARGE')

    const key = await env.DB
      .prepare('SELECT token_prefix, revoked_at FROM api_keys WHERE site_id = (SELECT site_id FROM autoseopilot_managed_sites WHERE external_workspace_id = ?)')
      .bind(EXTERNAL_WORKSPACE_ID)
      .first<{ token_prefix: string; revoked_at: number | null }>()
    expect(key?.revoked_at).not.toBeNull()

    const bearer = await app.fetch(
      new Request('https://app.basedui.dev/api/v1/site', {
        headers: { authorization: `Bearer ${ROTATED_TOKEN}` },
      }),
      env,
    )
    expect(bearer.status).toBe(401)
  })

  it('classifies concurrent first provision, slug conflicts, rotation, and reconcile safely', async () => {
    const raceExternalA = '00000000-0000-4000-8000-000000000911'
    const raceExternalC = '00000000-0000-4000-8000-000000000915'
    const raceExternalD = '00000000-0000-4000-8000-000000000916'
    const raceCredentialA = '00000000-0000-4000-8000-000000000913'
    const raceCredentialC = '00000000-0000-4000-8000-000000000917'
    const raceCredentialD = '00000000-0000-4000-8000-000000000918'
    const explicitSlug = 'managed-route-race-slug'
    const raceSlug = 'managed-route-concurrent-slug'
    const bodyA = provisionBody({
      ownerEmail: 'race-a@example.test',
      siteName: 'Race A',
      siteSlug: explicitSlug,
      credential: { rawToken: RACE_FIRST_TOKEN, credentialId: raceCredentialA, generation: 1 },
    })
    const bodyC = provisionBody({
      ownerEmail: 'race-c@example.test',
      siteName: 'Race C',
      siteSlug: raceSlug,
      credential: { rawToken: RACE_FIRST_TOKEN + 'x', credentialId: raceCredentialC, generation: 1 },
    })
    const bodyD = provisionBody({
      ownerEmail: 'race-d@example.test',
      siteName: 'Race D',
      siteSlug: raceSlug,
      credential: { rawToken: RACE_SECOND_TOKEN + 'y', credentialId: raceCredentialD, generation: 1 },
    })
    const [sameFirstA, sameFirstB] = await Promise.all([
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyA),
      }),
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyA),
      }),
    ])
    expect([sameFirstA.status, sameFirstB.status].sort()).toEqual([200, 201])

    const [slugA, slugB] = await Promise.all([
      request(`/internal/autoseopilot/sites/${raceExternalC}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyC),
      }),
      request(`/internal/autoseopilot/sites/${raceExternalD}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyD),
      }),
    ])
    expect([slugA.status, slugB.status].sort()).toEqual([201, 409])
    const loserResponse = slugA.status === 409 ? slugA : slugB
    expect((await json(loserResponse)).error.code).toBe('SLUG_CONFLICT')
    const loserExternal = slugA.status === 409 ? raceExternalC : raceExternalD
    const loserRows = await env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM workspaces WHERE id = ?) AS workspaces,
           (SELECT COUNT(*) FROM sites WHERE id = ?) AS sites,
           (SELECT COUNT(*) FROM api_keys WHERE id = ?) AS keys,
           (SELECT COUNT(*) FROM autoseopilot_managed_sites WHERE external_workspace_id = ?) AS bindings`,
      )
      .bind(
        `workspace_autoseopilot_${loserExternal}`,
        `site_autoseopilot_${loserExternal}`,
        `key_autoseopilot_${loserExternal}_1`,
        loserExternal,
      )
      .first<{ workspaces: number; sites: number; keys: number; bindings: number }>()
    expect(loserRows).toEqual({ workspaces: 0, sites: 0, keys: 0, bindings: 0 })

    const rotatedRaceToken = RECONCILE_TOKEN
    const [rotationA, rotationB] = await Promise.all([
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...bodyA,
          credential: { rawToken: rotatedRaceToken, credentialId: raceCredentialA, generation: 2 },
        }),
      }),
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...bodyA,
          credential: { rawToken: rotatedRaceToken, credentialId: raceCredentialA, generation: 2 },
        }),
      }),
    ])
    expect(rotationA.status).toBe(200)
    expect(rotationB.status).toBe(200)
    const afterRotation = await request(`/internal/autoseopilot/sites/${raceExternalA}`)
    expect((await json(afterRotation)).lifecycle.revision).toBe(2)

    const expiry = '2030-01-01T00:00:00Z'
    const [reconcileA, reconcileB] = await Promise.all([
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...bodyA,
          credential: { rawToken: rotatedRaceToken, credentialId: raceCredentialA, generation: 2 },
          entitlement: { status: 'active', expiresAt: expiry },
        }),
      }),
      request(`/internal/autoseopilot/sites/${raceExternalA}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...bodyA,
          credential: { rawToken: rotatedRaceToken, credentialId: raceCredentialA, generation: 2 },
          entitlement: { status: 'active', expiresAt: expiry },
        }),
      }),
    ])
    expect(reconcileA.status).toBe(200)
    expect(reconcileB.status).toBe(200)
    const afterReconcile = await request(`/internal/autoseopilot/sites/${raceExternalA}`)
    const afterReconcileBody = await json(afterReconcile)
    expect(afterReconcileBody.lifecycle.revision).toBe(3)
    expect(afterReconcileBody.entitlement.expiresAt).toBe('2030-01-01T00:00:00.000Z')
  })
})
