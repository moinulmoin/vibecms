import { FORM_STATUS, FREE_TIER, SITE_ADDRESS_MAX_LENGTH } from '@vc/config'
import { Alert, Field, FieldError, FieldLabel, Input, Skeleton } from '@vc/ui'
import { siteAddressFromText, siteAddressIssue, type SiteAddressIssue } from '@vc/validators'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { completeSetupMutation } from '~/lib/api-client'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { refreshContext, setupQuery } from '~/lib/queries'

type AddressCode = SiteAddressIssue | 'address_taken'
const ADDRESS_CODES: ReadonlySet<string> = new Set<AddressCode>(['address_required', 'slug_reserved', 'address_too_short', 'address_taken'])
const isAddressCode = (code: string): code is AddressCode => ADDRESS_CODES.has(code)

const ADDRESS_ERROR_ID = 'blog-address-error'
const STEP = { current: 1, total: 2 }

/** The blog taking shape as you type: its address, name, and where posts will land. */
export function BlogPreview({ name, address }: { name: string; address: string | null }) {
  const named = name.trim().length > 0
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden="true">
        <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-3.5 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
          </span>
          <span className="ml-1 min-w-0 truncate rounded-md border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {address ?? 'Choose an address'}
          </span>
        </div>
        <div className="px-6 pb-8 pt-5">
          <div className="flex items-center justify-between gap-4 border-b border-[color:var(--hairline)] pb-4">
            <p
              className={[
                'min-w-0 truncate font-display text-[1.0625rem] font-semibold tracking-[-0.02em] transition-colors duration-200',
                named ? 'text-foreground' : 'text-muted-foreground',
              ].join(' ')}
            >
              {named ? name.trim() : 'Your blog'}
            </p>
            <span className="flex shrink-0 gap-3 text-xs text-muted-foreground">
              <span>Posts</span>
              <span>About</span>
              <span>RSS</span>
            </span>
          </div>
          <p className="mt-5 text-xs font-medium text-muted-foreground">Latest</p>
          <div className="mt-2 rounded-lg bg-selected px-3.5 py-3">
            <p className="text-sm font-medium text-selected-foreground">Your first post</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your agent drafts it and sends you a private preview. It goes live when you say yes.
            </p>
          </div>
          <p className="mt-4 px-3.5 text-xs leading-5 text-muted-foreground">Every post you approve shows up here, newest first.</p>
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
  // Address editor text, normalized as typed; a trailing hyphen is dropped when saved.
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [editingSlug, setEditingSlug] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [rejected, setRejected] = useState<{ code: AddressCode; address: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const addressInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!query.data || seeded) return
    setSeeded(true)
    // The server pre-fills a placeholder name; start blank unless the user already named it.
    setName(query.data.name && query.data.name !== 'My Blog' ? query.data.name : '')
  }, [query.data, seeded])

  const baseDomain = query.data?.baseDomain ?? null
  const currentAddress = query.data?.slug ?? null
  // Exactly what the server will save (same shared normalizer), never a silent fallback.
  const address = siteAddressFromText(slugTouched ? slug : name)
  const started = slugTouched || name.trim().length > 0
  const liveIssue = started ? siteAddressIssue(address, currentAddress) : null
  // A derived address is too short while the first letters are typed; wait for an explicit address or a submit.
  const shownIssue = liveIssue === 'address_too_short' && !slugTouched && !attempted ? null : liveIssue
  const addressCode: AddressCode | null = shownIssue ?? (rejected?.address === address ? rejected.code : null)
  const addressError = addressCode ? (FORM_STATUS[addressCode]?.message ?? null) : null
  const addressLabel = started ? address : 'your-blog'
  // Latest address for async responses: a rejection must not overwrite edits made while saving.
  const latestAddress = useRef(address)
  useEffect(() => {
    latestAddress.current = address
  })

  // Pins the editor to `target` (already the current address) and moves focus into it.
  function openAddressEditor(target: string) {
    setSlug(target)
    setSlugTouched(true)
    setEditingSlug(true)
    addressInputRef.current?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    setAttempted(true)
    setError(null)
    if (siteAddressIssue(address, currentAddress)) {
      openAddressEditor(address)
      return
    }
    const submitted = address
    setSubmitting(true)
    try {
      const result = await completeSetupMutation({ name: name.trim(), slug: submitted })
      if (result.kind !== 'ok') {
        if (isAddressCode(result.code)) {
          setRejected({ code: result.code, address: submitted })
          if (latestAddress.current === submitted) openAddressEditor(submitted)
        } else {
          setError(resolveFormStatus({ error: result.code })?.message ?? 'That didn’t work. Try another name.')
        }
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
      description="You can rename your blog any time. Its address can’t be changed after this step."
      aside={<BlogPreview name={name} address={addressLabel ? `${addressLabel}${baseDomain ? `.${baseDomain}` : ''}` : null} />}
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
          <div className="grid gap-2">
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
                aria-describedby={addressError && !slugTouched ? ADDRESS_ERROR_ID : undefined}
              />
            </Field>
            <Field className="gap-1.5">
              <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {editingSlug ? (
                  <>
                    <FieldLabel htmlFor="blog-address" className="sr-only">
                      Blog address
                    </FieldLabel>
                    <Input
                      id="blog-address"
                      ref={addressInputRef}
                      value={slugTouched ? slug : address}
                      onChange={(event) => {
                        setSlugTouched(true)
                        // Shared normalizer as you type; keep one trailing separator so "my-" can become "my-blog".
                        const typed = event.target.value
                        const normalized = siteAddressFromText(typed)
                        setSlug(normalized && /[^\p{L}\p{M}\p{N}]$/u.test(typed) && normalized.length < SITE_ADDRESS_MAX_LENGTH ? `${normalized}-` : normalized)
                      }}
                      onBlur={() => {
                        if (!addressCode) setEditingSlug(false)
                      }}
                      autoFocus
                      maxLength={SITE_ADDRESS_MAX_LENGTH}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={addressError ? true : undefined}
                      aria-describedby={addressError ? ADDRESS_ERROR_ID : undefined}
                      className="h-8 max-w-56 font-mono text-sm"
                    />
                    {baseDomain ? <span className="font-mono">.{baseDomain}</span> : null}
                  </>
                ) : (
                  <>
                    {addressLabel ? (
                      <span className="min-w-0 truncate font-mono">
                        <span className="text-foreground">{addressLabel}</span>
                        {baseDomain ? `.${baseDomain}` : ''}
                      </span>
                    ) : (
                      <span>No address yet</span>
                    )}
                    <button
                      type="button"
                      onClick={() => openAddressEditor(address)}
                      aria-describedby={addressError ? ADDRESS_ERROR_ID : undefined}
                      className="rounded text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {address || !started ? 'Edit' : 'Choose address'}
                    </button>
                  </>
                )}
              </div>
              {addressError ? <FieldError id={ADDRESS_ERROR_ID}>{addressError}</FieldError> : null}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <PendingSubmitButton className="h-11 px-6" pending={submitting} pendingText="Creating…" disabled={!name.trim()}>
              Continue
            </PendingSubmitButton>
            <p className="text-sm text-muted-foreground">
              {FREE_TIER.publishedPosts} published posts, {FREE_TIER.drafts} drafts at a time, {FREE_TIER.images} images. No card.
            </p>
          </div>
        </form>
      )}
    </OnboardingFrame>
  )
}
