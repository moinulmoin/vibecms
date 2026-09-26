import {
  ACCENTS,
  DEFAULT_PRESET_ID,
  FONTS,
  PRESET_IDS,
  THEME_MODES,
  type AccentId,
  type FontId,
  type PresetId,
  type ThemeMode,
} from '@vc/config'
import { ArrowDown, ArrowUp, Download, ExternalLink, Globe2, LockKeyhole, Plus, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { Asset, BillingStatus } from '@vc/core'
import type { CustomDomainsPanel, CustomDomainView, NewsletterSettings, VoiceProfileSettings } from '~/types/dashboard'
import { Alert, CopyButton, Field, FieldLabel, FieldLegend, FieldSet, Input, Select, Textarea } from '@vc/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { PageHeader, PageSkeleton, PageTabs, Section, StatusBadge } from '~/components/dashboard/blocks'
import { PlanAndBilling } from '~/components/dashboard/BillingPage'
import { Tabs, TabsContent } from '~/components/ui/tabs'
import { Checkbox } from '~/components/ui/checkbox'
import { Switch } from '~/components/ui/switch'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { UnsavedNavigationGuard } from '~/components/dashboard/UnsavedNavigationGuard'
import {
  addCustomDomainMutation,
  removeCustomDomainMutation,
  updateSiteSettingsMutation,
  updateVoiceProfileMutation,
  clearVoiceProfileMutation,
} from '~/lib/api-client'
import type { z } from 'zod'
import { settingsPageDataSchema } from '~/lib/dashboard-response-schemas'
import { navLinksSchema, socialLinksSchema, socialKindSchema, type NavLink, type SocialLink } from '@vc/validators'
import { emptyDashboardStatusSearch, type SettingsTab } from '~/lib/dashboard-search'
import { refreshContext, settingsQuery } from '~/lib/queries'

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
  logoAssetId: string | null
  faviconAssetId: string | null
  navLinks: NavLink[]
  socialLinks: SocialLink[]
  theme: PresetId
  slug: string
  themeAccent: AccentId
  themeFont: FontId
  themeMode: ThemeMode
  themeRadius: string
  themeWidth: string
  bylineName: string
  showAgentCredit: boolean
  updatedAt: number
  newsletterSettings: NewsletterSettings
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

function siteDraftFromForm(form: HTMLFormElement) {
  const fields = new FormData(form)
  return {
    name: String(fields.get('name') ?? ''),
    description: String(fields.get('description') ?? ''),
    defaultSeoTitle: String(fields.get('defaultSeoTitle') ?? ''),
    defaultSeoDescription: String(fields.get('defaultSeoDescription') ?? ''),
    defaultSocialAssetId: String(fields.get('defaultSocialAssetId') ?? ''),
    logoAssetId: String(fields.get('logoAssetId') ?? ''),
    faviconAssetId: String(fields.get('faviconAssetId') ?? ''),
    bylineName: String(fields.get('bylineName') ?? '').trim(),
  }
}

function isSiteDraftDirty(draft: ReturnType<typeof siteDraftFromForm>, baseline: SiteSettingsForm) {
  return draft.name !== baseline.name
    || draft.description !== baseline.description
    || draft.defaultSeoTitle !== baseline.defaultSeoTitle
    || draft.defaultSeoDescription !== baseline.defaultSeoDescription
    || draft.defaultSocialAssetId !== (baseline.defaultSocialAssetId ?? '')
    || draft.logoAssetId !== (baseline.logoAssetId ?? '')
    || draft.faviconAssetId !== (baseline.faviconAssetId ?? '')
    || draft.bylineName !== baseline.bylineName
}

/** Save row at the foot of a form: disabled and quiet until something changes. */
function SaveRow({
  dirty,
  pending,
  disabled,
  onDiscard,
  pendingText = 'Saving…',
  children,
}: {
  dirty: boolean
  pending: boolean
  disabled?: boolean
  onDiscard?: () => void
  pendingText?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--hairline)] pt-5">
      <PendingSubmitButton pending={pending} pendingText={pendingText} disabled={!dirty || disabled}>
        {dirty ? 'Save changes' : 'Saved'}
      </PendingSubmitButton>
      {dirty && onDiscard ? (
        <Button type="button" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      ) : null}
      {children}
    </div>
  )
}

const SOCIAL_KIND_LABELS: Record<SocialLink['kind'], string> = {
  x: 'X', github: 'GitHub', linkedin: 'LinkedIn', bluesky: 'Bluesky', mastodon: 'Mastodon',
  youtube: 'YouTube', instagram: 'Instagram', website: 'Website', email: 'Email',
}

function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  )
}

const DOMAIN_STATUS_COPY: Record<CustomDomainView['status'], string> = {
  pending: 'Waiting for the DNS record. This usually takes a few minutes, sometimes up to an hour.',
  active: 'Live, with HTTPS.',
  failed: 'We couldn’t verify this domain. Check the record below, then check again.',
  disabled: 'Paused. It comes back when your plan is active.',
}

function DnsRecord({ hostname, target }: { hostname: string; target: string }) {
  const rows: Array<[string, string, boolean]> = [
    ['Type', 'CNAME', false],
    ['Name', hostname, true],
    ['Target', target, true],
  ]
  return (
    <dl className="grid overflow-hidden rounded-lg border border-border text-sm sm:grid-cols-3">
      {rows.map(([label, value, copy]) => (
        <div key={label} className="flex min-w-0 items-center justify-between gap-2 border-b border-[color:var(--hairline)] px-3 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono text-[0.8125rem] text-foreground">{value}</dd>
          </div>
          {copy ? <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} copiedLabel="Copied" iconOnly variant="ghost" className="size-8 shrink-0" /> : null}
        </div>
      ))}
    </dl>
  )
}

const TAB_LABELS: Record<SettingsTab, string> = {
  site: 'Site',
  voice: 'Voice',
  domain: 'Domain',
  billing: 'Plan & billing',
  export: 'Export posts',
}

export function SettingsPage({ canEdit }: { canEdit?: boolean } = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/dashboard/settings' })
  const query = useQuery(settingsQuery)
  const data = query.data ? narrowSettingsPageData(query.data) : null
  const [removeDomainPending, setRemoveDomainPending] = useState<string | null>(null)
  const [refreshingDomains, setRefreshingDomains] = useState(false)
  const [formPending, setFormPending] = useState<'site' | 'domain' | 'voice' | null>(null)
  const [selectedSocialAssetId, setSelectedSocialAssetId] = useState('')
  const [selectedLogoAssetId, setSelectedLogoAssetId] = useState('')
  const [selectedFaviconAssetId, setSelectedFaviconAssetId] = useState('')
  const [navLinks, setNavLinks] = useState<NavLink[]>([])
  // Empty new rows stay quiet until the owner types in them or tries to save.
  const [linksAttempted, setLinksAttempted] = useState(false)
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([])
  const linksCurrent = useRef({ navLinks, socialLinks })
  linksCurrent.current = { navLinks, socialLinks }
  const [voiceAudience, setVoiceAudience] = useState('')
  const [voiceSummary, setVoiceSummary] = useState('')
  const [voicePreferText, setVoicePreferText] = useState('')
  const [voiceAvoidText, setVoiceAvoidText] = useState('')
  const [voiceRepresentativeIds, setVoiceRepresentativeIds] = useState<string[]>([])
  const [seeded, setSeeded] = useState(false)
  // Dirty-gated saves: the site form is uncontrolled (FormData on submit), so
  // dirtiness compares a snapshot of the live form against the loaded values.
  const [siteDirty, setSiteDirty] = useState(false)
  // The agent-credit switch is controlled (Radix), so its dirtiness is tracked
  // against the loaded value rather than read back from FormData.
  const [agentCredit, setAgentCredit] = useState(true)
  const [siteFormRevision, setSiteFormRevision] = useState(0)
  const [siteBaseline, setSiteBaseline] = useState<SiteSettingsForm | null>(null)
  const [siteChangedElsewhere, setSiteChangedElsewhere] = useState(false)
  const [voiceDirty, setVoiceDirty] = useState(false)
  const voiceCurrent = useRef({ audience: '', voiceSummary: '', preferText: '', avoidText: '', representativeIds: [] as string[] })

  function seedVoice(profile: VoiceProfileSettings) {
    voiceCurrent.current = {
      audience: profile.audience,
      voiceSummary: profile.voiceSummary,
      preferText: profile.preferRules.join('\n'),
      avoidText: profile.avoidRules.join('\n'),
      representativeIds: profile.representativePostIds,
    }
    setVoiceAudience(profile.audience)
    setVoiceSummary(profile.voiceSummary)
    setVoicePreferText(profile.preferRules.join('\n'))
    setVoiceAvoidText(profile.avoidRules.join('\n'))
    setVoiceRepresentativeIds(profile.representativePostIds)
  }

  function mergeSavedVoice(profile: VoiceProfileSettings, submitted: typeof voiceCurrent.current) {
    const current = voiceCurrent.current
    const saved = {
      audience: profile.audience,
      voiceSummary: profile.voiceSummary,
      preferText: profile.preferRules.join('\n'),
      avoidText: profile.avoidRules.join('\n'),
      representativeIds: profile.representativePostIds,
    }
    const merged = {
      audience: current.audience === submitted.audience ? saved.audience : current.audience,
      voiceSummary: current.voiceSummary === submitted.voiceSummary ? saved.voiceSummary : current.voiceSummary,
      preferText: current.preferText === submitted.preferText ? saved.preferText : current.preferText,
      avoidText: current.avoidText === submitted.avoidText ? saved.avoidText : current.avoidText,
      representativeIds: current.representativeIds === submitted.representativeIds ? saved.representativeIds : current.representativeIds,
    }
    voiceCurrent.current = merged
    setVoiceAudience(merged.audience)
    setVoiceSummary(merged.voiceSummary)
    setVoicePreferText(merged.preferText)
    setVoiceAvoidText(merged.avoidText)
    setVoiceRepresentativeIds(merged.representativeIds)
    setVoiceDirty(merged.audience !== saved.audience || merged.voiceSummary !== saved.voiceSummary
      || merged.preferText !== saved.preferText || merged.avoidText !== saved.avoidText
      || merged.representativeIds !== saved.representativeIds)
  }

  useEffect(() => {
    if (!data || seeded) return
    setSeeded(true)
    setSiteBaseline(data.site)
    setSelectedSocialAssetId(data.site.defaultSocialAssetId ?? '')
    setSelectedLogoAssetId(data.site.logoAssetId ?? '')
    setSelectedFaviconAssetId(data.site.faviconAssetId ?? '')
    setNavLinks(data.site.navLinks)
    setSocialLinks(data.site.socialLinks)
    setAgentCredit(data.site.showAgentCredit)
    seedVoice(data.voiceProfile)
  }, [data, seeded])

  useEffect(() => {
    if (!data || !siteBaseline || data.site.updatedAt === siteBaseline.updatedAt) return
    if (siteDirty || agentCredit !== siteBaseline.showAgentCredit
      || JSON.stringify(navLinks) !== JSON.stringify(siteBaseline.navLinks)
      || JSON.stringify(socialLinks) !== JSON.stringify(siteBaseline.socialLinks)) {
      setSiteChangedElsewhere(true)
    } else {
      setSiteBaseline(data.site)
      setSelectedSocialAssetId(data.site.defaultSocialAssetId ?? '')
      setSelectedLogoAssetId(data.site.logoAssetId ?? '')
      setSelectedFaviconAssetId(data.site.faviconAssetId ?? '')
      setNavLinks(data.site.navLinks)
      setSocialLinks(data.site.socialLinks)
      setAgentCredit(data.site.showAgentCredit)
      setSiteFormRevision((revision) => revision + 1)
    }
  }, [data, siteBaseline, siteDirty, agentCredit])

  async function reload() {
    return narrowSettingsPageData(await queryClient.fetchQuery({ ...settingsQuery, staleTime: 0 }))
  }

  function feedback(result: { ok?: string; error?: string }) {
    void navigate({
      to: '/dashboard/settings',
      search: (prev) => ({ ok: result.ok, error: result.error, tab: prev.tab }),
      replace: true,
    })
  }

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

  function markSiteDirty(form: HTMLFormElement) {
    setSiteDirty(siteBaseline ? isSiteDraftDirty(siteDraftFromForm(form), siteBaseline) : false)
  }

  function discardSite() {
    const latest = data?.site ?? siteBaseline
    if (latest) setSiteBaseline(latest)
    setSelectedSocialAssetId(latest?.defaultSocialAssetId ?? '')
    setSelectedLogoAssetId(latest?.logoAssetId ?? '')
    setSelectedFaviconAssetId(latest?.faviconAssetId ?? '')
    setNavLinks(latest?.navLinks ?? [])
    setSocialLinks(latest?.socialLinks ?? [])
    setAgentCredit(latest?.showAgentCredit ?? true)
    setSiteDirty(false)
    setSiteChangedElsewhere(false)
    setSiteFormRevision((revision) => revision + 1)
  }

  async function handleSiteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const submitted = siteDraftFromForm(formElement)
    const nameChanged = submitted.name !== siteBaseline?.name
    if (!navLinksSchema.safeParse(navLinks).success || !socialLinksSchema.safeParse(socialLinks).success) {
      setLinksAttempted(true)
      return
    }
    const payload = {
      expectedUpdatedAt: siteBaseline?.updatedAt ?? 0,
      ...submitted,
      defaultSocialAssetId: submitted.defaultSocialAssetId || null,
      logoAssetId: submitted.logoAssetId || null,
      faviconAssetId: submitted.faviconAssetId || null,
      navLinks,
      socialLinks,
      showAgentCredit: agentCredit,
    }
    setFormPending('site')
    try {
      const result = await updateSiteSettingsMutation(payload)
      if (result.kind === 'ok') {
        const refreshed = await reload()
        setSiteBaseline(refreshed.site)
        setSiteChangedElsewhere(false)
        const liveDraft = siteDraftFromForm(formElement)
        if (isSiteDraftDirty(liveDraft, { ...refreshed.site, ...submitted })
          || JSON.stringify(linksCurrent.current.navLinks) !== JSON.stringify(navLinks)
          || JSON.stringify(linksCurrent.current.socialLinks) !== JSON.stringify(socialLinks)) {
          setSiteDirty(true)
        } else {
          setSelectedSocialAssetId(refreshed.site.defaultSocialAssetId ?? '')
          setSelectedLogoAssetId(refreshed.site.logoAssetId ?? '')
          setSelectedFaviconAssetId(refreshed.site.faviconAssetId ?? '')
          setNavLinks(refreshed.site.navLinks)
          setSocialLinks(refreshed.site.socialLinks)
          setAgentCredit(refreshed.site.showAgentCredit)
          setSiteDirty(false)
          setSiteFormRevision((revision) => revision + 1)
        }
        if (nameChanged) void refreshContext()
      } else if (result.code === 'settings_conflict') {
        await reload()
        setSiteChangedElsewhere(true)
        setSiteDirty(true)
      }
      feedback(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setFormPending(null)
    }
  }

  async function handleAddDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const hostname = String(new FormData(formElement).get('hostname') ?? '').trim()
    setFormPending('domain')
    try {
      const result = await addCustomDomainMutation({ hostname })
      // Always refresh: a transient provisioning failure keeps a retryable row server-side.
      await reload()
      if (result.ok) formElement.reset()
      feedback(result.ok ? { ok: 'domain_added' } : { error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setFormPending(null)
    }
  }

  async function handleRemoveDomain(domainId: string) {
    setRemoveDomainPending(domainId)
    try {
      const result = await removeCustomDomainMutation({ domainId })
      await reload()
      feedback(result.ok ? { ok: 'domain_removed' } : { error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setRemoveDomainPending(null)
    }
  }

  async function handleRefreshDomains() {
    setRefreshingDomains(true)
    try {
      await reload()
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setRefreshingDomains(false)
    }
  }

  async function handleVoiceProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!voiceValidation.isValid) return

    const submitted = voiceCurrent.current
    setFormPending('voice')
    try {
      const result = await updateVoiceProfileMutation({
        audience: submitted.audience || undefined,
        voiceSummary: submitted.voiceSummary || undefined,
        preferRules: parseVoiceRules(submitted.preferText),
        avoidRules: parseVoiceRules(submitted.avoidText),
        representativePostIds: submitted.representativeIds,
      })
      if (result.kind === 'ok') {
        const refreshed = await reload()
        mergeSavedVoice(refreshed.voiceProfile, submitted)
      }
      feedback(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setFormPending(null)
    }
  }

  async function handleVoiceProfileClear() {
    const submitted = voiceCurrent.current
    setFormPending('voice')
    try {
      const result = await clearVoiceProfileMutation()
      if (result.kind === 'ok') {
        const refreshed = await reload()
        mergeSavedVoice(refreshed.voiceProfile, submitted)
      }
      feedback(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setFormPending(null)
    }
  }

  const header = <PageHeader title="Settings" />

  if (query.isError && !data) {
    return (
      <>
        {header}
        <LoadError message="Settings didn’t load. Check your connection and try again." onRetry={() => void query.refetch()} />
      </>
    )
  }
  if (!data) return <PageSkeleton variant="list" />

  const { customDomains, isOwner } = data
  const editable = isOwner && (canEdit ?? isOwner)
  const site = siteBaseline ?? data.site
  // Free hosted plans see the lock; a missing field (stale payload) stays unlocked.
  const domainLocked = data.effectiveEntitlement?.effective === false
  const tabs = (['site', 'voice', 'domain', 'billing', 'export'] as const).filter(
    (tab) => isOwner || (tab !== 'domain' && tab !== 'export'),
  )
  const requested = search.tab === 'theme' ? undefined : (search.tab as SettingsTab | undefined)
  const activeTab: SettingsTab = requested && tabs.some((tab) => tab === requested) ? requested : 'site'
  const defaultAddress = data.publicBaseUrl
  const siteFormDirty = siteDirty || agentCredit !== site.showAgentCredit
    || JSON.stringify(navLinks) !== JSON.stringify(siteBaseline?.navLinks ?? [])
    || JSON.stringify(socialLinks) !== JSON.stringify(siteBaseline?.socialLinks ?? [])

  return (
    <>
      <UnsavedNavigationGuard when={editable && (siteFormDirty || voiceDirty)} />
      {header}
      {!editable ? <p className="text-sm text-muted-foreground">Only the owner can change these.</p> : null}
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          void navigate({
            to: '/dashboard/settings',
            search: { ok: undefined, error: undefined, tab: value === 'site' ? undefined : value },
          })
        }
        className="gap-8"
      >
        <PageTabs label="Settings sections" tabs={tabs.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))} />

        <TabsContent value="site">
          <form
            key={siteFormRevision}
            className="grid max-w-2xl gap-8"
            onChange={(event) => { if (editable) markSiteDirty(event.currentTarget) }}
            onSubmit={(event) => { if (editable) void handleSiteSave(event); else event.preventDefault() }}
          >
            <fieldset disabled={!editable} className="contents">
            {siteChangedElsewhere ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-warning-foreground">
                <span>Settings changed elsewhere, reload.</span>
                <Button type="button" variant="outline" size="sm" onClick={discardSite}>Reload settings</Button>
              </div>
            ) : null}
            <Section title="Your blog">
              <Field>
                <FieldLabel htmlFor="site-name">Name</FieldLabel>
                <Input id="site-name" name="name" required maxLength={80} defaultValue={site.name} />
              </Field>
              <Field>
                <FieldLabel htmlFor="site-description">Description</FieldLabel>
                <Textarea id="site-description" name="description" maxLength={220} rows={3} defaultValue={site.description} />
                <FieldHint>One or two sentences. Shown on your blog’s home page.</FieldHint>
              </Field>
              {(['Logo', 'Favicon'] as const).map((label) => {
                const id = label === 'Logo' ? 'logoAssetId' : 'faviconAssetId'
                const value = label === 'Logo' ? selectedLogoAssetId : selectedFaviconAssetId
                const selected = data.assets.find((asset) => asset.id === value)
                return <Field key={id}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Select id={id} name={id} value={value} onChange={(event) => label === 'Logo' ? setSelectedLogoAssetId(event.target.value) : setSelectedFaviconAssetId(event.target.value)}>
                    <option value="">No {label.toLowerCase()}</option>
                    {data.assets.filter((asset) => asset.mimeType.startsWith('image/')).map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
                  </Select>
                  {selected ? <img src={`/media-assets/${selected.id}`} alt="" className="h-12 w-20 object-contain" /> : null}
                </Field>
              })}
              {defaultAddress ? (
                <div className="grid gap-1.5">
                  <p className="text-sm font-medium text-foreground">Address</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <a href={defaultAddress} target="_blank" rel="noopener" className="font-mono text-foreground underline-offset-4 hover:underline">
                      {defaultAddress.replace(/^https?:\/\//, '')}
                    </a>
                    {isOwner ? (
                      <Link
                        to="/dashboard/settings"
                        search={{ ok: undefined, error: undefined, tab: 'domain' }}
                        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        Use your own domain
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Links" description="Add links to your blog navigation and footer.">
              <Field>
                <FieldLabel>Navigation links</FieldLabel>
                <FieldHint>Shown after All posts. Up to 6 links.</FieldHint>
                {navLinks.map((link, index) => {
                  const result = navLinksSchema.element.safeParse(link)
                  const labelError = result.success || !(linksAttempted || link.label.trim()) ? null : result.error.issues.find((issue) => issue.path[0] === 'label')?.message
                  const urlError = result.success || !(linksAttempted || link.url.trim()) ? null : result.error.issues.find((issue) => issue.path[0] === 'url')?.message
                  return <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
                    <div><Input aria-label={`Navigation ${index + 1} label`} placeholder="Label" value={link.label} maxLength={40} aria-invalid={!!labelError} aria-describedby={labelError ? `nav-label-error-${index}` : undefined} onChange={(event) => setNavLinks((rows) => rows.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} />{labelError ? <p id={`nav-label-error-${index}`} className="text-sm text-destructive">{labelError}</p> : null}</div>
                    <div><Input aria-label={`Navigation ${index + 1} URL`} placeholder="/about or https://…" value={link.url} aria-invalid={!!urlError} aria-describedby={urlError ? `nav-url-error-${index}` : undefined} onChange={(event) => setNavLinks((rows) => rows.map((row, i) => i === index ? { ...row, url: event.target.value } : row))} />{urlError ? <p id={`nav-url-error-${index}`} className="text-sm text-destructive">{urlError}</p> : null}</div>
                    <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Move navigation ${index + 1} up`} disabled={index === 0} onClick={() => setNavLinks((rows) => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next })}><ArrowUp aria-hidden /></Button><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Move navigation ${index + 1} down`} disabled={index === navLinks.length - 1} onClick={() => setNavLinks((rows) => { const next = [...rows]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next })}><ArrowDown aria-hidden /></Button><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Remove navigation ${index + 1}`} onClick={() => setNavLinks((rows) => rows.filter((_, i) => i !== index))}><X aria-hidden /></Button></div>
                  </div>
                })}
                <div><Button type="button" variant="outline" size="sm" disabled={navLinks.length >= 6} onClick={() => setNavLinks((rows) => [...rows, { label: '', url: '' }])}><Plus aria-hidden data-icon="inline-start" /> Add link</Button></div>
              </Field>
              <Field>
                <FieldLabel>Social links</FieldLabel>
                <FieldHint>Shown as icon links in the footer. Up to 8 links.</FieldHint>
                {socialLinks.map((link, index) => {
                  const result = socialLinksSchema.element.safeParse(link)
                  const urlError = result.success || !(linksAttempted || link.url.trim()) ? null : result.error.issues.find((issue) => issue.path[0] === 'url' || issue.path.length === 0)?.message
                  return <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                    <Select aria-label={`Social ${index + 1} kind`} value={link.kind} onChange={(event) => setSocialLinks((rows) => rows.map((row, i) => i === index ? { ...row, kind: socialKindSchema.parse(event.target.value) } : row))}>{socialKindSchema.options.map((kind) => <option key={kind} value={kind}>{SOCIAL_KIND_LABELS[kind]}</option>)}</Select>
                    <div><Input aria-label={`Social ${index + 1} URL`} placeholder={link.kind === 'email' ? 'hello@example.com' : 'https://…'} value={link.url} aria-invalid={!!urlError} aria-describedby={urlError ? `social-url-error-${index}` : undefined} onChange={(event) => setSocialLinks((rows) => rows.map((row, i) => i === index ? { ...row, url: event.target.value } : row))} />{urlError ? <p id={`social-url-error-${index}`} className="text-sm text-destructive">{urlError}</p> : null}</div>
                    <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Move social ${index + 1} up`} disabled={index === 0} onClick={() => setSocialLinks((rows) => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next })}><ArrowUp aria-hidden /></Button><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Move social ${index + 1} down`} disabled={index === socialLinks.length - 1} onClick={() => setSocialLinks((rows) => { const next = [...rows]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next })}><ArrowDown aria-hidden /></Button><Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Remove social ${index + 1}`} onClick={() => setSocialLinks((rows) => rows.filter((_, i) => i !== index))}><X aria-hidden /></Button></div>
                  </div>
                })}
                <div><Button type="button" variant="outline" size="sm" disabled={socialLinks.length >= 8} onClick={() => setSocialLinks((rows) => [...rows, { kind: 'website', url: '' }])}><Plus aria-hidden data-icon="inline-start" /> Add social link</Button></div>
              </Field>
            </Section>

            <Section title="Byline">
              <Field>
                <FieldLabel htmlFor="site-byline-name">Public name</FieldLabel>
                <Input
                  id="site-byline-name"
                  name="bylineName"
                  maxLength={80}
                  autoComplete="name"
                  placeholder={site.name}
                  defaultValue={site.bylineName}
                  aria-describedby="site-byline-name-help"
                />
                <FieldHint id="site-byline-name-help">Shown as the author on your posts. Your email is never shown.</FieldHint>
              </Field>
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <FieldLabel htmlFor="site-agent-credit">Credit your agent</FieldLabel>
                  <FieldHint id="site-agent-credit-help">
                    Agent-written posts show “Agent-written · Reviewed by {site.bylineName || site.name}”.
                  </FieldHint>
                </div>
                <Switch
                  id="site-agent-credit"
                  checked={agentCredit}
                  onCheckedChange={setAgentCredit}
                  aria-describedby="site-agent-credit-help"
                />
              </div>
            </Section>

            <Section title="Search and sharing" description="Defaults for search results and link previews. Each post can override them.">
              <Field>
                <FieldLabel htmlFor="default-seo-title">Title</FieldLabel>
                <Input id="default-seo-title" name="defaultSeoTitle" required maxLength={120} defaultValue={site.defaultSeoTitle} aria-describedby="default-seo-title-help" />
                <FieldHint id="default-seo-title-help">Shown in search results and browser tabs for your home page. Usually your blog name.</FieldHint>
              </Field>
              <Field>
                <FieldLabel htmlFor="default-seo-description">Description</FieldLabel>
                <Textarea
                  id="default-seo-description"
                  name="defaultSeoDescription"
                  maxLength={220}
                  rows={3}
                  defaultValue={site.defaultSeoDescription}
                  placeholder={site.description || undefined}
                  aria-describedby="default-seo-description-help"
                />
                <FieldHint id="default-seo-description-help">Leave empty to use your blog description.</FieldHint>
              </Field>
              <Field>
                <FieldLabel htmlFor="default-social-image">Share image</FieldLabel>
                <Select
                  id="default-social-image"
                  name="defaultSocialAssetId"
                  value={selectedSocialAssetId}
                  onChange={(event) => setSelectedSocialAssetId(event.currentTarget.value)}
                  aria-describedby="default-social-image-help"
                >
                  <option value="">Generated from your theme</option>
                  {data.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.filename}
                      {asset.altText ? '' : ' (needs alt text)'}
                    </option>
                  ))}
                </Select>
                <FieldHint id="default-social-image-help">
                  Used when a post has no cover. Without one, each post gets a card in your theme. 1200 × 630 works best.{' '}
                  <Link to="/dashboard/media" search={emptyDashboardStatusSearch} className="text-foreground underline underline-offset-4">
                    Manage images
                  </Link>
                </FieldHint>
                {selectedSocialAsset ? (
                  <div className="flex min-w-0 items-center gap-3 pt-1">
                    <img
                      src={`/media-assets/${selectedSocialAsset.id}`}
                      alt={selectedSocialAsset.altText ?? ''}
                      className="h-16 w-28 shrink-0 rounded-md border border-border object-cover"
                    />
                    {!selectedSocialAsset.altText ? (
                      <p className="text-sm text-destructive">Add alt text to this image in Media before saving.</p>
                    ) : null}
                  </div>
                ) : null}
              </Field>
            </Section>

            </fieldset>
            {editable ? <SaveRow
              dirty={siteFormDirty}
              pending={formPending === 'site'}
              disabled={Boolean(selectedSocialAsset && !selectedSocialAsset.altText)}
              onDiscard={discardSite}
            /> : null}
          </form>
        </TabsContent>

        <TabsContent value="voice">
          <form className="grid max-w-2xl gap-8" onSubmit={(event) => { if (editable) void handleVoiceProfileSave(event); else event.preventDefault() }}>
            <fieldset disabled={!editable} className="contents">
            <Section
              title="How your agents write"
              description={
                data.voiceProfile.configured
                  ? 'Agents read this before every draft.'
                  : 'Without this, agents write clearly and plainly: one idea per section, concrete examples, a useful ending. Add your own voice below.'
              }
            >
              <Field>
                <FieldLabel htmlFor="voice-audience">Who reads this blog</FieldLabel>
                <Textarea
                  id="voice-audience"
                  value={voiceAudience}
                  onChange={(e) => {
                    setVoiceDirty(true)
                    voiceCurrent.current = { ...voiceCurrent.current, audience: e.target.value }
                    setVoiceAudience(e.target.value)
                  }}
                  maxLength={300}
                  rows={2}
                  placeholder="e.g. Engineers who run small SaaS products"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="voice-summary">Tone</FieldLabel>
                <Textarea
                  id="voice-summary"
                  value={voiceSummary}
                  onChange={(e) => {
                    setVoiceDirty(true)
                    voiceCurrent.current = { ...voiceCurrent.current, voiceSummary: e.target.value }
                    setVoiceSummary(e.target.value)
                  }}
                  maxLength={500}
                  rows={3}
                  placeholder="e.g. Calm, specific, practical. Lead with the useful detail."
                />
              </Field>
            </Section>

            <Section title="Rules" description={`One per line, up to ${VOICE_RULE_LIMIT} in total.`}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="voice-prefer-rules">Do</FieldLabel>
                  <Textarea
                    id="voice-prefer-rules"
                    value={voicePreferText}
                    onChange={(e) => {
                      setVoiceDirty(true)
                      voiceCurrent.current = { ...voiceCurrent.current, preferText: e.target.value }
                      setVoicePreferText(e.target.value)
                    }}
                    aria-describedby={voicePreferDescribedBy}
                    aria-invalid={!voiceValidation.prefer.isValid}
                    rows={5}
                    placeholder={'e.g. Use short sentences\nShow a real example'}
                  />
                  <FieldHint id="voice-prefer-help">{voiceValidation.prefer.ruleCount} rules</FieldHint>
                  {voiceValidation.prefer.lineNumbers.length > 0 ? (
                    <p id="voice-prefer-line-error" role="alert" className="text-sm text-destructive">
                      Shorten line{voiceValidation.prefer.lineNumbers.length === 1 ? '' : 's'} {voiceValidation.prefer.lineNumbers.join(', ')} to {VOICE_RULE_LINE_LIMIT} characters or fewer.
                    </p>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="voice-avoid-rules">Don’t</FieldLabel>
                  <Textarea
                    id="voice-avoid-rules"
                    value={voiceAvoidText}
                    onChange={(e) => {
                      setVoiceDirty(true)
                      voiceCurrent.current = { ...voiceCurrent.current, avoidText: e.target.value }
                      setVoiceAvoidText(e.target.value)
                    }}
                    aria-describedby={voiceAvoidDescribedBy}
                    aria-invalid={!voiceValidation.avoid.isValid}
                    rows={5}
                    placeholder={'e.g. No buzzwords\nNo exclamation marks'}
                  />
                  <FieldHint id="voice-avoid-help">{voiceValidation.avoid.ruleCount} rules</FieldHint>
                  {voiceValidation.avoid.lineNumbers.length > 0 ? (
                    <p id="voice-avoid-line-error" role="alert" className="text-sm text-destructive">
                      Shorten line{voiceValidation.avoid.lineNumbers.length === 1 ? '' : 's'} {voiceValidation.avoid.lineNumbers.join(', ')} to {VOICE_RULE_LINE_LIMIT} characters or fewer.
                    </p>
                  ) : null}
                </Field>
              </div>
              {voiceValidation.ruleCount > VOICE_RULE_LIMIT ? (
                <p id="voice-rule-count-error" role="alert" className="text-sm text-destructive">
                  {voiceValidation.ruleCount} rules. Keep it to {VOICE_RULE_LIMIT} or fewer.
                </p>
              ) : null}
            </Section>

            <Section title="Example posts" description="Pick up to three published posts that sound like you. Agents read them for tone.">
              <FieldSet className="gap-0">
                <FieldLegend className="sr-only">Example posts</FieldLegend>
                {data.voiceProfile.publishedPosts.length > 0 || voiceRepresentativeIds.length > 0 ? (
                  <div className="grid max-h-80 overflow-y-auto">
                    {data.voiceProfile.publishedPosts.map((post) => (
                      <Field
                        key={post.id}
                        orientation="horizontal"
                        className="border-b border-[color:var(--hairline)] py-3 last:border-b-0"
                      >
                        <Checkbox
                          id={`post-${post.id}`}
                          checked={voiceRepresentativeIds.includes(post.id)}
                          onCheckedChange={(checked) => {
                            if (checked === 'indeterminate') return
                            setVoiceDirty(true)
                            const next = selectRepresentativePost(voiceRepresentativeIds, post.id, checked)
                            voiceCurrent.current = { ...voiceCurrent.current, representativeIds: next }
                            setVoiceRepresentativeIds(next)
                          }}
                          disabled={!editable || (!voiceRepresentativeIds.includes(post.id) && voiceRepresentativeIds.length >= REPRESENTATIVE_POST_LIMIT)}
                          className="mt-1"
                        />
                        <label htmlFor={`post-${post.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-[0.9375rem] text-foreground">{post.title}</span>
                          <span className="block truncate font-mono text-sm text-muted-foreground">/{post.slug}</span>
                        </label>
                      </Field>
                    ))}
                    {voiceRepresentativeIds
                      .filter((id) => !data.voiceProfile.publishedPosts.some((post) => post.id === id))
                      .map((staleId) => (
                        <Field key={staleId} orientation="horizontal" className="py-3">
                          <Checkbox
                            id={`post-${staleId}`}
                            checked
                            onCheckedChange={(checked) => {
                              if (!checked) {
                                setVoiceDirty(true)
                                const next = voiceRepresentativeIds.filter((id) => id !== staleId)
                                voiceCurrent.current = { ...voiceCurrent.current, representativeIds: next }
                                setVoiceRepresentativeIds(next)
                              }
                            }}
                            className="mt-1"
                          />
                          <label htmlFor={`post-${staleId}`} className="min-w-0 flex-1 cursor-pointer text-[0.9375rem] text-muted-foreground">
                            A post that’s no longer published
                          </label>
                        </Field>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Publish a post first, then pick it here.</p>
                )}
              </FieldSet>
            </Section>

            {data.voiceProfile.warnings.length > 0 ? (
              <Alert variant="warning" title="Worth a look">
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {data.voiceProfile.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            </fieldset>
            {editable ? <SaveRow
              dirty={voiceDirty}
              pending={formPending === 'voice'}
              disabled={!voiceValidation.isValid}
              onDiscard={() => {
                seedVoice(data.voiceProfile)
                setVoiceDirty(false)
              }}
            >
              {data.voiceProfile.configured && !voiceDirty ? (
                <SpaConfirmButton
                  type="button"
                  variant="ghost"
                  confirmLabel="Reset voice"
                  helperText="Agents go back to the default voice."
                  onConfirm={() => void handleVoiceProfileClear()}
                  className="text-muted-foreground"
                >
                  <RotateCcw aria-hidden data-icon="inline-start" /> Reset to default
                </SpaConfirmButton>
              ) : null}
            </SaveRow> : null}
          </form>
        </TabsContent>

        {isOwner ? (
          <TabsContent value="domain" className="grid max-w-2xl gap-10">
            <Section title="Your blog’s address">
              {defaultAddress ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 truncate font-mono text-[0.9375rem] text-foreground">
                    {defaultAddress.replace(/^https?:\/\//, '')}
                  </code>
                  <CopyButton value={defaultAddress} label="Copy address" copiedLabel="Copied" iconOnly variant="ghost" className="size-8" />
                  <Button asChild variant="ghost" size="sm">
                    <a href={defaultAddress} target="_blank" rel="noopener">
                      <ExternalLink aria-hidden data-icon="inline-start" /> Open
                    </a>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Your address appears here once your blog is set up.</p>
              )}
            </Section>

            <Section
              title="Your own domain"
              description="Serve the blog from a domain you own, like blog.example.com. HTTPS is set up for you."
              action={
                customDomains.domains.length ? (
                  <Button type="button" variant="ghost" size="sm" disabled={refreshingDomains} onClick={() => void handleRefreshDomains()}>
                    <RefreshCw aria-hidden data-icon="inline-start" className={refreshingDomains ? 'animate-spin' : undefined} />
                    {refreshingDomains ? 'Checking…' : 'Check again'}
                  </Button>
                ) : undefined
              }
            >
              {domainLocked ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
                  <LockKeyhole aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <p className="flex-1 text-sm text-muted-foreground">Custom domains are part of the paid plan.</p>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
                      See plans
                    </Link>
                  </Button>
                </div>
              ) : customDomains.domains.length === 0 ? (
                <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void handleAddDomain(event)}>
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor="domain-hostname">Domain</FieldLabel>
                    <Input id="domain-hostname" name="hostname" placeholder="blog.example.com" autoComplete="off" spellCheck={false} required />
                  </Field>
                  <PendingSubmitButton pending={formPending === 'domain'} pendingText="Adding…">
                    <Plus aria-hidden data-icon="inline-start" /> Add domain
                  </PendingSubmitButton>
                </form>
              ) : null}

              {customDomains.domains.length ? (
                <ul className="grid gap-6">
                  {customDomains.domains.map((domain) => (
                    <li key={domain.id} className="grid gap-3 rounded-xl border border-border p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Globe2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                          <strong className="break-all font-medium text-foreground">{domain.hostname}</strong>
                          <StatusBadge status={domain.status} />
                        </div>
                        <SpaConfirmButton
                          size="sm"
                          variant="ghost"
                          confirmLabel="Remove domain"
                          helperText="Your blog stops answering on this domain."
                          disabled={removeDomainPending === domain.id}
                          onConfirm={() => handleRemoveDomain(domain.id)}
                          className="text-muted-foreground"
                        >
                          Remove
                        </SpaConfirmButton>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{DOMAIN_STATUS_COPY[domain.status]}</p>
                      {domain.status !== 'active' && customDomains.cnameTarget ? (
                        <>
                          <p className="text-sm text-foreground">Add this record at your DNS provider:</p>
                          <DnsRecord hostname={domain.hostname} target={customDomains.cnameTarget} />
                          <p className="text-sm leading-6 text-muted-foreground">
                            On Cloudflare, set the record to DNS only (grey cloud). For a root domain like example.com, use your provider’s CNAME flattening or ALIAS record.
                          </p>
                        </>
                      ) : null}
                      {domain.verificationErrors.length && domain.status !== 'active' ? (
                        <ul className="grid gap-1 text-sm text-destructive">
                          {domain.verificationErrors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          </TabsContent>
        ) : null}

        <TabsContent value="billing">{activeTab === 'billing' ? <PlanAndBilling /> : null}</TabsContent>

        {isOwner ? (
          <TabsContent value="export" className="max-w-2xl">
            <Section
              title="Export posts"
              description="Download every post (drafts, published, and archived) as one JSON file. Your writing is yours."
            >
              <Button asChild variant="outline" className="w-fit">
                <a href="/api/export.json" download>
                  <Download aria-hidden data-icon="inline-start" /> Download posts
                </a>
              </Button>
            </Section>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  )
}
