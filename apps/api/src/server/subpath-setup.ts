import { proxyFingerprint, redactProxyLinks, type SubpathDomainRow } from '@vc/core'

/**
 * The "Check setup" probe (plans/022 §10): fetches
 * `https://<hostname><basePath>/_vc/health` — which only answers
 * `{ ok, siteId, proxyFingerprint }` when the customer's proxy forwards the
 * mount to us — and reports what is wrong in plain words. Warnings cover
 * things that work but hurt SEO (CDN caching, missing sitemap line).
 */

export type SubpathCheckIssue = { code: string; message: string }

export type SubpathCheckResult = {
  ok: boolean
  errors: SubpathCheckIssue[]
  warnings: SubpathCheckIssue[]
  checkedAt: number
}

const CHECK_UA = 'vibecms-setup-check/1'
const CHECK_TIMEOUT_MS = 8000

type CheckSite = { id: string }

async function probe(url: string): Promise<Response | 'network'> {
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { 'user-agent': CHECK_UA },
    })
  } catch {
    return 'network'
  }
}

// Probe answers are customer-controlled: read them through a byte cap so a
// hostile or broken mount cannot exhaust the Worker's memory. The 8s timeout
// bounds time, not bytes.
const HEALTH_BODY_LIMIT = 16 * 1024
const ROBOTS_BODY_LIMIT = 64 * 1024

/** Up to `limit` bytes as text; null when the stream is missing/too large/errors. */
async function readBoundedText(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    return null
  }
  return text + decoder.decode()
}

// The customer's CDN holding proxied HTML past a publish makes updates look
// broken; only flag confident caching signals (an Age past two minutes, or an
// explicit Cloudflare HIT that lacks a no-cache style directive).
function cdnCachingWarning(response: Response): SubpathCheckIssue | null {
  const age = Number(response.headers.get('age') ?? '0')
  if (Number.isFinite(age) && age > 120) {
    return {
      code: 'cdn_caching',
      message: `Your CDN cached the page for ${age} seconds. Visitors may see stale posts; exclude the blog path from full-page caching.`,
    }
  }
  const cfCache = (response.headers.get('cf-cache-status') ?? '').toUpperCase()
  const cacheControl = (response.headers.get('cache-control') ?? '').toLowerCase()
  if (cfCache === 'HIT' && !/max-age=0|no-cache|no-store/.test(cacheControl)) {
    return {
      code: 'cdn_caching',
      message: 'Your CDN served a cached page. Visitors may see stale posts; exclude the blog path from full-page caching.',
    }
  }
  return null
}

/**
 * Run the setup probe against a subpath row. Callers MUST only pass rows whose
 * hostname/basePath came from `validateSubpathLocation`; nothing else is
 * fetched (keeps the probe off platform and app hosts).
 */
export async function checkSubpathSetup(
  row: Pick<SubpathDomainRow, 'hostname' | 'basePath' | 'proxyId'>,
  site: CheckSite,
): Promise<SubpathCheckResult> {
  const errors: SubpathCheckIssue[] = []
  const warnings: SubpathCheckIssue[] = []
  const checkedAt = Math.floor(Date.now() / 1000)
  const location = `${row.hostname}${row.basePath ?? ''}`
  const base = `https://${location}`

  const health = await probe(`${base}/_vc/health`)
  if (health === 'network') {
    errors.push({
      code: 'no_response',
      message: `We couldn't reach ${location}. Check the route or rewrite is saved and deployed.`,
    })
  } else if (health.status >= 300 && health.status < 400) {
    // A redirect target may echo our proxy path (customer pointed the rule at
    // it) — never persist the embedded proxy id.
    const target = health.headers.get('location')
    errors.push({
      code: 'redirects',
      message: `${location} redirects${target ? ` to ${redactProxyLinks(target)}` : ''} instead of proxying to vibecms. The rule must rewrite, not redirect.`,
    })
  } else if (!health.ok) {
    errors.push({
      code: 'http_error',
      message: `${location} answered with HTTP ${health.status}. Check the route or rewrite is saved and deployed.`,
    })
  } else {
    const text = await readBoundedText(health, HEALTH_BODY_LIMIT)
    let body: { siteId?: unknown; proxyFingerprint?: unknown } | null = null
    if (text !== null) {
      try {
        body = JSON.parse(text) as { siteId?: unknown; proxyFingerprint?: unknown }
      } catch {
        body = null
      }
    }
    if (!body || typeof body.siteId !== 'string' || typeof body.proxyFingerprint !== 'string') {
      errors.push({
        code: 'not_proxied',
        message: `Your own site answered ${location}/_vc/health, not vibecms. The route or rewrite isn't matching this path.`,
      })
    } else if (body.siteId !== site.id) {
      errors.push({
        code: 'wrong_site',
        message: `${location} proxies to a different vibecms blog. Update the proxy target in your snippet to this blog's link.`,
      })
    } else if (body.proxyFingerprint !== (await proxyFingerprint(row.proxyId ?? ''))) {
      errors.push({
        code: 'old_proxy_link',
        message: `${location} uses an older proxy link. Copy the current snippet from Settings and update your proxy config.`,
      })
    }
  }

  if (errors.length === 0) {
    const [page, robots] = await Promise.all([probe(`${base}/`), probe(`https://${row.hostname}/robots.txt`)])

    if (page !== 'network' && page.ok) {
      // Headers carry every caching signal we need; drop the body unread.
      const warning = cdnCachingWarning(page)
      if (warning) warnings.push(warning)
    }
    if (page !== 'network') await page.body?.cancel().catch(() => {})

    // Crawlers only read the customer host's root robots.txt; it must point at
    // the blog's sitemap under its base path.
    const sitemapUrl = `${base}/sitemap.xml`
    if (robots !== 'network' && robots.ok) {
      const text = await readBoundedText(robots, ROBOTS_BODY_LIMIT)
      // Oversized/unreadable robots.txt: skip the warning — we cannot say
      // confidently that the sitemap line is missing.
      if (text !== null) {
        const hasSitemapLine = text
          .split('\n')
          .some((line) => line.trim().toLowerCase() === `sitemap: ${sitemapUrl}`.toLowerCase())
        if (!hasSitemapLine) {
          warnings.push({
            code: 'robots_missing_sitemap',
            message: `Add "Sitemap: ${sitemapUrl}" to ${row.hostname}/robots.txt so search engines find the blog's sitemap.`,
          })
        }
      }
    } else {
      warnings.push({
        code: 'robots_missing_sitemap',
        message: `Add "Sitemap: ${sitemapUrl}" to ${row.hostname}/robots.txt so search engines find the blog's sitemap.`,
      })
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.map((issue) => ({ ...issue, message: redactProxyLinks(issue.message) })),
    warnings: warnings.map((issue) => ({ ...issue, message: redactProxyLinks(issue.message) })),
    checkedAt,
  }
}
