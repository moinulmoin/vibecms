import { Button, Field, FieldLabel, Input } from '@vc/ui'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleAlert, Info, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '~/components/ui/spinner'
import { checkPostSeo, DashboardApiError } from '~/lib/api-client'
import { postAnalyticsQuery, postSeoQuery } from '~/lib/queries'
import type { PostAnalytics, SeoAiReview, SeoFinding } from '~/types/dashboard'

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

function rateLimitMessage(error: DashboardApiError) {
  const seconds = error.retryAfterSeconds
  if (seconds === undefined) return "You've used today's AI reviews. Try again later."
  const hours = Math.max(1, Math.ceil(seconds / 3600))
  return `You've used today's AI reviews. Try again in ${hours} ${hours === 1 ? 'hour' : 'hours'}.`
}

const SEVERITY_META = [
  { severity: 'error', label: 'Errors', icon: CircleAlert, className: 'text-destructive' },
  { severity: 'warn', label: 'Warnings', icon: AlertTriangle, className: 'text-warning' },
  { severity: 'info', label: 'Notes', icon: Info, className: 'text-muted-foreground' },
] as const

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function FindingRow({ finding }: { finding: SeoFinding }) {
  const focusable = finding.field in SEO_FIELD_TARGETS
  const body = (
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

function AiReviewView({ review, onApply }: { review: SeoAiReview; onApply: (field: 'seoTitle' | 'seoDescription', value: string) => void }) {
  return (
    <div className="grid gap-3 text-[13px] leading-5">
      {review.intent ? <p className="text-muted-foreground">Search intent: {review.intent}</p> : null}
      {review.titleIdeas.length > 0 ? (
        <div>
          <p className="font-medium text-foreground">Title ideas</p>
          <ul className="mt-1 grid gap-1.5">
            {review.titleIdeas.map((idea) => (
              <li key={idea} className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-muted-foreground">{idea}</span>
                <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0" onClick={() => onApply('seoTitle', idea)}>Use this</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.descriptionIdea ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-foreground">Description idea</p>
            <p className="mt-1 text-muted-foreground">{review.descriptionIdea}</p>
          </div>
          <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0" onClick={() => onApply('seoDescription', review.descriptionIdea)}>Use this</Button>
        </div>
      ) : null}
      {review.missingSubtopics.length > 0 ? (
        <div>
          <p className="font-medium text-foreground">Missing subtopics</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {review.missingSubtopics.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      {review.unclearPassages.length > 0 ? (
        <div>
          <p className="font-medium text-foreground">Unclear passages</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {review.unclearPassages.map((item) => <li key={item.quote}>&ldquo;{item.quote}&rdquo; — {item.why}</li>)}
          </ul>
        </div>
      ) : null}
      {review.claimsNeedingSources.length > 0 ? (
        <div>
          <p className="font-medium text-foreground">Claims needing sources</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {review.claimsNeedingSources.map((item) => <li key={item.quote}>&ldquo;{item.quote}&rdquo;</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export type SeoSectionProps = {
  postId?: string
  postStatus: 'draft' | 'published' | 'archived' | null
  /** Saved version the check runs against; bumps re-check after each save. */
  versionNumber: number | null
  onApplySeo: (field: 'seoTitle' | 'seoDescription', value: string) => void
}

export function SeoSection({ postId, postStatus, versionNumber, onApplySeo }: SeoSectionProps) {
  const [focusKeyword, setFocusKeyword] = useState(() => (postId ? readFocusKeyword(postId) : ''))
  const check = usePostSeoCheck(postId, versionNumber, focusKeyword)
  const analytics = useQuery(postAnalyticsQuery(postStatus === 'published' ? postId : undefined))
  const [aiPending, setAiPending] = useState(false)
  const [aiReview, setAiReview] = useState<SeoAiReview | null>(null)
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  const groups = useMemo(
    () =>
      SEVERITY_META.map((meta) => ({
        ...meta,
        findings: check.data?.findings.filter((finding) => finding.severity === meta.severity) ?? [],
      })).filter((group) => group.findings.length > 0),
    [check.data],
  )

  async function askAiReview() {
    if (!postId) return
    setAiPending(true)
    setAiMessage(null)
    try {
      const result = await checkPostSeo({ postId, ...(focusKeyword.trim() ? { focusKeyword: focusKeyword.trim() } : {}), ai: true })
      setAiReview(result.ai ?? null)
      setAiWarnings(result.warnings ?? [])
      if (!result.ai) setAiMessage('The review came back empty. Try again after your next save.')
    } catch (error) {
      if (error instanceof DashboardApiError && error.code === 'RATE_LIMIT') setAiMessage(rateLimitMessage(error))
      else if (error instanceof DashboardApiError && error.code === 'AI_UNAVAILABLE') setAiMessage("AI review isn't set up on this server.")
      else setAiMessage("Couldn't get an AI review. Try again later.")
    } finally {
      setAiPending(false)
    }
  }

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

      <div className="grid gap-3">
        <div>
          <Button type="button" variant="outline" size="sm" disabled={aiPending || !postId} onClick={() => void askAiReview()}>
            {aiPending ? <Spinner aria-hidden className="size-3.5" /> : <Sparkles aria-hidden className="size-3.5" />}
            {aiPending ? 'Reviewing…' : 'Ask AI review'}
          </Button>
        </div>
        {aiMessage ? <p role="status" className="text-sm text-muted-foreground">{aiMessage}</p> : null}
        {aiReview ? <AiReviewView review={aiReview} onApply={onApplySeo} /> : null}
        {aiWarnings.length > 0 ? (
          <ul className="list-disc space-y-0.5 ps-5 text-[13px] leading-5 text-muted-foreground">
            {aiWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
