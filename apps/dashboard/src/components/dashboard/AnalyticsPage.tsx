import { BarChartIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Link } from '@tanstack/react-router'
import { Badge, Button, Skeleton } from '@vc/ui'
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, Panel } from '~/components/dashboard/blocks'
import { loadAnalyticsPage } from '~/lib/api-client'
import { emptyPostEditorSearch } from '~/lib/dashboard-search'
import type { AnalyticsPageData, AnalyticsRange } from '~/types/dashboard'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { MetricStrip as SharedMetricStrip } from '~/components/dashboard/blocks'

const RANGE_OPTIONS: AnalyticsRange[] = [7, 30, 90, 365, 'all']
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

const trafficChartConfig = {
  views: { label: 'Views', color: 'var(--chart-1)' },
  aiCrawlerRequests: { label: 'AI crawlers', color: 'var(--chart-2)' },
} satisfies ChartConfig

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
          {option === 'all' ? 'All' : option === 365 ? '1y' : `${option}d`}
        </Button>
      ))}
    </div>
  )
}

function MetricStrip({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const allTime = data.rangeDays === 'all'
  const metrics = [
    {
      label: allTime ? 'Lifetime views' : 'Page views',
      value: compactNumber.format(data.views),
      detail: allTime ? 'Since analytics collection began' : trendLabel(data.trendPercent),
    },
    {
      label: allTime ? 'Detailed history' : 'Previous period',
      value: allTime ? '1 year' : data.previousViews === null ? '—' : compactNumber.format(data.previousViews),
      detail: allTime ? 'Older history is retained monthly' : `${data.rangeDays} days before this range`,
    },
    { label: 'AI referrals', value: compactNumber.format(data.aiReferralViews), detail: 'Human visits sent by AI services' },
    {
      label: 'AI crawler requests',
      value: data.aiCrawlers.status === 'available' ? compactNumber.format(data.aiCrawlers.requests) : '—',
      detail: data.aiCrawlers.status === 'available'
        ? allTime ? 'Since collection began' : `Last ${data.aiCrawlers.lookbackDays} days`
        : 'Crawler feed is not configured',
    },
  ]

  return <SharedMetricStrip metrics={metrics} />
}

function TrafficChart({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const chartData = data.series.map((point) => ({
    date: formatDate(point.date),
    views: point.views,
    aiCrawlerRequests: point.aiCrawlerRequests,
  }))

  return (
    <Panel
      title="Traffic over time"
      meta={
        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-foreground" />Views</span>
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-bright" />AI crawlers · {data.rangeDays === 'all' ? 'all time' : `${data.aiCrawlers.lookbackDays}d`}</span>
        </div>
      }
    >
      {data.views === 0 && data.aiCrawlers.requests === 0 ? (
        <EmptyState
          icon={<BarChartIcon />}
          title="No traffic recorded yet"
          description="Open a published post to verify collection. New page views appear here within a few minutes."
          action={
            <Button asChild>
              <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>Create a post</Link>
            </Button>
          }
        />
      ) : (
        <ChartContainer config={trafficChartConfig} className="h-56 w-full">
          <LineChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => value}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={40}
            />
            <ChartTooltip
              content={<ChartTooltipContent indicator="line" />}
            />
            <Line dataKey="views" type="monotone" stroke="var(--color-views)" strokeWidth={2} dot={false} />
            {data.aiCrawlers.status === 'available' ? (
              <Line dataKey="aiCrawlerRequests" type="monotone" stroke="var(--color-aiCrawlerRequests)" strokeWidth={2} dot={false} />
            ) : null}
          </LineChart>
        </ChartContainer>
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
            <li key={post.postId} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0">
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
            <li key={referrer.domain} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0">
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
          Requests from published AI crawler identities {data.rangeDays === 'all' ? 'since collection began' : `over the last ${data.aiCrawlers.lookbackDays} days`}, including ChatGPT, Claude, Perplexity, and other major operators.
        </p>
        <p className="font-mono text-xs leading-5 text-muted-foreground">
          Identity is matched from Cloudflare request analytics using official user-agent tokens. User agents can be spoofed.
        </p>
      </div>
      {data.aiCrawlers.status === 'unavailable' ? (
        <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
          AI crawler reporting is not configured for this deployment. Human page views and AI referrals are still tracked.
        </p>
      ) : data.aiCrawlers.agents.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">No AI crawler requests {data.rangeDays === 'all' ? 'since collection began' : `in the last ${data.aiCrawlers.lookbackDays} days`}.</p>
      ) : (
        <div className="grid gap-x-8 md:grid-cols-2">
          {data.aiCrawlers.agents.map((crawler) => (
            <div key={crawler.agent} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0 md:border-b-0">
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

function LockedAnalytics() {
  return (
    <Panel title="Analytics is included with vibecms Cloud">
      <div className="max-w-2xl py-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><LockClosedIcon className="size-5" /></span>
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">See what readers and AI systems discover.</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Unlock lifetime page-view totals, one year of daily trends, older monthly history, top posts, referring domains, AI referrals, and named crawler activity.
        </p>
        <Button asChild className="mt-6">
                    <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
            View plan
          </Link>
        </Button>
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
        title="Readers and AI discovery"
        description="Privacy-friendly post analytics without cookies, IP storage, or visitor profiles."
        action={data.status === 'available' ? headerAction : undefined}
      />

      {data.status === 'locked' ? <LockedAnalytics /> : null}
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
            Lifetime totals · One year of daily detail · Older history retained monthly · Cookie-free · DNT and Global Privacy Control respected · No IP addresses or visitor identifiers stored
          </p>
        </>
      ) : null}
    </>
  )
}
