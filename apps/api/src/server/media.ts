import { MEDIA } from '@vc/config'
import {
  ConflictError,
  listAssets,
  NotFoundError,
  requireScope,
  updateAssetAltText,
  type Asset,
} from '@vc/core'
import {
  createDataAccess,
  createD1AssetRepository,
  createPendingMediaRepository,
  MediaQuotaExceededError,
} from '@vc/db'
import { allowedImageMimeTypes, createAssetInput } from '@vc/validators'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from './onboarding'
import { readImageDimensions, validateDeclaredImageMime } from '@/server/media-bytes'
import { assertMediaUploadAllowed, MediaQuotaError } from '@/server/media-quota'

type UploadErrorCode =
  | 'upload_missing_file'
  | 'upload_type'
  | 'upload_too_large'
  | 'media_quota_paid'
  | 'billing_required'
  | 'unknown'

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code)
  }
}

function assetRepository() {
  return createD1AssetRepository(env.DB)
}

function pendingMedia() {
  return createPendingMediaRepository(env.DB)
}

function isAllowedMimeType(type: string): type is (typeof allowedImageMimeTypes)[number] {
  return allowedImageMimeTypes.includes(type as (typeof allowedImageMimeTypes)[number])
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 180) || 'upload'
}

export async function getMedia(app: AppUserContext) {
  return listAssets(assetRepository(), app.actor, app.siteId)
}

export async function uploadAsset(app: AppUserContext, file: File, altText?: string) {
  if (!isAllowedMimeType(file.type)) throw new UploadError('upload_type')
  if (file.size <= 0 || file.size > MEDIA.maxImageBytes) throw new UploadError('upload_too_large')

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!validateDeclaredImageMime(file.type, bytes)) throw new UploadError('upload_type')
  const imageDimensions = readImageDimensions(file.type, bytes)
  if (!imageDimensions) throw new UploadError('upload_type')

  requireScope(app.actor, 'assets:write')

  const filename = safeFilename(file.name)
  const assetId = crypto.randomUUID()
  const opId = crypto.randomUUID()
  const r2Key = `${app.siteId}/${opId}-${filename}`
  const pending = pendingMedia()

  let parsed
  try {
    parsed = createAssetInput.parse({
      siteId: app.siteId,
      r2Key,
      filename,
      mimeType: file.type,
      sizeBytes: file.size,
      width: imageDimensions.width,
      height: imageDimensions.height,
      altText,
    })
  } catch {
    throw new UploadError('unknown')
  }

  const draft = {
    id: assetId,
    siteId: parsed.siteId,
    r2Key: parsed.r2Key,
    filename: parsed.filename,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
    width: parsed.width ?? null,
    height: parsed.height ?? null,
    altText: parsed.altText ?? null,
  }

  try {
    const quota = await assertMediaUploadAllowed(app.siteId)
    await pending.reserveUpload({
      opId,
      siteId: app.siteId,
      storageKey: r2Key,
      sizeBytes: file.size,
      skipQuota: quota.skipQuota,
      limit: quota.limit,
    })
  } catch (error) {
    if (error instanceof MediaQuotaError) throw new UploadError(error.code)
    if (error instanceof MediaQuotaExceededError) throw new UploadError('media_quota_paid')
    throw new UploadError('unknown')
  }

  try {
    await env.ASSETS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: file.type },
    })
  } catch (error) {
    console.error('[media] r2_put_failed', { siteId: app.siteId, r2Key, error: String(error) })
    // Leave upload_cleanup op for reconciler (durable release). Do not touch pending bytes here.
    throw new UploadError('unknown')
  }

  try {
    return await pending.finalizeUpload({
      opId,
      asset: draft,
      actor: app.actor,
      activity: {
        siteId: app.siteId,
        actor: app.actor,
        action: 'asset.uploaded',
        entityType: 'asset',
        entityId: draft.id,
        summary: `Uploaded ${draft.filename}`,
        after: draft,
      },
    })
  } catch (error) {
    console.error('[media] finalize_failed', { siteId: app.siteId, r2Key, error: String(error) })
    // Op + reservation remain; reconciler deletes R2 and releases quota once.
    throw new UploadError('unknown')
  }
}

export async function uploadAssetForApp(
  app: AppUserContext,
  file: File,
  altText?: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    await uploadAsset(app, file, altText)
    return { kind: 'ok', code: 'media_uploaded' }
  } catch (error) {
    if (error instanceof UploadError) return { kind: 'error', code: error.code }
    return { kind: 'error', code: 'unknown' }
  }
}

export async function updateAssetAltForApp(
  app: AppUserContext,
  assetId: string,
  altText: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    await updateAssetAltText(assetRepository(), app.actor, app.siteId, assetId, altText)
    return { kind: 'ok', code: 'media_updated' }
  } catch (error) {
    if (error instanceof ConflictError) return { kind: 'error', code: 'alt_required_in_use' }
    if (error instanceof NotFoundError) return { kind: 'error', code: 'not_found' }
    return { kind: 'error', code: 'unknown' }
  }
}

/**
 * Delete DB row + activity + pending delete op atomically, then best-effort R2 delete.
 * R2 failure leaves the delete op for the reconciler. Response stays stable either way.
 */
export async function deleteAssetTracked(app: AppUserContext, assetId: string): Promise<Asset> {
  requireScope(app.actor, 'assets:write')
  const repo = assetRepository()
  const asset = await repo.getAsset(app.siteId, assetId)
  if (!asset) throw new NotFoundError('Asset not found')
  if (
    (await repo.isAssetReferencedAsCover(app.siteId, assetId)) ||
    (await repo.isAssetReferencedAsSiteSocialImage(app.siteId, assetId))
  ) {
    throw new ConflictError('Asset is in use')
  }

  const opId = crypto.randomUUID()
  await pendingMedia().deleteAssetWithPendingOp({
    opId,
    siteId: app.siteId,
    assetId,
    storageKey: asset.r2Key,
    sizeBytes: asset.sizeBytes,
    activity: {
      siteId: app.siteId,
      actor: app.actor,
      action: 'asset.deleted',
      entityType: 'asset',
      entityId: assetId,
      summary: `Deleted ${asset.filename}`,
      before: asset,
    },
  })

  try {
    await env.ASSETS_BUCKET.delete(asset.r2Key)
  } catch (error) {
    console.error('[media] r2_delete_failed', { siteId: app.siteId, r2Key: asset.r2Key, error: String(error) })
    // Leave delete op for reconciler retry.
    return asset
  }
  try {
    await pendingMedia().removeOp(opId)
  } catch (error) {
    console.error('[media] delete_op_remove_failed', { siteId: app.siteId, opId, error: String(error) })
    // Op remains; reconciler retries idempotent R2 delete then removes it.
  }

  return asset
}

export async function deleteAssetForApp(
  app: AppUserContext,
  assetId: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    await deleteAssetTracked(app, assetId)
    return { kind: 'ok', code: 'media_deleted' }
  } catch (error) {
    if (error instanceof ConflictError) return { kind: 'error', code: 'asset_in_use' }
    if (error instanceof NotFoundError) return { kind: 'error', code: 'not_found' }
    return { kind: 'error', code: 'unknown' }
  }
}

export async function serveAsset(assetId: string) {
  const row = await createDataAccess(env.DB).assets.getAssetForServe(assetId)
  if (!row) return new Response('Not found', { status: 404 })
  const object = await env.ASSETS_BUCKET.get(row.r2Key)
  if (!object) return new Response('Not found', { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': row.mimeType,
      'content-length': String(row.sizeBytes),
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
