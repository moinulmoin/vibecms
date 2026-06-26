'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { Badge } from '~/components/ui/badge'
import { Skeleton } from '~/components/ui/skeleton'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { dashboardStatusSearch } from '~/lib/dashboard-search'
import type { BillingSnapshot } from '~/server/billing'
import {
  checkoutBillingMutation,
  loadBillingPage,
  portalBillingMutation,
  type BillingPageLoadResult,
} from '~/server/billing-page-fn'

function BillingStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

export function BillingPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<BillingPageLoadResult | null>(null)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)
  const [portalPending, setPortalPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadBillingPage().then((page) => {
      if (cancelled) return
      setData(page)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function startCheckout(interval: 'monthly' | 'yearly') {
    setCheckoutPending(interval)
    try {
      const result = await checkoutBillingMutation({ data: { interval } })
      if (result.kind === 'ok') {
        window.location.assign(result.url)
        return
      }
      void navigate({ to: '/app/billing', search: dashboardStatusSearch({ error: result.code }) })
    } catch {
      void navigate({ to: '/app/billing', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
    } finally {
      setCheckoutPending(null)
    }
  }

  async function openPortal() {
    setPortalPending(true)
    try {
      const result = await portalBillingMutation()
      if (result.kind === 'ok') {
        window.location.assign(result.url)
        return
      }
      void navigate({ to: '/app/billing', search: dashboardStatusSearch({ error: result.code }) })
    } catch {
      void navigate({ to: '/app/billing', search: dashboardStatusSearch({ error: 'polar_unconfigured' }) })
    } finally {
      setPortalPending(false)
    }
  }

  if (!data) {
    return (
      <OnboardingFrame phase="Billing">
        <Skeleton className="h-[30rem] rounded-xl" />
      </OnboardingFrame>
    )
  }

  if (data.selfHosted) {
    return (
      <>
        <PageHeader
          kicker="Billing"
          title="Workspace billing"
          description="Polar checkout is disabled for self-hosted workspaces."
        />
        <Panel title="Self-hosted" meta={<Badge variant="outline">SELF_HOSTED=true</Badge>}>
          <p className="font-sans text-sm text-muted-foreground">
            Publishing, media uploads, and agent access run on your own Cloudflare resources without Polar.
          </p>
        </Panel>
      </>
    )
  }

  const billing: BillingSnapshot = data.billing
  const { isOwner } = data
  const isActive = billing.status === 'active'

  return (
    <>
      <PageHeader
        kicker="Billing"
        title={isActive ? "You're subscribed" : 'Subscribe to publish'}
        description="Manage your Polar subscription and customer portal."
      />
      <OnboardingFrame phase="Billing">
        <div className="grid gap-4">
          <Panel
            title={PRICING.monthlyLabel}
            meta={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  {PRICING.planName}
                </span>
                <BillingStatusBadge status={billing.status} />
              </span>
            }
          >
            <p className="mb-5 font-sans text-sm leading-6 text-muted-foreground">
              or {PRICING.annualLabel} billed yearly. Cancel anytime from the customer portal.
            </p>
            <ul className="grid gap-2.5 rounded-xl bg-muted/50 p-4 text-sm">
              {ENTITLEMENTS.map((entitlement) => (
                <li key={entitlement} className="flex items-start gap-2.5">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="font-sans text-foreground">{entitlement}</span>
                </li>
              ))}
              <li className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-sans text-foreground">{MEDIA.paidStorageLabel} media storage</span>
              </li>
            </ul>
            {isOwner ? (
              isActive ? (
                <div className="mt-5 grid gap-2">
                  <PendingSubmitButton
                    type="button"
                    className="h-11 w-full rounded-xl"
                    pending={portalPending}
                    pendingText="Opening portal…"
                    onClick={() => void openPortal()}
                  >
                    Manage subscription
                  </PendingSubmitButton>
                </div>
              ) : (
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <PendingSubmitButton
                    type="button"
                    className="h-11 w-full rounded-xl"
                    pending={checkoutPending === 'monthly'}
                    pendingText="Starting checkout…"
                    onClick={() => void startCheckout('monthly')}
                  >
                    Subscribe monthly
                  </PendingSubmitButton>
                  <PendingSubmitButton
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl"
                    pending={checkoutPending === 'yearly'}
                    pendingText="Starting checkout…"
                    onClick={() => void startCheckout('yearly')}
                  >
                    Subscribe yearly
                  </PendingSubmitButton>
                  <PendingSubmitButton
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl sm:col-span-2"
                    pending={portalPending}
                    pendingText="Opening portal…"
                    onClick={() => void openPortal()}
                  >
                    Customer portal
                  </PendingSubmitButton>
                </div>
              )
            ) : (
              <p className="mt-5 font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
            <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
              {isActive
                ? 'Your plan is active: unlimited publishing, media uploads, and search indexing are on. Cancel anytime from the customer portal.'
                : 'Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload media, and make your blog search-indexable. Cancel anytime from the customer portal.'}
            </p>
          </Panel>
        </div>
      </OnboardingFrame>
    </>
  )
}