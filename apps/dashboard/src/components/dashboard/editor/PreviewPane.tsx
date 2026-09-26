import {
  readingTimeMinutes,
  renderRichContent,
  type CodeHighlighter,
  type RenderedImageAttributes,
} from '@vc/content'
import { PresentedPostArticle, articleHasToc, type SiteThemeInput } from '@vc/content/presented-post'
import { PublicPageChrome, type SubscribeSettings } from '@vc/content/public-chrome'
import { resolvePresentation, type Presentation } from '@vc/config'
import { Monitor, Moon, Smartphone, Sun, Tablet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EditorSiteInfo } from '~/types/dashboard'
import { useBlockEnhancers } from './use-block-enhancers'

export type PreviewMetadata = {
  title?: string
  excerpt?: string
  coverAssetSrc?: string
  coverAssetAlt?: string
  coverAssetWidth?: number
  coverAssetHeight?: number
  tags?: string[]
}

export type PreviewPaneProps = {
  source: string
  metadata: PreviewMetadata
  presetId: string
  presentation?: { layout?: string; toc?: boolean }
  site?: EditorSiteInfo | null
  publishedAt?: number | null
  updatedAt?: number | null
  resolveImage?: (src: string) => RenderedImageAttributes | null
  /** Per-site subscribe copy, so the preview matches the live end-of-post form. */
  subscribeSettings?: SubscribeSettings | null
  /** Hide the width / mode controls (e.g. compact embeds). */
  hideToolbar?: boolean
  /** Fill the parent height (split view) instead of capping to the viewport. */
  fill?: boolean
  /** Receives render warnings (missing alt text, unsupported HTML, ...). */
  onWarnings?: (warnings: string[]) => void
}

type PreviewWidth = 'desktop' | 'tablet' | 'phone'
type PreviewMode = 'light' | 'dark'

const WIDTHS: Record<PreviewWidth, string> = { desktop: '100%', tablet: '768px', phone: '390px' }

let highlighterPromise: Promise<CodeHighlighter> | null = null

/** Loads the Shiki highlighter on demand so it stays out of the main bundle. */
export function useCodeHighlighter(): CodeHighlighter | null {
  const [highlighter, setHighlighter] = useState<CodeHighlighter | null>(null)
  useEffect(() => {
    let alive = true
    highlighterPromise ??= import('@vc/content/highlight').then((m) => m.createCodeHighlighter())
    highlighterPromise.then((h) => alive && setHighlighter(h)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return highlighter
}

function responsiveImageSource(source: string): RenderedImageAttributes | null {
  const match = /^\/media-assets\/([^/?#]+)$/.exec(source)
  if (!match?.[1]) return null
  const path = `/media-assets/${match[1]}`
  return {
    src: path,
    srcSet: [320, 640, 960, 1280].map((width) => `${path}?w=${width} ${width}w`).join(', '),
    sizes: '(max-width: 720px) calc(100vw - 32px), 720px',
  }
}

function systemMode(): PreviewMode {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark'
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export function PreviewPane({
  source,
  metadata,
  presetId,
  presentation,
  site,
  publishedAt,
  updatedAt,
  resolveImage = responsiveImageSource,
  subscribeSettings,
  hideToolbar = false,
  fill = false,
  onWarnings,
}: PreviewPaneProps) {
  const highlighter = useCodeHighlighter()
  const [width, setWidth] = useState<PreviewWidth>('desktop')
  const siteMode = site?.themeMode === 'light' || site?.themeMode === 'dark' ? site.themeMode : null
  const [mode, setMode] = useState<PreviewMode>(() => siteMode ?? systemMode())
  useEffect(() => {
    if (siteMode) setMode(siteMode)
  }, [siteMode])

  const previewResult = useMemo(
    () => renderRichContent(source, { presetId, pageTitle: metadata.title, resolveImage, highlighter }),
    [source, presetId, metadata.title, resolveImage, highlighter],
  )
  useEffect(() => {
    onWarnings?.(previewResult.warnings)
  }, [previewResult.warnings, onWarnings])
  const blocksRef = useBlockEnhancers(previewResult)

  const resolvedPresentation = resolvePresentation(presetId, presentation as Presentation | null | undefined).resolved
  const theme: SiteThemeInput | undefined = site
    ? { accent: site.themeAccent, font: site.themeFont, mode, radius: site.themeRadius ?? null, width: site.themeWidth ?? null }
    : { accent: null, font: null, mode }
  const showUpdated = Boolean(publishedAt && updatedAt && updatedAt > publishedAt + 86400)

  return (
    <div role="region" aria-label="Post preview" className={`flex min-w-0 flex-col ${fill ? 'h-full' : ''}`}>
      {hideToolbar ? null : (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Preview · matches your live blog</p>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5" role="group" aria-label="Preview width">
              <ToolbarButton active={width === 'desktop'} label="Desktop width" onClick={() => setWidth('desktop')}>
                <Monitor className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton active={width === 'tablet'} label="Tablet width" onClick={() => setWidth('tablet')}>
                <Tablet className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton active={width === 'phone'} label="Phone width" onClick={() => setWidth('phone')}>
                <Smartphone className="size-3.5" />
              </ToolbarButton>
            </div>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <ToolbarButton
              active={false}
              label={mode === 'dark' ? 'Preview light mode' : 'Preview dark mode'}
              onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
            >
              {mode === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </ToolbarButton>
          </div>
        </div>
      )}
      <div
        className={`min-h-0 overflow-y-auto rounded-xl border border-border bg-muted/40 ${
          fill ? 'flex-1' : 'lg:max-h-[calc(100dvh-10rem)]'
        }`}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
        onAuxClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
      >
        <div
          ref={blocksRef}
          className="mx-auto transition-[max-width] duration-200 motion-reduce:transition-none"
          style={{ maxWidth: WIDTHS[width] }}
        >
          {source.trim() || metadata.title ? (
            <PublicPageChrome
              siteName={site?.name ?? 'Your blog'}
              logoUrl={site?.logoAssetId ? `/media-assets/${site.logoAssetId}` : null}
              navLinks={site?.navLinks}
              socialLinks={site?.socialLinks}
              homeHref="#"
              allPostsHref="#"
              presetId={presetId}
              theme={theme}
              article
              embedded
              wide={articleHasToc(resolvedPresentation, previewResult.outline)}
              layout={resolvedPresentation.layout}
              feedHref="#"
              subscribeVariant="end"
              subscribeSettings={subscribeSettings}
            >
              <PresentedPostArticle
                renderResult={previewResult}
                presetId={presetId}
                presentation={resolvedPresentation}
                theme={theme}
                title={metadata.title}
                excerpt={metadata.excerpt}
                coverAssetSrc={metadata.coverAssetSrc}
                coverAssetAlt={metadata.coverAssetAlt}
                coverAssetWidth={metadata.coverAssetWidth}
                coverAssetHeight={metadata.coverAssetHeight}
                publishedAt={publishedAt ?? Math.floor(Date.now() / 1000)}
                updatedAt={showUpdated ? updatedAt : null}
                readingMinutes={readingTimeMinutes(source)}
                tags={metadata.tags}
                basePath="#"
                author={{ name: site?.bylineName?.trim() || site?.name || 'You' }}
              />
            </PublicPageChrome>
          ) : (
            <div className="p-8">
              <p className="text-sm text-muted-foreground">Nothing here yet. Start writing and the page builds itself.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
