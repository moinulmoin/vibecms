import { createPendingMediaRepository, type PendingMediaOperation } from '@vc/db'
import { env } from 'cloudflare:workers'

/** Ops older than this are eligible for reconciler claim. */
export const MEDIA_OP_STALE_SECONDS = 15 * 60
/** Claims older than this may be stolen by another reconciler run (crashed worker). */
export const MEDIA_OP_CLAIM_TIMEOUT_SECONDS = 10 * 60
/** Max ops processed per scheduled invocation. */
export const MEDIA_RECONCILE_LIMIT = 50

type ReconcileEnv = Pick<Cloudflare.Env, 'DB' | 'ASSETS_BUCKET'>

type Bucket = Pick<R2Bucket, 'delete'>

export type MediaReconcileResult = {
  scanned: number
  claimed: number
  cleaned: number
  failed: number
  skipped: number
}

async function processOp(
  op: PendingMediaOperation,
  claimedAt: number,
  workerEnv: ReconcileEnv,
  bucket: Bucket,
): Promise<'cleaned' | 'failed' | 'skipped'> {
  const pending = createPendingMediaRepository(workerEnv.DB)
  try {
    await bucket.delete(op.storageKey)
    if (op.kind === 'upload_cleanup') {
      const applied = await pending.finishUploadCleanup({
        opId: op.id,
        siteId: op.siteId,
        sizeBytes: op.sizeBytes,
        claimedAt,
      })
      return applied ? 'cleaned' : 'skipped'
    }
    const applied = await pending.finishDeleteOp({ opId: op.id, claimedAt })
    return applied ? 'cleaned' : 'skipped'
  } catch (error) {
    await pending.failClaim({
      opId: op.id,
      claimedAt,
      error: String(error),
    })
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'media_reconcile_op_failed',
        opId: op.id,
        kind: op.kind,
        error: String(error),
      }),
    )
    return 'failed'
  }
}

export async function reconcileMediaOperations(
  workerEnv: ReconcileEnv = env,
  options?: { now?: number; limit?: number; bucket?: Bucket },
): Promise<MediaReconcileResult> {
  const now = options?.now ?? Math.floor(Date.now() / 1000)
  const limit = options?.limit ?? MEDIA_RECONCILE_LIMIT
  const bucket = options?.bucket ?? workerEnv.ASSETS_BUCKET
  const pending = createPendingMediaRepository(workerEnv.DB)
  const staleBefore = now - MEDIA_OP_STALE_SECONDS
  const claimExpiredBefore = now - MEDIA_OP_CLAIM_TIMEOUT_SECONDS

  const candidates = await pending.listClaimableOps({
    now,
    staleBefore,
    claimExpiredBefore,
    limit,
  })

  const result: MediaReconcileResult = {
    scanned: candidates.length,
    claimed: 0,
    cleaned: 0,
    failed: 0,
    skipped: 0,
  }

  for (const candidate of candidates) {
    const claimed = await pending.claimOp({
      opId: candidate.id,
      now,
      claimExpiredBefore,
    })
    if (!claimed || claimed.claimedAt == null) {
      result.skipped += 1
      continue
    }
    result.claimed += 1
    const outcome = await processOp(claimed, claimed.claimedAt, workerEnv, bucket)
    if (outcome === 'cleaned') result.cleaned += 1
    else if (outcome === 'failed') result.failed += 1
    else result.skipped += 1
  }

  return result
}
