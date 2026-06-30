import { MEDIA } from '@vc/config'
import { ConflictError, createAsset, deleteAsset, listAssets, NotFoundError, updateAssetAltText } from '@vc/core'
import { createD1AssetRepository } from '@vc/db'
import { allowedImageMimeTypes } from '@vc/validators'
import { env } from 'cloudflare:workers'
import { getBillingStatusForSite, isSelfHosted } from './billing'
import type { AppUserContext } from './onboarding'

type AssetRow = {
  id: string
  site_id: string
  r2_key: string
  filename: string
  mime_type: string
  size_bytes: number
  alt_text: string | null
}
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
    const usage = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM assets WHERE site_id = ?',
    )
      .bind(app.siteId)
      .first<{ total: number }>()
    if ((usage?.total ?? 0) + file.size > MEDIA.paidStorageBytes) throw new UploadError('media_quota_paid')
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
  const row = await env.DB.prepare(
    'SELECT id, site_id, r2_key, filename, mime_type, size_bytes, alt_text FROM assets WHERE id = ? LIMIT 1',
  )
    .bind(assetId)
    .first<AssetRow>()
  if (!row) return new Response('Not found', { status: 404 })
  const object = await env.ASSETS_BUCKET.get(row.r2_key)
  if (!object) return new Response('Not found', { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': row.mime_type,
      'content-length': String(row.size_bytes),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}