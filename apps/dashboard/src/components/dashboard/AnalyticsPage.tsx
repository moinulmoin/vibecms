import { SegmentedControl } from '~/components/ui/segmented-control'
import { BarChart3, LockKeyhole } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, cn } from '@vc/ui'
import { AGENT_CATEGORY_LABELS } from '@vc/config/agents'
import type { ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, PageTabs, Panel } from '~/components/dashboard/blocks'
import { analyticsQuery } from '~/lib/queries'
import { emptyPostEditorSearch } from '~/lib/dashboard-search'
import type { AgentAnalytics, AgentCategory, AnalyticsPageData, AnalyticsRange } from '~/types/dashboard'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { MetricStrip as SharedMetricStrip } from '~/components/dashboard/blocks'
import { Tabs, TabsContent } from '~/components/ui/tabs'

export type AnalyticsTab = 'people' | 'agents'

const RANGE_OPTIONS: AnalyticsRange[] = [7, 30, 90, 365, 'all']
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const dateLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function analyticsUnavailableMessage(reason: Extract<AnalyticsPageData, { status: 'unavailable' }>['reason']) {
  if (reason === 'self_hosted') return 'Managed analytics is a vibecms Cloud feature. Self-hosted sites can use Cloudflare Web Analytics or their own analytics stack.'
  if (reason === 'not_configured') return 'Analytics isn’t available for this blog yet. Try again later.'
  return 'Analytics couldn’t be read right now. Try again in a few minutes.'
}

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
} satisfies ChartConfig

const agentChartConfig = {
  agentReads: { label: 'Agent reads', color: 'var(--chart-2)' },
} satisfies ChartConfig

/** Display order for agent categories: human-serving agents first, then
 *  crawlers, then generic/unmatched traffic. Independent of the palette. */
const AGENT_CATEGORY_ORDER: AgentCategory[] = [
  'ai-assistant',
  'ai-search',
  'ai-training',
  'search-engine',
  'other-bot',
  'unknown-agent',
]

const AGENT_CATEGORY_COLORS: Record<AgentCategory, string> = {
  'ai-assistant': 'var(--chart-2)',
  'ai-search': 'var(--chart-3)',
  'ai-training': 'var(--chart-5)',
  'search-engine': 'var(--chart-1)',
  'other-bot': 'var(--chart-4)',
  'unknown-agent': 'var(--muted-foreground)',
}

export function TopPosts({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
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
                  className="block break-words text-sm font-medium text-foreground underline-offset-4 hover:underline"
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
    <SegmentedControl
      label="Date range"
      className="max-w-full overflow-x-auto"
      value={String(value)}
      onChange={(next) => onChange(next === 'all' ? 'all' : (Number(next) as AnalyticsRange))}
      options={RANGE_OPTIONS.map((option) => ({
        value: String(option),
        label: <span className="tabular-nums">{option === 'all' ? 'All' : option === 365 ? '1y' : `${option}d`}</span>,
      }))}
    />
  )
}

function MetricStrip({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const allTime = data.rangeDays === 'all'
  const metrics = [
    {
      label: allTime ? 'Lifetime views' : 'Page views',
      value: compactNumber.format(data.views),
      detail: allTime
        ? 'Daily for a year, monthly before that'
        : data.previousViews === null || data.trendPercent === null
          ? 'Nothing earlier to compare with'
          : `${trendLabel(data.trendPercent)} (${compactNumber.format(data.previousViews)})`,
    },
    {
      label: 'Agent reads',
      value: data.agents ? compactNumber.format(data.agents.total) : '—',
      detail: 'Fetches by AI assistants, crawlers, and bots',
    },
    { label: 'AI referrals', value: compactNumber.format(data.aiReferralViews), detail: 'Visits sent by AI assistants' },
  ]

  return <SharedMetricStrip metrics={metrics} columns={3} />
}

function TrafficChart({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const chartData = data.series.map((point) => ({
    date: formatDate(point.date),
    views: point.views,
  }))

  return (
    <Panel title="Traffic over time">
      {data.views === 0 ? (
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
              allowDecimals={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent indicator="line" />}
            />
            <Line dataKey="views" type="monotone" stroke="var(--color-views)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      )}
    </Panel>
  )
}

/** Daily agent reads. The API merges legacy crawler counts into this series so
 *  days before agent classification shipped still show traffic. */
function AgentReadsChart({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const chartData = data.series.map((point) => ({
    date: formatDate(point.date),
    agentReads: point.aiCrawlerRequests,
  }))
  const hasLegacy = data.aiCrawlers.requests > 0

  return (
    <Panel
      title="Agent reads over time"
      description={
        hasLegacy
          ? 'Agent reads per day. Days before agent classification shipped keep counts collected by the crawler feed.'
          : 'Agent reads per day.'
      }
    >
      <ChartContainer config={agentChartConfig} className="h-56 w-full">
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
            allowDecimals={false}
          />
          <ChartTooltip
            content={<ChartTooltipContent indicator="line" />}
          />
          <Line dataKey="agentReads" type="monotone" stroke="var(--color-agentReads)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </Panel>
  )
}

/** Period totals per category. Per-day category splits are not stored, so the
 *  split is a bar for the selected range, not a stacked trend. */
function ReadsByCategory({ agents }: { agents: AgentAnalytics }) {
  const rows = AGENT_CATEGORY_ORDER
    .map((category) => ({
      category,
      fetches: agents.byCategory.find((row) => row.category === category)?.fetches ?? 0,
    }))
    .filter((row) => row.fetches > 0)

  return (
    <Panel title="Reads by category" description="What kind of agent fetched this site in the selected range.">
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No agent reads"
          description="No agent reads in this range."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const share = Math.max(1, Math.round((row.fetches / agents.total) * 100))
            return (
              <li key={row.category} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: AGENT_CATEGORY_COLORS[row.category] }} />
                    {AGENT_CATEGORY_LABELS[row.category]}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-foreground">{row.fetches.toLocaleString()}</span>
                </div>
                <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: AGENT_CATEGORY_COLORS[row.category] }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function TopAgents({ agents }: { agents: AgentAnalytics }) {
  return (
    <Panel title="Top agents" meta="Reads">
      {agents.topAgents.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No agent reads"
          description="No agent reads in this range."
        />
      ) : (
        <div>
          {agents.topAgents.map((agent, index) => (
            <RankedRow
              key={agent.id}
              index={index}
              count={agent.fetches}
              label={<span className="block truncate text-sm font-medium text-foreground">{agent.label}</span>}
              detail={<>{agent.operator} · {AGENT_CATEGORY_LABELS[agent.category] ?? agent.category}</>}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

function AgentTopPosts({ agents }: { agents: AgentAnalytics }) {
  return (
    <Panel title="Posts agents read most" meta="Reads">
      {agents.topPosts.length === 0 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title="No posts read"
          description="No agent reads on posts in this range."
        />
      ) : (
        <div>
          {agents.topPosts.map((post, index) => (
            <RankedRow
              key={post.postId}
              index={index}
              count={post.fetches}
              label={
                <Link
                  to="/dashboard/posts/$postId/edit"
                  params={{ postId: post.postId }}
                  search={emptyPostEditorSearch}
                  className="block break-words text-sm font-medium text-foreground underline-offset-4 hover:underline"
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

function AgentStats({ agents }: { agents: AgentAnalytics }) {
  const none = agents.total === 0
  return (
    <SharedMetricStrip
      variant="inset"
      columns={3}
      metrics={[
        {
          label: 'Markdown requests',
          value: none ? '—' : `${agents.markdownShare}%`,
          detail: 'Share of agent reads that asked for Markdown',
        },
        {
          label: 'llms.txt reads',
          value: compactNumber.format(agents.llmsReads),
          detail: 'Fetches of llms.txt and llms-full.txt',
        },
        {
          label: 'Signed requests',
          value: none ? '—' : `${agents.signedShare}%`,
          detail: 'Share carrying a Signature-Agent header',
        },
      ]}
    />
  )
}


function AgentsTab({ data }: { data: Extract<AnalyticsPageData, { status: 'available' }> }) {
  const agents = data.agents
  // Older API payloads predate the agents breakdown; the crawler trend still
  // renders, and the rest shows a short note instead of missing panels.
  if (!agents) {
    return (
      <>
        <AgentReadsChart data={data} />
        <Panel title="Agent reads">
          <EmptyState
            icon={<BarChart3 />}
            title="Agent details aren’t available yet"
            description="This breakdown needs a newer API. The daily trend above still shows agent traffic."
          />
        </Panel>
      </>
    )
  }
  if (agents.total === 0 && data.aiCrawlers.requests === 0) {
    return (
      <Panel title="Agent reads">
        <EmptyState
          icon={<BarChart3 />}
          title="No agent reads yet"
          description="An agent read is any request to your site that isn't a person in a browser — AI assistants and search crawlers, plus fetches of Markdown, feeds, or llms.txt. Numbers update daily."
        />
      </Panel>
    )
  }

  return (
    <>
      <AgentReadsChart data={data} />
      <div className="grid gap-6 xl:grid-cols-2">
        <TopAgents agents={agents} />
        <ReadsByCategory agents={agents} />
      </div>
      <AgentTopPosts agents={agents} />
      <AgentStats agents={agents} />
      <p className="text-sm leading-6 text-muted-foreground">
        Agent identity comes from the user agent or the representation requested; request signatures are counted, not verified. Numbers update daily.
      </p>
    </>
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

export function AnalyticsPage({ range = 30, tab = 'people' }: { range?: AnalyticsRange; tab?: AnalyticsTab }) {
  const navigate = useNavigate()
  const query = useQuery({ ...analyticsQuery(range), placeholderData: keepPreviousData })
  const data = query.data
  const setRange = (next: AnalyticsRange) =>
    void navigate({
      to: '/dashboard/analytics',
      search: { range: next === 30 ? undefined : next, tab: tab === 'people' ? undefined : tab },
      replace: true,
    })
  const setTab = (next: AnalyticsTab) =>
    void navigate({
      to: '/dashboard/analytics',
      search: { range: range === 30 ? undefined : range, tab: next === 'people' ? undefined : next },
      replace: true,
    })
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
            {analyticsUnavailableMessage(data.reason)}
          </p>
        </div>
      ) : null}
      {data.status === 'available' ? (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value === 'agents' ? 'agents' : 'people')}
          className={cn('gap-6 transition-opacity', query.isPlaceholderData && 'opacity-60')}
        >
          <PageTabs
            label="Analytics audience"
            tabs={[
              { value: 'people', label: 'People' },
              { value: 'agents', label: 'Agents' },
            ]}
          />
          <MetricStrip data={data} />
          <TabsContent value="people" className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <TrafficChart data={data} />
            <div className="grid gap-6 xl:grid-cols-2">
              <TopPosts data={data} />
              <Referrers data={data} />
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Daily detail for a year, monthly after that. Do Not Track and Global Privacy Control are respected.
            </p>
          </TabsContent>
          <TabsContent value="agents" className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <AgentsTab data={data} />
          </TabsContent>
        </Tabs>
      ) : null}
    </>
  )
}
