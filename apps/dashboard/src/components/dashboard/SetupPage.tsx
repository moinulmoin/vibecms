import { FREE_TIER } from '@vc/config'
import { Alert, Field, FieldLabel, Input, Skeleton } from '@vc/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { completeSetupMutation } from '~/lib/api-client'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { refreshContext, setupQuery } from '~/lib/queries'

const SLUG_MAX = 42

/** Blog name → hosted address label. Lowercase letters, digits, single hyphens. */
export function slugFromName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

const STEP = { current: 1, total: 2 }

/** The blog taking shape as you type: its address, name, and where posts will land. */
export function BlogPreview({ name, address }: { name: string; address: string }) {
  const named = name.trim().length > 0
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_48px_-32px_oklch(0_0_0/0.45)]" aria-hidden="true">
        <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-3.5 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
          </span>
          <span className="ml-1 min-w-0 truncate rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {address}
          </span>
        </div>
        <div className="px-6 pb-7 pt-6">
          <p
            className={[
              'truncate font-display text-[1.375rem] font-semibold tracking-[-0.03em] transition-colors duration-200',
              named ? 'text-foreground' : 'text-muted-foreground/60',
            ].join(' ')}
          >
            {named ? name.trim() : 'Your blog'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Written with your agent</p>
          <div className="mt-6 space-y-5">
            <div className="rounded-lg border border-dashed border-brand-bright/45 bg-brand-bright/[0.06] px-3.5 py-3">
              <p className="text-[13px] font-medium text-foreground">Your first post lands here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Your agent drafts it. It goes live when you say yes.</p>
            </div>
            {[0.82, 0.64].map((width) => (
              <div key={width} className="space-y-2">
                <div className="h-2.5 rounded-full bg-foreground/10" style={{ width: `${width * 100}%` }} />
                <div className="h-2 w-2/5 rounded-full bg-foreground/[0.06]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Live preview</figcaption>
    </figure>
  )
}

export function SetupPage() {
  const navigate = useNavigate()
  const query = useQuery(setupQuery)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [editingSlug, setEditingSlug] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    if (!query.data || seeded) return
    setSeeded(true)
    // The server pre-fills a placeholder name; start blank unless the user already named it.
    const prefilled = query.data.name && query.data.name !== 'My Blog' ? query.data.name : ''
    setName(prefilled)
    if (prefilled) setSlug(query.data.slug || slugFromName(prefilled))
  }, [query.data, seeded])

  const effectiveSlug = slugTouched ? slug : slugFromName(name)
  const baseDomain = query.data?.baseDomain ?? null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await completeSetupMutation({ name: name.trim(), slug: slugFromName(effectiveSlug) || slugFromName(name) })
      if (result.kind !== 'ok') {
        setError(resolveFormStatus({ error: result.code })?.message ?? 'That didn’t work. Try another name.')
        return
      }
      await refreshContext()
      await navigate({ to: '/dashboard/personalize', search: emptyDashboardStatusSearch })
    } catch {
      setError('We couldn’t save that. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (query.isError && !query.data) {
    return (
      <OnboardingFrame step={STEP} title="Name your blog">
        <LoadError message="Setup didn’t load. Check your connection and try again." onRetry={() => void query.refetch()} />
      </OnboardingFrame>
    )
  }

  return (
    <OnboardingFrame
      step={STEP}
      title="Name your blog"
      description="You can change it any time."
      aside={<BlogPreview name={name} address={`${effectiveSlug || 'your-blog'}${baseDomain ? `.${baseDomain}` : ''}`} />}
    >
      {!query.data ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-11 rounded-lg" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-11 w-32 rounded-lg" />
        </div>
      ) : (
        <form className="grid gap-6" onSubmit={(event) => void handleSubmit(event)}>
          {error ? <Alert variant="error">{error}</Alert> : null}
          <Field>
            <FieldLabel htmlFor="blog-name" className="sr-only">
              Blog name
            </FieldLabel>
            <Input
              id="blog-name"
              name="name"
              required
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Field Notes"
              className="h-12 text-lg"
            />
            <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {editingSlug ? (
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="sr-only">Blog address</span>
                  <Input
                    value={effectiveSlug}
                    onChange={(event) => {
                      setSlugTouched(true)
                      setSlug(
                        event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]+/g, '-')
                          .replace(/-{2,}/g, '-')
                          .replace(/^-+/, '')
                          .slice(0, SLUG_MAX),
                      )
                    }}
                    onBlur={() => setEditingSlug(false)}
                    autoFocus
                    maxLength={SLUG_MAX}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    className="h-8 max-w-56 font-mono text-sm"
                  />
                  {baseDomain ? <span className="font-mono">.{baseDomain}</span> : null}
                </label>
              ) : (
                <>
                  <span className="min-w-0 truncate font-mono">
                    <span className="text-foreground">{effectiveSlug || 'your-blog'}</span>
                    {baseDomain ? `.${baseDomain}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingSlug(true)}
                    className="rounded text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <PendingSubmitButton className="h-11 px-6" pending={submitting} pendingText="Creating…" disabled={!name.trim()}>
              Continue
            </PendingSubmitButton>
            <p className="text-sm text-muted-foreground">
              Free for your first {FREE_TIER.publishedPosts} posts. No card.
            </p>
          </div>
        </form>
      )}
    </OnboardingFrame>
  )
}
