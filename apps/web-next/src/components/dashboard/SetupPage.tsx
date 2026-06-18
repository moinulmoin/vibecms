'use client'

import { BRAND, MEDIA } from '@vc/config'
import { Field, FieldDescription, FieldGroup, FieldLabel, Input, Textarea } from '@vc/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { Skeleton } from '~/components/ui/skeleton'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { completeSetupMutation, loadSetupPage } from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'

export function SetupPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const formStatus = useFormStatusFromSearch()
  const [site, setSite] = useState<{ name: string; slug: string; description: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSetupPage()
      .then((data) => {
        if (!cancelled) setSite(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load setup.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    const slug = String(form.get('slug') ?? '')
    const description = String(form.get('description') ?? '')
    const result = await completeSetupMutation({ data: { name, slug, description: description || undefined } })
    if (result.kind === 'ok') {
      await router.invalidate()
      await navigate({ to: '/app/connect', search: dashboardStatusSearch({ ok: result.code }) })
    } else {
      await navigate({ to: '/app/setup', search: dashboardStatusSearch({ error: result.code }) })
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!site)
    return (
      <OnboardingFrame phase="Step 1 of 1">
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
    <OnboardingFrame phase="Step 1 of 1">
      <div className="grid gap-4">
        <StatusAlert status={formStatus} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-muted/50 p-4">
            <strong className="block font-display text-base font-semibold tabular-nums text-foreground">1 blog</strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              per subscription
            </span>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <strong className="block font-display text-base font-semibold text-brand-bright">
              {MEDIA.paidStorageLabel}
            </strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              media storage
            </span>
          </div>
        </div>
        <Panel title="Create your hosted blog" meta={<span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Blog setup</span>}>
          <p className="mb-6 font-sans text-sm leading-6 text-muted-foreground">
            Only the essentials. You can edit posts, media, tokens, and billing after this.
          </p>
          <form className="grid gap-6" onSubmit={(e) => void handleSubmit(e)}>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="name" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Blog Name
                </FieldLabel>
                <Input id="name" name="name" required maxLength={80} defaultValue={site.name} placeholder="Moin's Notes" />
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
                  defaultValue={site.slug}
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
                  defaultValue={site.description}
                  placeholder={`A short blog about building products with AI agents on ${BRAND.name}.`}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[11px] leading-5 text-muted-foreground">
                Draft for free and publish your first post to try it live. Subscribe to publish more and upload media.
              </p>
              <PendingSubmitButton className="h-11 shrink-0 rounded-xl px-6" pendingText="Saving…">
                Continue
              </PendingSubmitButton>
            </div>
          </form>
        </Panel>
      </div>
    </OnboardingFrame>
  )
}