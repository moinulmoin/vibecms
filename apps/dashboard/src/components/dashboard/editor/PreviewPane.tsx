'use client'

import { readingTimeMinutes, renderRichContent, type RenderedImageAttributes } from '@vc/content'
import { PresentedPostArticle, type SiteThemeInput } from '@vc/content/presented-post'
import { PublicPageChrome } from '@vc/content/public-chrome'
import { resolvePresentation, type Presentation } from '@vc/config'
import { useMemo } from 'react'
import type { EditorSiteInfo } from '~/types/dashboard'

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

function dateText(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000).toLocaleDateString() : undefined
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
}: PreviewPaneProps) {
  const previewResult = useMemo(
    () => renderRichContent(source, { presetId, pageTitle: metadata.title, resolveImage }),
    [source, presetId, metadata.title, resolveImage],
  )
  const resolvedPresentation = resolvePresentation(presetId, presentation as Presentation | null | undefined).resolved
  const updated = publishedAt && updatedAt && updatedAt > publishedAt + 86400 ? dateText(updatedAt) : undefined

  return (
    <div role="region" aria-label="Markdown preview" className="min-w-0 lg:sticky lg:top-20">
      <p className="mb-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground" aria-live="polite">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright/40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-brand-bright" />
        </span>
        Exact public page · live as you type
      </p>
      <div
        className="overflow-y-auto rounded-xl border border-border lg:max-h-[calc(100dvh-10rem)]"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
        onAuxClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) event.preventDefault()
        }}
      >
        {source.trim() ? (
          <PublicPageChrome
            siteName={site?.name ?? 'Your blog'}
            tagline={site?.description ?? null}
            homeHref="#"
            allPostsHref="#"
            presetId={presetId}
            theme={site ? { accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } : undefined}
            article
            subscribeVariant="end"
          >
            <PresentedPostArticle
              renderResult={previewResult}
              presetId={presetId}
              presentation={resolvedPresentation}
              theme={site ? ({ accent: site.themeAccent, font: site.themeFont, mode: site.themeMode } satisfies SiteThemeInput) : undefined}
              title={metadata.title}
              excerpt={metadata.excerpt}
              byline={site?.name}
              coverAssetSrc={metadata.coverAssetSrc}
              coverAssetAlt={metadata.coverAssetAlt}
              coverAssetWidth={metadata.coverAssetWidth}
              coverAssetHeight={metadata.coverAssetHeight}
              dateText={dateText(publishedAt)}
              updatedDateText={updated}
              readingMinutes={readingTimeMinutes(source)}
              tags={metadata.tags}
              basePath="#"
            />
          </PublicPageChrome>
        ) : (
          <div className="bg-muted/50 p-8">
            <p className="font-mono text-xs text-muted-foreground">Nothing here yet — start writing and the page builds itself.</p>
          </div>
        )}
      </div>
    </div>
  )
}
