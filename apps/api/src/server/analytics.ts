import { env } from 'cloudflare:workers'
import { createDataAccess, type AnalyticsRollupRecord } from '@vc/db'
import {
  AGENT_CATEGORY_LABELS,
  agentForUserAgent,
  aiReferrer,
  AI_AGENTS,
  type AgentCategory,
} from '@vc/config/agents'
import { ValidationError } from '@vc/core'
import { isSelfHosted } from '@/server/billing'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'
import type { AppUserContext } from '@/server/onboarding'

export { aiReferrer }

export const ANALYTICS_RETENTION_DAYS = 365
export type AnalyticsRange = 7 | 30 | 90 | 365 | 'all'

export type AgentAnalytics = {
  total: number
  byCategory: Array<{ category: AgentCategory; fetches: number }>
  topAgents: Array<{ id: string; label: string; operator: string; category: AgentCategory; fetches: number }>
  topPosts: Array<{ postId: string; slug: string; title: string; fetches: number }>
  /** Whole percent of agent fetches that asked for the Markdown representation. */
  markdownShare: number
  /** Whole percent of agent fetches carrying a `Signature-Agent` header. */
  signedShare: number
  llmsReads: number
}

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
      agents: AgentAnalytics
    }

type SqlResponse = { data?: Array<Record<string, unknown>>; error?: string }
type Fetcher = typeof fetch

function sqlIdentifier(value: string): string | null {
  return /^[A-Za-z0-9_]+$/.test(value) ? value : null
}

// Analytics Engine SQL is ClickHouse-flavoured: a backslash escapes the next
// character inside a string literal, so escape backslashes as well as quotes.
// Callers still validate ids (`isAnalyticsPostId`) before they reach a query.
function sqlString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

/** Post ids are opaque but never contain quotes, backslashes or spaces. */
export function isAnalyticsPostId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
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

/** UA match against the shared agent table (plans/023 §2); null for browsers. */
export function crawlerForUserAgent(userAgent: string) {
  return agentForUserAgent(userAgent)
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

export type AgentFetchSourceRow = {
  date?: unknown
  post_id?: unknown
  resource?: unknown
  agent_id?: unknown
  category?: unknown
  representation?: unknown
  signed?: unknown
  fetches?: unknown
}

/**
 * One day of `agent_fetch` rows → rollup values (plans/023 §4). Shared with
 * analytics-rollup.ts; see its comment for the `repr_*`/`signed`
 * pseudo-dimensions under `agent_resource`.
 */
export function agentRollupValues(
  rows: AgentFetchSourceRow[],
): Array<{ kind: 'agent' | 'agent_category' | 'agent_post' | 'agent_resource'; dimension: string; label: string | null; value: number }> {
  const agents = new Map<string, { label: string | null; value: number }>()
  const categories = new Map<string, { label: string | null; value: number }>()
  const posts = new Map<string, { label: string | null; value: number }>()
  const resources = new Map<string, { label: string | null; value: number }>()
  const bump = (map: Map<string, { label: string | null; value: number }>, dimension: string, label: string | null, value: number) => {
    const current = map.get(dimension)
    if (current) current.value += value
    else map.set(dimension, { label, value })
  }
  for (const row of rows) {
    const fetches = numberValue(row.fetches)
    if (fetches <= 0) continue
    const agentId = typeof row.agent_id === 'string' ? row.agent_id : ''
    if (agentId) {
      const entry = AI_AGENTS.find((candidate) => candidate.id === agentId)
      bump(agents, agentId, entry?.label ?? 'Unknown', fetches)
    }
    const category = typeof row.category === 'string' ? row.category : ''
    if (category) bump(categories, category, null, fetches)
    const postId = typeof row.post_id === 'string' ? row.post_id : ''
    if (postId) bump(posts, postId, null, fetches)
    const resource = typeof row.resource === 'string' ? row.resource : ''
    if (resource) bump(resources, resource, null, fetches)
    const representation = typeof row.representation === 'string' ? row.representation : ''
    if (representation) bump(resources, `repr_${representation}`, null, fetches)
    if (row.signed === '1') bump(resources, 'signed', null, fetches)
  }
  return [
    ...[...agents].map(([dimension, value]) => ({ kind: 'agent' as const, dimension, ...value })),
    ...[...categories].map(([dimension, value]) => ({ kind: 'agent_category' as const, dimension, ...value })),
    ...[...posts].map(([dimension, value]) => ({ kind: 'agent_post' as const, dimension, ...value })),
    ...[...resources].map(([dimension, value]) => ({ kind: 'agent_resource' as const, dimension, ...value })),
  ]
}

/** Not-yet-rolled `agent_fetch` rows → day-grain records, same shape as stored rollups. */
function agentSourceRecords(rows: AgentFetchSourceRow[]): AnalyticsRollupRecord[] {
  const byDate = new Map<string, AgentFetchSourceRow[]>()
  for (const row of rows) {
    const date = dateKey(row.date)
    if (!date) continue
    const current = byDate.get(date)
    if (current) current.push(row)
    else byDate.set(date, [row])
  }
  const records: AnalyticsRollupRecord[] = []
  for (const [periodStart, dayRows] of byDate) {
    for (const value of agentRollupValues(dayRows)) {
      records.push({ granularity: 'day', periodStart, ...value })
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
  options: { fetcher?: Fetcher; postId?: string } = {},
): Promise<AnalyticsPageData> {
  const fetcher = options.fetcher ?? fetch
  const postId = options.postId
  // postId reaches Analytics Engine SQL, which has no bind parameters.
  if (postId !== undefined && !isAnalyticsPostId(postId)) throw new ValidationError('postId is not a valid post id.')
  const selfHosted = isSelfHosted()
  if (!selfHosted) {
    const entitlement = await resolveEffectiveEntitlementForWorkspace(app.workspaceId)
    if (!entitlement.effective) {
      return { status: 'locked', retentionDays: ANALYTICS_RETENTION_DAYS }
    }
  }

  const accountId = env.ANALYTICS_ACCOUNT_ID?.trim()
  const dataset = sqlIdentifier(env.ANALYTICS_DATASET?.trim() ?? '')
  const token = env.ANALYTICS_API_TOKEN?.trim()
  if (!accountId || !dataset || !token) {
    // 'self_hosted' keeps the dashboard's existing self-host copy; the binding
    // trio is how a self-host install turns analytics on (plans/023 §5).
    return {
      status: 'unavailable',
      retentionDays: ANALYTICS_RETENTION_DAYS,
      reason: selfHosted ? 'self_hosted' : 'not_configured',
    }
  }

  const today = todayKey()
  const yesterday = shiftDate(today, -1)
  const sourceFloor = shiftDate(today, -89)
  const currentStart = rangeDays === 'all' ? null : shiftDate(today, -(rangeDays - 1))
  const data = createDataAccess(env.DB)
  const sqlConfig = { accountId, token }

  try {
    const lastRolledDate = await data.analytics.getLastRolledDate(app.siteId)
    // A bounded rollup may only have covered the oldest part of the source window.
    // Fetch exactly the uncovered suffix, never dates already represented in D1.
    const unrolledFrom = lastRolledDate ? shiftDate(lastRolledDate, 1) : sourceFloor
    const sourceFrom = [unrolledFrom, sourceFloor, currentStart ?? sourceFloor]
      .reduce((latest, date) => date > latest ? date : latest)
    const escapedSite = sqlString(app.siteId)
    const [sourceRows, agentRows] = await Promise.all([
      queryAnalyticsEngine(
        `SELECT toDate(timestamp) AS date, blob2 AS post_id, blob3 AS post_slug, blob4 AS referrer, SUM(_sample_interval) AS views
         FROM ${dataset}
         WHERE index1 = ${escapedSite}
           AND blob1 = 'page_view'
           AND timestamp >= toDateTime('${sourceFrom} 00:00:00')
           AND timestamp < toDateTime('${today} 00:00:00') + INTERVAL '1' DAY
         GROUP BY date, post_id, post_slug, referrer`,
        sqlConfig,
        fetcher,
      ),
      queryAnalyticsEngine(
        `SELECT toDate(timestamp) AS date, blob2 AS post_id, blob3 AS resource, blob4 AS agent_id, blob5 AS category, blob6 AS representation, blob7 AS signed, SUM(_sample_interval) AS fetches
         FROM ${dataset}
         WHERE index1 = ${escapedSite}
           AND blob1 = 'agent_fetch'
           AND timestamp >= toDateTime('${sourceFrom} 00:00:00')
           AND timestamp < toDateTime('${today} 00:00:00') + INTERVAL '1' DAY
         GROUP BY date, post_id, resource, agent_id, category, representation, signed`,
        sqlConfig,
        fetcher,
      ) as Promise<AgentFetchSourceRow[]>,
    ])

    // D1 answers exactly the dates up to the watermark read above and the source
    // query the dates after it, so a rollup committing mid-request can't count a day twice.
    const rolledThrough = shiftDate(unrolledFrom, -1)
    const storedTo = rolledThrough < yesterday ? rolledThrough : yesterday
    const storedRows = rangeDays === 'all'
      ? [
          ...(await data.analytics.listMonthly(app.siteId)),
          ...(await data.analytics.listDaily(app.siteId, '0000-01-01', storedTo)),
        ]
      : await data.analytics.listDaily(app.siteId, currentStart!, storedTo)
    const records = [...storedRows, ...sourceRecords(sourceRows), ...agentSourceRecords(agentRows)]

    let previousViews: number | null = null
    if (rangeDays !== 'all' && rangeDays <= 90) {
      const previousEnd = shiftDate(currentStart!, -1)
      const previousStart = shiftDate(previousEnd, -(rangeDays - 1))
      const previousStored = await data.analytics.listDaily(app.siteId, previousStart, previousEnd < storedTo ? previousEnd : storedTo)
      previousViews = previousStored
        .filter((row) => postId
          ? row.kind === 'post' && row.dimension === postId
          : row.kind === 'page')
        .reduce((sum, row) => sum + row.value, 0)
      const boundedStart = [previousStart, sourceFloor, unrolledFrom]
        .reduce((latest, date) => date > latest ? date : latest)
      if (boundedStart <= previousEnd) {
        const previousRows = await queryAnalyticsEngine(
          `SELECT SUM(_sample_interval) AS views FROM ${dataset}
           WHERE index1 = ${escapedSite}
             AND blob1 = 'page_view'
             ${postId ? `AND blob2 = ${sqlString(postId)}` : ''}
             AND timestamp >= toDateTime('${boundedStart} 00:00:00')
             AND timestamp < toDateTime('${previousEnd} 00:00:00') + INTERVAL '1' DAY`,
          sqlConfig,
          fetcher,
        )
        previousViews += numberValue(previousRows[0]?.views)
      }
    }

    // `postId` scopes every number that exists per post; site-grain facts
    // (referrers, per-category/agent splits) have no per-post source and come
    // back empty rather than silently reporting site totals.
    const views = records
      .filter((row) => postId
        ? row.kind === 'post' && row.dimension === postId
        : row.kind === 'page')
      .reduce((sum, row) => sum + row.value, 0)
    const trendPercent = previousViews && previousViews > 0
      ? Math.round(((views - previousViews) / previousViews) * 100)
      : null

    const posts = new Map<string, { slug: string; views: number }>()
    const referrerTotals = new Map<string, number>()
    const crawlerRows: Array<{ periodStart: string; dimension: string; label: string | null; value: number }> = []
    const crawlerTotals = new Map<string, { operator: string; category: string; requests: number }>()
    const agentTotals = new Map<string, { label: string | null; fetches: number }>()
    const agentCategoryTotals = new Map<string, number>()
    const agentPostTotals = new Map<string, number>()
    const agentResourceTotals = new Map<string, number>()
    const pageSeries = new Map<string, number>()
    const crawlerSeries = new Map<string, number>()
    // Dates (or months, for compacted rows) with agent data: agent rows win
    // per date so crawler rows captured by the legacy collector during the
    // public-before-API rollout never double-count the same requests.
    const agentDates = new Set<string>()
    for (const row of records) {
      const seriesKey = rangeDays === 'all' ? monthSeriesKey(row.periodStart) : row.periodStart
      if (row.kind === 'page') {
        if (!postId) addMetric(pageSeries, seriesKey, row.value)
      }
      if (row.kind === 'post') {
        if (postId && row.dimension !== postId) continue
        if (postId) addMetric(pageSeries, seriesKey, row.value)
        const current = posts.get(row.dimension)
        if (current) current.views += row.value
        else posts.set(row.dimension, { slug: row.label ?? '', views: row.value })
      }
      if (row.kind === 'referrer' && !postId) addMetric(referrerTotals, row.dimension, row.value)
      // Legacy rows are buffered, not applied yet: they only count for dates
      // without agent data (merged after this loop).
      if (row.kind === 'crawler' && !postId) {
        crawlerRows.push({
          periodStart: row.periodStart,
          dimension: row.dimension,
          label: row.label,
          value: row.value,
        })
      }
      if (row.kind === 'agent' || row.kind === 'agent_post') agentDates.add(row.periodStart)
      if (row.kind === 'agent' && !postId) {
        addMetric(crawlerSeries, seriesKey, row.value)
        const current = agentTotals.get(row.dimension)
        if (current) current.fetches += row.value
        else agentTotals.set(row.dimension, { label: row.label, fetches: row.value })
      }
      if (row.kind === 'agent_category' && !postId) {
        addMetric(agentCategoryTotals, row.dimension, row.value)
      }
      if (row.kind === 'agent_post') {
        if (postId && row.dimension !== postId) continue
        addMetric(agentPostTotals, row.dimension, row.value)
        if (postId) addMetric(crawlerSeries, seriesKey, row.value)
      }
      if (row.kind === 'agent_resource' && !postId) {
        addMetric(agentResourceTotals, row.dimension, row.value)
      }
    }

    // Agent rows win per date; legacy crawler rows only fill dates (or
    // compacted months) with no agent data.
    for (const row of crawlerRows) {
      if (agentDates.has(row.periodStart)) continue
      const key = rangeDays === 'all' ? monthSeriesKey(row.periodStart) : row.periodStart
      addMetric(crawlerSeries, key, row.value)
      const crawler = crawlerForUserAgent(row.dimension)
      const current = crawlerTotals.get(row.dimension)
      if (current) current.requests += row.value
      else {
        crawlerTotals.set(row.dimension, {
          operator: row.label ?? crawler?.operator ?? 'Unknown',
          category: crawler ? AGENT_CATEGORY_LABELS[crawler.category] : 'AI crawler',
          requests: row.value,
        })
      }
    }

    const resolvePost = async (postIdValue: string, slug: string) => {
      const post = await data.posts.getPost(app.siteId, postIdValue)
      return {
        postId: postIdValue,
        slug: post?.slug ?? slug,
        title: post?.title ?? 'Deleted post',
      }
    }
    const topPosts = await Promise.all(
      [...posts]
        .sort((a, b) => b[1].views - a[1].views)
        .slice(0, 10)
        .map(async ([id, metric]) => ({ ...(await resolvePost(id, metric.slug)), views: metric.views })),
    )
    const agentTopPosts = await Promise.all(
      [...agentPostTotals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(async ([id, fetches]) => ({ ...(await resolvePost(id, '')), fetches })),
    )
    const referrers = [...referrerTotals]
      .map(([domain, count]) => ({ domain, views: count, ...aiReferrer(domain) }))
      .sort((a, b) => b.views - a.views)
    const aiReferralViews = referrers.filter((row) => row.ai).reduce((sum, row) => sum + row.views, 0)
    const legacyCrawlerAgents = [...crawlerTotals]
      .map(([agent, metric]) => ({ agent, ...metric }))
      .sort((a, b) => b.requests - a.requests)
    const agentFetchTotal = postId
      ? agentPostTotals.get(postId) ?? 0
      : [...agentTotals.values()].reduce((sum, metric) => sum + metric.fetches, 0)
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
        status: legacyCrawlerAgents.length > 0 ? 'available' : 'unavailable',
        lookbackDays: rangeDays === 'all' ? ANALYTICS_RETENTION_DAYS : rangeDays,
        requests: legacyCrawlerAgents.reduce((sum, agent) => sum + agent.requests, 0),
        agents: legacyCrawlerAgents,
      },
      agents: {
        total: agentFetchTotal,
        byCategory: [...agentCategoryTotals]
          .map(([category, fetches]) => ({ category: category as AgentCategory, fetches }))
          .sort((a, b) => b.fetches - a.fetches),
        topAgents: [...agentTotals]
          .map(([id, metric]) => {
            const entry = AI_AGENTS.find((candidate) => candidate.id === id)
            return {
              id,
              label: metric.label ?? entry?.label ?? id,
              operator: entry?.operator ?? 'Unknown',
              category: (entry?.category ?? 'unknown-agent') as AgentCategory,
              fetches: metric.fetches,
            }
          })
          .sort((a, b) => b.fetches - a.fetches)
          .slice(0, 10),
        topPosts: agentTopPosts,
        markdownShare: agentFetchTotal > 0
          ? Math.round(((agentResourceTotals.get('repr_markdown') ?? 0) / agentFetchTotal) * 100)
          : 0,
        signedShare: agentFetchTotal > 0
          ? Math.round(((agentResourceTotals.get('signed') ?? 0) / agentFetchTotal) * 100)
          : 0,
        llmsReads: agentResourceTotals.get('llms') ?? 0,
      },
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'analytics_query_failed', error: String(error) }))
    return { status: 'unavailable', retentionDays: ANALYTICS_RETENTION_DAYS, reason: 'query_failed' }
  }
}
