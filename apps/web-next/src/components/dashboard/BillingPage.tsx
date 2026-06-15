'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { Badge } from '@vc/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { dashboardStatusSearch } from '~/lib/dashboard-search'
import type { BillingSnapshot } from '~/server/billing'
import {
  checkoutBillingMutation,
  loadBillingPage,
  portalBillingMutation,
  type BillingPageLoadResult,
} from '~/server/billing-page-fn'

export function BillingPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
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
    return <p className="font-mono text-sm text-muted-foreground">Loading…</p>
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

  return (
    <>
      <PageHeader
        kicker="Billing"
        title="Subscribe to publish"
        description="Manage your Polar subscription and customer portal."
      />
      <OnboardingFrame phase="Billing">
        <div className="grid gap-4">
          <StatusAlert status={formStatus} />
          <Panel
            title={PRICING.monthlyLabel}
            meta={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{PRICING.planName}</span>
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.08em]">
                  {billing.status}
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
            ) : (
              <p className="mt-6 font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
            <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
              Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload
              media, and make your blog search-indexable. Cancel anytime from the customer portal.
            </p>
          </Panel>
        </div>
      </OnboardingFrame>
    </>
  )
}