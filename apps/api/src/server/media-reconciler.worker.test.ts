/**
 * Media reconciler: crash recovery, CAS exclusivity, single quota release.
 * Uses real miniflare D1 + an injected R2 delete stub (no bucket binding required).
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, describe, expect, inject, it } from 'vitest'
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { createPendingMediaRepository } from '@vc/db'
import {
  MEDIA_OP_CLAIM_TIMEOUT_SECONDS,
  MEDIA_OP_STALE_SECONDS,
  reconcileMediaOperations,
} from '@/server/media-reconciler'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const WS = 'mrec-ws'
const SITE = 'mrec-site'

beforeAll(async () => {
  const migrations = inject('migrations') as D1Migration[]
  await applyD1Migrations(env.DB, migrations)
  const ts = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(WS, 'MRec Workspace', WS, ts, ts)
    .run()
  await env.DB.prepare(
    'INSERT INTO sites (id, workspace_id, name, slug, media_pending_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
  )
    .bind(SITE, WS, SITE, SITE, ts, ts)
    .run()
})

function pending() {
  return createPendingMediaRepository(env.DB)
}

function mockBucket(deleted: string[]) {
  return {
    async delete(key: string) {
      deleted.push(key)
    },
  }
}

describe('reconcileMediaOperations', () => {
  it('cleans a stale upload_cleanup op: deletes R2, releases pending bytes once, removes op', async () => {
    const opId = 'mrec-upload-1'
    const key = `${SITE}/${opId}.png`
    const now = 2_000_000_000
    const createdAt = now - MEDIA_OP_STALE_SECONDS - 1
    await env.DB.prepare('UPDATE sites SET media_pending_bytes = 123 WHERE id = ?').bind(SITE).run()
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 123, ?, ?, NULL, 0, NULL)`,
    )
      .bind(opId, SITE, key, createdAt, createdAt)
      .run()

    const deleted: string[] = []
    const result = await reconcileMediaOperations(env, { now, bucket: mockBucket(deleted) })
    expect(result.cleaned).toBeGreaterThanOrEqual(1)
    expect(deleted).toContain(key)
    expect(await pending().getOp(opId)).toBeNull()
    expect(await pending().getMediaPendingBytes(SITE)).toBe(0)
  })

  it('retries a delete op by removing R2 and the pending row', async () => {
    const opId = 'mrec-delete-1'
    const key = `${SITE}/${opId}.png`
    const now = 2_000_100_000
    const createdAt = now - MEDIA_OP_STALE_SECONDS - 1
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'delete', ?, ?, 1, ?, ?, NULL, 0, NULL)`,
    )
      .bind(opId, SITE, key, createdAt, createdAt)
      .run()

    const deleted: string[] = []
    await reconcileMediaOperations(env, { now, bucket: mockBucket(deleted) })
    expect(deleted).toContain(key)
    expect(await pending().getOp(opId)).toBeNull()
  })

  it('concurrent reconciler runs cannot double-release upload quota', async () => {
    const opId = 'mrec-race-1'
    const key = `${SITE}/${opId}.png`
    const now = 2_000_200_000
    const createdAt = now - MEDIA_OP_STALE_SECONDS - 1
    await env.DB.prepare('UPDATE sites SET media_pending_bytes = 50 WHERE id = ?').bind(SITE).run()
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 50, ?, ?, NULL, 0, NULL)`,
    )
      .bind(opId, SITE, key, createdAt, createdAt)
      .run()

    const deleted: string[] = []
    const bucket = mockBucket(deleted)
    const [a, b] = await Promise.all([
      reconcileMediaOperations(env, { now, bucket }),
      reconcileMediaOperations(env, { now, bucket }),
    ])
    const cleaned = a.cleaned + b.cleaned
    expect(cleaned).toBe(1)
    expect(await pending().getMediaPendingBytes(SITE)).toBe(0)
    expect(await pending().getOp(opId)).toBeNull()
  })

  it('leaves fresh ops untouched until stale', async () => {
    const opId = 'mrec-fresh-1'
    const now = 2_000_300_000
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 9, ?, ?, NULL, 0, NULL)`,
    )
      .bind(opId, SITE, `${SITE}/fresh.png`, now - 30, now - 30)
      .run()
    await env.DB.prepare('UPDATE sites SET media_pending_bytes = media_pending_bytes + 9 WHERE id = ?')
      .bind(SITE)
      .run()
    const before = await pending().getMediaPendingBytes(SITE)
    const deleted: string[] = []
    const result = await reconcileMediaOperations(env, { now, bucket: mockBucket(deleted) })
    expect(deleted).not.toContain(`${SITE}/fresh.png`)
    expect(await pending().getOp(opId)).toBeTruthy()
    expect(await pending().getMediaPendingBytes(SITE)).toBe(before)
    expect(result.scanned === 0 || !deleted.includes(`${SITE}/fresh.png`)).toBe(true)
  })

  it('reclaims ops whose claim timed out after a crashed reconciler', async () => {
    const opId = 'mrec-stale-claim'
    const key = `${SITE}/${opId}.png`
    const now = 2_000_400_000
    const createdAt = now - MEDIA_OP_STALE_SECONDS - 1
    const staleClaim = now - MEDIA_OP_CLAIM_TIMEOUT_SECONDS - 1
    await env.DB.prepare('UPDATE sites SET media_pending_bytes = 11 WHERE id = ?').bind(SITE).run()
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 11, ?, ?, ?, 1, 'crashed')`,
    )
      .bind(opId, SITE, key, createdAt, staleClaim, staleClaim)
      .run()

    const deleted: string[] = []
    await reconcileMediaOperations(env, { now, bucket: mockBucket(deleted) })
    expect(deleted).toContain(key)
    expect(await pending().getOp(opId)).toBeNull()
    expect(await pending().getMediaPendingBytes(SITE)).toBe(0)
  })
})
