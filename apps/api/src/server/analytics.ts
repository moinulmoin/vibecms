import { env } from 'cloudflare:workers'
import { createDataAccess, createD1DomainRepository } from '@vc/db'
import { listCustomDomains } from '@vc/core'
import { getBilling, isSelfHosted } from '@/server/billing'
import type { AppUserContext } from '@/server/onboarding'

export const ANALYTICS_RETENTION_DAYS = 90
export type AnalyticsRange = 7 | 30 | 90

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
      previousViews: number
      trendPercent: number | null
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

async function queryAnalyticsEngine(
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
  if (!response.ok) throw new Error(`analytics_sql_${response.status}`)
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

type AiCrawlerQueryResult = {
  requests: number
  lookbackDays: number
  byDate: Map<string, number>
  agents: Array<{ agent: string; operator: string; category: string; requests: number }>
}

async function queryAiCrawlers(
  hosts: string[],
  rangeDays: AnalyticsRange,
  config: { zoneId: string; token: string },
  fetcher: Fetcher,
): Promise<AiCrawlerQueryResult> {
  const lookbackDays = Math.min(rangeDays, 7)
  const latest = Date.now()
  const earliest = latest - lookbackDays * 86_400_000
  const intervals = Array.from({ length: lookbackDays }, (_, index) => {
    const to = new Date(latest - index * 86_400_000)
    const from = new Date(Math.max(earliest, to.getTime() - 86_400_000))
    return { from: from.toISOString(), to: to.toISOString() }
  })
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

  return { lookbackDays, requests, byDate, agents: [...byAgent.values()].sort((a, b) => b.requests - a.requests) }
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

export async function loadAnalyticsForApp(
  app: AppUserContext,
  rangeDays: AnalyticsRange,
  fetcher: Fetcher = fetch,
): Promise<AnalyticsPageData> {
  if (isSelfHosted()) return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'self_hosted' }
  const billing = await getBilling(app.workspaceId)
  if (billing.status !== 'active') return { status: 'locked', retentionDays: ANALYTICS_RETENTION_DAYS }

  const accountId = env.ANALYTICS_ACCOUNT_ID?.trim()
  const dataset = sqlIdentifier(env.ANALYTICS_DATASET?.trim() ?? '')
  const token = env.ANALYTICS_API_TOKEN?.trim()
  if (!accountId || !dataset || !token) {
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'not_configured' }
  }

  const site = sqlString(app.siteId)
  const currentStart = rangeDays - 1
  const previousStart = rangeDays * 2 - 1
  const currentFilter = `index1 = ${site} AND blob1 = 'page_view' AND timestamp >= toStartOfDay(NOW()) - INTERVAL '${currentStart}' DAY`
  const previousFilter = `index1 = ${site} AND blob1 = 'page_view' AND timestamp >= toStartOfDay(NOW()) - INTERVAL '${previousStart}' DAY AND timestamp < toStartOfDay(NOW()) - INTERVAL '${currentStart}' DAY`
  const sqlConfig = { accountId, token }

  try {
    const [seriesRows, previousRows, postRows, referrerRows, hosts] = await Promise.all([
      queryAnalyticsEngine(
        `SELECT toStartOfDay(timestamp) AS date, SUM(_sample_interval) AS views FROM ${dataset} WHERE ${currentFilter} GROUP BY date ORDER BY date ASC`,
        sqlConfig,
        fetcher,
      ),
      queryAnalyticsEngine(`SELECT SUM(_sample_interval) AS views FROM ${dataset} WHERE ${previousFilter}`, sqlConfig, fetcher),
      queryAnalyticsEngine(
        `SELECT blob2 AS post_id, blob3 AS post_slug, SUM(_sample_interval) AS views FROM ${dataset} WHERE ${currentFilter} GROUP BY post_id, post_slug ORDER BY views DESC LIMIT 10`,
        sqlConfig,
        fetcher,
      ),
      queryAnalyticsEngine(
        `SELECT blob4 AS domain, SUM(_sample_interval) AS views FROM ${dataset} WHERE ${currentFilter} AND blob4 != '' GROUP BY domain ORDER BY views DESC LIMIT 10`,
        sqlConfig,
        fetcher,
      ),
      analyticsHosts(app),
    ])

    const humanByDate = new Map<string, number>()
    for (const row of seriesRows) {
      const date = dateKey(row.date)
      if (date) humanByDate.set(date, numberValue(row.views))
    }
    const views = [...humanByDate.values()].reduce((sum, count) => sum + count, 0)
    const previousViews = numberValue(previousRows[0]?.views)
    const trendPercent = previousViews > 0 ? Math.round(((views - previousViews) / previousViews) * 100) : null

    const data = createDataAccess(env.DB)
    const topPosts = await Promise.all(
      postRows.map(async (row) => {
        const postId = typeof row.post_id === 'string' ? row.post_id : ''
        const post = postId ? await data.posts.getPost(app.siteId, postId) : null
        return {
          postId,
          slug: post?.slug ?? (typeof row.post_slug === 'string' ? row.post_slug : ''),
          title: post?.title ?? 'Deleted post',
          views: numberValue(row.views),
        }
      }),
    )

    const referrers = referrerRows.map((row) => {
      const domain = typeof row.domain === 'string' ? row.domain : ''
      return { domain, views: numberValue(row.views), ...aiReferrer(domain) }
    })
    const aiReferralViews = referrers.filter((row) => row.ai).reduce((sum, row) => sum + row.views, 0)

    let crawlerData: AiCrawlerQueryResult | null = null
    const zoneId = env.CLOUDFLARE_ZONE_ID?.trim()
    if (zoneId && hosts.length > 0) {
      try {
        crawlerData = await queryAiCrawlers(hosts, rangeDays, { zoneId, token }, fetcher)
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', event: 'analytics_ai_crawler_query_failed', error: String(error) }))
      }
    }

    return {
      status: 'available',
      rangeDays,
      retentionDays: ANALYTICS_RETENTION_DAYS,
      views,
      previousViews,
      trendPercent,
      aiReferralViews,
      series: dateRange(rangeDays).map((date) => ({
        date,
        views: humanByDate.get(date) ?? 0,
        aiCrawlerRequests: crawlerData?.byDate.get(date) ?? 0,
      })),
      topPosts,
      referrers,
      aiCrawlers: crawlerData
        ? { status: 'available', lookbackDays: crawlerData.lookbackDays, requests: crawlerData.requests, agents: crawlerData.agents }
        : { status: 'unavailable', lookbackDays: 7, requests: 0, agents: [] },
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'analytics_query_failed', error: String(error) }))
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'query_failed' }
  }
}
