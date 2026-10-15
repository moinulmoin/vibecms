import { createDataAccess, type AnalyticsRollupValue } from '@vc/db'
import { env } from 'cloudflare:workers'
import { agentRollupValues, queryAnalyticsEngine, type AgentFetchSourceRow } from '@/server/analytics'

const SOURCE_RETENTION_DAYS = 90
const DETAILED_RETENTION_DAYS = 365

type AnalyticsSourceRow = {
  date?: unknown
  post_id?: unknown
  post_slug?: unknown
  referrer?: unknown
  views?: unknown
}


type RollupEnv = Pick<
  Cloudflare.Env,
  | 'DB'
  | 'SELF_HOSTED'
  | 'ANALYTICS_ACCOUNT_ID'
  | 'ANALYTICS_DATASET'
  | 'ANALYTICS_API_TOKEN'
>

function utcDate(offsetDays: number, now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
    .toISOString()
    .slice(0, 10)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date)
  return dates
}

function safeIdentifier(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_]+$/.test(value) ? value : null
}

function sourceDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null
}

function sourceString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sourceNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function increment(
  map: Map<string, { label: string | null; value: number }>,
  dimension: string,
  label: string | null,
  value: number,
) {
  const current = map.get(dimension)
  if (current) current.value += value
  else map.set(dimension, { label, value })
}

function rollupValues(rows: AnalyticsSourceRow[]): AnalyticsRollupValue[] {
  let pageViews = 0
  const posts = new Map<string, { label: string | null; value: number }>()
  const referrers = new Map<string, { label: string | null; value: number }>()
  for (const row of rows) {
    const views = sourceNumber(row.views)
    if (views <= 0) continue
    pageViews += views
    const postId = sourceString(row.post_id)
    if (postId) increment(posts, postId, sourceString(row.post_slug) || null, views)
    const referrer = sourceString(row.referrer)
    if (referrer) increment(referrers, referrer, null, views)
  }
  return [
    { kind: 'page', dimension: '', label: null, value: pageViews },
    ...[...posts].map(([dimension, value]) => ({ kind: 'post' as const, dimension, ...value })),
    ...[...referrers].map(([dimension, value]) => ({ kind: 'referrer' as const, dimension, ...value })),
  ]
}


async function rollupSite(
  workerEnv: RollupEnv,
  site: { id: string; slug: string },
  sourceFrom: string,
  sourceTo: string,
  fetcher: typeof fetch,
) {
  const data = createDataAccess(workerEnv.DB)
  const accountId = workerEnv.ANALYTICS_ACCOUNT_ID?.trim()
  const dataset = safeIdentifier(workerEnv.ANALYTICS_DATASET?.trim())
  const token = workerEnv.ANALYTICS_API_TOKEN?.trim()
  if (!accountId || !dataset || !token) throw new Error('analytics_rollup_not_configured')

  const escapedSite = site.id.replaceAll("'", "''")
  const [rows, agentRows] = await Promise.all([
    queryAnalyticsEngine(
      `SELECT toDate(timestamp) AS date, blob2 AS post_id, blob3 AS post_slug, blob4 AS referrer, SUM(_sample_interval) AS views
       FROM ${dataset}
       WHERE index1 = '${escapedSite}'
         AND blob1 = 'page_view'
         AND timestamp >= toDateTime('${sourceFrom} 00:00:00')
         AND timestamp < toDateTime('${sourceTo} 00:00:00') + INTERVAL '1' DAY
       GROUP BY date, post_id, post_slug, referrer
       ORDER BY date ASC`,
      { accountId, token },
      fetcher,
    ) as Promise<AnalyticsSourceRow[]>,
    queryAnalyticsEngine(
      `SELECT toDate(timestamp) AS date, blob2 AS post_id, blob3 AS resource, blob4 AS agent_id, blob5 AS category, blob6 AS representation, blob7 AS signed, SUM(_sample_interval) AS fetches
       FROM ${dataset}
       WHERE index1 = '${escapedSite}'
         AND blob1 = 'agent_fetch'
         AND timestamp >= toDateTime('${sourceFrom} 00:00:00')
         AND timestamp < toDateTime('${sourceTo} 00:00:00') + INTERVAL '1' DAY
       GROUP BY date, post_id, resource, agent_id, category, representation, signed
       ORDER BY date ASC`,
      { accountId, token },
      fetcher,
    ) as Promise<AgentFetchSourceRow[]>,
  ])

  const byDate = new Map<string, AnalyticsSourceRow[]>()
  for (const row of rows) {
    const date = sourceDate(row.date)
    if (!date) continue
    const current = byDate.get(date)
    if (current) current.push(row)
    else byDate.set(date, [row])
  }
  const agentByDate = new Map<string, AgentFetchSourceRow[]>()
  for (const row of agentRows) {
    const date = sourceDate(row.date)
    if (!date) continue
    const current = agentByDate.get(date)
    if (current) current.push(row)
    else agentByDate.set(date, [row])
  }

  for (const date of daysBetween(sourceFrom, sourceTo)) {
    const values = [
      ...rollupValues(byDate.get(date) ?? []),
      ...agentRollupValues(agentByDate.get(date) ?? []),
    ]
    // Zone-GraphQL crawler counting stopped when agent_fetch shipped
    // (plans/023 §4). Carried-forward `crawler` rows only fill days with no
    // agent data — a day with both would double-count the same requests.
    const existing = await data.analytics.listDaily(site.id, date, date)
    const hasAgentData = values.some((value) => value.kind === 'agent')
    values.push(...existing
      .filter((row) => row.kind === 'crawler' && !hasAgentData)
      .map(({ kind, dimension, label, value }) => ({ kind, dimension, label, value })))
    await data.analytics.replaceDaily(site.id, date, values)
  }
}

export async function runAnalyticsRollup(workerEnv: RollupEnv = env, fetcher: typeof fetch = fetch) {
  const selfHosted = String(workerEnv.SELF_HOSTED) === 'true'
  // Self-host rolls up only when the AE query env is configured; without it
  // nothing collects anyway and the loader reports unavailable.
  const configured =
    Boolean(workerEnv.ANALYTICS_ACCOUNT_ID?.trim()) &&
    safeIdentifier(workerEnv.ANALYTICS_DATASET?.trim()) !== null &&
    Boolean(workerEnv.ANALYTICS_API_TOKEN?.trim())
  if (selfHosted && !configured) return { sites: 0, compactedMonths: 0 }
  const data = createDataAccess(workerEnv.DB)
  const sites = await data.managedSites.listEffectiveEntitledActiveSites({
    selfHosted,
    // Unfloored epoch seconds: the past_due grace deadline is exact to the millisecond.
    now: Date.now() / 1000,
  })
  const yesterday = utcDate(-1)
  const sourceFloor = utcDate(-(SOURCE_RETENTION_DAYS - 1))

  let completedSites = 0
  for (const site of sites) {
    try {
      const lastRolledDate = await data.analytics.getLastRolledDate(site.id)
      const overlapStart = lastRolledDate ? addDays(lastRolledDate, -2) : sourceFloor
      const sourceFrom = overlapStart < sourceFloor ? sourceFloor : overlapStart
      if (sourceFrom <= yesterday) {
        await rollupSite(workerEnv, site, sourceFrom, yesterday, fetcher)
      }
      completedSites += 1
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'analytics_rollup_failed', siteId: site.id, error: String(error) }))
    }
  }

  const compactedMonths = await data.analytics.compactDailyBefore(utcDate(-DETAILED_RETENTION_DAYS))
  return { sites: completedSites, compactedMonths }
}
