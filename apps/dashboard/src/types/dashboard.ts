import type { Asset, BillingStatus, DomainRecord, Post, PostVersionSummary } from '@vc/core'
import type { VoiceProfileSettingsInput } from '@vc/validators'

export type SessionUser = { id: string; name: string; email: string }

export type AppChoice = {
  workspaceId: string
  workspaceName: string
  siteId: string
  siteName: string
  siteSlug: string
  role: 'owner' | 'editor' | 'viewer'
  managed: {
    status: 'active' | 'revoked'
    expiresAt: number | null
    effective: boolean
  } | null
}

export type AppUserContext = {
  user: SessionUser
  siteId: string
  workspaceId: string
  actor: { type: 'human'; id: string; name: string; role: 'owner' | 'editor' | 'viewer' }
}

export type AppRouterContext = {
  googleEnabled: boolean
  githubEnabled: boolean
  user: SessionUser | null
  app: AppUserContext | null
  apps: AppChoice[]
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
  billingStatus?: BillingStatus
  polarStatus?: BillingStatus
  effective?: boolean
  access?: 'self_hosted' | 'hosted_paid' | 'hosted_free'
  source?: 'self_hosted' | 'polar' | 'managed_sponsorship' | 'none'
  calls: { minute: ApiUsageStatus; day: ApiUsageStatus; month: ApiUsageStatus }
  writes: { day: ApiUsageStatus; month: ApiUsageStatus }
}

export type DashboardData = {
  site: { name: string; slug: string } | null
  publicUrl: string | null
  publicUrlLocal: boolean
  billing: {
    status: BillingStatus
    polarStatus?: BillingStatus
    effective?: boolean
    access?: 'self_hosted' | 'hosted_paid' | 'hosted_free'
    source?: 'self_hosted' | 'polar' | 'managed_sponsorship' | 'none'
    managed?: {
      status: 'active' | 'revoked'
      expiresAt: number | null
      effective: boolean
    } | null
  }
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
  /** Drafts awaiting a human review decision (updatedAt desc, limit 5). */
  recentDrafts: Array<{
    id: string
    title: string
    slug: string
    status: Post['status']
    updatedAt: number
    publishedAt: number | null
  }>
  recentActivity: Array<{ action: string; summary: string; actor_name: string; created_at: number }>
  activationPost: null | {
    id: string
    title: string
    slug: string
    publishedAt: number
    url: string | null
    actorName: string
  }
}

export type AnalyticsRange = 7 | 30 | 90 | 365 | 'all'

export type AnalyticsPageData =
  | { status: 'locked'; retentionDays: number }
  | { status: 'unavailable'; retentionDays: number; reason: 'self_hosted' | 'not_configured' | 'query_failed' }
  | {
      status: 'available'
      rangeDays: AnalyticsRange
      retentionDays: number
      views: number
      previousViews: number | null
      trendPercent: number | null
      seriesGranularity: 'day' | 'month'
      aiReferralViews: number
      series: Array<{ date: string; views: number; aiCrawlerRequests: number }>
      topPosts: Array<{ postId: string; slug: string; title: string; views: number }>
      referrers: Array<{ domain: string; views: number; ai: boolean; operator: string | null }>
      aiCrawlers: {
        status: 'available' | 'unavailable'
        lookbackDays: number
        requests: number
        agents: Array<{ agent: string; operator: string; category: string; requests: number }>
      }
    }

export type BillingSnapshot = {
  status: BillingStatus
  currentPeriodEnd: number | null
  polarCustomerId?: string | null
}

export type BillingPageLoadResult =
  | { selfHosted: true; isOwner: boolean; billing: { status: BillingStatus; currentPeriodEnd: null } }
  | {
      selfHosted: false
      isOwner: boolean
      billing: BillingSnapshot
      managed: {
        status: 'active' | 'revoked'
        expiresAt: number | null
        effective: boolean
      } | null
    }

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

export type AgentPreference = 'claude_code' | 'codex' | 'cursor' | 'droid' | 'other'

export type SitePersonalization = {
  agentPreference: AgentPreference | null
  voiceSeed: string[]
  onboardingNote: string | null
}

export type ConnectPageData = {
  canManage: boolean
  mcpUrl: string
  apiKeys: ApiKeyListItem[]
  effectiveEntitlement: {
    effective: boolean
    source: 'self_hosted' | 'polar' | 'managed_sponsorship' | 'none'
  }
  managed: {
    status: 'active' | 'revoked'
    expiresAt: number | null
    effective: boolean
  } | null
  personalization: {
    agentPreference: AgentPreference | null
    voiceSeedPending: boolean
  }
}

export type ActivationKeyInfo = {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export type ActivationFirstPost =
  | { state: 'waiting' }
  | {
      state: 'draft'
      post: { id: string; title: string; slug: string; updatedAt: number; versionNumber: number }
    }
  | {
      state: 'live'
      post: { id: string; title: string; slug: string; publishedAt: number; url: string | null }
      actorName: string
    }

export type OnboardingConnectStatus = {
  canManage: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  key: ActivationKeyInfo | null
  connection: 'no_token' | 'waiting' | 'connected' | 'revoked'
  firstPost: ActivationFirstPost
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
  defaultSocialAssetId: string | null
  theme: string
  slug: string
  themeAccent: string
  themeFont: string
  themeMode: string
}

export type SettingsPageData = {
  site: SiteSettingsForm
  assets: Asset[]
  customDomains: CustomDomainsPanel
  billingStatus: string
  polarBillingStatus?: BillingStatus
  effectiveEntitlement?: {
    effective: boolean
    access: 'self_hosted' | 'hosted_paid' | 'hosted_free'
    source: 'self_hosted' | 'polar' | 'managed_sponsorship' | 'none'
    effectiveUntil: number | null
  }
  managed?: {
    status: 'active' | 'revoked'
    expiresAt: number | null
    effective: boolean
  } | null
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

export type EditorSiteInfo = {
  name: string
  description: string | null
  slug: string
  themeAccent: string | null
  themeFont: string | null
  themeMode: string
}

export type PostEditorPageLoad = {
  mode: 'new' | 'edit'
  post: Post | null
  assets: Asset[]
  missing: boolean
  presetId: string
  site: EditorSiteInfo | null
  /** Public origin of the blog (null when no active hostname), for open-live links. */
  publicBaseUrl: string | null
  currentVersionNumber: number | null
  /** Latest saved version (newest first), for the review strip's actor/time line. */
  latestVersion: PostVersionSummary | null
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
  /** Last-change actor: type (human/agent/api_key/system) + resolved name
   * (user.name or api key name; null when neither matches). */
  updatedByType: string | null
  updatedByName: string | null
}

export type ApiKeyMutationResult =
  | { kind: 'ok'; code: string; token: string; name: string; id: string; createdAt: number }
  | { kind: 'error'; code: string }

export type BillingMutationResult = { kind: 'ok'; url: string } | { kind: 'error'; code: string }

export type VoiceProfileMutationResult =
  | { kind: 'ok'; code: 'voice_profile_saved' | 'voice_profile_cleared' }
  | { kind: 'error'; code: 'voice_profile_invalid' | 'owner_required' }

export type AddCustomDomainResult = { ok: true; domain: CustomDomainView } | { ok: false; code: string }
export type RemoveCustomDomainResult = { ok: true } | { ok: false; code: string }

export type { VoiceProfileSettingsInput }