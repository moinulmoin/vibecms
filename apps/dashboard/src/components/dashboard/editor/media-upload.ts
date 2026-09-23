import type { Asset } from '@vc/core'
import { MEDIA } from '@vc/config'
import { loadMediaPage } from '~/lib/api-client'
import { parseMutationResultJson } from '~/lib/mutation-result'
import { altFromFileName } from './image-alt'

// The upload endpoint does not return the new asset's id, so each upload is
// identified by diffing the library before/after. Uploads run one at a time so
// two concurrent drops can never pick up each other's image.
let queue: Promise<unknown> = Promise.resolve()

export function uploadEditorMedia(
  file: File,
  altText: string | undefined,
  currentAssets: Asset[] | (() => Asset[]),
  onAssets: (assets: Asset[]) => void,
  onUnauthorized: () => Promise<void>,
) {
  const run = queue.then(() => uploadOne(file, altText, typeof currentAssets === 'function' ? currentAssets() : currentAssets, onAssets, onUnauthorized))
  queue = run.catch(() => undefined)
  return run
}

async function uploadOne(
  file: File,
  altText: string | undefined,
  currentAssets: Asset[],
  onAssets: (assets: Asset[]) => void,
  onUnauthorized: () => Promise<void>,
) {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be added to a post.')
  const form = new FormData()
  form.append('file', file)
  const alt = (altText ?? altFromFileName(file.name)).trim()
  if (alt) form.append('altText', alt)
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
