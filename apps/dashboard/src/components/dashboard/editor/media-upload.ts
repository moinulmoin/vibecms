'use client'

import type { Asset } from '@vc/core'
import { MEDIA } from '@vc/config'
import { loadMediaPage } from '~/lib/api-client'
import { parseMutationResultJson } from '~/lib/mutation-result'

export async function uploadEditorMedia(
  file: File,
  altText: string,
  currentAssets: Asset[],
  onAssets: (assets: Asset[]) => void,
  onUnauthorized: () => Promise<void>,
) {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be added to a post.')
  const form = new FormData()
  form.append('file', file)
  form.append('altText', altText.trim() || file.name)
  const response = await fetch('/api/media/upload', { method: 'POST', body: form, credentials: 'include' })
  if (response.status === 401) {
    await onUnauthorized()
    throw new Error('Sign in to upload media.')
  }
  const result = parseMutationResultJson(await response.json())
  if (result.kind !== 'ok') throw new Error(result.code === 'upload_too_large' ? `Images must be ${MEDIA.maxImageLabel} or smaller.` : 'The image could not be uploaded.')
  const prior = new Set(currentAssets.map((asset) => asset.id))
  const loaded = await loadMediaPage()
  onAssets(loaded.assets)
  return loaded.assets.find((asset) => !prior.has(asset.id)) ?? loaded.assets[0]
}
