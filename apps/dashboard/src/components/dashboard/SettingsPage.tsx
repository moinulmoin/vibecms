'use client'

import {
  ACCENTS,
  DEFAULT_PRESET_ID,
  ENTITLEMENTS,
  FONTS,
  MEDIA,
  PRESET_IDS,
  PRICING,
  resolvePresentation,
  STARTER_LOOKS,
  THEME_MODES,
  THEME_PRESETS,
  type AccentId,
  type FontId,
  type StarterLookId,
  type ThemeMode,
  type PresetId,
  type ResolvedPresentation,
} from '@vc/config'
import type { Asset, BillingStatus } from '@vc/core'
import type { CustomDomainsPanel, CustomDomainView } from '~/types/dashboard'
import { DownloadIcon, GlobeIcon, PlusIcon, ReloadIcon, ResetIcon, CheckIcon } from '@radix-ui/react-icons'
import {
  Alert,
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Textarea,
  cn,
  Select,
} from '@vc/ui'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { renderRichContent, type RenderResult } from '@vc/content'
import { PresentedPostArticle } from '@vc/content/presented-post'
import { PublicPageChrome } from '@vc/content/public-chrome'
import {
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '~/components/dashboard/DashboardLayout'
import { ListRow, StatusBadge } from '~/components/dashboard/blocks'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '~/components/ui/collapsible'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  addCustomDomainMutation,
  removeCustomDomainMutation,
  loadPostEditorPage,
  loadPostsPage,
  loadSettingsPage,
  updateSiteSettingsMutation,
  updateVoiceProfileMutation,
  clearVoiceProfileMutation,
} from '~/lib/api-client'
import type { VoiceProfileSettings } from '~/types/dashboard'
import type { z } from 'zod'
import { settingsPageDataSchema } from '~/lib/dashboard-response-schemas'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { useMediaQuery } from '~/hooks/use-media-query'
type SettingsPageData = {
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
  publicBaseUrl: string | null
  voiceProfile: VoiceProfileSettings
}
type SiteSettingsForm = {
  name: string
  description: string
  defaultSeoTitle: string
  defaultSeoDescription: string
  defaultSocialAssetId: string | null
  theme: PresetId
  slug: string
  themeAccent: AccentId
  themeFont: FontId
  themeMode: ThemeMode
}

type SettingsApiResponse = z.infer<typeof settingsPageDataSchema>

function isPresetId(value: string): value is PresetId {
  return PRESET_IDS.some((id) => id === value)
}

function isAccentId(value: string): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value)
}

function isFontId(value: string): value is FontId {
  return FONTS.some((font) => font.id === value)
}

function isThemeMode(value: string): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value)
}

function isCustomDomainStatus(value: string): value is CustomDomainView['status'] {
  return value === 'pending' || value === 'active' || value === 'failed' || value === 'disabled'
}

function narrowSettingsPageData(result: SettingsApiResponse): SettingsPageData {
  const domains: CustomDomainView[] = []
  for (const domain of result.customDomains.domains) {
    if (!isCustomDomainStatus(domain.status)) continue
    domains.push({ ...domain, status: domain.status })
  }

  return {
    ...result,
    site: {
      ...result.site,
      theme: isPresetId(result.site.theme) ? result.site.theme : DEFAULT_PRESET_ID,
      themeAccent: isAccentId(result.site.themeAccent) ? result.site.themeAccent : 'teal',
      themeFont: isFontId(result.site.themeFont) ? result.site.themeFont : 'geist-sans',
      themeMode: isThemeMode(result.site.themeMode) ? result.site.themeMode : 'system',
    },
    customDomains: {
      ...result.customDomains,
      domains,
    },
  }
}

const VOICE_RULE_LINE_LIMIT = 200
const VOICE_RULE_LIMIT = 12
const REPRESENTATIVE_POST_LIMIT = 3

export type VoiceRuleValidation = {
  lineNumbers: number[]
  ruleCount: number
  isValid: boolean
}

export function parseVoiceRules(value: string) {
  return value.split('\n').filter((line) => line.trim().length > 0)
}

export function validateVoiceRules(value: string): VoiceRuleValidation {
  const lines = value.split('\n')
  const rules = parseVoiceRules(value)
  const lineNumbers = lines.reduce<number[]>((overlong, line, index) => {
    if (line.trim().length > 0 && line.length > VOICE_RULE_LINE_LIMIT) overlong.push(index + 1)
    return overlong
  }, [])

  return {
    lineNumbers,
    ruleCount: rules.length,
    isValid: lineNumbers.length === 0,
  }
}

export type VoiceProfileFormValidation = {
  prefer: VoiceRuleValidation
  avoid: VoiceRuleValidation
  ruleCount: number
  isValid: boolean
}

export function validateVoiceProfileForm(preferRules: string, avoidRules: string): VoiceProfileFormValidation {
  const prefer = validateVoiceRules(preferRules)
  const avoid = validateVoiceRules(avoidRules)
  const ruleCount = prefer.ruleCount + avoid.ruleCount

  return {
    prefer,
    avoid,
    ruleCount,
    isValid: prefer.isValid && avoid.isValid && ruleCount <= VOICE_RULE_LIMIT,
  }
}

export function selectRepresentativePost(selectedIds: string[], postId: string, checked: boolean) {
  if (!checked) return selectedIds.filter((id) => id !== postId)
  if (selectedIds.includes(postId) || selectedIds.length >= REPRESENTATIVE_POST_LIMIT) return selectedIds
  return [...selectedIds, postId]
}

function BillingStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />
}

function DomainStatusBadge({ status }: { status: CustomDomainView['status'] }) {
  return <StatusBadge status={status} />
}

// ---------------------------------------------------------------------------
// Canonical markdown sample - exercises the full renderer vocabulary.
// Used only as a preview fallback when no published post exists yet.
// Computed once at module load; safe because renderRichContent is synchronous.
// ---------------------------------------------------------------------------
const CANONICAL_SAMPLE_MD = `# Shipping calm software

Your agents draft, you approve, and the public blog reflects only what you
explicitly publish. This preview is one article that shows every block the
renderer supports.

Every meaningful change creates a version. You can roll back any post from
the activity log with a single restore, and the audit trail stays readable.

Whether the actor was **you**, a token, or an **agent**, the trail reads the
same. Learn more in the [format guide](https://example.com).

> [!NOTE]
> Versions are immutable. Restoring creates a new tip; it never rewrites
> history.

> A quote pulls out a line worth remembering, *styled per preset.*

## A calm publishing loop

vibecms keeps agent drafts separate from the public page until you say publish.
The result is a loop with one owner of record:

1. Draft and preview with \`posts.preview\`
2. Save as a draft and record the version
3. Approve publishing in a later message

## Applied in practice

Agents prepare drafts and previews, but publishing waits for your explicit
go-ahead. Requests funnel through \`posts.versionTip\` and return a clean
version cursor:

\`\`\`ts
export async function publishPost(id: string) {
  const tip = await db.posts.versionTip(id)
  return db.posts.publish(id, { expectedVersionNumber: tip })
}
\`\`\`

> [!TIP]
> Change the **accent** above and watch the links, callouts, and code cursor
> update here.

## Readable everywhere

Every preset keeps the same promises: open graph metadata and a layout that
reads well in a browser, a feed reader, or an AI crawler.

![A calm blog layout](https://picsum.photos/seed/vc/800/400)
*Caption: the same post, your chosen style.*

| Preset | Density | Best for |
| ------ | ------- | -------- |
| Minimal | Airy | General writing |
| Editorial | Comfortable | Narrative |
`
const SAMPLE_TITLE = 'Shipping calm software'
const SAMPLE_RENDER = renderRichContent(CANONICAL_SAMPLE_MD, { pageTitle: SAMPLE_TITLE })

type ThemePreviewArticle = {
  renderResult: RenderResult
  title: string
  excerpt: string
  dateText: string
  tags: string[]
  presentation: ResolvedPresentation
  source: 'sample' | 'published'
}

const SAMPLE_PREVIEW_ARTICLE: ThemePreviewArticle = {
  renderResult: SAMPLE_RENDER,
  title: SAMPLE_TITLE,
  excerpt: 'A complete article preview for judging typography, rhythm, media, callouts, code, and tables.',
  dateText: 'Preview article',
  tags: ['workflow', 'publishing'],
  presentation: resolvePresentation(DEFAULT_PRESET_ID, null).resolved,
  source: 'sample',
}

export function SettingsPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/dashboard/settings' })
  const desktopSettingsNavigation = useMediaQuery('(min-width: 1024px)')
  const [data, setData] = useState<SettingsPageData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeDomainPending, setRemoveDomainPending] = useState<string | null>(null)
  const [refreshingDomains, setRefreshingDomains] = useState(false)
  const [formPending, setFormPending] = useState<'site' | 'theme' | 'domain' | 'voice' | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<PresetId>(DEFAULT_PRESET_ID)
  const [selectedAccent, setSelectedAccent] = useState<AccentId>('teal')
  const [selectedFont, setSelectedFont] = useState<FontId>('geist-sans')
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('system')
  const [selectedSocialAssetId, setSelectedSocialAssetId] = useState('')
  const [voiceAudience, setVoiceAudience] = useState('')
  const [voiceSummary, setVoiceSummary] = useState('')
  const [voicePreferText, setVoicePreferText] = useState('')
  const [voiceAvoidText, setVoiceAvoidText] = useState('')
  const [voiceRepresentativeIds, setVoiceRepresentativeIds] = useState<string[]>([])
  const [voiceSaveStatus, setVoiceSaveStatus] = useState<string | null>(null)
  const [voiceEditorOpen, setVoiceEditorOpen] = useState(false)
  // Live preview content: the latest published post when one exists,
  // otherwise the canonical sample. Rendered fresh against the selected
  // theme so the preview is always the real blog, not a mock.
  const [previewArticle, setPreviewArticle] = useState<ThemePreviewArticle>(SAMPLE_PREVIEW_ARTICLE)

  useEffect(() => {
    let cancelled = false
    void loadSettingsPage()
      .then((loaded) => {
        const normalized = narrowSettingsPageData(loaded)
        if (!cancelled) {
        setData(normalized)
        setSelectedTheme(normalized.site.theme)
        setSelectedAccent(normalized.site.themeAccent)
        setSelectedFont(normalized.site.themeFont)
        setSelectedMode(normalized.site.themeMode)
        setSelectedSocialAssetId(normalized.site.defaultSocialAssetId ?? '')
        setVoiceAudience(normalized.voiceProfile.audience)
        setVoiceSummary(normalized.voiceProfile.voiceSummary)
        setVoicePreferText(normalized.voiceProfile.preferRules.join('\n'))
        setVoiceAvoidText(normalized.voiceProfile.avoidRules.join('\n'))
        setVoiceRepresentativeIds(normalized.voiceProfile.representativePostIds)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load settings.')
      })
    // Pull the most recent published post for the theme live preview.
    void loadPostsPage({ status: 'published' })
      .then((list) => {
        if (cancelled || list.posts.length === 0) return
        return loadPostEditorPage({ postId: list.posts[0]?.id })
      })
      .then((page) => {
        if (cancelled || !page) return
        const latestPublished = page.post?.status === 'published' ? page.post : null
        if (latestPublished?.contentMarkdown) {
          setPreviewArticle({
            renderResult: renderRichContent(latestPublished.contentMarkdown, { pageTitle: latestPublished.title }),
            title: latestPublished.title,
            excerpt: latestPublished.excerpt ?? 'Published article preview',
            dateText: latestPublished.publishedAt
              ? new Date(latestPublished.publishedAt * 1000).toLocaleDateString()
              : 'Published article',
            tags: latestPublished.tags,
            presentation: resolvePresentation(page.presetId, latestPublished.presentation).resolved,
            source: 'published',
          })
        }
      })
      .catch(() => {
        // Keep the sample preview; the preview is a nice-to-have, not a blocker.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const voiceValidation = validateVoiceProfileForm(voicePreferText, voiceAvoidText)
  const voicePreferDescribedBy = [
    'voice-prefer-help',
    voiceValidation.prefer.lineNumbers.length > 0 ? 'voice-prefer-line-error' : null,
    voiceValidation.ruleCount > VOICE_RULE_LIMIT ? 'voice-rule-count-error' : null,
  ].filter(Boolean).join(' ')
  const voiceAvoidDescribedBy = [
    'voice-avoid-help',
    voiceValidation.avoid.lineNumbers.length > 0 ? 'voice-avoid-line-error' : null,
    voiceValidation.ruleCount > VOICE_RULE_LIMIT ? 'voice-rule-count-error' : null,
  ].filter(Boolean).join(' ')
  const selectedSocialAsset = data?.assets.find((asset) => asset.id === selectedSocialAssetId) ?? null


  async function handleSiteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? '') || undefined,
      defaultSeoTitle: String(form.get('defaultSeoTitle') ?? ''),
      defaultSeoDescription: String(form.get('defaultSeoDescription') ?? '') || undefined,
      defaultSocialAssetId: selectedSocialAssetId || null,
      theme: data?.site.theme ?? selectedTheme,
      themeAccent: data?.site.themeAccent,
      themeFont: data?.site.themeFont,
      themeMode: data?.site.themeMode,
    }
    setFormPending('site')
    try {
      const result = await updateSiteSettingsMutation(payload)
      if (result.kind === 'ok') {
        setData((prev) => prev ? {
          ...prev,
          site: {
            ...prev.site,
            name: payload.name,
            description: payload.description ?? '',
            defaultSeoTitle: payload.defaultSeoTitle,
            defaultSeoDescription: payload.defaultSeoDescription ?? '',
            defaultSocialAssetId: payload.defaultSocialAssetId,
          },
        } : prev)
      }
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.kind === 'ok' ? result.code : undefined, error: result.kind === 'ok' ? undefined : result.code, tab: prev.tab }),
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: 'unknown', tab: prev.tab }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleThemeSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    setFormPending('theme')
    try {
      const result = await updateSiteSettingsMutation({
        name: data.site.name,
        description: data.site.description || undefined,
        defaultSeoTitle: data.site.defaultSeoTitle,
        defaultSeoDescription: data.site.defaultSeoDescription || undefined,
        theme: selectedTheme,
        themeAccent: selectedAccent,
        themeFont: selectedFont,
        themeMode: selectedMode,
      })
      if (result.kind === 'ok') {
        setData((prev) => prev ? {
          ...prev,
          site: {
            ...prev.site,
            theme: selectedTheme,
            themeAccent: selectedAccent,
            themeFont: selectedFont,
            themeMode: selectedMode,
          },
        } : prev)
      }
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({
          ok: result.kind === 'ok' ? result.code : undefined,
          error: result.kind === 'ok' ? undefined : result.code,
          tab: prev.tab,
        }),
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: 'unknown', tab: prev.tab }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleAddDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const hostname = String(form.get('hostname') ?? '').trim()
    setFormPending('domain')
    try {
      const result = await addCustomDomainMutation({ hostname })
      // Always refresh after the mutation: a transient domain_provisioning
      // failure keeps a retryable row server-side, and the user needs to see
      // it without a full page reload. The error toast (result.code) still
      // fires through the navigate below.
      const refreshed = await loadSettingsPage()
      setData(narrowSettingsPageData(refreshed))
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.ok ? 'domain_added' : undefined, error: result.ok ? undefined : result.code, tab: prev.tab }),
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: 'unknown', tab: prev.tab }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleRemoveDomain(domainId: string) {
    setRemoveDomainPending(domainId)
    try {
      const result = await removeCustomDomainMutation({ domainId })
      const refreshed = await loadSettingsPage()
      setData(narrowSettingsPageData(refreshed))
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.ok ? 'domain_removed' : undefined, error: result.ok ? undefined : result.code, tab: prev.tab }),
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: 'unknown', tab: prev.tab }),
      })
    } finally {
      setRemoveDomainPending(null)
    }
  }
  async function handleRefreshDomains() {
    setRefreshingDomains(true)
    try {
      const refreshed = await loadSettingsPage()
      setData(narrowSettingsPageData(refreshed))
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: undefined, tab: prev.tab }),
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: undefined, error: 'unknown', tab: prev.tab }),
      })
    } finally {
      setRefreshingDomains(false)
    }
  }

  async function handleVoiceProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!voiceValidation.isValid) return

    setFormPending('voice')
    try {
      const result = await updateVoiceProfileMutation({
        audience: voiceAudience || undefined,
        voiceSummary: voiceSummary || undefined,
        preferRules: voiceValidation.prefer.ruleCount ? parseVoiceRules(voicePreferText) : [],
        avoidRules: voiceValidation.avoid.ruleCount ? parseVoiceRules(voiceAvoidText) : [],
        representativePostIds: voiceRepresentativeIds,
      })
      if (result.kind === 'ok') {
        const refreshed = await loadSettingsPage()
        const normalized = narrowSettingsPageData(refreshed)
        setData(normalized)
        setVoiceAudience(normalized.voiceProfile.audience)
        setVoiceSummary(normalized.voiceProfile.voiceSummary)
        setVoicePreferText(normalized.voiceProfile.preferRules.join('\n'))
        setVoiceAvoidText(normalized.voiceProfile.avoidRules.join('\n'))
        setVoiceRepresentativeIds(normalized.voiceProfile.representativePostIds)
        setVoiceSaveStatus('Voice profile saved.')
        setVoiceEditorOpen(false)
      }
      await navigate({
        to: '/dashboard/settings',
        search: {
          ok: result.kind === 'ok' ? result.code : undefined,
          error: result.kind === 'ok' ? undefined : result.code,
          tab: 'voice',
        },
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: { ok: undefined, error: 'unknown', tab: 'voice' },
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleVoiceProfileClear() {
    setFormPending('voice')
    try {
      const result = await clearVoiceProfileMutation()
      if (result.kind === 'ok') {
        const refreshed = await loadSettingsPage()
        const normalized = narrowSettingsPageData(refreshed)
        setData(normalized)
        setVoiceAudience(normalized.voiceProfile.audience)
        setVoiceSummary(normalized.voiceProfile.voiceSummary)
        setVoicePreferText(normalized.voiceProfile.preferRules.join('\n'))
        setVoiceAvoidText(normalized.voiceProfile.avoidRules.join('\n'))
        setVoiceRepresentativeIds(normalized.voiceProfile.representativePostIds)
        setVoiceSaveStatus('Voice profile cleared. Agents will use the VibeCMS writing baseline and the current brief.')
        setVoiceEditorOpen(false)
      }
      await navigate({
        to: '/dashboard/settings',
        search: {
          ok: result.kind === 'ok' ? result.code : undefined,
          error: result.kind === 'ok' ? undefined : result.code,
          tab: 'voice',
        },
      })
    } catch {
      await navigate({
        to: '/dashboard/settings',
        search: { ok: undefined, error: 'unknown', tab: 'voice' },
      })
    } finally {
      setFormPending(null)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!data) {
    return (
      <>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </>
    )
  }

  const { site, customDomains, billingStatus, managed, selfHosted, isOwner } = data
  const managedBinding = managed != null
  const managedAccess = managed?.effective === true
  const polarAccess =
    data.effectiveEntitlement?.effective === true &&
    data.effectiveEntitlement.source === 'polar'

  return (
    <>
      <PageHeader
        title="Settings"
        description="Blog defaults, agent voice, domain, plan, and data."
      />
      <Tabs
        value={search.tab ?? 'general'}
        onValueChange={(value) => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: value === 'general' ? undefined : value }})}
        orientation={desktopSettingsNavigation ? 'vertical' : 'horizontal'}
        className="gap-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8"
      >
        <div className="overflow-x-auto pb-1 lg:sticky lg:top-20 lg:overflow-visible lg:pb-0">
          <TabsList
            aria-label="Workspace settings sections"
            variant="line"
            className="min-w-max gap-1 lg:grid lg:w-full lg:min-w-0 lg:justify-stretch"
          >
            <TabsTrigger value="general" aria-label="Site settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Site</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Identity and SEO</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="theme" aria-label="Theme settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Theme</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Reading experience</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="voice" aria-label="Writing voice settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Voice</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Agent writing rules</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="domain" aria-label="Domain settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Domain</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Hosts and DNS</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="billing" aria-label="Plan and billing settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Plan</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Billing and limits</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="data" aria-label="Data export settings" className="px-3 py-2.5 data-[state=active]:font-medium lg:h-auto">
              <span className="text-left">
                <span className="block">Data</span>
                <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground lg:block">Export and portability</span>
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="general" className="grid gap-4">
          <Panel title="Site" meta="Name & SEO defaults">
            <form className="grid max-w-3xl gap-4" onSubmit={(e) => void handleSiteSave(e)}>
              <Field>
                <FieldLabel htmlFor="site-name">Blog name</FieldLabel>
                <Input id="site-name" name="name" required maxLength={80} defaultValue={site.name} />
              </Field>
              <Field>
                <FieldLabel htmlFor="site-description">Description</FieldLabel>
                <Textarea id="site-description" name="description" maxLength={220} rows={3} defaultValue={site.description} />
              </Field>
          <Field>
            <FieldLabel htmlFor="default-seo-title">SEO title</FieldLabel>
            <Input id="default-seo-title" name="defaultSeoTitle" required maxLength={120} defaultValue={site.defaultSeoTitle} />
          </Field>
          <Field>
            <FieldLabel htmlFor="default-seo-description">Meta description</FieldLabel>
            <Textarea
              id="default-seo-description"
              name="defaultSeoDescription"
              maxLength={220}
              rows={3}
              defaultValue={site.defaultSeoDescription}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="default-social-image">Default social image</FieldLabel>
            <Select
              id="default-social-image"
              name="defaultSocialAssetId"
              value={selectedSocialAssetId}
              onChange={(event) => setSelectedSocialAssetId(event.currentTarget.value)}
              aria-describedby="default-social-image-help"
            >
              <option value="">No default image</option>
              {data.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename}{asset.altText ? '' : ' — add alt text first'}
                </option>
              ))}
            </Select>
            <p id="default-social-image-help" className="text-sm leading-6 text-muted-foreground">
              Used for posts without a featured image and for shared blog pages. A 1200 × 630 image works best.
              {' '}Manage images and alt text in <Link to="/dashboard/media" search={emptyDashboardStatusSearch} className="text-foreground underline underline-offset-4">Media</Link>.
            </p>
            {selectedSocialAsset ? (
              <div className="flex min-w-0 items-center gap-3 pt-1">
                <img
                  src={`/media-assets/${selectedSocialAsset.id}`}
                  alt={selectedSocialAsset.altText ?? ''}
                  className="h-16 w-28 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-foreground">{selectedSocialAsset.filename}</p>
                  <p className="text-muted-foreground">
                    {selectedSocialAsset.width && selectedSocialAsset.height
                      ? `${selectedSocialAsset.width} × ${selectedSocialAsset.height}`
                      : 'Dimensions unavailable'}
                  </p>
                  {!selectedSocialAsset.altText ? (
                    <p className="text-destructive">Add alt text before saving.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Field>
          <PendingSubmitButton
            className="w-fit"
            pending={formPending === 'site'}
            pendingText="Saving…"
            disabled={Boolean(selectedSocialAsset && !selectedSocialAsset.altText)}
          >
            <CheckIcon aria-hidden data-icon="inline-start" /> Save
          </PendingSubmitButton>
        </form>
      </Panel>
        </TabsContent>
        <TabsContent value="theme" className="grid gap-4">
          <Panel title="Theme" meta="Reading experience">
            <p className="mb-6 max-w-3xl font-sans text-base leading-7 text-muted-foreground">
              Set the typography and color system on the left. The right side is the same article shell readers receive, including the masthead, title, metadata, body, and table of contents.
            </p>
            <form
              className="grid gap-6 xl:grid-cols-[minmax(19rem,21rem)_minmax(0,1fr)] xl:items-start"
              onSubmit={(e) => void handleThemeSave(e)}
            >
              <div className="grid gap-5 rounded-xl bg-muted/30 p-4 sm:p-5">
                <FieldSet>
                  <FieldLegend variant="label">Style</FieldLegend>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESET_IDS.map((id) => {
                      const preset = THEME_PRESETS[id]
                      const isCurrent = selectedTheme === id
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={isCurrent}
                          onClick={() => {
                            setSelectedTheme(id)
                            const look = id === 'minimal' ? undefined : STARTER_LOOKS[id as StarterLookId]
                            if (look) {
                              setSelectedAccent(look.accent)
                              if ('font' in look && look.font) setSelectedFont(look.font)
                            }
                          }}
                          className={cn(
                            'flex min-w-0 flex-col gap-1 rounded-lg p-3 text-left transition-colors hover:bg-background/65',
                            isCurrent &&
                              'bg-brand-bright/[0.045] ring-1 ring-brand-bright/50',
                          )}
                        >
                          <span className="flex items-center gap-1.5 font-display text-[13px] font-medium text-foreground">
                            {preset.name}
                            {isCurrent && (
                              <Badge className="gap-1 border-brand-bright/30 bg-brand-bright/10 text-primary text-[0.6rem]">
                                Live
                              </Badge>
                            )}
                          </span>
                          <span className="font-sans text-[11px] leading-4 text-muted-foreground">
                            {preset.designIntent}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </FieldSet>

                <FieldSet>
                  <FieldLegend variant="label">Accent</FieldLegend>
                  <div className="flex flex-wrap gap-1.5">
                    {ACCENTS.map((accent) => {
                      const isCurrent = selectedAccent === accent.id
                      return (
                        <button
                          key={accent.id}
                          type="button"
                          aria-pressed={isCurrent}
                          title={accent.name}
                          onClick={() => setSelectedAccent(accent.id)}
                          className={cn(
                            'size-7 rounded-full ring-1 ring-inset ring-black/10 transition-transform dark:ring-white/10',
                            'hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isCurrent && 'ring-2 ring-brand-bright ring-offset-2 ring-offset-background',
                          )}
                          style={{ backgroundColor: accent.oklchLight }}
                          aria-label={`Accent ${accent.name}`}
                        />
                      )
                    })}
                  </div>
                </FieldSet>

                <FieldSet>
                  <FieldLegend variant="label">Type</FieldLegend>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={selectedFont}
                    onValueChange={(value) => { if (value) setSelectedFont(value as FontId) }}
                    aria-label="Font type"
                    className="w-full flex-wrap justify-start"
                  >
                    {FONTS.map((font) => (
                      <ToggleGroupItem
                        key={font.id}
                        value={font.id}
                        className="px-2.5 data-[state=on]:border-brand-bright/40 data-[state=on]:bg-brand-bright/10 data-[state=on]:text-primary"
                      >
                        {font.name}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </FieldSet>

                <FieldSet>
                  <FieldLegend variant="label">Default mode</FieldLegend>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={selectedMode}
                    onValueChange={(value) => { if (value) setSelectedMode(value as ThemeMode) }}
                    aria-label="Default color mode"
                    className="w-full flex-wrap justify-start"
                  >
                    {THEME_MODES.map((mode) => (
                      <ToggleGroupItem
                        key={mode}
                        value={mode}
                        className="px-2.5 capitalize data-[state=on]:border-brand-bright/40 data-[state=on]:bg-brand-bright/10 data-[state=on]:text-primary"
                      >
                        {mode}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p className="mt-1 font-sans text-[11px] leading-4 text-muted-foreground">
                    What visitors see. The preview on the right uses this mode.
                  </p>
                </FieldSet>

                {(selectedTheme !== site.theme ||
                  selectedAccent !== site.themeAccent ||
                  selectedFont !== site.themeFont ||
                  selectedMode !== site.themeMode) && (
                  <p className="font-sans text-xs text-amber-600 dark:text-amber-400">
                    Changes not yet saved.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <PendingSubmitButton className="w-fit" pending={formPending === 'theme'} pendingText="Saving…">
                    <CheckIcon aria-hidden data-icon="inline-start" /> Save changes
                  </PendingSubmitButton>
                </div>
              </div>

              <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-sans text-sm font-semibold text-foreground">Article preview</p>
                    <p className="mt-0.5 font-sans text-xs text-muted-foreground">
                      {previewArticle.source === 'published' ? 'Latest published post' : 'Complete sample article'}
                    </p>
                  </div>
                  {data.publicBaseUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={data.publicBaseUrl} target="_blank" rel="noopener noreferrer">
                        View live blog
                      </a>
                    </Button>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-xl border border-[color:var(--hairline)] bg-background shadow-[0_16px_50px_-35px_oklch(0.2_0.03_155/0.45)]">
                  <div className="border-b border-[color:var(--hairline)] bg-muted/45 px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {data.publicBaseUrl?.replace('https://', '') ?? `${site.slug}.your-domain.com`}/{previewArticle.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}
                  </div>
                  <div className="h-[44rem] max-h-[72dvh] overflow-auto">
                    <div inert>
                      <PublicPageChrome
                        siteName={site.name}
                        tagline={site.description}
                        homeHref="#"
                        allPostsHref="#"
                        presetId={selectedTheme}
                        theme={{ accent: selectedAccent, font: selectedFont, mode: selectedMode }}
                        article
                      >
                        <PresentedPostArticle
                          renderResult={previewArticle.renderResult}
                          presetId={selectedTheme}
                          presentation={resolvePresentation(selectedTheme, previewArticle.presentation).resolved}
                          title={previewArticle.title}
                          excerpt={previewArticle.excerpt}
                          byline={site.name}
                          dateText={previewArticle.dateText}
                          readingMinutes={4}
                          tags={previewArticle.tags}
                          basePath=""
                          theme={{ accent: selectedAccent, font: selectedFont, mode: selectedMode }}
                        />
                      </PublicPageChrome>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </Panel>
        </TabsContent>
        <TabsContent value="voice" className="grid gap-4">
          <Panel title="Writing voice" meta={data.voiceProfile.configured ? 'Custom' : 'VibeCMS default'}>
            <Collapsible open={voiceEditorOpen} onOpenChange={setVoiceEditorOpen} className="grid gap-5">
            <div className="rounded-xl bg-muted/35 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <p className="font-display text-base font-medium text-foreground">
                    {data.voiceProfile.configured ? 'Your voice profile is active' : 'A strong baseline, with no setup'}
                  </p>
                  <p className="mt-2 font-sans text-sm leading-6 text-muted-foreground">
                    {data.voiceProfile.configured
                      ? (data.voiceProfile.voiceSummary || 'Agents follow your saved audience, style rules, and example posts.')
                      : 'Clear, specific, and practical. Agents use the reader’s language, keep one idea per section, support claims with evidence, and end with a concrete next step.'}
                  </p>
                  {data.voiceProfile.configured && data.voiceProfile.audience ? (
                    <p className="mt-2 font-sans text-xs text-muted-foreground">
                      Audience: {data.voiceProfile.audience}
                    </p>
                  ) : null}
                  {voiceSaveStatus ? (
                    <p aria-live="polite" className="mt-2 font-sans text-xs text-muted-foreground">
                      {voiceSaveStatus}
                    </p>
                  ) : null}
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={voiceEditorOpen}
                  >
                    {voiceEditorOpen ? 'Close' : data.voiceProfile.configured ? 'Edit voice' : 'Customize voice'}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
            <form className="grid max-w-3xl gap-5" onSubmit={(e) => void handleVoiceProfileSave(e)}>
              <Field>
                <FieldLabel htmlFor="voice-audience">Audience</FieldLabel>
                <Textarea
                  id="voice-audience"
                  value={voiceAudience}
                  onChange={(e) => {
                    setVoiceSaveStatus(null)
                    setVoiceAudience(e.target.value)
                  }}
                  maxLength={300}
                  rows={2}
                  placeholder="For example: technical operators building reliable SaaS products"
                />
                <p className="mt-1 font-sans text-xs text-muted-foreground">
                  Who should feel addressed? {voiceAudience.length}/300 characters
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="voice-summary">Tone</FieldLabel>
                <Textarea
                  id="voice-summary"
                  value={voiceSummary}
                  onChange={(e) => {
                    setVoiceSaveStatus(null)
                    setVoiceSummary(e.target.value)
                  }}
                  maxLength={500}
                  rows={3}
                  placeholder="For example: Calm, specific, and practical; lead with the useful detail."
                />
                <p className="mt-1 font-sans text-xs text-muted-foreground">
                  The overall register and rhythm. {voiceSummary.length}/500 characters
                </p>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Style rules</FieldLegend>
                <p className="mb-3 font-sans text-xs text-muted-foreground">
                  One rule per line. Up to {VOICE_RULE_LIMIT} rules total.
                </p>
                <div className="space-y-3">
                  <div>
                    <FieldLabel htmlFor="voice-prefer-rules" className="text-sm">Do</FieldLabel>
                    <Textarea
                      id="voice-prefer-rules"
                      value={voicePreferText}
                      onChange={(e) => {
                        setVoiceSaveStatus(null)
                        setVoicePreferText(e.target.value)
                      }}
                      aria-describedby={voicePreferDescribedBy}
                      aria-invalid={!voiceValidation.prefer.isValid}
                      rows={4}
                      placeholder={"One guideline per line\nUse active voice\nInclude concrete examples"}
                    />
                    <p id="voice-prefer-help" className="mt-1 font-sans text-xs text-muted-foreground">
                      {voiceValidation.prefer.ruleCount} of {VOICE_RULE_LIMIT} rules used here
                    </p>
                    {voiceValidation.prefer.lineNumbers.length > 0 && (
                      <p id="voice-prefer-line-error" role="alert" className="mt-1 font-sans text-xs text-destructive">
                        Shorten line{voiceValidation.prefer.lineNumbers.length === 1 ? '' : 's'} {voiceValidation.prefer.lineNumbers.join(', ')} to {VOICE_RULE_LINE_LIMIT} characters or fewer.
                      </p>
                    )}
                  </div>
                  <div>
                    <FieldLabel htmlFor="voice-avoid-rules" className="text-sm">Don’t</FieldLabel>
                    <Textarea
                      id="voice-avoid-rules"
                      value={voiceAvoidText}
                      onChange={(e) => {
                        setVoiceSaveStatus(null)
                        setVoiceAvoidText(e.target.value)
                      }}
                      aria-describedby={voiceAvoidDescribedBy}
                      aria-invalid={!voiceValidation.avoid.isValid}
                      rows={4}
                      placeholder={"One guideline per line\nAvoid jargon\nDo not use passive voice"}
                    />
                    <p id="voice-avoid-help" className="mt-1 font-sans text-xs text-muted-foreground">
                      {voiceValidation.avoid.ruleCount} of {VOICE_RULE_LIMIT} rules used here
                    </p>
                    {voiceValidation.avoid.lineNumbers.length > 0 && (
                      <p id="voice-avoid-line-error" role="alert" className="mt-1 font-sans text-xs text-destructive">
                        Shorten line{voiceValidation.avoid.lineNumbers.length === 1 ? '' : 's'} {voiceValidation.avoid.lineNumbers.join(', ')} to {VOICE_RULE_LINE_LIMIT} characters or fewer.
                      </p>
                    )}
                  </div>
                </div>
                {voiceValidation.ruleCount > VOICE_RULE_LIMIT && (
                  <p id="voice-rule-count-error" role="alert" className="mt-2 font-sans text-xs text-destructive">
                    {voiceValidation.ruleCount} rules entered. Keep the combined total to {VOICE_RULE_LIMIT} or fewer before saving.
                  </p>
                )}
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">Example posts</FieldLegend>
                <p id="representative-posts-help" className="mb-3 font-sans text-xs text-muted-foreground">
                  Select published posts that best demonstrate this voice. Agents use them as reading references, not source material.
                </p>
                <p className="mb-3 font-sans text-sm font-medium" aria-live="polite">
                  {voiceRepresentativeIds.length} of {REPRESENTATIVE_POST_LIMIT} posts selected
                </p>
                {voiceRepresentativeIds.length >= REPRESENTATIVE_POST_LIMIT && (
                  <p className="mb-3 font-sans text-xs text-muted-foreground">
                    The three-post limit is reached. Deselect a post to choose another.
                  </p>
                )}
                {data.voiceProfile.publishedPosts.length > 0 || voiceRepresentativeIds.length > 0 ? (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1 sm:max-h-80">
                    {data.voiceProfile.publishedPosts.map((post) => (
                      <Field key={post.id} orientation="horizontal">
                        <Checkbox
                          id={`post-${post.id}`}
                          checked={voiceRepresentativeIds.includes(post.id)}
                          onCheckedChange={(checked) => {
                            if (checked === 'indeterminate') return
                            setVoiceSaveStatus(null)
                            setVoiceRepresentativeIds(selectRepresentativePost(voiceRepresentativeIds, post.id, checked))
                          }}
                          disabled={!voiceRepresentativeIds.includes(post.id) && voiceRepresentativeIds.length >= REPRESENTATIVE_POST_LIMIT}
                          aria-describedby="representative-posts-help"
                          className="mt-1"
                        />
                        <label htmlFor={`post-${post.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <div className="truncate font-sans text-sm font-medium">{post.title}</div>
                          <div className="truncate font-sans text-xs text-muted-foreground">{post.slug}</div>
                        </label>
                      </Field>
                    ))}
                    {voiceRepresentativeIds
                      .filter(id => !data.voiceProfile.publishedPosts.some(p => p.id === id))
                      .map((staleId) => (
                        <Field key={staleId} orientation="horizontal">
                          <Checkbox
                            id={`post-${staleId}`}
                            checked={true}
                            onCheckedChange={(checked) => {
                              if (!checked) {
                                setVoiceSaveStatus(null)
                                setVoiceRepresentativeIds(voiceRepresentativeIds.filter(id => id !== staleId))
                              }
                            }}
                            aria-describedby="representative-posts-help"
                            className="mt-1"
                          />
                          <label htmlFor={`post-${staleId}`} className="min-w-0 flex-1 cursor-pointer">
                            <div className="font-sans text-sm font-medium text-muted-foreground">Archived or missing post</div>
                            <div className="truncate font-sans text-xs text-muted-foreground">ID: {staleId}</div>
                          </label>
                        </Field>
                      ))}
                  </div>
                ) : (
                  <p className="font-sans text-sm text-muted-foreground">
                    No published posts are available yet. Publish one first to add a reading reference.
                  </p>
                )}
              </FieldSet>
              {data.voiceProfile.warnings.length > 0 && (
                <Alert variant="warning" title="Warnings">
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {data.voiceProfile.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <PendingSubmitButton
                  className="w-fit"
                  pending={formPending === 'voice'}
                  pendingText="Saving voice profile..."
                  disabled={!voiceValidation.isValid}
                >
                  <CheckIcon aria-hidden data-icon="inline-start" /> Save
                </PendingSubmitButton>
                {data.voiceProfile.configured && (
                  <SpaConfirmButton
                    type="button"
                    variant="outline"
                    size="sm"
                    confirmLabel="Confirm clear"
                    helperText="This removes the editorial guidance and reading references that agents receive."
                    onConfirm={() => void handleVoiceProfileClear()}
                  >
                    <ResetIcon aria-hidden data-icon="inline-start" /> Reset to default
                  </SpaConfirmButton>
                )}
              </div>
            </form>
            </CollapsibleContent>
            </Collapsible>
          </Panel>
        </TabsContent>
        <TabsContent value="domain" className="grid gap-4">
      {isOwner ? (
        <Panel
          title="Custom domain"
          meta={
            <div className="flex items-center gap-3">
              <span className="font-sans text-xs text-muted-foreground">Bring your own domain</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshingDomains}
                onClick={() => void handleRefreshDomains()}
              >
                <ReloadIcon aria-hidden data-icon="inline-start" />
                {refreshingDomains ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          }
        >
          <p className="mb-4 font-sans text-sm text-muted-foreground">
            Serve your blog on your own domain (for example blog.example.com). Requires an active subscription.
          </p>
          <form className="mb-4 flex max-w-3xl flex-wrap items-end gap-3" onSubmit={(e) => void handleAddDomain(e)}>
            <Field className="flex-1">
              <FieldLabel htmlFor="domain-hostname">Domain</FieldLabel>
              <Input id="domain-hostname" name="hostname" placeholder="blog.example.com" autoComplete="off" required />
            </Field>
            <PendingSubmitButton className="w-fit" pending={formPending === 'domain'} pendingText="Adding…">
              <PlusIcon aria-hidden data-icon="inline-start" /> Add domain
            </PendingSubmitButton>
          </form>
          {customDomains.cnameTarget ? (
            <p className="mb-4 font-sans text-xs leading-5 text-muted-foreground">
              After adding, create a DNS-only CNAME record pointing your domain to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{customDomains.cnameTarget}</code>. We verify and issue SSL automatically.
            </p>
          ) : null}
          {customDomains.domains.length ? (
            <div className="grid gap-0">
              {customDomains.domains.map((domain) => (
                <ListRow
                  key={domain.id}
                  title={<strong className="break-words font-display text-foreground">{domain.hostname}</strong>}
                  meta={
                    <div className="flex flex-wrap items-center gap-2">
                      <DomainStatusBadge status={domain.status} />
                      {domain.verificationErrors.length ? (
                        <span className="font-sans text-xs text-muted-foreground">{domain.verificationErrors[0]}</span>
                      ) : null}
                    </div>
                  }
                  actions={
                    <SpaConfirmButton
                      size="sm"
                      confirmLabel="Confirm remove"
                      helperText="Removing stops serving your blog on this domain."
                      disabled={removeDomainPending === domain.id}
                      onConfirm={() => handleRemoveDomain(domain.id)}
                    >
                      Remove
                    </SpaConfirmButton>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GlobeIcon />}
              title="No custom domains"
              description="Add a domain above to serve your blog on your own URL."
            />
          )}
        </Panel>
      ) : null}
        </TabsContent>
        <TabsContent value="billing" className="grid gap-4">
      <Panel
        title="Billing"
        meta={
          selfHosted ? (
            <Badge variant="outline">self-hosted</Badge>
          ) : polarAccess && !managedAccess ? (
            <BillingStatusBadge status={billingStatus} />
          ) : managedBinding ? (
            <Badge variant="outline">
              {managedAccess ? 'managed access' : managed?.status === 'revoked' ? 'managed revoked' : 'managed expired'}
            </Badge>
          ) : (
            <BillingStatusBadge status={billingStatus} />
          )
        }
      >
        <div className="rounded-xl bg-muted/35 p-4 md:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-display text-sm font-medium text-foreground">
                {selfHosted
                  ? 'Billing is disabled for this self-hosted workspace'
                  : polarAccess && !managedAccess
                    ? `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`
                  : managedBinding
                    ? 'Paid hosted access is managed by AutoSEOPilot'
                  : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}
              </p>
              <p className="mt-2 max-w-2xl font-sans text-sm leading-6 text-muted-foreground">
                {selfHosted
                  ? 'Publishing, media uploads, scoped agent access, activity history, and post versions run on your own Cloudflare resources without Polar checkout.'
                  : polarAccess && !managedAccess
                    ? `Your independent VibeCMS subscription keeps paid hosted features active. AutoSEOPilot sponsorship is currently unavailable. Media storage is capped at ${MEDIA.paidStorageLabel}.`
                  : managedBinding
                    ? managedAccess
                      ? `Publishing, media uploads, API and MCP quotas, analytics, custom domains, and search indexing are enabled while sponsorship is active. Polar billing remains separate. Media storage is capped at ${MEDIA.paidStorageLabel}.`
                      : 'Paid hosted features are unavailable until AutoSEOPilot restores sponsorship. Existing content and workspace data remain intact.'
                  : `Drafting, agent tokens, and your first 5 published posts are free. Subscribe to publish more, upload media, and make posts search-indexable. Media storage is capped at ${MEDIA.paidStorageLabel}.`}
              </p>
            </div>
            {selfHosted ? (
              <Badge variant="outline" className="w-fit font-mono text-[11px] lg:justify-self-end">
                SELF_HOSTED=true
              </Badge>
            ) : isOwner ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button asChild>
                  <Link to="/dashboard/billing" search={emptyDashboardStatusSearch}>
                    {billingStatus === 'active'
                      ? 'Manage billing'
                      : managedBinding
                        ? 'Managed access'
                        : 'Subscribe to publish'}
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="Plan includes" meta={PRICING.planName}>
        <div className="grid gap-x-6 gap-y-1 font-sans text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
          {ENTITLEMENTS.map((entitlement) => (
            <span className="flex items-start gap-2 py-2 leading-5" key={entitlement}>
              <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>{entitlement}</span>
            </span>
          ))}
        </div>
      </Panel>
        </TabsContent>
        <TabsContent value="data" className="grid gap-4">
      {isOwner ? (
        <Panel title="Your data" meta="Export">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/35 p-4 md:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <DownloadIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="font-sans text-sm leading-6 text-muted-foreground">
                Download every post (drafts, published, and archived) as JSON. Your content is yours to keep, with no lock-in.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <a href="/api/export.json">Export posts</a>
            </Button>
          </div>
        </Panel>
      ) : null}
        </TabsContent>
      </Tabs>
    </>
  )
}