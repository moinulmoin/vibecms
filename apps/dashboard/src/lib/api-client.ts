import type {
  AddCustomDomainResult,
  ActivityPageLoad,
  ApiKeyMutationResult,
  AppRouterContext,
  BillingMutationResult,
  BillingPageLoadResult,
  CheckoutInterval,
  ConnectPageData,
  DashboardData,
  PostEditorPageLoad,
  PostsPageLoad,
  MutationResult,
  OnboardingConnectStatus,
  RemoveCustomDomainResult,
  SettingsPageData,
  VoiceProfileMutationResult,
  VoiceProfileSettingsInput,
} from '~/types/dashboard'
import type { Asset, Post, PostVersion, PostVersionSummary } from '@vc/core'
import type { z } from 'zod'
import {
  appRouterContextSchema,
  dashboardDataSchema,
  mutationResultSchema,
  onboardingConnectStatusSchema,
  settingsPageDataSchema,
} from '~/lib/dashboard-response-schemas'

export class DashboardApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'DashboardApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type ApiErrorEnvelope = { error: { code: string; message: string; details?: unknown } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseApiErrorBody(body: unknown): { code: string; message: string; details?: unknown } {
  if (isRecord(body) && isRecord(body.error)) {
    const err = body.error
    const code = typeof err.code === 'string' ? err.code : 'unknown'
    const message = typeof err.message === 'string' ? err.message : 'Request failed'
    return { code, message, details: err.details }
  }
  return { code: 'unknown', message: 'Request failed' }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new DashboardApiError(response.status, 'invalid_response', 'Expected JSON response')
  }
  try {
    return await response.json()
  } catch {
    throw new DashboardApiError(response.status, 'invalid_json', 'Response was not valid JSON')
  }
}

export async function dashboardFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    signal: init?.signal,
  })

  if (response.status === 401) {
    const body = await readJsonBody(response).catch(() => null)
    const parsed = body ? parseApiErrorBody(body) : { code: 'unauthorized', message: 'Unauthorized' }
    throw new DashboardApiError(401, parsed.code, parsed.message, parsed.details)
  }

  const body = await readJsonBody(response)

  if (!response.ok) {
    const parsed = parseApiErrorBody(body)
    throw new DashboardApiError(response.status, parsed.code, parsed.message, parsed.details)
  }

  if (schema) {
    return schema.parse(body)
  }
  return body as T
}

/** Unsafe POST mutations are never retried automatically. */
export async function dashboardPost<T>(
  path: string,
  payload?: unknown,
  signal?: AbortSignal,
  schema?: z.ZodType<T>,
): Promise<T> {
  return dashboardFetch<T>(
    path,
    {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal,
    },
    schema,
  )
}

export function loadAppRouterContext(signal?: AbortSignal) {
  return dashboardFetch('/api/dashboard/context', { method: 'GET', signal }, appRouterContextSchema)
}

export function loadDashboardOverview(signal?: AbortSignal) {
  return dashboardFetch('/api/dashboard/overview', { method: 'GET', signal }, dashboardDataSchema)
}

export function loadSetupPage(signal?: AbortSignal) {
  return dashboardFetch<{ name: string; slug: string; description: string }>('/api/dashboard/setup', {
    method: 'GET',
    signal,
  })
}

export function completeSetupMutation(data: { name: string; slug: string; description?: string }) {
  return dashboardPost('/api/dashboard/setup', data, undefined, mutationResultSchema)
}

export function loadSettingsPage(signal?: AbortSignal) {
  return dashboardFetch('/api/dashboard/settings', { method: 'GET', signal }, settingsPageDataSchema)
}

export function updateSiteSettingsMutation(data: {
  name: string
  description?: string
  defaultSeoTitle?: string
  defaultSeoDescription?: string
  theme?: string
  themeAccent?: string | null
  themeFont?: string | null
  themeMode?: string | null
}) {
  return dashboardPost('/api/dashboard/settings', data, undefined, mutationResultSchema)
}

export function updateVoiceProfileMutation(data: VoiceProfileSettingsInput) {
  return dashboardPost<VoiceProfileMutationResult>('/api/dashboard/voice-profile', data)
}

export function clearVoiceProfileMutation() {
  return dashboardPost<VoiceProfileMutationResult>('/api/dashboard/voice-profile/clear', {})
}

export function createApiKeyMutation(data: { name: string; actorName: string; preset: 'draft' | 'publish' | 'full' }) {
  return dashboardPost<ApiKeyMutationResult>('/api/dashboard/api-keys', data)
}

export function revokeApiKeyMutation(data: { keyId: string }) {
  return dashboardPost<MutationResult>('/api/dashboard/api-keys/revoke', data)
}

export function updateMediaAltMutation(data: { assetId: string; altText: string }) {
  return dashboardPost<MutationResult>('/api/dashboard/media/alt', data)
}

export function addCustomDomainMutation(data: { hostname: string }) {
  return dashboardPost<AddCustomDomainResult>('/api/dashboard/domains', data)
}

export function removeCustomDomainMutation(data: { domainId: string }) {
  return dashboardPost<RemoveCustomDomainResult>('/api/dashboard/domains/remove', data)
}

export function loadMediaPage(signal?: AbortSignal) {
  return dashboardFetch<{ assets: Asset[] }>('/api/dashboard/media', { method: 'GET', signal })
}

export function loadActivityPage(data: { offset?: number } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (data.offset !== undefined) params.set('offset', String(data.offset))
  const qs = params.toString()
  return dashboardFetch<ActivityPageLoad>(`/api/dashboard/activity${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    signal,
  })
}

export function loadConnectPage(signal?: AbortSignal) {
  return dashboardFetch<ConnectPageData>('/api/dashboard/connect', { method: 'GET', signal })
}

export function loadOnboardingStatus(options?: { keyId?: string | null; signal?: AbortSignal }) {
  const params = new URLSearchParams()
  if (options?.keyId) params.set('keyId', options.keyId)
  const query = params.toString()
  const path = query
    ? `/api/dashboard/onboarding-status?${query}`
    : '/api/dashboard/onboarding-status'
  return dashboardFetch<OnboardingConnectStatus>(
    path,
    { method: 'GET', signal: options?.signal },
    onboardingConnectStatusSchema,
  )
}

export function loadPostsPage(
  data: { status?: string; search?: string; offset?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  if (data.status) params.set('status', data.status)
  if (data.search) params.set('search', data.search)
  if (data.offset !== undefined) params.set('offset', String(data.offset))
  const qs = params.toString()
  return dashboardFetch<PostsPageLoad>(
    `/api/dashboard/posts${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal },
  )
}

export function loadPostEditorPage(data: { postId?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (data.postId) params.set('postId', data.postId)
  const qs = params.toString()
  return dashboardFetch<PostEditorPageLoad>(`/api/dashboard/posts/editor${qs ? `?${qs}` : ''}`, { method: 'GET', signal })
}

export function createPostMutation(data: {
  title: string
  slug: string
  excerpt?: string
  contentMarkdown: string
  coverAssetId?: string | null
  seoTitle?: string
  seoDescription?: string
  canonicalUrl?: string | null
  tags?: string
  presentation?: { layout: string; toc: boolean } | null
}) {
  return dashboardPost<MutationResult>('/api/dashboard/posts/create', data)
}

export function updatePostMutation(data: {
  postId: string
  title: string
  slug: string
  excerpt?: string
  contentMarkdown: string
  coverAssetId?: string | null
  seoTitle?: string
  seoDescription?: string
  canonicalUrl?: string | null
  tags?: string
  presentation?: { layout: string; toc: boolean } | null
}) {
  return dashboardPost<MutationResult>('/api/dashboard/posts/update', data)
}

export function publishPostMutation(data: { postId: string; expectedVersionNumber: number }) {
  return dashboardPost<MutationResult>('/api/dashboard/posts/publish', data)
}

export function archivePostMutation(data: { postId: string }) {
  return dashboardPost<MutationResult>('/api/dashboard/posts/archive', data)
}

export function listPostVersionsFn(data: { postId: string }, signal?: AbortSignal) {
  const params = new URLSearchParams({ postId: data.postId })
  return dashboardFetch<PostVersionSummary[]>(`/api/dashboard/posts/versions?${params}`, {
    method: 'GET',
    signal,
  })
}

export function getPostVersionFn(
  data: { postId: string; versionNumber: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    postId: data.postId,
    versionNumber: String(data.versionNumber),
  })
  return dashboardFetch<PostVersion | null>(`/api/dashboard/posts/version?${params}`, {
    method: 'GET',
    signal,
  })
}

export function restorePostVersionFn(data: { postId: string; versionNumber: number }) {
  return dashboardPost<MutationResult>('/api/dashboard/posts/versions/restore', data)
}

export function loadBillingPage(signal?: AbortSignal) {
  return dashboardFetch<BillingPageLoadResult>('/api/dashboard/billing', { method: 'GET', signal })
}

export function checkoutBillingMutation(data: { interval: CheckoutInterval }) {
  return dashboardPost<BillingMutationResult>('/api/dashboard/billing/checkout', data)
}

export function portalBillingMutation() {
  return dashboardPost<BillingMutationResult>('/api/dashboard/billing/portal', {})
}

export async function ensureOnboarding() {
  return dashboardPost<unknown>('/api/onboarding/ensure', {})
}