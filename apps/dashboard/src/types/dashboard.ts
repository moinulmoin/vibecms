import type { Asset, BillingStatus, DomainRecord, Post } from '@vc/core'
import type { VoiceProfileSettingsInput } from '@vc/validators'

export type SessionUser = { id: string; name: string; email: string }

export type AppUserContext = {
  user: SessionUser
  siteId: string
  workspaceId: string
  actor: { type: 'human'; id: string; name: string; role: 'owner' | 'editor' }
}

export type AppRouterContext = {
  googleEnabled: boolean
  user: SessionUser | null
  app: AppUserContext | null
  siteSetupComplete: boolean
  siteDisplayName: string | null
}

export type ApiUsageStatus = {
  metric: string
  period: string
  used: number
  limit: number
  remaining: number
  resetsAt: number
}

export type ApiUsageSummary = {
  enforced: boolean
  calls: { minute: ApiUsageStatus; day: ApiUsageStatus; month: ApiUsageStatus }
  writes: { day: ApiUsageStatus; month: ApiUsageStatus }
}

export type DashboardData = {
  site: { name: string; slug: string } | null
  publicUrl: string | null
  publicUrlLocal: boolean
  billing: { status: BillingStatus }
  apiUsage: ApiUsageSummary
  counts: { published: number; draft: number; archived: number }
  media: { bytes: number; count: number }
  tokenCount: number
  versionCount: number
  recentPosts: Array<{
    id: string
    title: string
    slug: string
    status: Post['status']
    updatedAt: number
    publishedAt: number | null
  }>
  recentActivity: Array<{ action: string; summary: string; actor_name: string; created_at: number }>
}

export type BillingSnapshot = {
  status: BillingStatus
  currentPeriodEnd: number | null
  polarCustomerId?: string | null
}

export type BillingPageLoadResult =
  | { selfHosted: true; isOwner: boolean; billing: { status: BillingStatus; currentPeriodEnd: null } }
  | { selfHosted: false; isOwner: boolean; billing: BillingSnapshot }

export type CheckoutInterval = 'monthly' | 'yearly'

export type ApiKeyListItem = {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export type ConnectPageData = {
  canManage: boolean
  mcpUrl: string
  apiKeys: ApiKeyListItem[]
}

export type OnboardingConnectStatus = {
  canManage: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  onboardingKey: null | {
    id: string
    name: string
    createdAt: number
    lastUsedAt: number | null
    revokedAt: number | null
  }
  connection: 'no_token' | 'waiting' | 'connected' | 'revoked'
  publish: null | {
    state: 'none' | 'live' | 'already_live'
    post?: { id: string; title: string; slug: string; publishedAt: number | null; url: string }
    actor: 'onboarding_agent' | 'human' | 'other_agent' | 'unknown'
  }
}

export type CustomDomainView = {
  id: string
  hostname: string
  status: DomainRecord['status']
  verificationErrors: string[]
  createdAt: number
}

export type CustomDomainsPanel = {
  domains: CustomDomainView[]
  cnameTarget: string | null
}

export type VoiceProfileSettings = {
  configured: boolean
  audience: string
  voiceSummary: string
  preferRules: string[]
  avoidRules: string[]
  representativePostIds: string[]
  warnings: string[]
  updatedByName: string | null
  updatedAt: number | null
  publishedPosts: Array<{ id: string; title: string; slug: string; updatedAt: number }>
}

export type SiteSettingsForm = {
  name: string
  description: string
  defaultSeoTitle: string
  defaultSeoDescription: string
  theme: string
  slug: string
  themeAccent: string
  themeFont: string
  themeMode: string
}

export type SettingsPageData = {
  site: SiteSettingsForm
  customDomains: CustomDomainsPanel
  billingStatus: string
  selfHosted: boolean
  isOwner: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  voiceProfile: VoiceProfileSettings
}

export type ActivityEvent = {
  action: string
  summary: string
  actor_type: string
  actor_name: string
  created_at: number
}

export type ActivityPageLoad = {
  events: ActivityEvent[]
  hasMore: boolean
}

export type PostEditorPageLoad = {
  mode: 'new' | 'edit'
  post: Post | null
  assets: Asset[]
  missing: boolean
  presetId: string
  currentVersionNumber: number | null
}

export type PostsPageLoad = {
  posts: DashboardPostSummary[]
  hasMore: boolean
}

export type MutationResult = { kind: 'ok' | 'error'; code: string; postId?: string; versionNumber?: number }

export type DashboardPostSummary = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverAssetId: string | null
  status: Post['status']
  publishedAt: number | null
  tags: string[]
  createdAt: number
  updatedAt: number
  versionNumber: number | null
}

export type ApiKeyMutationResult =
  | { kind: 'ok'; code: string; token: string; name: string; id: string; createdAt: number }
  | { kind: 'error'; code: string }

export type BillingMutationResult = { kind: 'ok'; url: string } | { kind: 'error'; code: string }

export type VoiceProfileMutationResult =
  | { kind: 'ok'; code: 'voice_profile_saved' | 'voice_profile_cleared' }
  | { kind: 'error'; code: 'voice_profile_invalid' }

export type AddCustomDomainResult = { ok: true; domain: CustomDomainView } | { ok: false; code: string }
export type RemoveCustomDomainResult = { ok: true } | { ok: false; code: string }

export type { VoiceProfileSettingsInput }