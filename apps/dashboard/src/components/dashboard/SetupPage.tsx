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
    <OnboardingFrame step={STEP} title="Name your blog" description="You can change it any time.">
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
