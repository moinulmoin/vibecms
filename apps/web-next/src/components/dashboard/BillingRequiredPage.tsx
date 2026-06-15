'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { Badge } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { checkoutBillingMutation } from '~/server/billing-page-fn'
import { loadBillingRequiredPage } from '~/server/dashboard-pages-fn'

export function BillingRequiredPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
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
    return <p className="font-mono text-sm text-muted-foreground">Loading…</p>
  }

  return (
    <OnboardingFrame phase="Billing">
      <div className="grid gap-4">
        <StatusAlert status={formStatus} />
        <Panel
          title={PRICING.monthlyLabel}
          meta={
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{PRICING.planName}</span>
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.08em]">
                {billingStatus}
              </Badge>
            </span>
          }
        >
          <p className="mb-5 font-sans text-sm leading-6 text-muted-foreground">
            or {PRICING.annualLabel} billed yearly. Cancel anytime from the customer portal.
          </p>
          <ul className="grid gap-3 text-sm text-muted-foreground">
            {ENTITLEMENTS.map((entitlement) => (
              <li key={entitlement} className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden="true" />
                <span className="font-sans">{entitlement}</span>
              </li>
            ))}
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden="true" />
              <span className="font-sans">{MEDIA.paidStorageLabel} media storage</span>
            </li>
          </ul>
          {isOwner ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
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
            <p className="mt-6 font-sans text-sm text-muted-foreground">Only workspace owners can subscribe.</p>
          )}
          <div className="mt-4">
            <Link
              to="/app/billing"
              search={emptyDashboardStatusSearch}
              className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Full billing & customer portal
            </Link>
          </div>
          <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
            Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload
            media, and make your blog search-indexable. Cancel anytime from the customer portal.
          </p>
        </Panel>
      </div>
    </OnboardingFrame>
  )
}