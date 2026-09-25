import {
  ACCENTS,
  DEFAULT_PRESET_ID,
  FONTS,
  PRESET_IDS,
  resolvePresentation,
  THEME_MODES,
  THEME_PRESETS,
  THEME_RADII,
  THEME_WIDTHS,
  resolveRadius,
  resolveWidth,
  type ThemeRadius,
  type ThemeWidth,
  type AccentId,
  type FontId,
  type PresetId,
  type ResolvedPresentation,
  type ThemeMode,
} from '@vc/config'
import { readingTimeMinutes, renderRichContent, type CodeHighlighter, type RenderResult } from '@vc/content'
import { PresentedPostArticle, articleHasToc } from '@vc/content/presented-post'
import { PublicPageChrome, type SubscribeSettings } from '@vc/content/public-chrome'
import { PublicPostList, type PublicPostListItem } from '@vc/content/public-post-list'
import { cn } from '@vc/ui'
import { Check, ExternalLink, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { PageHeader, PageSkeleton } from '~/components/dashboard/blocks'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { UnsavedNavigationGuard } from '~/components/dashboard/UnsavedNavigationGuard'
import { useCodeHighlighter } from '~/components/dashboard/editor/PreviewPane'
import { useBlockEnhancers } from '~/components/dashboard/editor/use-block-enhancers'
import {
  getPostVersionFn,
  loadPostEditorPage,
  loadPostsPage,
  loadSettingsPage,
  updateSiteSettingsMutation,
} from '~/lib/api-client'

// A sample article that exercises the renderer vocabulary. Shown until the
// blog has a published post of its own.
const SAMPLE_TITLE = 'Shipping calm software'
const SAMPLE_MD = `Your agents draft, you approve, and the public blog shows only what you publish. This sample shows every block the theme styles.[^1]

## A calm publishing loop

Every change becomes a version. Publishing pins the live page to the exact version you approved, so later edits stay private until you publish again.

:::tip[Try it]
Change the **accent** or the **font** on the left and watch links, callouts, and code update here.
:::

### What it looks like in code

\`\`\`ts title="publish.ts" {2}
export async function publish(id: string) {
  const tip = await cms.posts.get(id)
  return cms.posts.publish(id, { expectedVersionNumber: tip.versionNumber })
}
\`\`\`

> Good tools make the safe path the easy path.

## Readable everywhere

| Style | Voice | Best for |
| --- | --- | --- |
| Minimal | Neutral | Everyday writing |
| Editorial | Literary | Essays |
| Technical | Precise | Docs and tutorials |
| Product | Confident | Launches |

> [!NOTE]
> Readers can switch between light and dark when your default mode is System.

## Wrapping up

- One owner of record
- A version for every change
- A theme that looks like *your* brand

[^1]: Footnotes, tables, callouts, and code all follow your theme.
`

type PreviewArticle = {
  markdown: string
  title: string
  excerpt: string
  publishedAt: number
  tags: string[]
  presentation: ResolvedPresentation | null
  source: 'sample' | 'published'
}

const SAMPLE_ARTICLE: PreviewArticle = {
  markdown: SAMPLE_MD,
  title: SAMPLE_TITLE,
  excerpt: 'A sample article for judging typography, rhythm, callouts, code, and tables.',
  publishedAt: Math.floor(Date.UTC(2026, 8, 12) / 1000),
  tags: ['workflow', 'publishing'],
  presentation: null,
  source: 'sample',
}

const SAMPLE_INDEX: PublicPostListItem[] = [
  { id: 's1', title: SAMPLE_TITLE, href: '#', excerpt: SAMPLE_ARTICLE.excerpt, publishedAt: SAMPLE_ARTICLE.publishedAt, tags: ['workflow'] },
  { id: 's2', title: 'Versions are the product', href: '#', excerpt: 'Every save is a snapshot you can diff and restore.', publishedAt: SAMPLE_ARTICLE.publishedAt - 9 * 86400, tags: ['versions'] },
  { id: 's3', title: 'Markdown, all the way down', href: '#', excerpt: 'Callouts, footnotes, highlighted code, and a feed that reads cleanly everywhere.', publishedAt: SAMPLE_ARTICLE.publishedAt - 20 * 86400 },
]

function isAccentId(value: string | null | undefined): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value)
}

function isFontId(value: string | null | undefined): value is FontId {
  return FONTS.some((font) => font.id === value)
}

function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value)
}

function isPresetId(value: string): value is PresetId {
  return PRESET_IDS.some((id) => id === value)
}

type ThemeSiteBaseline = {
  name: string
  description: string
  slug: string
  theme: PresetId
  themeAccent: AccentId
  themeFont: FontId
  themeMode: ThemeMode
  themeRadius: ThemeRadius
  themeWidth: ThemeWidth
  updatedAt: number
  publicBaseUrl: string | null
  newsletter: SubscribeSettings | null
}

function themeBaselineFromSettings(loaded: Awaited<ReturnType<typeof loadSettingsPage>>): ThemeSiteBaseline {
  const site = loaded.site
  return {
    name: site.name,
    description: site.description ?? '',
    slug: site.slug,
    theme: isPresetId(site.theme) ? site.theme : DEFAULT_PRESET_ID,
    themeAccent: isAccentId(site.themeAccent) ? site.themeAccent : 'teal',
    themeFont: isFontId(site.themeFont) ? site.themeFont : 'geist-sans',
    themeMode: isThemeMode(site.themeMode) ? site.themeMode : 'system',
    themeRadius: resolveRadius(site.themeRadius, site.theme),
    themeWidth: resolveWidth(site.themeWidth, site.theme),
    updatedAt: site.updatedAt,
    publicBaseUrl: loaded.publicBaseUrl ?? null,
    newsletter: (site as { newsletterSettings?: SubscribeSettings | null }).newsletterSettings ?? null,
  }
}

const MODE_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }
const RADIUS_LABEL: Record<ThemeRadius, string> = { none: 'Square', sm: 'Soft', md: 'Round', lg: 'Rounder' }
const WIDTH_LABEL: Record<ThemeWidth, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' }

/** A live, scaled-down render of a blog page (real components, inert). */
function MiniRender({ width = 1180, children }: { width?: number; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0.25)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => setScale(box.clientWidth / width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [width])
  return (
    <div ref={boxRef} className="relative aspect-[16/11] w-full overflow-hidden" aria-hidden="true">
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left [&>main]:!min-h-full"
        style={{ width, height: (width * 11) / 16, transform: `scale(${scale})` }}
        inert
      >
        {children}
      </div>
    </div>
  )
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium text-foreground">{children}</h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: React.ReactNode; title?: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            value === option.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function renderArticle(article: PreviewArticle, highlighter: CodeHighlighter | null): RenderResult {
  return renderRichContent(article.markdown, { pageTitle: article.title, highlighter })
}

export function ThemePage() {
  const [site, setSite] = useState<ThemeSiteBaseline | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [selectedTheme, setSelectedTheme] = useState<PresetId>(DEFAULT_PRESET_ID)
  const [selectedAccent, setSelectedAccent] = useState<AccentId>('teal')
  const [selectedFont, setSelectedFont] = useState<FontId>('geist-sans')
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('system')
  const [selectedRadius, setSelectedRadius] = useState<ThemeRadius>('md')
  const [selectedWidth, setSelectedWidth] = useState<ThemeWidth>('normal')
  // After picking a template, remember the previous look for one-click "keep my look".
  const [previousLook, setPreviousLook] = useState<{ accent: AccentId; font: FontId; radius: ThemeRadius; width: ThemeWidth } | null>(null)
  const selectedRef = useRef({ theme: selectedTheme, accent: selectedAccent, font: selectedFont, mode: selectedMode, radius: selectedRadius, width: selectedWidth })
  selectedRef.current = { theme: selectedTheme, accent: selectedAccent, font: selectedFont, mode: selectedMode, radius: selectedRadius, width: selectedWidth }

  const [article, setArticle] = useState<PreviewArticle>(SAMPLE_ARTICLE)
  const [indexPosts, setIndexPosts] = useState<PublicPostListItem[] | null>(null)
  const [previewPage, setPreviewPage] = useState<'article' | 'home'>('article')
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'phone'>('desktop')
  const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const highlighter = useCodeHighlighter()

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void loadSettingsPage()
      .then((loaded) => {
        if (cancelled) return
        const baseline = themeBaselineFromSettings(loaded)
        setSite(baseline)
        setSelectedTheme(baseline.theme)
        setSelectedAccent(baseline.themeAccent)
        setSelectedFont(baseline.themeFont)
        setSelectedMode(baseline.themeMode)
        setSelectedRadius(baseline.themeRadius)
        setSelectedWidth(baseline.themeWidth)
        if (baseline.themeMode !== 'system') setPreviewScheme(baseline.themeMode)
      })
      .catch(() => {
        if (!cancelled) setLoadError('We couldn’t load your theme settings.')
      })
    // Preview with the blog's own posts when it has any.
    void loadPostsPage({ status: 'published' })
      .then((list) => {
        if (cancelled || list.posts.length === 0) return null
        setIndexPosts(
          list.posts.slice(0, 8).map((post) => ({
            id: post.id,
            title: post.title,
            href: '#',
            excerpt: post.excerpt,
            publishedAt: post.publishedAt,
            tags: post.tags,
          })),
        )
        return loadPostEditorPage({ postId: list.posts[0]?.id })
      })
      .then(async (page) => {
        const versionNumber = page?.post?.publishedVersionNumber
        if (cancelled || !page?.post || versionNumber == null) return
        const version = await getPostVersionFn({ postId: page.post.id, versionNumber })
        if (cancelled || !version?.contentMarkdown) return
        setArticle({
          markdown: version.contentMarkdown,
          title: version.title,
          excerpt: version.excerpt ?? '',
          publishedAt: page.post.publishedAt ?? SAMPLE_ARTICLE.publishedAt,
          tags: version.tags,
          presentation: resolvePresentation(page.presetId, version.presentation).resolved,
          source: 'published',
        })
      })
      .catch(() => {
        // The sample stays; the preview is never a blocker.
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const renderResult = useMemo(() => renderArticle(article, highlighter), [article, highlighter])
  const blocksRef = useBlockEnhancers(renderResult)

  if (loadError) {
    return (
      <>
        <PageHeader title="Theme" />
        <LoadError message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      </>
    )
  }

  if (!site) {
    return (
      <>
        <PageHeader title="Theme" />
        <PageSkeleton />
      </>
    )
  }

  const themeDirty =
    selectedTheme !== site.theme ||
    selectedAccent !== site.themeAccent ||
    selectedFont !== site.themeFont ||
    selectedMode !== site.themeMode ||
    selectedRadius !== site.themeRadius ||
    selectedWidth !== site.themeWidth

  function discard() {
    if (!site) return
    setSelectedTheme(site.theme)
    setSelectedAccent(site.themeAccent)
    setSelectedFont(site.themeFont)
    setSelectedMode(site.themeMode)
    setSelectedRadius(site.themeRadius)
    setSelectedWidth(site.themeWidth)
    setPreviousLook(null)
    setSaveError(null)
  }

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
        themeRadius: submitted.radius,
        themeWidth: submitted.width,
      })
      if (result.kind === 'ok') {
        settingsSaved = true
        const refreshed = themeBaselineFromSettings(await loadSettingsPage())
        setSite(refreshed)
        if (
          selectedRef.current.theme === submitted.theme &&
          selectedRef.current.accent === submitted.accent &&
          selectedRef.current.font === submitted.font &&
          selectedRef.current.mode === submitted.mode &&
          selectedRef.current.radius === submitted.radius &&
          selectedRef.current.width === submitted.width
        ) {
          setSelectedTheme(refreshed.theme)
          setSelectedAccent(refreshed.themeAccent)
          setSelectedFont(refreshed.themeFont)
          setSelectedMode(refreshed.themeMode)
          setSelectedRadius(refreshed.themeRadius)
          setSelectedWidth(refreshed.themeWidth)
          setPreviousLook(null)
        }
        setJustSaved(true)
        window.setTimeout(() => setJustSaved(false), 2400)
      } else if (result.code === 'settings_conflict') {
        const refreshed = themeBaselineFromSettings(await loadSettingsPage())
        setSite(refreshed)
        setSaveError('The saved theme changed elsewhere. Your choices are still in the preview. Check them, then save again.')
      } else {
        setSaveError('Your theme didn’t save. Try again.')
      }
    } catch {
      setSaveError(
        settingsSaved
          ? 'Theme saved, but the page couldn’t refresh. Reload before changing anything else.'
          : 'Your theme didn’t save. Check your connection and try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const effectiveMode = selectedMode === 'system' ? previewScheme : selectedMode
  const previewTheme = { accent: selectedAccent, font: selectedFont, mode: effectiveMode, radius: selectedRadius, width: selectedWidth }
  const selectedTemplate = THEME_PRESETS[selectedTheme].template
  const listedPosts = indexPosts ?? SAMPLE_INDEX
  const tagCounts = new Map<string, number>()
  for (const post of listedPosts) for (const tag of post.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  const previewSidebar = {
    recent: listedPosts.slice(0, 5).map((post) => ({ title: post.title, href: '#' })),
    tags: [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count, href: '#' })),
  }

  function pickTemplate(id: PresetId) {
    if (id === selectedTheme) return
    const look = THEME_PRESETS[id].template.defaults
    setPreviousLook({ accent: selectedAccent, font: selectedFont, radius: selectedRadius, width: selectedWidth })
    setSelectedTheme(id)
    setSelectedAccent(look.accent)
    setSelectedFont(look.font)
    setSelectedRadius(look.radius)
    setSelectedWidth(look.width)
  }

  function keepPreviousLook() {
    if (!previousLook) return
    setSelectedAccent(previousLook.accent)
    setSelectedFont(previousLook.font)
    setSelectedRadius(previousLook.radius)
    setSelectedWidth(previousLook.width)
    setPreviousLook(null)
  }
  const presentation = resolvePresentation(selectedTheme, article.presentation).resolved

  return (
    <>
      <UnsavedNavigationGuard when={themeDirty} />
      <PageHeader
        title="Theme"
        description="How your public blog looks to readers."
        action={
          site.publicBaseUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={site.publicBaseUrl} target="_blank" rel="noopener noreferrer">
                View blog <ExternalLink aria-hidden data-icon="inline-end" />
              </a>
            </Button>
          ) : null
        }
      />
      <section className="mt-6" aria-labelledby="templates-heading">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="templates-heading" className="text-sm font-medium text-foreground">Template</h2>
          <span className="text-xs text-muted-foreground">A designed starting point. Change anything below.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Template">
          {PRESET_IDS.map((id) => {
            const preset = THEME_PRESETS[id]
            const look = preset.template.defaults
            const isCurrent = selectedTheme === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isCurrent}
                aria-pressed={isCurrent}
                onClick={() => pickTemplate(id)}
                className={cn(
                  'group overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  isCurrent ? 'border-foreground/40 ring-1 ring-foreground/20' : 'border-border hover:border-foreground/25',
                )}
              >
                <div className="border-b border-border bg-muted/40">
                  <MiniRender>
                    <PublicPageChrome
                      siteName={site.name}
                      tagline={site.description || null}
                      homeHref="#"
                      homeHeading
                      presetId={id}
                      theme={{ accent: look.accent, font: look.font, mode: effectiveMode, radius: look.radius, width: look.width }}
                      embedded
                      feedHref="#"
                      sidebar={previewSidebar}
                    >
                      <PublicPostList variant={preset.template.index} posts={(indexPosts ?? SAMPLE_INDEX).slice(0, 5)} />
                    </PublicPageChrome>
                  </MiniRender>
                </div>
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {preset.name}
                      {site.theme === id ? <span className="text-xs font-normal text-muted-foreground">Live</span> : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preset.designIntent}</span>
                  </span>
                  {isCurrent ? <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden /> : null}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <form
        className="mt-6 grid gap-8 xl:grid-cols-[18.5rem_minmax(0,1fr)] xl:items-start"
        onSubmit={(e) => void handleThemeSave(e)}
      >
        <div className="flex flex-col gap-7 xl:sticky xl:top-6">
          {previousLook ? (
            <div className="-mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground" role="status">
              Applied {THEME_PRESETS[selectedTheme].name}’s look.{' '}
              <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={keepPreviousLook}>
                Keep my colors and font
              </button>
            </div>
          ) : null}

          <section>
            <SectionLabel hint={ACCENTS.find((a) => a.id === selectedAccent)?.name}>Accent</SectionLabel>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
              {ACCENTS.map((accent) => {
                const isCurrent = selectedAccent === accent.id
                return (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={isCurrent}
                    aria-label={accent.name}
                    title={accent.name}
                    onClick={() => setSelectedAccent(accent.id)}
                    className={cn(
                      'grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition focus-visible:outline-2 focus-visible:outline-ring',
                      isCurrent ? 'ring-2 ring-foreground/70' : 'hover:ring-2 hover:ring-border',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-6 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{
                        backgroundColor:
                          effectiveMode === 'dark' ? accent.oklchDark : accent.oklchLight,
                      }}
                    />
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <SectionLabel>Font</SectionLabel>
            <div className="grid gap-1.5" role="radiogroup" aria-label="Font">
              {FONTS.map((font) => {
                const isCurrent = selectedFont === font.id
                return (
                  <button
                    key={font.id}
                    type="button"
                    role="radio"
                    aria-checked={isCurrent}
                    onClick={() => setSelectedFont(font.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      isCurrent ? 'border-foreground/25 bg-muted/60' : 'border-transparent hover:bg-muted/40',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="w-8 text-lg leading-none text-foreground"
                      style={{ fontFamily: font.headingStack }}
                    >
                      Aa
                    </span>
                    <span className="flex-1 text-sm text-foreground">{font.name}</span>
                    {isCurrent ? <Check className="size-4 shrink-0 text-foreground" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <SectionLabel>Shape</SectionLabel>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Corners</span>
                <Segmented
                  label="Corner radius"
                  value={selectedRadius}
                  onChange={setSelectedRadius}
                  options={THEME_RADII.map((r) => ({ value: r, label: RADIUS_LABEL[r] }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Reading width</span>
                <Segmented
                  label="Reading width"
                  value={selectedWidth}
                  onChange={setSelectedWidth}
                  options={THEME_WIDTHS.map((w) => ({ value: w, label: WIDTH_LABEL[w] }))}
                />
              </div>
            </div>
          </section>

          <section>
            <SectionLabel>Color mode</SectionLabel>
            <Segmented
              label="Default color mode"
              value={selectedMode}
              onChange={(mode) => {
                setSelectedMode(mode)
                if (mode !== 'system') setPreviewScheme(mode)
              }}
              options={THEME_MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] }))}
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {selectedMode === 'system'
                ? 'Follows each reader’s device setting.'
                : `Every reader sees ${selectedMode} mode.`}
            </p>
          </section>

          <div className="flex flex-col gap-2 border-t border-[color:var(--hairline)] pt-5">
            {saveError ? (
              <p className="text-sm text-destructive" role="alert">
                {saveError}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <PendingSubmitButton pending={saving} pendingText="Saving…" disabled={!themeDirty}>
                {themeDirty ? 'Save changes' : 'Saved'}
              </PendingSubmitButton>
              {themeDirty ? (
                <Button type="button" variant="ghost" onClick={discard} disabled={saving}>
                  Discard
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {themeDirty ? 'Unsaved changes. Readers still see your current theme.' : justSaved ? 'Your blog is updated.' : ''}
            </p>
          </div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-6">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              label="Preview page"
              value={previewPage}
              onChange={setPreviewPage}
              options={[
                { value: 'article', label: 'Post' },
                { value: 'home', label: 'Home' },
              ]}
            />
            <div className="flex items-center gap-2">
              <Segmented
                label="Preview width"
                value={previewWidth}
                onChange={setPreviewWidth}
                options={[
                  { value: 'desktop', label: <Monitor className="size-3.5" aria-hidden />, title: 'Desktop' },
                  { value: 'phone', label: <Smartphone className="size-3.5" aria-hidden />, title: 'Phone' },
                ]}
              />
              {selectedMode === 'system' ? (
                <Segmented
                  label="Preview color scheme"
                  value={previewScheme}
                  onChange={setPreviewScheme}
                  options={[
                    { value: 'light', label: <Sun className="size-3.5" aria-hidden />, title: 'Light' },
                    { value: 'dark', label: <Moon className="size-3.5" aria-hidden />, title: 'Dark' },
                  ]}
                />
              ) : null}
            </div>
          </div>
          <div
            className="h-[calc(100dvh-12rem)] min-h-[32rem] overflow-y-auto rounded-xl border border-border bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
            role="region"
            aria-label="Theme preview"
            tabIndex={0}
          >
            <div
              ref={blocksRef}
              className="mx-auto transition-[max-width] duration-200 motion-reduce:transition-none"
              style={{ maxWidth: previewWidth === 'phone' ? 390 : '100%' }}
              inert
            >
              {previewPage === 'home' ? (
                <PublicPageChrome
                  siteName={site.name}
                  tagline={site.description || null}
                  homeHref="#"
                  homeHeading
                  presetId={selectedTheme}
                  theme={previewTheme}
                  embedded
                  searchAction="#"
                  feedHref="#"
                  subscribeVariant="footer"
                  subscribeSettings={site.newsletter}
                  sidebar={previewSidebar}
                >
                  <PublicPostList variant={selectedTemplate.index} posts={indexPosts ?? SAMPLE_INDEX} />
                </PublicPageChrome>
              ) : (
                <PublicPageChrome
                  siteName={site.name}
                  homeHref="#"
                  allPostsHref="#"
                  presetId={selectedTheme}
                  theme={previewTheme}
                  article
                  embedded
                  wide={articleHasToc(presentation, renderResult.outline)}
                  layout={presentation.layout}
                  feedHref="#"
                  subscribeVariant="end"
                  subscribeSettings={site.newsletter}
                  sidebar={previewSidebar}
                >
                  <PresentedPostArticle
                    renderResult={renderResult}
                    presetId={selectedTheme}
                    presentation={presentation}
                    title={article.title}
                    excerpt={article.excerpt || undefined}
                    publishedAt={article.publishedAt}
                    readingMinutes={readingTimeMinutes(article.markdown)}
                    tags={article.tags}
                    basePath=""
                    theme={previewTheme}
                    author={{ name: site.name, agent: true }}
                  />
                </PublicPageChrome>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {article.source === 'published' ? 'Showing your latest published post.' : 'Showing a sample post until you publish one.'}
          </p>
        </div>
      </form>
    </>
  )
}
