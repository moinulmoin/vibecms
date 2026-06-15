'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { Badge } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { loadBillingRequiredPage } from '~/server/dashboard-pages-fn'

export function BillingRequiredPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
  const [billingStatus, setBillingStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadBillingRequiredPage().then((data) => {
      if (cancelled) return
      if (data.redirectToApp) {
        void navigate({ to: '/app' })
        return
      }
      setBillingStatus(data.billingStatus)
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

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
          <div className="mt-6">
            <Link
              to="/app/billing" search={emptyDashboardStatusSearch}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Go to billing (checkout in next phase)
            </Link>
          </div>
          <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
            Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload media, and make your blog search-indexable. Cancel anytime from the customer portal.
          </p>
        </Panel>
      </div>
    </OnboardingFrame>
  )
}