'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { Badge } from '~/components/ui/badge'
import { Skeleton } from '~/components/ui/skeleton'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { checkoutBillingMutation } from '~/server/billing-page-fn'
import { loadBillingRequiredPage } from '~/server/dashboard-pages-fn'

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

export function BillingRequiredPage() {
  const navigate = useNavigate()
  const [billingStatus, setBillingStatus] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadBillingRequiredPage().then((data) => {
      if (cancelled) return
      if (data.redirectToApp) {
        void navigate({ to: '/app' })
        return
      }
      setBillingStatus(data.billingStatus)
      setIsOwner(data.isOwner)
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

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

  if (!billingStatus) {
    return (
      <OnboardingFrame phase="Billing">
        <Skeleton className="h-[28rem] rounded-xl" />
      </OnboardingFrame>
    )
  }

  return (
    <OnboardingFrame phase="Billing">
      <div className="grid gap-4">
        <Panel
          title={PRICING.monthlyLabel}
          meta={
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                {PRICING.planName}
              </span>
              <BillingStatusBadge status={billingStatus} />
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
            </div>
          ) : (
            <p className="mt-5 font-sans text-sm text-muted-foreground">Only workspace owners can subscribe.</p>
          )}
          <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
            Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload
            media, and make your blog search-indexable. Cancel anytime from the customer portal.
          </p>
          <div className="mt-4">
            <Link
              to="/app/billing"
              search={emptyDashboardStatusSearch}
              className="font-mono text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Full billing &amp; customer portal &rarr;
            </Link>
          </div>
        </Panel>
      </div>
    </OnboardingFrame>
  )
}