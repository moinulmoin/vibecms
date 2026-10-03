import { env } from 'cloudflare:workers'
import { getPreviewTokenRecord, hashPreviewToken, putPreviewTokenRecord } from '@vc/db'
import { NotFoundError } from '@vc/core'
import { getSitePublicBaseUrl } from './site-public-url'
import { createDataAccess } from '@vc/db'

async function deriveToken(siteId: string, postId: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${siteId}:${postId}:${nonce}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function previewUrlForPost(siteId: string, postId: string, rotate = false): Promise<string | null> {
  const data = createDataAccess(env.DB)
  const siteSlug = await data.sites.getSiteSlug(siteId)
  let record = await getPreviewTokenRecord(env.DB, siteId, postId)
  if (!record || rotate) {
    const nonce = crypto.randomUUID()
    const token = await deriveToken(siteId, postId, nonce)
    const saved = await putPreviewTokenRecord(env.DB, siteId, postId, nonce, await hashPreviewToken(token), Boolean(rotate && record))
    if (rotate && !saved) throw new NotFoundError('Post not found')
    record = saved ? { nonce, tokenHash: await hashPreviewToken(token) } : await getPreviewTokenRecord(env.DB, siteId, postId)
  }
  if (!record) throw new NotFoundError('Post not found')
  const base = siteSlug ? await getSitePublicBaseUrl(siteId, siteSlug) : null
  if (!base) return null
  return `${base}/preview/${await deriveToken(siteId, postId, record.nonce)}`
}
