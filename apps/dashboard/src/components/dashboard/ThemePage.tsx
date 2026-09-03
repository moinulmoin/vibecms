'use client'

import {
  ACCENTS,
  DEFAULT_PRESET_ID,
  FONTS,
  PRESET_IDS,
  resolvePresentation,
  STARTER_LOOKS,
  THEME_MODES,
  THEME_PRESETS,
  type AccentId,
  type FontId,
  type PresetId,
  type ResolvedPresentation,
  type StarterLookId,
  type ThemeMode,
} from '@vc/config'
import { useEffect, useRef, useState } from 'react'
import { renderRichContent, type RenderResult } from '@vc/content'
import { PresentedPostArticle } from '@vc/content/presented-post'
import { PublicPageChrome } from '@vc/content/public-chrome'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { PageHeader, PageSkeleton, Panel, StatusBadge } from '~/components/dashboard/blocks'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { UnsavedNavigationGuard } from '~/components/dashboard/UnsavedNavigationGuard'
import { FieldLegend, FieldSet, cn } from '@vc/ui'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import {
  getPostVersionFn,
  loadPostEditorPage,
  loadPostsPage,
  loadSettingsPage,
  updateSiteSettingsMutation,
} from '~/lib/api-client'

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

function isAccentId(value: string): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value)
}

function isFontId(value: string): value is FontId {
  return FONTS.some((font) => font.id === value)
}

function isThemeMode(value: string): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value)
}

type ThemeSiteBaseline = {
  name: string
  description: string
  slug: string
  defaultSeoTitle: string
  defaultSeoDescription: string
  theme: PresetId
  themeAccent: AccentId
  themeFont: FontId
  themeMode: ThemeMode
  updatedAt: number
  publicBaseUrl: string | null
}

function isPresetId(value: string): value is PresetId {
  return PRESET_IDS.some((id) => id === value)
}

function themeBaselineFromSettings(loaded: Awaited<ReturnType<typeof loadSettingsPage>>): ThemeSiteBaseline {
  const site = loaded.site
  return {
    name: site.name,
    description: site.description ?? '',
    slug: site.slug,
    defaultSeoTitle: site.defaultSeoTitle,
    defaultSeoDescription: site.defaultSeoDescription ?? '',
    theme: isPresetId(site.theme) ? site.theme : DEFAULT_PRESET_ID,
    themeAccent: isAccentId(site.themeAccent) ? site.themeAccent : 'teal',
    themeFont: isFontId(site.themeFont) ? site.themeFont : 'geist-sans',
    themeMode: isThemeMode(site.themeMode) ? site.themeMode : 'system',
    updatedAt: site.updatedAt,
    publicBaseUrl: loaded.publicBaseUrl ?? null,
  }
}

export function ThemePage() {
  const [site, setSite] = useState<ThemeSiteBaseline | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<PresetId>(DEFAULT_PRESET_ID)
  const [selectedAccent, setSelectedAccent] = useState<AccentId>('teal')
  const [selectedFont, setSelectedFont] = useState<FontId>('geist-sans')
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('system')
  const selectedRef = useRef({ theme: selectedTheme, accent: selectedAccent, font: selectedFont, mode: selectedMode })
  selectedRef.current = { theme: selectedTheme, accent: selectedAccent, font: selectedFont, mode: selectedMode }
  // Live preview content: the latest published post when one exists,
  // otherwise the canonical sample. Rendered fresh against the selected
  // theme so the preview is always the real blog, not a mock.
  const [previewArticle, setPreviewArticle] = useState<ThemePreviewArticle>(SAMPLE_PREVIEW_ARTICLE)

  useEffect(() => {
    let cancelled = false
    void loadSettingsPage()
      .then((loaded) => {
        if (cancelled) return
        const baseline = themeBaselineFromSettings(loaded)
        setSite(baseline)
        setSelectedTheme(baseline.theme)
        setSelectedAccent(baseline.themeAccent)
        setSelectedFont(baseline.themeFont)
        setSelectedMode(baseline.themeMode)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load theme.')
      })
    // Pull the most recent published post for the live preview.
    void loadPostsPage({ status: 'published' })
      .then((list) => {
        if (cancelled || list.posts.length === 0) return
        return loadPostEditorPage({ postId: list.posts[0]?.id })
      })
      .then(async (page) => {
        const publishedVersionNumber = page?.post?.publishedVersionNumber
        if (cancelled || !page?.post || publishedVersionNumber == null) return null
        const publishedVersion = await getPostVersionFn({
          postId: page.post.id,
          versionNumber: publishedVersionNumber,
        })
        return { page, post: page.post, publishedVersion }
      })
      .then((published) => {
        if (cancelled || !published?.publishedVersion) return
        const { page, post, publishedVersion } = published
        if (publishedVersion.contentMarkdown) {
          setPreviewArticle({
            renderResult: renderRichContent(publishedVersion.contentMarkdown, { pageTitle: publishedVersion.title }),
            title: publishedVersion.title,
            excerpt: publishedVersion.excerpt ?? 'Published article preview',
            dateText: post.publishedAt
              ? new Date(post.publishedAt * 1000).toLocaleDateString()
              : 'Published article',
            tags: publishedVersion.tags,
            presentation: resolvePresentation(page.presetId, publishedVersion.presentation).resolved,
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

  if (loadError) {
    return (
      <>
        <PageHeader title="Theme" description="Typography, color, and reading experience for your public blog." />
        <LoadError message={loadError} />
      </>
    )
  }

  if (!site) {
    return (
      <>
        <PageHeader title="Theme" description="Typography, color, and reading experience for your public blog." />
        <PageSkeleton />
      </>
    )
  }

  const themeDirty =
    selectedTheme !== site.theme ||
    selectedAccent !== site.themeAccent ||
    selectedFont !== site.themeFont ||
    selectedMode !== site.themeMode

  async function handleThemeSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!site) return
    setSaving(true)
    setSaveError(null)
    let settingsSaved = false
    const submitted = selectedRef.current
    try {
      const result = await updateSiteSettingsMutation({
        expectedUpdatedAt: site.updatedAt,
        theme: submitted.theme,
        themeAccent: submitted.accent,
        themeFont: submitted.font,
        themeMode: submitted.mode,
      })
      if (result.kind === 'ok') {
        settingsSaved = true
        const refreshed = themeBaselineFromSettings(await loadSettingsPage())
        setSite(refreshed)
        if (
          selectedRef.current.theme === submitted.theme
          && selectedRef.current.accent === submitted.accent
          && selectedRef.current.font === submitted.font
          && selectedRef.current.mode === submitted.mode
        ) {
          setSelectedTheme(refreshed.theme)
          setSelectedAccent(refreshed.themeAccent)
          setSelectedFont(refreshed.themeFont)
          setSelectedMode(refreshed.themeMode)
        }
      } else if (result.code === 'settings_conflict') {
        const refreshed = themeBaselineFromSettings(await loadSettingsPage())
        setSite(refreshed)
        setSaveError('The saved theme changed elsewhere. Your choices remain in the preview; review them against the latest settings, then save again.')
      } else {
        setSaveError('Could not save your theme. Try again.')
      }
    } catch {
      setSaveError(settingsSaved
        ? 'Theme saved, but the editor could not refresh its version. Reload before making another change.'
        : 'Could not save your theme. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <UnsavedNavigationGuard when={themeDirty} />
      <PageHeader title="Theme" description="Typography, color, and reading experience for your public blog." />
      <Panel title="Reading experience">
        <p className="mb-6 max-w-3xl font-sans text-base leading-7 text-muted-foreground">
          Set the typography and color system on the left. The right side is the same article shell readers receive, including the masthead, title, metadata, body, and table of contents.
        </p>
        <form
          className="grid gap-6 xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] xl:items-start"
          onSubmit={(e) => void handleThemeSave(e)}
        >
          <div className="grid gap-5 rounded-xl bg-muted/30 p-4 sm:p-5">
            <FieldSet>
              <FieldLegend variant="label">Style</FieldLegend>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_IDS.map((id) => {
                  const preset = THEME_PRESETS[id]
                  const isCurrent = selectedTheme === id
                  const isLive = site.theme === id
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
                        'flex min-h-16 min-w-0 flex-col gap-1 rounded-lg bg-background/25 p-3 text-left ring-1 ring-border/50 transition-colors hover:bg-background/65',
                        isCurrent &&
                          'bg-brand-bright/[0.045] ring-1 ring-brand-bright/50',
                      )}
                    >
                      <span className="flex items-center gap-1.5 font-display text-[13px] font-medium text-foreground">
                        {preset.name}
                        {isLive && (
                          <StatusBadge status="live" className="text-[0.6rem]" />
                        )}
                      </span>
                      <span className="font-sans text-xs leading-4 text-muted-foreground">
                        {preset.designIntent}
                      </span>
                    </button>
                  )
                })}
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Accent</FieldLegend>
              <div className="grid grid-cols-2 gap-2">
                {ACCENTS.map((accent) => {
                  const isCurrent = selectedAccent === accent.id
                  return (
                    <button
                      key={accent.id}
                      type="button"
                      aria-pressed={isCurrent}
                      onClick={() => setSelectedAccent(accent.id)}
                      className={cn(
                        'flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left font-sans text-xs text-muted-foreground transition-colors',
                        'hover:bg-background/65 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isCurrent && 'bg-background text-foreground ring-1 ring-brand-bright/50',
                      )}
                      aria-label={`Accent ${accent.name}`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10"
                        style={{ backgroundColor: accent.oklchLight }}
                      />
                      <span>{accent.name}</span>
                    </button>
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
                    className="min-h-11 px-2.5 data-[state=on]:border-brand-bright/40 data-[state=on]:bg-brand-bright/10 data-[state=on]:text-primary"
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
                    className="min-h-11 px-2.5 capitalize data-[state=on]:border-brand-bright/40 data-[state=on]:bg-brand-bright/10 data-[state=on]:text-primary"
                  >
                    {mode}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">
                What visitors see. System follows this device&apos;s current light or dark setting.
              </p>
            </FieldSet>

            {themeDirty && (
              <p className="font-sans text-xs text-amber-600 dark:text-amber-400">
                Changes not yet saved.
              </p>
            )}
            {saveError ? (
              <p className="font-sans text-xs text-destructive" role="alert">{saveError}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <PendingSubmitButton
                className="min-h-11 w-fit"
                pending={saving}
                pendingText="Saving…"
                disabled={!themeDirty}
              >
                {themeDirty ? 'Save changes' : 'Saved'}
              </PendingSubmitButton>
              <Button asChild variant="outline" className="min-h-11 xl:hidden">
                <a href="#theme-preview">Preview below</a>
              </Button>
            </div>
          </div>

          <div id="theme-preview" className="min-w-0 scroll-mt-20 xl:sticky xl:top-20 xl:self-start">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-sans text-sm font-semibold text-foreground">Article preview</p>
                <p className="mt-0.5 font-sans text-xs text-muted-foreground">
                  {previewArticle.source === 'published' ? 'Latest published post' : 'Complete sample article'}
                </p>
              </div>
              {site.publicBaseUrl ? (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <a href={site.publicBaseUrl} target="_blank" rel="noopener noreferrer">
                    View live blog
                  </a>
                </Button>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="border-b border-[color:var(--hairline)] bg-muted/45 px-4 py-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                {site.publicBaseUrl?.replace('https://', '') ?? `${site.slug}.your-domain.com`}/{previewArticle.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}
              </div>
              <div
                className="h-[44rem] max-h-[72dvh] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                role="region"
                aria-label="Scrollable article theme preview"
                tabIndex={0}
              >
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
    </>
  )
}
