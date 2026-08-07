'use client'

import { ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import { CheckIcon } from '@radix-ui/react-icons'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoadError, PageHeader, Panel } from '~/components/dashboard/DashboardLayout'
import { Alert, Badge, Skeleton } from "@vc/ui"
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { dashboardStatusSearch } from '~/lib/dashboard-search'
import type { BillingSnapshot, BillingPageLoadResult } from '~/types/dashboard'
import {
  checkoutBillingMutation,
  loadBillingPage,
  portalBillingMutation,
} from '~/lib/api-client'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)
  const [portalPending, setPortalPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadBillingPage()
      .then((page) => {
        if (cancelled) return
        setData(page)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load billing details.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function startCheckout(interval: 'monthly' | 'yearly') {
    if (checkoutPending !== null) return
    setCheckoutPending(interval)
    try {
      const result = await checkoutBillingMutation({ interval })
      if (result.kind === 'ok') {
        window.location.assign(result.url)
        return
      }
      void navigate({ to: '/dashboard/billing', search: dashboardStatusSearch({ error: result.code }) })
    } catch {
      void navigate({ to: '/dashboard/billing', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
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
      void navigate({ to: '/dashboard/billing', search: dashboardStatusSearch({ error: result.code }) })
    } catch {
      void navigate({ to: '/dashboard/billing', search: dashboardStatusSearch({ error: 'polar_unconfigured' }) })
    } finally {
      setPortalPending(false)
    }
  }

  if (loadError) return <LoadError message={loadError} />

  if (!data) {
    return (
      <>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-[26rem] max-w-2xl rounded-2xl" />
      </>
    )
  }

  if (data.selfHosted) {
    return (
      <>
        <PageHeader
          title="Self-hosted workspace"
          description="Billing stays disabled while publishing, media, and agent access run on your Cloudflare resources."
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
        title="Billing"
        description={
          isActive
            ? 'Manage your subscription and customer portal.'
            : 'Subscribe to publish more posts, upload media, and make your public blog indexable.'
        }
      />
      <div className="grid max-w-2xl gap-4">
          <Panel
            title={PRICING.monthlyLabel}
            meta={
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {PRICING.planName}
                </span>
                <BillingStatusBadge status={billing.status} />
              </span>
            }
          >
            <p className="mb-5 font-sans text-base leading-7 text-muted-foreground">
              or {PRICING.annualLabel} billed yearly. Cancel anytime from the customer portal.
            </p>
            <ul className="grid gap-3 rounded-xl bg-muted/50 p-4 text-base leading-6">
              {ENTITLEMENTS.map((entitlement) => (
                <li key={entitlement} className="flex items-start gap-2.5">
                  <CheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="font-sans text-foreground">{entitlement}</span>
                </li>
              ))}
              <li className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-sans text-foreground">{MEDIA.paidStorageLabel} media storage</span>
              </li>
            </ul>
            {isActive ? (
              <Alert className="mt-5" title="If you cancel">
                Paid access ends when the subscription ends. More publishing, media uploads, custom domains,
                search indexing, analytics, and paid API limits will lock. Existing posts stay online, and your
                drafts, media, domains, versions, and analytics history are kept for you if you resubscribe.
              </Alert>
            ) : null}
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
                    disabled={checkoutPending !== null && checkoutPending !== 'monthly'}
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
                    disabled={checkoutPending !== null && checkoutPending !== 'yearly'}
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
                    disabled={checkoutPending !== null}
                    pendingText="Opening portal…"
                    onClick={() => void openPortal()}
                  >
                    Customer portal
                  </PendingSubmitButton>
                </div>
              )
            ) : (
              <p className="mt-5 font-sans text-base leading-7 text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
            {billing.status === 'canceled' ? (
              <Alert className="mt-5" title="Your data is retained">
                Existing posts remain online, but search indexing and paid tools are locked. Drafts, media,
                domains, versions, and analytics history will be available again if you resubscribe.
              </Alert>
            ) : null}
            <p className="mt-5 font-mono text-xs leading-5 text-muted-foreground">
              {isActive
                ? 'Your plan is active: unlimited publishing, media uploads, custom domains, search indexing, analytics, and paid API limits are on.'
                : 'Your first 5 published posts stay free. Subscribe to unlock every paid feature immediately.'}
            </p>
          </Panel>
      </div>
    </>
  )
}