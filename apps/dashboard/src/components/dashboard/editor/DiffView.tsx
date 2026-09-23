import type { Asset, PostVersion } from '@vc/core'
import { ArrowRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { collapseUnchanged, diffLines, diffStats, type DiffLine } from '~/lib/diff'

/** The comparable shape of a post at one point in time. */
export type PostSnapshot = {
  title: string
  slug: string
  excerpt: string | null
  tags: string[]
  coverAssetId: string | null
  seoTitle: string | null
  seoDescription: string | null
  canonicalUrl: string | null
  layout: string | null
  toc: boolean | null
  contentMarkdown: string
}

export function snapshotFromVersion(version: PostVersion): PostSnapshot {
  return {
    title: version.title,
    slug: version.slug,
    excerpt: version.excerpt,
    tags: version.tags,
    coverAssetId: version.coverAssetId,
    seoTitle: version.seoTitle,
    seoDescription: version.seoDescription,
    canonicalUrl: version.canonicalUrl,
    layout: version.presentation?.layout ?? null,
    toc: version.presentation?.toc ?? null,
    contentMarkdown: version.contentMarkdown,
  }
}

type FieldChange = { label: string; before: ReactNode; after: ReactNode }

function text(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function Empty() {
  return <span className="italic text-muted-foreground">empty</span>
}

function CoverThumb({ assetId, assets }: { assetId: string | null; assets: Asset[] }) {
  if (!assetId) return <Empty />
  const asset = assets.find((item) => item.id === assetId)
  return (
    <span className="inline-flex items-center gap-2">
      <img src={`/media-assets/${assetId}?w=160`} alt={asset?.altText ?? ''} className="h-10 w-16 rounded-md border border-border object-cover" />
      <span className="truncate text-xs text-muted-foreground">{asset?.filename ?? 'Removed image'}</span>
    </span>
  )
}

export function metadataChanges(before: PostSnapshot, after: PostSnapshot, assets: Asset[]): FieldChange[] {
  const changes: FieldChange[] = []
  const pushText = (label: string, a: string | null | undefined, b: string | null | undefined, mono = false) => {
    if ((text(a) ?? '') === (text(b) ?? '')) return
    const render = (value: string | null | undefined) => text(value)
      ? <span className={mono ? 'font-mono text-xs' : undefined}>{text(value)}</span>
      : <Empty />
    changes.push({ label, before: render(a), after: render(b) })
  }
  pushText('Title', before.title, after.title)
  pushText('Slug', before.slug, after.slug, true)
  pushText('Excerpt', before.excerpt, after.excerpt)
  if (before.tags.join('\u0000') !== after.tags.join('\u0000')) {
    const render = (tags: string[]) => tags.length
      ? <span className="flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{tag}</span>)}</span>
      : <Empty />
    changes.push({ label: 'Tags', before: render(before.tags), after: render(after.tags) })
  }
  if ((before.coverAssetId ?? '') !== (after.coverAssetId ?? '')) {
    changes.push({
      label: 'Cover',
      before: <CoverThumb assetId={before.coverAssetId} assets={assets} />,
      after: <CoverThumb assetId={after.coverAssetId} assets={assets} />,
    })
  }
  pushText('SEO title', before.seoTitle, after.seoTitle)
  pushText('SEO description', before.seoDescription, after.seoDescription)
  pushText('Canonical URL', before.canonicalUrl, after.canonicalUrl, true)
  if ((before.layout ?? '') !== (after.layout ?? '') || Boolean(before.toc) !== Boolean(after.toc)) {
    const render = (snapshot: PostSnapshot) => (
      <span>{snapshot.layout ? snapshot.layout.charAt(0).toUpperCase() + snapshot.layout.slice(1) : 'Default'}{snapshot.toc ? ' · contents' : ''}</span>
    )
    changes.push({ label: 'Layout', before: render(before), after: render(after) })
  }
  return changes
}

export function MetadataDiff({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null
  return (
    <dl className="grid gap-0 text-sm">
      {changes.map((change) => (
        <div key={change.label} className="grid gap-1.5 border-b border-[color:var(--hairline)] py-3 first:pt-0 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground">{change.label}</dt>
          <dd className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start sm:gap-3">
            <span className="min-w-0 break-words text-muted-foreground line-through decoration-destructive/50 [&_img]:no-underline">{change.before}</span>
            <ArrowRight aria-label="changed to" className="hidden size-4 shrink-0 text-muted-foreground sm:mt-0.5 sm:block" />
            <span className="min-w-0 break-words text-foreground">{change.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const tone = line.type === 'add'
    ? 'bg-brand-bright/10 text-foreground'
    : line.type === 'del'
      ? 'bg-destructive/10 text-muted-foreground line-through decoration-destructive/40'
      : 'text-muted-foreground'
  return (
    <div className={`grid grid-cols-[1.25rem_minmax(0,1fr)] px-2 ${tone}`}>
      <span aria-hidden className={`select-none text-center ${line.type === 'add' ? 'text-primary' : line.type === 'del' ? 'text-destructive' : ''}`}>
        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}
      </span>
      <span className="whitespace-pre-wrap break-words">
        <span className="sr-only">{line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : ''}</span>
        {line.text || ' '}
      </span>
    </div>
  )
}

/** Line diff of the body with unchanged runs folded behind a "show" row. */
export function BodyDiff({ before, after, context = 3 }: { before: string; after: string; context?: number }) {
  const diff = useMemo(() => diffLines(before, after), [before, after])
  const hunks = useMemo(() => collapseUnchanged(diff, context), [diff, context])
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const stats = diffStats(diff)
  if (stats.added === 0 && stats.removed === 0) {
    return <p className="text-sm text-muted-foreground">The body is unchanged.</p>
  }
  return (
    <div className="grid gap-2">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">+{stats.added}</span> <span className="text-destructive">−{stats.removed}</span> lines
      </p>
      <div className="overflow-hidden rounded-lg border border-border font-mono text-[13px] leading-6">
        {hunks.map((hunk, index) => {
          if (hunk.type === 'lines' || expanded.has(index)) {
            return <div key={index}>{hunk.lines.map((line, lineIndex) => <DiffRow key={lineIndex} line={line} />)}</div>
          }
          return (
            <button
              key={index}
              type="button"
              className="block w-full border-y border-[color:var(--hairline)] bg-muted/40 px-3 py-1 text-left font-sans text-xs text-muted-foreground first:border-t-0 last:border-b-0 hover:text-foreground"
              onClick={() => setExpanded((current) => new Set(current).add(index))}
            >
              Show {hunk.count} unchanged {hunk.count === 1 ? 'line' : 'lines'}
            </button>
          )
        })}
      </div>
    </div>
  )
}
