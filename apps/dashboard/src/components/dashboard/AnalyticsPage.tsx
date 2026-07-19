import { ChartNoAxesCombined, LockKeyhole } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge, Button, Card, Skeleton } from '@vc/ui'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState, LoadError, PageHeader, Panel } from '~/components/dashboard/DashboardLayout'
import { loadAnalyticsPage } from '~/lib/api-client'
import { emptyPostEditorSearch } from '~/lib/dashboard-search'
import type { AnalyticsPageData, AnalyticsRange } from '~/types/dashboard'

const RANGE_OPTIONS: AnalyticsRange[] = [7, 30, 90]
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const dateLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function formatDate(value: string) {
  return dateLabel.format(new Date(`${value}T00:00:00Z`))
}

function trendLabel(value: number | null) {
  if (value === null) return 'No previous-period baseline'
  if (value === 0) return 'No change from previous period'
  return `${value > 0 ? '+' : ''}${value}% from previous period`
}

function points(values: number[], maximum: number) {
  if (values.length === 0) return ''
  if (values.length === 1) return `0,${180 - (values[0] / maximum) * 160}`
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 1000
      const y = 180 - (value / maximum) * 160
      return `${x},${y}`
    })
    .join(' ')
}

function AnalyticsSkeleton() {
  return (
    <>
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </>
  )
}

function RangeControl({ value, onChange }: { value: AnalyticsRange; onChange: (value: AnalyticsRange) => void }) {
  return (
    <div className="flex items-center rounded-xl bg-muted p-1" aria-label="Analytics date range">
      {RANGE_OPTIONS.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={value === option ? 'secondary' : 'ghost'}
          className="h-8 px-3 font-mono text-xs tabular-nums"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}d
        </Button>
      ))}
    </div>
  )
}

function MetricStrip({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const metrics = [
    { label: 'Page views', value: compactNumber.format(data.views), detail: trendLabel(data.trendPercent) },
    { label: 'Previous period', value: compactNumber.format(data.previousViews), detail: `${data.rangeDays} days before this range` },
    { label: 'AI referrals', value: compactNumber.format(data.aiReferralViews), detail: 'Human visits sent by AI services' },
    {
      label: 'AI crawler requests',
      value: data.aiCrawlers.status === 'available' ? compactNumber.format(data.aiCrawlers.requests) : '—',
      detail: data.aiCrawlers.status === 'available' ? `Last ${data.aiCrawlers.lookbackDays} days` : 'Crawler feed is not configured',
    },
  ]

  return (
    <Card className="grid gap-0 overflow-hidden p-0 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="min-w-0 px-5 py-5 sm:px-6 sm:py-6 xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:border-[color:var(--hairline)]"
        >
          <p className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{metric.label}</p>
          <p className="mt-3 font-display text-3xl font-semibold tabular-nums tracking-[-0.035em] text-foreground sm:text-4xl">
            {metric.value}
          </p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{metric.detail}</p>
        </div>
      ))}
    </Card>
  )
}

function TrafficChart({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const maximum = Math.max(1, ...data.series.flatMap((point) => [point.views, point.aiCrawlerRequests]))
  const humanPoints = points(data.series.map((point) => point.views), maximum)
  const crawlerPoints = points(data.series.map((point) => point.aiCrawlerRequests), maximum)
  const middle = data.series[Math.floor(data.series.length / 2)]
  const first = data.series[0]
  const last = data.series.at(-1)

  return (
    <Panel
      title="Traffic over time"
      meta={
        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-foreground" />Views</span>
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-bright" />AI crawlers · {data.aiCrawlers.lookbackDays}d</span>
        </div>
      }
    >
      {data.views === 0 && data.aiCrawlers.requests === 0 ? (
        <EmptyState
          icon={<ChartNoAxesCombined />}
          title="No traffic recorded yet"
          description="Open a published post to verify collection. New page views appear here within a few minutes."
          action={
            <Button asChild>
              <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>Create a post</Link>
            </Button>
          }
        />
      ) : (
        <div>
          <div className="relative h-56 w-full" role="img" aria-label={`Daily page views and AI crawler requests over ${data.rangeDays} days`}>
            <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden="true">
              {[20, 60, 100, 140, 180].map((y) => (
                <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <polyline points={humanPoints} fill="none" stroke="currentColor" className="text-foreground" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {data.aiCrawlers.status === 'available' ? (
                <polyline points={crawlerPoints} fill="none" stroke="var(--brand-bright)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ) : null}
            </svg>
          </div>
          <div className="mt-3 flex justify-between font-mono text-xs text-muted-foreground" aria-hidden="true">
            <span>{first ? formatDate(first.date) : ''}</span>
            <span>{middle ? formatDate(middle.date) : ''}</span>
            <span>{last ? formatDate(last.date) : ''}</span>
          </div>
        </div>
      )}
    </Panel>
  )
}

function TopPosts({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel title="Top posts" meta={<Badge variant="outline">Views</Badge>}>
      {data.topPosts.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">No post views in this range.</p>
      ) : (
        <ol className="space-y-1">
          {data.topPosts.map((post, index) => (
            <li key={post.postId} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted/50">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
              <Link
                to="/dashboard/posts/$postId/edit"
                params={{ postId: post.postId }}
                search={emptyPostEditorSearch}
                className="min-w-0 truncate text-base font-medium text-foreground underline-offset-4 hover:underline"
              >
                {post.title}
              </Link>
              <span className="font-mono text-sm tabular-nums text-foreground">{post.views.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function Referrers({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel title="Referrers" meta={<Badge variant="outline">External</Badge>}>
      {data.referrers.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">No external referrers in this range.</p>
      ) : (
        <ol className="space-y-1">
          {data.referrers.map((referrer) => (
            <li key={referrer.domain} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{referrer.domain}</p>
                {referrer.ai ? <p className="mt-1 text-xs text-muted-foreground">AI referral · {referrer.operator}</p> : null}
              </div>
              <span className="font-mono text-sm tabular-nums text-foreground">{referrer.views.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function AiCrawlerPanel({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel
      title="AI discovery"
      meta={<Badge className="border-brand-bright/30 bg-brand-bright/10 text-primary">Crawler activity</Badge>}
    >
      <div className="mb-5 max-w-3xl space-y-2">
        <p className="text-base leading-7 text-muted-foreground">
          Requests from published AI crawler identities over the last {data.aiCrawlers.lookbackDays} days, including ChatGPT, Claude, Perplexity, and other major operators.
        </p>
        <p className="font-mono text-xs leading-5 text-muted-foreground">
          Identity is matched from Cloudflare request analytics using official user-agent tokens. User agents can be spoofed.
        </p>
      </div>
      {data.aiCrawlers.status === 'unavailable' ? (
        <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
          AI crawler reporting is not configured for this deployment. Human page views and AI referrals are still tracked.
        </p>
      ) : data.aiCrawlers.agents.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">No AI crawler requests in the last {data.aiCrawlers.lookbackDays} days.</p>
      ) : (
        <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          {data.aiCrawlers.agents.map((crawler) => (
            <div key={crawler.agent} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium text-foreground">{crawler.agent}</p>
                <p className="mt-1 text-xs text-muted-foreground">{crawler.operator} · {crawler.category}</p>
              </div>
              <span className="font-mono text-sm tabular-nums text-foreground">{crawler.requests.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function LockedAnalytics({ retentionDays }: { retentionDays: number }) {
  return (
    <Panel title="Analytics is included with vibecms Cloud">
      <div className="max-w-2xl py-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><LockKeyhole className="size-5" /></span>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">See what readers and AI systems discover.</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Unlock page-view trends, top posts, referring domains, AI referrals, and named crawler activity with {retentionDays}-day reporting.
        </p>
        <Button asChild className="mt-6"><a href="/dashboard/settings#plan">View plan</a></Button>
      </div>
    </Panel>
  )
}

export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>(30)
  const [data, setData] = useState<AnalyticsPageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError(null)
    void loadAnalyticsPage(range, controller.signal)
      .then(setData)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setError('Could not load analytics.')
      })
    return () => controller.abort()
  }, [range])

  const headerAction = useMemo(() => <RangeControl value={range} onChange={setRange} />, [range])

  if (error) return <LoadError message={error} />
  if (!data) return <AnalyticsSkeleton />

  return (
    <>
      <PageHeader
        kicker="Analytics"
        title="Readers and AI discovery"
        description="Privacy-friendly post analytics without cookies, IP storage, or visitor profiles."
        action={data.status === 'available' ? headerAction : undefined}
      />

      {data.status === 'locked' ? <LockedAnalytics retentionDays={data.retentionDays} /> : null}
      {data.status === 'unavailable' ? (
        <Panel title="Analytics unavailable">
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {data.reason === 'self_hosted'
              ? 'Managed analytics is a vibecms Cloud feature. Self-hosted sites can use Cloudflare Web Analytics or their own analytics stack.'
              : data.reason === 'not_configured'
                ? 'Analytics credentials have not been configured for this deployment.'
                : 'Cloudflare analytics could not be queried. Try again in a few minutes.'}
          </p>
        </Panel>
      ) : null}
      {data.status === 'available' ? (
        <>
          <MetricStrip data={data} />
          <TrafficChart data={data} />
          <div className="grid gap-6 xl:grid-cols-2">
            <TopPosts data={data} />
            <Referrers data={data} />
          </div>
          <AiCrawlerPanel data={data} />
          <p className="font-mono text-xs leading-5 text-muted-foreground">
            {data.retentionDays}-day retention · Cookie-free · DNT and Global Privacy Control respected · No IP addresses or visitor identifiers stored
          </p>
        </>
      ) : null}
    </>
  )
}
