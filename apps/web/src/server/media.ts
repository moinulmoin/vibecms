import { MEDIA } from '@vc/config'
import { ConflictError, createAsset, deleteAsset, listAssets, NotFoundError, updateAssetAltText } from '@vc/core'
import { createDataAccess, createD1AssetRepository } from '@vc/db'
import { allowedImageMimeTypes } from '@vc/validators'
import { env } from 'cloudflare:workers'
import { getBillingStatusForSite, isSelfHosted } from './billing'
import type { AppUserContext } from './onboarding'

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

function repository() {
  return createD1AssetRepository(env.DB)
}

function redirect(to: string) {
  return new Response(null, { status: 303, headers: { Location: to } })
}

function redirectWithStatus(kind: 'ok' | 'error', code: string) {
  return redirect(`/dashboard/media?${kind}=${code}`)
}

function isAllowedMimeType(type: string): type is (typeof allowedImageMimeTypes)[number] {
  return allowedImageMimeTypes.includes(type as (typeof allowedImageMimeTypes)[number])
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 180) || 'upload'
}

export async function getMedia(app: AppUserContext) {
  return listAssets(repository(), app.actor, app.siteId)
}

export async function uploadAsset(app: AppUserContext, file: File, altText?: string) {
  if (!isAllowedMimeType(file.type)) throw new UploadError('upload_type')
  if (file.size <= 0 || file.size > MEDIA.maxImageBytes) throw new UploadError('upload_too_large')
  if (!isSelfHosted()) {
    const billingStatus = await getBillingStatusForSite(app.siteId)
    if (billingStatus !== 'active') throw new UploadError('billing_required')
    const total = await createDataAccess(env.DB).assets.getMediaUsageBytes(app.siteId)
    if (total + file.size > MEDIA.paidStorageBytes) throw new UploadError('media_quota_paid')
  }
  const filename = safeFilename(file.name)
  const r2Key = `${app.siteId}/${crypto.randomUUID()}-${filename}`
  await env.ASSETS_BUCKET.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })
  return createAsset(repository(), app.actor, {
    siteId: app.siteId,
    r2Key,
    filename,
    mimeType: file.type,
    sizeBytes: file.size,
    altText,
  })
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

export async function uploadAssetFromRequest(app: AppUserContext, request: Request) {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return redirectWithStatus('error', 'upload_missing_file')
  try {
    await uploadAsset(
      app,
      file,
      typeof form.get('altText') === 'string' ? String(form.get('altText')) : undefined,
    )
  } catch (error) {
    return redirectWithStatus('error', error instanceof UploadError ? error.code : 'unknown')
  }
  return redirectWithStatus('ok', 'media_uploaded')
}

export async function updateAssetAltForApp(
  app: AppUserContext,
  assetId: string,
  altText: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    await updateAssetAltText(repository(), app.actor, app.siteId, assetId, altText)
    return { kind: 'ok', code: 'media_updated' }
  } catch (error) {
    if (error instanceof NotFoundError) return { kind: 'error', code: 'not_found' }
    return { kind: 'error', code: 'unknown' }
  }
}

export async function deleteAssetForApp(
  app: AppUserContext,
  assetId: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    const asset = await deleteAsset(repository(), app.actor, app.siteId, assetId)
    try {
      await env.ASSETS_BUCKET.delete(asset.r2Key)
    } catch (e) {
      console.error('[media] R2 delete failed (best-effort):', e)
    }
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
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}