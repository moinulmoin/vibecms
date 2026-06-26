'use client'

import { BRAND, MEDIA } from '@vc/config'
import { Field, FieldDescription, FieldGroup, FieldLabel, Input, Textarea } from '@vc/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoadError, Panel } from '~/components/dashboard/DashboardLayout'
import { Skeleton } from '~/components/ui/skeleton'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { completeSetupMutation, loadSetupPage } from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'

export function SetupPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const [site, setSite] = useState<{ name: string; slug: string; description: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Controlled values for the three prefillable fields
  const [nameVal, setNameVal] = useState('')
  const [slugVal, setSlugVal] = useState('')
  const [descVal, setDescVal] = useState('')

  // Touched tracking: once the user manually edits a field, URL changes must not overwrite it
  const [nameTouched, setNameTouched] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const [descTouched, setDescTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadSetupPage()
      .then((data) => {
        if (!cancelled) {
          setSite(data)
          setNameVal(data.name)
          setSlugVal(data.slug)
          setDescVal(data.description)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load setup.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleUrlPrefill(raw: string) {
    if (!raw.trim()) return
    let url: URL
    try {
      url = new URL(raw.includes('://') ? raw : 'https://' + raw)
    } catch {
      return // invalid input - silently ignore
    }

    // Strip a leading www. only
    let hostname = url.hostname
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }

    // Registrable domain label. Handle common multi-part public suffixes (co.uk, com.au, ...)
    // so example.co.uk -> 'example', not 'co'. moin.com -> 'moin'; blog.acme.com -> 'acme'.
    const parts = hostname.split('.')
    const MULTI_PART_SUFFIXES = new Set(['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.in', 'com.mx', 'org.uk', 'net.au'])
    let labelIndex = parts.length - 2
    if (parts.length >= 3 && MULTI_PART_SUFFIXES.has(`${parts[parts.length - 2]}.${parts[parts.length - 1]}`)) {
      labelIndex = parts.length - 3
    }
    const label = labelIndex >= 0 ? parts[labelIndex] : parts[0]
    if (!label) return

    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42)
    if (!slug) return

    const name = label.charAt(0).toUpperCase() + label.slice(1)
    const description = `Notes and updates from ${name}.`

    if (!nameTouched) setNameVal(name)
    if (!slugTouched) setSlugVal(slug)
    if (!descTouched) setDescVal(description)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    const slug = String(form.get('slug') ?? '')
    const description = String(form.get('description') ?? '')
    setSubmitting(true)
    try {
      const result = await completeSetupMutation({ data: { name, slug, description: description || undefined } })
      if (result.kind === 'ok') {
        await router.invalidate()
        await navigate({ to: '/app/connect', search: dashboardStatusSearch({ ok: result.code }) })
      } else {
        await navigate({ to: '/app/setup', search: dashboardStatusSearch({ error: result.code }) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!site)
    return (
      <OnboardingFrame phase="Blog setup">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-[68px] rounded-xl" />
            <Skeleton className="h-[68px] rounded-xl" />
          </div>
          <Skeleton className="h-[28rem] rounded-xl" />
        </div>
      </OnboardingFrame>
    )

  return (
    <OnboardingFrame phase="Blog setup">
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-muted/50 p-4">
            <strong className="block font-display text-base font-semibold tabular-nums text-foreground">1 blog</strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              per subscription
            </span>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <strong className="block font-display text-base font-semibold tabular-nums text-foreground">
              {MEDIA.paidStorageLabel}
            </strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              media storage
            </span>
          </div>
        </div>
        <Panel title="Create your hosted blog" meta={<span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Blog setup</span>}>
          <p className="mb-5 font-sans text-sm leading-6 text-muted-foreground">
            Only the essentials. You can edit posts, media, tokens, and billing after this.
          </p>
          <form className="grid gap-4" onSubmit={(e) => void handleSubmit(e)}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="website-url" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Existing website URL{' '}
                  <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                </FieldLabel>
                <Input
                  id="website-url"
                  placeholder="https://example.com"
                  onChange={(e) => handleUrlPrefill(e.target.value)}
                  onBlur={(e) => handleUrlPrefill(e.target.value)}
                />
                <FieldDescription>
                  Used only to prefill the fields below. VibeCMS will not scrape, import, or contact this site.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="name" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Blog Name
                </FieldLabel>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={80}
                  value={nameVal}
                  onChange={(e) => { setNameVal(e.target.value); setNameTouched(true) }}
                  placeholder="Moin's Notes"
                />
                <FieldDescription>This appears in the dashboard and public blog header.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="slug" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Default Slug
                </FieldLabel>
                <Input
                  id="slug"
                  name="slug"
                  required
                  maxLength={42}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={slugVal}
                  onChange={(e) => { setSlugVal(e.target.value); setSlugTouched(true) }}
                  placeholder="moins-notes"
                />
                <FieldDescription>Lowercase letters, numbers, and hyphens. Custom domains can come later.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Description <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                </FieldLabel>
                <Textarea
                  id="description"
                  name="description"
                  maxLength={220}
                  rows={4}
                  value={descVal}
                  onChange={(e) => { setDescVal(e.target.value); setDescTouched(true) }}
                  placeholder={`A short blog about building products with AI agents on ${BRAND.name}.`}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[11px] leading-5 text-muted-foreground">
                Draft for free and publish your first post to try it live. Subscribe to publish more and upload media.
              </p>
              <PendingSubmitButton className="h-11 shrink-0 rounded-xl px-6" pending={submitting} pendingText="Saving…">
                Continue
              </PendingSubmitButton>
            </div>
          </form>
        </Panel>
      </div>
    </OnboardingFrame>
  )
}
