import { env } from 'cloudflare:workers'
import { createDataAccess, createD1DomainRepository, type AnalyticsRollupRecord } from '@vc/db'
import { listCustomDomains } from '@vc/core'
import { isSelfHosted } from '@/server/billing'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'
import type { AppUserContext } from '@/server/onboarding'

export const ANALYTICS_RETENTION_DAYS = 365
export type AnalyticsRange = 7 | 30 | 90 | 365 | 'all'

const AI_CRAWLERS = [
  { agent: 'GPTBot', operator: 'OpenAI', category: 'AI crawler' },
  { agent: 'ChatGPT-User', operator: 'OpenAI', category: 'AI assistant' },
  { agent: 'OAI-SearchBot', operator: 'OpenAI', category: 'AI search' },
  { agent: 'ClaudeBot', operator: 'Anthropic', category: 'AI crawler' },
  { agent: 'Claude-SearchBot', operator: 'Anthropic', category: 'AI search' },
  { agent: 'Claude-User', operator: 'Anthropic', category: 'AI assistant' },
  { agent: 'PerplexityBot', operator: 'Perplexity', category: 'AI search' },
  { agent: 'Perplexity-User', operator: 'Perplexity', category: 'AI assistant' },
  { agent: 'Google-CloudVertexBot', operator: 'Google', category: 'AI crawler' },
  { agent: 'Bytespider', operator: 'ByteDance', category: 'AI crawler' },
  { agent: 'CCBot', operator: 'Common Crawl', category: 'AI crawler' },
  { agent: 'meta-externalagent', operator: 'Meta', category: 'AI crawler' },
  { agent: 'meta-externalfetcher', operator: 'Meta', category: 'AI assistant' },
  { agent: 'FacebookBot', operator: 'Meta', category: 'AI crawler' },
  { agent: 'Applebot', operator: 'Apple', category: 'AI search' },
  { agent: 'Amazonbot', operator: 'Amazon', category: 'AI crawler' },
  { agent: 'DuckAssistBot', operator: 'DuckDuckGo', category: 'AI assistant' },
  { agent: 'MistralAI-User', operator: 'Mistral', category: 'AI assistant' },
] as const

const AI_REFERRERS = [
  { operator: 'OpenAI', domains: ['openai.com', 'chatgpt.com'] },
  { operator: 'Anthropic', domains: ['anthropic.com', 'claude.ai'] },
  { operator: 'Perplexity', domains: ['perplexity.ai'] },
  { operator: 'Google', domains: ['google.com', 'youtube.com'] },
  { operator: 'Microsoft', domains: ['bing.com', 'msn.com', 'microsoft.com'] },
  { operator: 'Meta', domains: ['facebook.com', 'instagram.com', 'whatsapp.com', 'meta.com'] },
  { operator: 'DuckDuckGo', domains: ['duckduckgo.com', 'duck.com'] },
  { operator: 'ByteDance', domains: ['bytedance.com', 'tiktok.com'] },
  { operator: 'Apple', domains: ['apple.com', 'icloud.com'] },
  { operator: 'Amazon', domains: ['amazon.com', 'alexa.com'] },
] as const

export type AnalyticsPageData =
  | { status: 'locked'; retentionDays: number }
  | { status: 'unavailable'; retentionDays: number; reason: 'self_hosted' | 'not_configured' | 'query_failed' }
  | {
      status: 'available'
      rangeDays: AnalyticsRange
      retentionDays: number
      views: number
      previousViews: number | null
      trendPercent: number | null
      seriesGranularity: 'day' | 'month'
      aiReferralViews: number
      series: Array<{ date: string; views: number; aiCrawlerRequests: number }>
      topPosts: Array<{ postId: string; slug: string; title: string; views: number }>
      referrers: Array<{ domain: string; views: number; ai: boolean; operator: string | null }>
      aiCrawlers: {
        status: 'available' | 'unavailable'
        lookbackDays: number
        requests: number
        agents: Array<{ agent: string; operator: string; category: string; requests: number }>
      }
    }

type SqlResponse = { data?: Array<Record<string, unknown>>; error?: string }
type Fetcher = typeof fetch

function sqlIdentifier(value: string): string | null {
  return /^[A-Za-z0-9_]+$/.test(value) ? value : null
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function queryAnalyticsEngine(
  query: string,
  config: { accountId: string; token: string },
  fetcher: Fetcher,
): Promise<Array<Record<string, unknown>>> {
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'text/plain' },
      body: `${query}\nFORMAT JSON`,
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) {
    const detail = (await response.text()).replaceAll(/\s+/g, ' ').slice(0, 500)
    throw new Error(`analytics_sql_${response.status}${detail ? `: ${detail}` : ''}`)
  }
  const payload = (await response.json()) as SqlResponse
  if (!Array.isArray(payload.data)) throw new Error(payload.error ?? 'analytics_sql_invalid_response')
  return payload.data
}

function dateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value)
  return match?.[0] ?? null
}

function dateRange(days: number): string[] {
  const dates: string[] = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset))
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

export function aiReferrer(domain: string): { ai: boolean; operator: string | null } {
  const normalized = domain.toLowerCase()
  for (const entry of AI_REFERRERS) {
    if (entry.domains.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`))) {
      return { ai: true, operator: entry.operator }
    }
  }
  return { ai: false, operator: null }
}

export function crawlerForUserAgent(userAgent: string) {
  const normalized = userAgent.toLowerCase()
  return AI_CRAWLERS.find((crawler) => normalized.includes(crawler.agent.toLowerCase())) ?? null
}

type GraphQlGroup = {
  count?: number
  dimensions?: {
    datetimeHour?: string
    userAgent?: string
    clientRequestPath?: string
    clientRequestHTTPHost?: string
  }
}

type GraphQlResponse = {
  data?: { viewer?: { zones?: Array<{ httpRequestsAdaptiveGroups?: GraphQlGroup[] }> } }
  errors?: Array<{ message?: string }>
}

const AI_CRAWLER_QUERY = `
query AiCrawlerRequests($zoneTag: string!, $from: Time!, $to: Time!, $host: string!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 5000
        orderBy: [count_DESC]
        filter: {
          datetime_geq: $from
          datetime_lt: $to
          requestSource: "eyeball"
          clientRequestHTTPHost: $host
          edgeResponseStatus_geq: 200
          edgeResponseStatus_lt: 400
          OR: [
${AI_CRAWLERS.map((crawler) => `            { userAgent_like: "%${crawler.agent}%" }`).join('\n')}
          ]
        }
      ) {
        count
        dimensions { datetimeHour userAgent clientRequestPath clientRequestHTTPHost }
      }
    }
  }
}`

export type AiCrawlerQueryResult = {
  requests: number
  lookbackDays: number
  byDate: Map<string, number>
  agents: Array<{ agent: string; operator: string; category: string; requests: number }>
}

async function queryAiCrawlerIntervals(
  hosts: string[],
  intervals: Array<{ from: string; to: string }>,
  config: { zoneId: string; token: string },
  fetcher: Fetcher,
): Promise<AiCrawlerQueryResult> {
  const groups = (
    await Promise.all(
      hosts.slice(0, 5).flatMap((host) =>
        intervals.map(async ({ from, to }) => {
          const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              query: AI_CRAWLER_QUERY,
              variables: { zoneTag: config.zoneId, from, to, host },
            }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!response.ok) throw new Error(`analytics_graphql_${response.status}`)
          const payload = (await response.json()) as GraphQlResponse
          if (payload.errors?.length) throw new Error(payload.errors[0]?.message ?? 'analytics_graphql_error')
          return payload.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []
        }),
      ),
    )
  ).flat()

  let requests = 0
  const byDate = new Map<string, number>()
  const byAgent = new Map<string, { agent: string; operator: string; category: string; requests: number }>()
  for (const group of groups) {
    const count = numberValue(group.count)
    const crawler = crawlerForUserAgent(group.dimensions?.userAgent ?? '')
    if (!crawler || count <= 0) continue
    requests += count
    const date = dateKey(group.dimensions?.datetimeHour)
    if (date) byDate.set(date, (byDate.get(date) ?? 0) + count)
    const current = byAgent.get(crawler.agent)
    if (current) current.requests += count
    else byAgent.set(crawler.agent, { ...crawler, requests: count })
  }

  return {
    lookbackDays: intervals.length,
    requests,
    byDate,
    agents: [...byAgent.values()].sort((a, b) => b.requests - a.requests),
  }
}

export async function queryAiCrawlersForPeriod(
  hosts: string[],
  from: string,
  to: string,
  config: { zoneId: string; token: string },
  fetcher: Fetcher = fetch,
): Promise<AiCrawlerQueryResult> {
  return queryAiCrawlerIntervals(hosts, [{ from, to }], config, fetcher)
}

async function queryAiCrawlers(
  hosts: string[],
  rangeDays: AnalyticsRange,
  config: { zoneId: string; token: string },
  fetcher: Fetcher,
): Promise<AiCrawlerQueryResult> {
  const lookbackDays = Math.min(typeof rangeDays === 'number' ? rangeDays : 7, 7)
  const latest = Date.now()
  const earliest = latest - lookbackDays * 86_400_000
  const intervals = Array.from({ length: lookbackDays }, (_, index) => {
    const to = new Date(latest - index * 86_400_000)
    const from = new Date(Math.max(earliest, to.getTime() - 86_400_000))
    return { from: from.toISOString(), to: to.toISOString() }
  })
  return queryAiCrawlerIntervals(hosts, intervals, config, fetcher)
}

async function analyticsHosts(app: AppUserContext): Promise<string[]> {
  const data = createDataAccess(env.DB)
  const [defaultHostname, domains] = await Promise.all([
    data.sites.getActiveDefaultHostname(app.siteId),
    listCustomDomains(createD1DomainRepository(env.DB), app.siteId),
  ])
  return [...new Set([defaultHostname, ...domains.filter((domain) => domain.status === 'active').map((domain) => domain.hostname)])]
    .filter((hostname): hostname is string => Boolean(hostname))
    .map((hostname) => hostname.toLowerCase())
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function sourceRecords(rows: Array<Record<string, unknown>>): AnalyticsRollupRecord[] {
  const records: AnalyticsRollupRecord[] = []
  for (const row of rows) {
    const periodStart = dateKey(row.date)
    const value = numberValue(row.views)
    if (!periodStart || value <= 0) continue
    records.push({ granularity: 'day', periodStart, kind: 'page', dimension: '', label: null, value })
    const postId = typeof row.post_id === 'string' ? row.post_id : ''
    if (postId) {
      records.push({
        granularity: 'day',
        periodStart,
        kind: 'post',
        dimension: postId,
        label: typeof row.post_slug === 'string' ? row.post_slug : null,
        value,
      })
    }
    const referrer = typeof row.referrer === 'string' ? row.referrer : ''
    if (referrer) {
      records.push({
        granularity: 'day',
        periodStart,
        kind: 'referrer',
        dimension: referrer,
        label: null,
        value,
      })
    }
  }
  return records
}

function addMetric(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value)
}

function monthSeriesKey(periodStart: string) {
  return `${periodStart.slice(0, 7)}-01`
}

export async function loadAnalyticsForApp(
  app: AppUserContext,
  rangeDays: AnalyticsRange,
  fetcher: Fetcher = fetch,
): Promise<AnalyticsPageData> {
  if (isSelfHosted()) {
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'self_hosted' }
  }
  const entitlement = await resolveEffectiveEntitlementForWorkspace(app.workspaceId)
  if (!entitlement.effective) {
    return { status: 'locked', retentionDays: ANALYTICS_RETENTION_DAYS }
  }

  const accountId = env.ANALYTICS_ACCOUNT_ID?.trim()
  const dataset = sqlIdentifier(env.ANALYTICS_DATASET?.trim() ?? '')
  const token = env.ANALYTICS_API_TOKEN?.trim()
  if (!accountId || !dataset || !token) {
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'not_configured' }
  }

  const today = todayKey()
  const yesterday = shiftDate(today, -1)
  const sourceFloor = shiftDate(today, -89)
  const currentStart = rangeDays === 'all' ? null : shiftDate(today, -(rangeDays - 1))
  const data = createDataAccess(env.DB)
  const sqlConfig = { accountId, token }

  try {
    const lastRolledDate = await data.analytics.getLastRolledDate(app.siteId)
    const sourceFrom = lastRolledDate
      ? today
      : currentStart && currentStart > sourceFloor
        ? currentStart
        : sourceFloor
    const sourceRows = await queryAnalyticsEngine(
      `SELECT toDate(timestamp) AS date, blob2 AS post_id, blob3 AS post_slug, blob4 AS referrer, SUM(_sample_interval) AS views
       FROM ${dataset}
       WHERE index1 = ${sqlString(app.siteId)}
         AND blob1 = 'page_view'
         AND timestamp >= toDateTime('${sourceFrom} 00:00:00')
         AND timestamp < toDateTime('${today} 00:00:00') + INTERVAL '1' DAY
       GROUP BY date, post_id, post_slug, referrer`,
      sqlConfig,
      fetcher,
    )

    const storedRows = rangeDays === 'all'
      ? [
          ...(await data.analytics.listMonthly(app.siteId)),
          ...(await data.analytics.listDaily(app.siteId, '0000-01-01', yesterday)),
        ]
      : await data.analytics.listDaily(app.siteId, currentStart!, yesterday)
    const records = [...storedRows, ...sourceRecords(sourceRows)]

    let previousViews: number | null = null
    if (rangeDays !== 'all' && rangeDays <= 90) {
      const previousEnd = shiftDate(currentStart!, -1)
      const previousStart = shiftDate(previousEnd, -(rangeDays - 1))
      const previousStored = await data.analytics.listDaily(app.siteId, previousStart, previousEnd)
      previousViews = previousStored
        .filter((row) => row.kind === 'page')
        .reduce((sum, row) => sum + row.value, 0)
      if (!lastRolledDate && previousEnd >= sourceFloor) {
        const boundedStart = previousStart < sourceFloor ? sourceFloor : previousStart
        const previousRows = await queryAnalyticsEngine(
          `SELECT SUM(_sample_interval) AS views FROM ${dataset}
           WHERE index1 = ${sqlString(app.siteId)}
             AND blob1 = 'page_view'
             AND timestamp >= toDateTime('${boundedStart} 00:00:00')
             AND timestamp < toDateTime('${previousEnd} 00:00:00') + INTERVAL '1' DAY`,
          sqlConfig,
          fetcher,
        )
        previousViews += numberValue(previousRows[0]?.views)
      }
    }

    const hosts = await analyticsHosts(app)
    const zoneId = env.CLOUDFLARE_ZONE_ID?.trim()
    let liveCrawler: AiCrawlerQueryResult | null = null
    if (zoneId && hosts.length > 0) {
      try {
        liveCrawler = lastRolledDate
          ? await queryAiCrawlersForPeriod(
              hosts,
              `${today}T00:00:00.000Z`,
              new Date().toISOString(),
              { zoneId, token },
              fetcher,
            )
          : await queryAiCrawlers(hosts, rangeDays, { zoneId, token }, fetcher)
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', event: 'analytics_ai_crawler_query_failed', error: String(error) }))
      }
    }

    if (liveCrawler) {
      for (const agent of liveCrawler.agents) {
        records.push({
          granularity: 'day',
          periodStart: today,
          kind: 'crawler',
          dimension: agent.agent,
          label: agent.operator,
          value: agent.requests,
        })
      }
    }

    const views = records.filter((row) => row.kind === 'page').reduce((sum, row) => sum + row.value, 0)
    const trendPercent = previousViews && previousViews > 0
      ? Math.round(((views - previousViews) / previousViews) * 100)
      : null

    const posts = new Map<string, { slug: string; views: number }>()
    const referrerTotals = new Map<string, number>()
    const crawlerTotals = new Map<string, { operator: string; category: string; requests: number }>()
    const pageSeries = new Map<string, number>()
    const crawlerSeries = new Map<string, number>()

    for (const row of records) {
      const seriesKey = rangeDays === 'all' ? monthSeriesKey(row.periodStart) : row.periodStart
      if (row.kind === 'page') addMetric(pageSeries, seriesKey, row.value)
      if (row.kind === 'post') {
        const current = posts.get(row.dimension)
        if (current) current.views += row.value
        else posts.set(row.dimension, { slug: row.label ?? '', views: row.value })
      }
      if (row.kind === 'referrer') addMetric(referrerTotals, row.dimension, row.value)
      if (row.kind === 'crawler') {
        addMetric(crawlerSeries, seriesKey, row.value)
        const crawler = crawlerForUserAgent(row.dimension)
        const current = crawlerTotals.get(row.dimension)
        if (current) current.requests += row.value
        else {
          crawlerTotals.set(row.dimension, {
            operator: row.label ?? crawler?.operator ?? 'Unknown',
            category: crawler?.category ?? 'AI crawler',
            requests: row.value,
          })
        }
      }
    }

    const topPosts = await Promise.all(
      [...posts]
        .sort((a, b) => b[1].views - a[1].views)
        .slice(0, 10)
        .map(async ([postId, metric]) => {
          const post = await data.posts.getPost(app.siteId, postId)
          return {
            postId,
            slug: post?.slug ?? metric.slug,
            title: post?.title ?? 'Deleted post',
            views: metric.views,
          }
        }),
    )
    const referrers = [...referrerTotals]
      .map(([domain, count]) => ({ domain, views: count, ...aiReferrer(domain) }))
      .sort((a, b) => b.views - a.views)
    const aiReferralViews = referrers.filter((row) => row.ai).reduce((sum, row) => sum + row.views, 0)
    const agents = [...crawlerTotals]
      .map(([agent, metric]) => ({ agent, ...metric }))
      .sort((a, b) => b.requests - a.requests)
    const seriesKeys = rangeDays === 'all'
      ? [...new Set([...pageSeries.keys(), ...crawlerSeries.keys()])].sort()
      : dateRange(rangeDays)

    return {
      status: 'available',
      rangeDays,
      retentionDays: ANALYTICS_RETENTION_DAYS,
      views,
      previousViews,
      trendPercent,
      seriesGranularity: rangeDays === 'all' ? 'month' : 'day',
      aiReferralViews,
      series: seriesKeys.map((date) => ({
        date,
        views: pageSeries.get(date) ?? 0,
        aiCrawlerRequests: crawlerSeries.get(date) ?? 0,
      })),
      topPosts,
      referrers: referrers.slice(0, 10),
      aiCrawlers: {
        status: liveCrawler || agents.length > 0 ? 'available' : 'unavailable',
        lookbackDays: rangeDays === 'all' ? ANALYTICS_RETENTION_DAYS : rangeDays,
        requests: agents.reduce((sum, agent) => sum + agent.requests, 0),
        agents,
      },
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'analytics_query_failed', error: String(error) }))
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'query_failed' }
  }
}
