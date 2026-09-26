import type { Asset } from '@vc/core'
import { MEDIA } from '@vc/config'
import { DashboardApiError, dashboardMutationHeaders, dashboardMutationSignal, handleDashboardSiteChanged, loadMediaPage } from '~/lib/api-client'
import { parseMutationResultJson } from '~/lib/mutation-result'
import { altFromFileName } from './image-alt'

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
  const response = await fetch('/api/media/upload', { method: 'POST', body: form, headers: dashboardMutationHeaders(), credentials: 'include', signal: dashboardMutationSignal() })
  if (response.status === 409) {
    const body = await response.json() as { error?: { code?: string } }
    if (body.error?.code === 'site_changed') {
      const error = new DashboardApiError(409, 'site_changed', 'Selected site changed')
      handleDashboardSiteChanged(error)
      throw error
    }
    throw new Error('The image could not be uploaded.')
  }
  if (response.status === 401) {
    await onUnauthorized()
    throw new Error('Sign in to upload media.')
  }
  const body = await response.json()
  const result = parseMutationResultJson(body)
  if (result.kind !== 'ok') throw new Error(result.code === 'upload_too_large' ? `Images must be ${MEDIA.maxImageLabel} or smaller.` : 'The image could not be uploaded.')
  const uploaded = (body as { asset?: Asset & { url: string } }).asset
  if (!uploaded?.id) throw new Error('The upload did not return an image.')
  const loaded = await loadMediaPage()
  onAssets(loaded.assets)
  return loaded.assets.find((asset) => asset.id === uploaded.id) ?? uploaded
}
