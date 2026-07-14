'use client'

import {
  ACCENTS,
  DEFAULT_PRESET_ID,
  ENTITLEMENTS,
  FONTS,
  MEDIA,
  PRESET_IDS,
  PRICING,
  STARTER_LOOKS,
  THEME_MODES,
  THEME_PRESETS,
  type AccentId,
  type FontId,
  type StarterLook,
  type StarterLookId,
  type ThemeMode,
  type PresetId,
} from '@vc/config'
import type { CustomDomainsPanel, CustomDomainView } from '~/types/dashboard'
import { DownloadIcon, GlobeIcon } from '@radix-ui/react-icons'
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Textarea,
  cn,
} from '@vc/ui'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { renderRichContent, RichContentFrame } from '@vc/content'
import {
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '~/components/dashboard/DashboardLayout'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  addCustomDomainMutation,
  removeCustomDomainMutation,
  loadSettingsPage,
  updateSiteSettingsMutation,
  updateVoiceProfileMutation,
  clearVoiceProfileMutation,
} from '~/lib/api-client'
import type { VoiceProfileSettings } from '~/types/dashboard'
import type { z } from 'zod'
import { settingsPageDataSchema } from '~/lib/dashboard-response-schemas'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
type SettingsPageData = {
  site: SiteSettingsForm
  customDomains: CustomDomainsPanel
  billingStatus: string
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
  if (status === 'active') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

function DomainStatusBadge({ status }: { status: CustomDomainView['status'] }) {
  if (status === 'active') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        Active
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 capitalize text-destructive">
        failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Canonical markdown sample - exercises the full renderer vocabulary.
// Computed once at module load; safe because renderRichContent is synchronous.
// ---------------------------------------------------------------------------
const CANONICAL_SAMPLE_MD = `## Sample heading

[[toc]]

### Introduction

Write compelling posts with **bold text**, *italic text*, and [links](https://example.com).

> [!NOTE]
> Notes add context without interrupting the narrative.

> [!TIP]
> Tips help readers get the most from their reading.

> [!WARNING]
> Warnings flag important caveats or breaking changes.

### Code block

\`\`\`ts
export async function getPost(id: string) {
  return db.posts.findById(id)
}
\`\`\`

### Media

![A sample blog header image](https://picsum.photos/seed/vc/800/400)
*Caption: a hero image sets the tone for every preset.*

### Comparison table

| Preset | Density | Best for |
| ------ | ------- | -------- |
| Minimal | Airy | General writing |
| Editorial | Comfortable | Narrative |
`
const SAMPLE_RENDER = renderRichContent(CANONICAL_SAMPLE_MD)

export function SettingsPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/dashboard/settings' })
  const [data, setData] = useState<SettingsPageData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeDomainPending, setRemoveDomainPending] = useState<string | null>(null)
  const [formPending, setFormPending] = useState<'site' | 'theme' | 'appearance' | 'domain' | 'voice' | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<PresetId>(DEFAULT_PRESET_ID)
  const [previewMode, setPreviewMode] = useState<'light' | 'dark' | 'system'>('system')
  const [selectedAccent, setSelectedAccent] = useState<AccentId>('teal')
  const [selectedFont, setSelectedFont] = useState<FontId>('geist-sans')
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('system')
  const [voiceAudience, setVoiceAudience] = useState('')
  const [voiceSummary, setVoiceSummary] = useState('')
  const [voicePreferText, setVoicePreferText] = useState('')
  const [voiceAvoidText, setVoiceAvoidText] = useState('')
  const [voiceRepresentativeIds, setVoiceRepresentativeIds] = useState<string[]>([])
  const [voiceSaveStatus, setVoiceSaveStatus] = useState<string | null>(null)

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


  async function handleSiteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setFormPending('site')
    try {
      const result = await updateSiteSettingsMutation({
          name: String(form.get('name') ?? ''),
          description: String(form.get('description') ?? '') || undefined,
          defaultSeoTitle: String(form.get('defaultSeoTitle') ?? ''),
          defaultSeoDescription: String(form.get('defaultSeoDescription') ?? '') || undefined,
          theme: data?.site.theme ?? selectedTheme,
          themeAccent: data?.site.themeAccent,
          themeFont: data?.site.themeFont,
          themeMode: data?.site.themeMode,
      })
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.kind === 'ok' ? result.code : undefined, error: result.kind === 'ok' ? undefined : result.code, tab: prev.tab }),
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
          themeAccent: data.site.themeAccent,
          themeFont: data.site.themeFont,
          themeMode: data.site.themeMode,
      })
      if (result.kind === 'ok') {
        setData((prev) => prev ? { ...prev, site: { ...prev.site, theme: selectedTheme } } : prev)
      }
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.kind === 'ok' ? result.code : undefined, error: result.kind === 'ok' ? undefined : result.code, tab: prev.tab }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleAppearanceSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    setFormPending('appearance')
    try {
      const result = await updateSiteSettingsMutation({
          name: data.site.name,
          description: data.site.description || undefined,
          defaultSeoTitle: data.site.defaultSeoTitle,
          defaultSeoDescription: data.site.defaultSeoDescription || undefined,
          theme: data.site.theme,
          themeAccent: selectedAccent,
          themeFont: selectedFont,
          themeMode: selectedMode,
      })
      if (result.kind === 'ok') {
        setData((prev) => prev ? { ...prev, site: { ...prev.site, themeAccent: selectedAccent, themeFont: selectedFont, themeMode: selectedMode } } : prev)
      }
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.kind === 'ok' ? result.code : undefined, error: result.kind === 'ok' ? undefined : result.code, tab: prev.tab }),
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
      if (result.ok) {
        const refreshed = await loadSettingsPage()
        setData(narrowSettingsPageData(refreshed))
      }
      await navigate({
        to: '/dashboard/settings',
        search: (prev) => ({ ok: result.ok ? 'domain_added' : undefined, error: result.ok ? undefined : result.code, tab: prev.tab }),
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
    } finally {
      setRemoveDomainPending(null)
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
      }
      await navigate({
        to: '/dashboard/settings',
        search: {
          ok: result.kind === 'ok' ? result.code : undefined,
          error: result.kind === 'ok' ? undefined : result.code,
          tab: 'voice',
        },
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
        setVoiceSaveStatus('Voice profile cleared. Agents will use your published work without this guidance.')
      }
      await navigate({
        to: '/dashboard/settings',
        search: {
          ok: result.kind === 'ok' ? result.code : undefined,
          error: result.kind === 'ok' ? undefined : result.code,
          tab: 'voice',
        },
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

  const { site, customDomains, billingStatus, selfHosted, isOwner } = data

  return (
    <>
      <PageHeader
        kicker="Settings"
        title="Workspace Settings"
        description="Set publication defaults, editorial voice, domains, billing, and portable data."
      />
      <Tabs
        value={search.tab ?? 'general'}
        onValueChange={(value) => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: value === 'general' ? undefined : value }})}
        className="gap-4"
      >
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="Workspace settings sections" className="min-w-max">
            <TabsTrigger value="general" aria-label="Publication settings" className="data-[state=active]:font-semibold">
              Publication
            </TabsTrigger>
            <TabsTrigger value="voice" aria-label="Voice Profile settings" className="data-[state=active]:font-semibold">
              Voice Profile
            </TabsTrigger>
            <TabsTrigger value="domain" aria-label="Domain and DNS settings" className="data-[state=active]:font-semibold">
              Domain &amp; DNS
            </TabsTrigger>
            <TabsTrigger value="billing" aria-label="Plan and billing settings" className="data-[state=active]:font-semibold">
              Plan &amp; billing
            </TabsTrigger>
            <TabsTrigger value="data" aria-label="Export and data settings" className="data-[state=active]:font-semibold">
              Export &amp; data
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
            <FieldLabel htmlFor="default-seo-title">Default SEO title</FieldLabel>
            <Input id="default-seo-title" name="defaultSeoTitle" required maxLength={120} defaultValue={site.defaultSeoTitle} />
          </Field>
          <Field>
            <FieldLabel htmlFor="default-seo-description">Default SEO description</FieldLabel>
            <Textarea
              id="default-seo-description"
              name="defaultSeoDescription"
              maxLength={220}
              rows={3}
              defaultValue={site.defaultSeoDescription}
            />
          </Field>
          <PendingSubmitButton className="w-fit" pending={formPending === 'site'} pendingText="Saving…">
            Save site settings
          </PendingSubmitButton>
        </form>
      </Panel>
      <Panel title="Public blog" meta="Theme">
        <p className="mb-4 font-sans text-sm text-muted-foreground">
          Changes public blog appearance and future agent guidance. Does not rewrite existing content.
        </p>
        <form className="grid gap-4" onSubmit={(e) => void handleThemeSave(e)}>
          <FieldSet>
            <FieldLegend className="sr-only">Preset</FieldLegend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESET_IDS.map((id) => {
                const preset = THEME_PRESETS[id]
                const isCurrent = site.theme === id
                const isDefault = id === DEFAULT_PRESET_ID
                return (
                  <Field
                    key={id}
                    orientation="horizontal"
                    className={cn(
                      'rounded-xl bg-muted/50 p-3 transition-colors hover:bg-muted',
                      'has-[:checked]:ring-1 has-[:checked]:ring-brand-bright/40',
                    )}
                  >
                    <input
                      id={`theme-${id}`}
                      className="mt-1 accent-[var(--brand-bright)]"
                      type="radio"
                      name="theme"
                      value={id}
                      checked={selectedTheme === id}
                      onChange={() => setSelectedTheme(id)}
                    />
                    <span>
                      <FieldLabel
                        htmlFor={`theme-${id}`}
                        className="flex flex-wrap items-center gap-1.5 font-display text-sm font-medium"
                      >
                        {preset.name}
                        {isCurrent && (
                          <Badge className="gap-1 border-brand-bright/30 bg-brand-bright/10 text-primary text-[0.65rem]">
                            Current live theme
                          </Badge>
                        )}
                        {isDefault && (
                          <Badge variant="outline" className="font-mono text-[0.65rem]">
                            Default
                          </Badge>
                        )}
                      </FieldLabel>
                      <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                        {preset.designIntent}
                      </span>
                    </span>
                  </Field>
                )
              })}
            </div>
          </FieldSet>
          {selectedTheme !== site.theme && (
            <p className="font-sans text-xs text-amber-600 dark:text-amber-400">
              Theme not yet saved.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <PendingSubmitButton className="w-fit" pending={formPending === 'theme'} pendingText="Saving theme...">
              Save theme
            </PendingSubmitButton>
            {data.publicBaseUrl ? (
              <Button asChild variant="outline">
                <a href={data.publicBaseUrl} target="_blank" rel="noopener noreferrer">
                  View public blog
                </a>
              </Button>
            ) : null}
          </div>
        </form>
        <div className="mt-6 rounded-2xl border bg-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xs font-medium text-muted-foreground">
              Illustrative preview
            </p>
            <div className="flex gap-1 rounded-lg border bg-background p-0.5 text-xs">
              {(['light', 'system', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'rounded-md px-2 py-1 capitalize transition-colors',
                    previewMode === mode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <RichContentFrame node={SAMPLE_RENDER.node} presetId={selectedTheme} mode={previewMode} />
          </div>
        </div>
      </Panel>
      <Panel title="Appearance" meta="Accent, font & mode">
        <p className="mb-4 font-sans text-sm text-muted-foreground">
          Customize your blog's accent color, typeface, and light/dark mode. Applies to the public blog only and does not rewrite existing content.
        </p>
        <form className="grid gap-5" onSubmit={(e) => void handleAppearanceSave(e)}>
          <FieldSet>
            <FieldLegend variant="label">Starter looks</FieldLegend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STARTER_LOOKS) as StarterLookId[]).map((id) => {
                const look: StarterLook = STARTER_LOOKS[id]
                const isActive =
                  selectedAccent === look.accent &&
                  (look.font === undefined || selectedFont === look.font)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSelectedAccent(look.accent)
                      if (look.font) setSelectedFont(look.font)
                    }}
                    aria-pressed={isActive}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 font-sans text-sm capitalize transition-colors',
                      isActive
                        ? 'border-brand-bright/40 bg-brand-bright/10 text-primary'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {id}
                  </button>
                )
              })}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Accent color</FieldLegend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACCENTS.map((accent) => {
                const isSelected = selectedAccent === accent.id
                return (
                  <Field
                    key={accent.id}
                    orientation="horizontal"
                    className={cn(
                      'cursor-pointer rounded-xl bg-muted/50 p-3 transition-colors hover:bg-muted',
                      'has-[:checked]:ring-1 has-[:checked]:ring-brand-bright/40',
                    )}
                  >
                    <input
                      id={`accent-${accent.id}`}
                      className="sr-only"
                      type="radio"
                      name="accent"
                      value={accent.id}
                      checked={isSelected}
                      onChange={() => setSelectedAccent(accent.id)}
                    />
                    <span
                      aria-hidden
                      className="h-5 w-5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: accent.oklchLight }}
                    />
                    <FieldLabel
                      htmlFor={`accent-${accent.id}`}
                      className="font-sans text-sm font-medium"
                    >
                      {accent.name}
                    </FieldLabel>
                  </Field>
                )
              })}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Font</FieldLegend>
            <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-0.5">
              {FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => setSelectedFont(font.id)}
                  aria-pressed={selectedFont === font.id}
                  className={cn(
                    'rounded-md px-3 py-1.5 font-sans text-sm transition-colors',
                    selectedFont === font.id
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {font.name}
                </button>
              ))}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Mode</FieldLegend>
            <div className="flex flex-wrap gap-1 rounded-lg border bg-background p-0.5">
              {THEME_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelectedMode(mode)}
                  aria-pressed={selectedMode === mode}
                  className={cn(
                    'rounded-md px-3 py-1.5 font-sans text-sm capitalize transition-colors',
                    selectedMode === mode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </FieldSet>
          {(selectedAccent !== site.themeAccent ||
            selectedFont !== site.themeFont ||
            selectedMode !== site.themeMode) && (
            <p className="font-sans text-xs text-amber-600 dark:text-amber-400">
              Appearance changes not yet saved.
            </p>
          )}
          <PendingSubmitButton className="w-fit" pending={formPending === 'appearance'} pendingText="Saving appearance...">
            Save appearance
          </PendingSubmitButton>
        </form>
      </Panel>
        </TabsContent>
        <TabsContent value="voice" className="grid gap-4">
          <Panel title="Voice Profile" meta="Editorial guidance for agents">
            <p className="mb-4 max-w-2xl font-sans text-sm text-muted-foreground">
              Set the editorial guardrails agents use when drafting for this publication. They can read this profile; only workspace editors can change it.
            </p>
            <form className="grid max-w-3xl gap-5" onSubmit={(e) => void handleVoiceProfileSave(e)}>
              <Field>
                <FieldLabel htmlFor="voice-audience">Reader in view</FieldLabel>
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
                <FieldLabel htmlFor="voice-summary">Editorial character</FieldLabel>
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
                <FieldLegend variant="label">Editorial rules</FieldLegend>
                <p className="mb-3 font-sans text-xs text-muted-foreground">
                  One rule per line, up to {VOICE_RULE_LIMIT} rules across both lists. Each non-blank line can be up to {VOICE_RULE_LINE_LIMIT} characters; blank lines stay in place while you edit.
                </p>
                <div className="space-y-3">
                  <div>
                    <FieldLabel htmlFor="voice-prefer-rules" className="text-sm">Prefer</FieldLabel>
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
                    <FieldLabel htmlFor="voice-avoid-rules" className="text-sm">Avoid</FieldLabel>
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
                <FieldLegend variant="label">Representative posts</FieldLegend>
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
                        <input
                          type="checkbox"
                          id={`post-${post.id}`}
                          checked={voiceRepresentativeIds.includes(post.id)}
                          onChange={(e) => {
                            setVoiceSaveStatus(null)
                            setVoiceRepresentativeIds(selectRepresentativePost(voiceRepresentativeIds, post.id, e.target.checked))
                          }}
                          disabled={!voiceRepresentativeIds.includes(post.id) && voiceRepresentativeIds.length >= REPRESENTATIVE_POST_LIMIT}
                          aria-describedby="representative-posts-help"
                          className="mt-1 accent-[var(--brand-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                          <input
                            type="checkbox"
                            id={`post-${staleId}`}
                            checked={true}
                            onChange={(e) => {
                              if (!e.target.checked) {
                                setVoiceSaveStatus(null)
                                setVoiceRepresentativeIds(voiceRepresentativeIds.filter(id => id !== staleId))
                              }
                            }}
                            aria-describedby="representative-posts-help"
                            className="mt-1 accent-[var(--brand-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                  <p className="font-display text-sm font-medium text-amber-900 dark:text-amber-100">Warnings</p>
                  <ul className="mt-2 space-y-1 font-sans text-xs text-amber-800 dark:text-amber-200">
                    {data.voiceProfile.warnings.map((warning, i) => (
                      <li key={i}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <PendingSubmitButton
                  className="w-fit"
                  pending={formPending === 'voice'}
                  pendingText="Saving voice profile..."
                  disabled={!voiceValidation.isValid}
                >
                  Save voice profile
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
                    Clear voice profile
                  </SpaConfirmButton>
                )}
                {voiceSaveStatus && (
                  <p aria-live="polite" className="font-sans text-sm text-muted-foreground">
                    {voiceSaveStatus}
                  </p>
                )}
              </div>
            </form>
          </Panel>
        </TabsContent>
        <TabsContent value="domain" className="grid gap-4">
      {isOwner ? (
        <Panel title="Custom domain" meta="Bring your own domain">
          <p className="mb-4 font-sans text-sm text-muted-foreground">
            Serve your blog on your own domain (for example blog.example.com). Requires an active subscription.
          </p>
          <form className="mb-4 flex max-w-3xl flex-wrap items-end gap-3" onSubmit={(e) => void handleAddDomain(e)}>
            <Field className="flex-1">
              <FieldLabel htmlFor="domain-hostname">Domain</FieldLabel>
              <Input id="domain-hostname" name="hostname" placeholder="blog.example.com" autoComplete="off" required />
            </Field>
            <PendingSubmitButton className="w-fit" pending={formPending === 'domain'} pendingText="Adding…">
              Add domain
            </PendingSubmitButton>
          </form>
          {customDomains.cnameTarget ? (
            <p className="mb-4 font-sans text-xs leading-5 text-muted-foreground">
              After adding, create a CNAME record pointing your domain to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{customDomains.cnameTarget}</code>. We verify and issue SSL automatically.
            </p>
          ) : null}
          {customDomains.domains.length ? (
            <div className="grid gap-3">
              {customDomains.domains.map((domain) => (
                <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4" key={domain.id}>
                  <div className="min-w-0">
                    <strong className="break-words font-display text-foreground">{domain.hostname}</strong>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <DomainStatusBadge status={domain.status} />
                      {domain.verificationErrors.length ? (
                        <span className="font-sans text-xs text-muted-foreground">{domain.verificationErrors[0]}</span>
                      ) : null}
                    </div>
                  </div>
                  <SpaConfirmButton
                    size="sm"
                    confirmLabel="Confirm remove"
                    helperText="Removing stops serving your blog on this domain."
                    disabled={removeDomainPending === domain.id}
                    onConfirm={() => handleRemoveDomain(domain.id)}
                  >
                    Remove
                  </SpaConfirmButton>
                </article>
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
        meta={selfHosted ? <Badge variant="outline">self-hosted</Badge> : <BillingStatusBadge status={billingStatus} />}
      >
        <div className="rounded-2xl bg-muted/50 p-4 md:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-display text-sm font-medium text-foreground">
                {selfHosted
                  ? 'Billing is disabled for this self-hosted workspace'
                  : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}
              </p>
              <p className="mt-2 max-w-2xl font-sans text-sm leading-6 text-muted-foreground">
                {selfHosted
                  ? 'Publishing, media uploads, scoped agent access, activity history, and post versions run on your own Cloudflare resources without Polar checkout.'
                  : `Drafting, agent tokens, and your first published post are free. Subscribe to publish more, upload media, and make posts search-indexable. Media storage is capped at ${MEDIA.paidStorageLabel}.`}
              </p>
            </div>
            {selfHosted ? (
              <Badge variant="outline" className="w-fit font-mono text-[11px] lg:justify-self-end">
                SELF_HOSTED=true
              </Badge>
            ) : isOwner ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button asChild>
                  <Link to="/dashboard/billing" search={emptyDashboardStatusSearch}>Subscribe / manage billing</Link>
                </Button>
              </div>
            ) : (
              <p className="font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
          </div>
        </div>
      </Panel>
        </TabsContent>
        <TabsContent value="data" className="grid gap-4">
      {isOwner ? (
        <Panel title="Your data" meta="Export">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/50 p-4 md:p-5">
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
      <Panel title="Plan Includes" meta={PRICING.planName}>
        <div className="grid gap-2 font-sans text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
          {ENTITLEMENTS.map((entitlement) => (
            <span className="rounded-xl bg-muted/50 px-3 py-2.5 leading-5" key={entitlement}>
              {entitlement}
            </span>
          ))}
        </div>
      </Panel>
        </TabsContent>
      </Tabs>
    </>
  )
}