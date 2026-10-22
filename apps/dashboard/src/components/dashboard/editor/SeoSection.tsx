import { Field, FieldLabel, Input } from '@vc/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { postAnalyticsQuery, postSeoQuery } from '~/lib/queries'
import type { PostAnalytics, SeoFinding } from '~/types/dashboard'

export const SEO_SECTION_ID = 'post-seo-section'

const SEO_FIELD_TARGETS: Record<string, string> = {
  slug: 'post-slug',
  seoTitle: 'post-seo-title',
  seoDescription: 'post-seo-description',
  canonicalUrl: 'post-canonical-url',
  coverAssetId: 'post-cover',
  title: 'post-title',
}

/** Focus the rail/editor field a finding attaches to; no-op for body or site findings. */
export function focusSeoField(field: string) {
  const id = SEO_FIELD_TARGETS[field]
  if (!id) return
  const el = document.getElementById(id)
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

function focusKeywordKey(postId: string) {
  return `vc-seo-keyword:${postId}`
}

/** Focus keyword is remembered per post in this browser; storage may be unavailable. */
export function readFocusKeyword(postId: string): string {
  try {
    return window.localStorage.getItem(focusKeywordKey(postId)) ?? ''
  } catch {
    return ''
  }
}

function writeFocusKeyword(postId: string, value: string) {
  try {
    if (value) window.localStorage.setItem(focusKeywordKey(postId), value)
    else window.localStorage.removeItem(focusKeywordKey(postId))
  } catch {
    /* storage unavailable */
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/**
 * Deterministic check for the last saved version, shared between the rail and
 * the publish dialog. `versionNumber` re-keys the check after every save.
 */
export function usePostSeoCheck(postId: string | undefined, versionNumber: number | null, focusKeyword: string) {
  // Debounce the scalars, not a fresh object: an inline `{ versionNumber,
  // focusKeyword }` changes identity every render, rescheduling the timer
  // forever. Scalar effects stop once the values settle.
  const version = useDebouncedValue(versionNumber, 500)
  const keyword = useDebouncedValue(focusKeyword, 500)
  return useQuery(postSeoQuery(postId, version, keyword.trim()))
}

const SEVERITY_META = [
  { severity: 'error', label: 'Errors', icon: CircleAlert, className: 'text-destructive' },
  { severity: 'warn', label: 'Warnings', icon: AlertTriangle, className: 'text-warning' },
  { severity: 'info', label: 'Notes', icon: Info, className: 'text-muted-foreground' },
] as const

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

// The site is only non-indexable when it has no paid entitlement, so the
// generic check copy is replaced with the plan reason and the way out.
const SITE_NOT_INDEXABLE = 'site-not-indexable'

function FindingRow({ finding }: { finding: SeoFinding }) {
  const focusable = finding.field in SEO_FIELD_TARGETS
  const body = finding.code === SITE_NOT_INDEXABLE ? (
    <>
      <span className="block text-foreground">Search engines don’t index posts on the free plan.</span>
      <span className="mt-0.5 block text-muted-foreground">
        Subscribe in{' '}
        <Link
          to="/dashboard/settings"
          search={{ ok: undefined, error: undefined, tab: 'billing' }}
          className="text-foreground underline underline-offset-4 hover:text-primary"
        >
          Settings &gt; Billing
        </Link>{' '}
        so this post can appear in search results.
      </span>
    </>
  ) : (
    <>
      <span className="block text-foreground">{finding.message}</span>
      <span className="mt-0.5 block text-muted-foreground">{finding.fix}</span>
    </>
  )
  return (
    <li>
      {focusable ? (
        <button type="button" onClick={() => focusSeoField(finding.field)} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </button>
      ) : (
        <div className="px-2 py-1.5 text-[13px] leading-5">{body}</div>
      )}
    </li>
  )
}

export type SeoSectionProps = {
  postId?: string
  postStatus: 'draft' | 'published' | 'archived' | null
  /** Saved version the check runs against; bumps re-check after each save. */
  versionNumber: number | null
}

export function SeoSection({ postId, postStatus, versionNumber }: SeoSectionProps) {
  const [focusKeyword, setFocusKeyword] = useState(() => (postId ? readFocusKeyword(postId) : ''))
  const check = usePostSeoCheck(postId, versionNumber, focusKeyword)
  const analytics = useQuery(postAnalyticsQuery(postStatus === 'published' ? postId : undefined))

  const groups = useMemo(
    () =>
      SEVERITY_META.map((meta) => ({
        ...meta,
        findings: check.data?.findings.filter((finding) => finding.severity === meta.severity) ?? [],
      })).filter((group) => group.findings.length > 0),
    [check.data],
  )

  const stats: PostAnalytics = analytics.data ?? null

  return (
    <div id={SEO_SECTION_ID} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {stats ? (
        <p className="text-[13px] text-muted-foreground">
          Last 30 days: <span className="text-foreground">{compactNumber.format(stats.views)}</span> views,{' '}
          <span className="text-foreground">{compactNumber.format(stats.agentReads)}</span> agent reads
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor="post-seo-focus-keyword" className="text-sm font-normal text-muted-foreground">Focus keyword</FieldLabel>
        <Input
          id="post-seo-focus-keyword"
          name="focusKeyword"
          value={focusKeyword}
          maxLength={80}
          placeholder="e.g. markdown cms"
          onChange={(event) => {
            setFocusKeyword(event.currentTarget.value)
            if (postId) writeFocusKeyword(postId, event.currentTarget.value)
          }}
        />
      </Field>

      <div aria-live="polite" className="grid gap-3">
        {check.isPending ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
        {check.isError ? <p className="text-sm text-muted-foreground">Checks couldn't run right now.</p> : null}
        {check.data && groups.length === 0 ? <p className="text-sm text-muted-foreground">No issues found.</p> : null}
        {groups.map((group) => (
          <div key={group.severity}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <group.icon aria-hidden className={`size-3.5 ${group.className}`} /> {group.label}
            </p>
            <ul className="mt-0.5">
              {group.findings.map((finding, index) => <FindingRow key={`${finding.code}:${finding.position ?? index}`} finding={finding} />)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
