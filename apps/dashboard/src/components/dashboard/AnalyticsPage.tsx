import { BarChart3, LockKeyhole } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, cn } from '@vc/ui'
import type { ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { EmptyState, ListRow, PageHeader, PageSkeleton, Panel } from '~/components/dashboard/blocks'
import { analyticsQuery } from '~/lib/queries'
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
function TopPosts({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel title="Top posts" meta="Views">
      {data.topPosts.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No post views"
          description="No post views in this range."
        />
      ) : (
        <div>
          {data.topPosts.map((post, index) => (
            <RankedRow
              key={post.postId}
              index={index}
              count={post.views}
              label={
                <Link
                  to="/dashboard/posts/$postId/edit"
                  params={{ postId: post.postId }}
                  search={emptyPostEditorSearch}
                  className="block truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {post.title}
                </Link>
              }
            />
          ))}
        </div>
      )}
    </Panel>
  )
}



function RangeControl({ value, onChange }: { value: AnalyticsRange; onChange: (value: AnalyticsRange) => void }) {
  return (
    <nav className="flex gap-0.5 overflow-x-auto rounded-lg border border-border p-0.5" aria-label="Date range">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === option ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option === 'all' ? 'All' : option === 365 ? '1y' : `${option}d`}
        </button>
      ))}
    </nav>
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
          icon={<BarChart3 />}
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

function RankedRow({
  index,
  label,
  detail,
  count,
}: {
  index: number
  label: ReactNode
  detail?: ReactNode
  count: number
}) {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0">
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
      <div className="min-w-0">
        {label}
        {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
      </div>
      <span className="font-mono text-sm tabular-nums text-foreground">{count.toLocaleString()}</span>
    </div>
  )
}

function Referrers({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel title="Referrers" meta="Views">
      {data.referrers.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No referrers"
          description="No external referrers in this range."
        />
      ) : (
        <div>
          {data.referrers.map((referrer, index) => (
            <RankedRow
              key={referrer.domain}
              index={index}
              count={referrer.views}
              label={<span className="block truncate font-mono text-sm text-foreground">{referrer.domain}</span>}
              detail={referrer.ai ? <>AI referral · {referrer.operator}</> : undefined}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

function AiCrawlerPanel({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  return (
    <Panel title="AI crawlers">
      <div className="mb-5 max-w-3xl space-y-2">
        <p className="text-[0.9375rem] leading-7 text-muted-foreground">
          Requests from known AI crawlers {data.rangeDays === 'all' ? 'since collection began' : `over the last ${data.aiCrawlers.lookbackDays} days`}, including ChatGPT, Claude, Perplexity, and other major operators.
        </p>
        <p className="text-sm leading-5 text-muted-foreground">
          Identity is matched from Cloudflare request analytics using official user-agent tokens. User agents can be spoofed.
        </p>
      </div>
      {data.aiCrawlers.status === 'unavailable' ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="Crawler reporting unavailable"
          description="Human page views and AI referrals are still tracked."
        />
      ) : data.aiCrawlers.agents.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No crawler requests"
          description={data.rangeDays === 'all' ? 'None since collection began.' : `None in the last ${data.aiCrawlers.lookbackDays} days.`}
        />
      ) : (
        <div className="grid gap-x-8 md:grid-cols-2">
          {data.aiCrawlers.agents.map((crawler) => (
            <ListRow
              key={crawler.agent}
              title={<span className="truncate font-sans text-sm font-medium text-foreground">{crawler.agent}</span>}
              description={<span>{crawler.operator} · {crawler.category}</span>}
              actions={<span className="font-mono text-sm tabular-nums text-foreground">{crawler.requests.toLocaleString()}</span>}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

function LockedAnalytics() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-6">
      <span className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground">
        <LockKeyhole className="size-4" aria-hidden />
      </span>
      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
          See who reads, and which AI tools find you
        </h2>
        <p className="text-[0.9375rem] leading-7 text-muted-foreground">
          Page views, top posts, where readers come from, and AI crawler visits. Included with the paid plan.
        </p>
      </div>
      <Button asChild>
        <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
          See plans
        </Link>
      </Button>
    </div>
  )
}

export function AnalyticsPage({ range = 30 }: { range?: AnalyticsRange }) {
  const navigate = useNavigate()
  const query = useQuery({ ...analyticsQuery(range), placeholderData: keepPreviousData })
  const data = query.data
  const setRange = (next: AnalyticsRange) =>
    void navigate({ to: '/dashboard/analytics', search: { range: next === 30 ? undefined : next }, replace: true })
  const headerAction = <RangeControl value={range} onChange={setRange} />

  if (query.isError && !data) {
    return (
      <>
        <PageHeader title="Analytics" />
        <LoadError message="Analytics didn’t load. Try again in a moment." onRetry={() => void query.refetch()} />
      </>
    )
  }
  if (!data) return <PageSkeleton variant="stats" />

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Private by design: no cookies, no IP addresses, no visitor profiles."
        action={data.status === 'available' ? headerAction : undefined}
      />

      {data.status === 'locked' ? <LockedAnalytics /> : null}
      {data.status === 'unavailable' ? (
        <div className="max-w-2xl py-4">
          <p className="text-[0.9375rem] leading-7 text-muted-foreground">
            {data.reason === 'self_hosted'
              ? 'Managed analytics is a vibecms Cloud feature. Self-hosted sites can use Cloudflare Web Analytics or their own analytics stack.'
              : data.reason === 'not_configured'
                ? 'Analytics credentials have not been configured for this deployment.'
                : 'Analytics couldn’t be read right now. Try again in a few minutes.'}
          </p>
        </div>
      ) : null}
      {data.status === 'available' ? (
        <div className={cn('grid gap-6 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <MetricStrip data={data} />
          <TrafficChart data={data} />
          <div className="grid gap-6 xl:grid-cols-2">
            <TopPosts data={data} />
            <Referrers data={data} />
          </div>
          <AiCrawlerPanel data={data} />
          <p className="text-sm leading-6 text-muted-foreground">
            Daily detail for a year, monthly after that. Do Not Track and Global Privacy Control are respected.
          </p>
        </div>
      ) : null}
    </>
  )
}
