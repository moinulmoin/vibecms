import { FREE_TIER, LAUNCH_OFFER, MEDIA, PRICING } from '@vc/config'
import { Check, CreditCard, Minus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { cn, Skeleton } from '@vc/ui'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { StatusBadge } from '~/components/dashboard/blocks'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useToast } from '~/components/Toaster'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { checkoutBillingMutation, portalBillingMutation } from '~/lib/api-client'
import { billingQuery } from '~/lib/queries'

type Allowance = string | boolean

/** One truth for what each plan includes. `∞` instead of limits on the paid plan. */
export const PLAN_ROWS: Array<{ label: string; free: Allowance; paid: Allowance }> = [
  { label: 'Published posts', free: String(FREE_TIER.publishedPosts), paid: '∞' },
  { label: 'Drafts and versions', free: '∞', paid: '∞' },
  { label: 'Agent keys', free: true, paid: true },
  { label: 'Image uploads', free: false, paid: MEDIA.paidStorageLabel },
  { label: 'Found by search engines', free: false, paid: true },
  { label: 'Your own domain', free: false, paid: true },
  { label: 'Analytics', free: false, paid: true },
]

function AllowanceCell({ value }: { value: Allowance }) {
  if (value === true) return <Check aria-label="Included" className="size-4 text-primary" />
  if (value === false) return <Minus aria-label="Not included" className="size-4 text-muted-foreground/60" />
  return <span className="tabular-nums text-foreground">{value}</span>
}

function PlanTable({ paidActive }: { paidActive: boolean }) {
  return (
    <table className="w-full max-w-2xl text-left text-[0.9375rem]">
      <thead>
        <tr className="border-b border-[color:var(--hairline)] text-sm text-muted-foreground">
          <th scope="col" className="py-2.5 font-normal">
            <span className="sr-only">Feature</span>
          </th>
          <th scope="col" className={cn('w-28 py-2.5 font-normal', !paidActive && 'font-medium text-foreground')}>
            Free
          </th>
          <th scope="col" className={cn('w-36 py-2.5 font-normal', paidActive && 'font-medium text-foreground')}>
            Paid · {LAUNCH_OFFER.monthlyLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {PLAN_ROWS.map((row) => (
          <tr key={row.label} className="border-b border-[color:var(--hairline)] last:border-b-0">
            <th scope="row" className="py-3 pr-4 font-normal text-foreground">
              {row.label}
            </th>
            <td className="py-3">
              <AllowanceCell value={row.free} />
            </td>
            <td className="py-3">
              <AllowanceCell value={row.paid} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Plan & billing, rendered inside Settings. */
export function PlanAndBilling() {
  const query = useQuery(billingQuery)
  const { toast } = useToast()
  const [pending, setPending] = useState<'monthly' | 'yearly' | 'portal' | null>(null)

  async function redirectTo(action: 'monthly' | 'yearly' | 'portal') {
    if (pending) return
    setPending(action)
    try {
      const result = action === 'portal' ? await portalBillingMutation() : await checkoutBillingMutation({ interval: action })
      if (result.kind === 'ok') {
        window.location.assign(result.url)
        return
      }
      toast(resolveFormStatus({ error: result.code }) ?? { variant: 'error', title: 'Checkout didn’t open', message: 'Try again.' })
    } catch {
      toast({ variant: 'error', title: 'Checkout didn’t open', message: 'Check your connection and try again.' })
    } finally {
      setPending(null)
    }
  }

  if (query.isError && !query.data) {
    return <LoadError message="Your plan didn’t load." onRetry={() => void query.refetch()} />
  }
  const data = query.data
  if (!data) {
    return (
      <div className="grid max-w-2xl gap-4" aria-busy="true" aria-label="Loading plan">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  if (data.selfHosted) {
    return (
      <div className="grid max-w-2xl gap-2">
        <h2 className="text-lg font-semibold text-foreground">Self-hosted</h2>
        <p className="text-[0.9375rem] leading-7 text-muted-foreground">
          Everything is unlocked and runs on your own Cloudflare account. There’s nothing to pay here.
        </p>
      </div>
    )
  }

  const billing = data.billing
  const active = billing.status === 'active'
  const managed = data.managed && !active ? data.managed : null
  const paidActive = active || managed?.effective === true
  const renews = active && billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd * 1000) : null

  return (
    <div className="grid gap-8">
      <div className="flex max-w-2xl flex-wrap items-start justify-between gap-4 rounded-xl border border-border p-5">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
            {managed ? 'Sponsored plan' : active ? 'Paid plan' : 'Free plan'}
            {billing.status !== 'none' && !managed ? <StatusBadge status={billing.status} /> : null}
            {managed ? <StatusBadge status={managed.effective ? 'active' : managed.status === 'revoked' ? 'canceled' : 'unknown'} label={managed.effective ? 'Active' : 'Ended'} /> : null}
          </p>
          <p className="text-[0.9375rem] leading-7 text-muted-foreground">
            {managed
              ? managed.effective
                ? 'AutoSEOPilot covers this blog. Everything is unlocked.'
                : 'The sponsorship ended. Your posts stay online; paid features are paused.'
              : active
                ? renews
                  ? `Renews ${renews.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}.`
                  : 'Everything is unlocked.'
                : billing.status === 'canceled'
                  ? 'Your subscription ended. Posts stay online and nothing was deleted.'
                  : `Publish up to ${FREE_TIER.publishedPosts} posts for free. Upgrade for unlimited publishing.`}
          </p>
        </div>
        {!data.isOwner ? (
          <p className="text-sm text-muted-foreground">Only the owner can change the plan.</p>
        ) : active ? (
          <PendingSubmitButton type="button" variant="outline" pending={pending === 'portal'} pendingText="Opening…" onClick={() => void redirectTo('portal')}>
            <CreditCard aria-hidden data-icon="inline-start" /> Manage subscription
          </PendingSubmitButton>
        ) : managed?.effective ? null : (
          <div className="flex flex-wrap gap-2">
            <PendingSubmitButton type="button" pending={pending === 'monthly'} pendingText="Opening checkout…" disabled={pending !== null} onClick={() => void redirectTo('monthly')}>
              Upgrade · {LAUNCH_OFFER.monthlyLabel}
            </PendingSubmitButton>
            <PendingSubmitButton type="button" variant="outline" pending={pending === 'yearly'} pendingText="Opening checkout…" disabled={pending !== null} onClick={() => void redirectTo('yearly')}>
              Yearly · {LAUNCH_OFFER.annualLabel}
            </PendingSubmitButton>
            <p className="basis-full text-xs text-muted-foreground">
              Early access rate (normally {PRICING.monthlyLabel}). {LAUNCH_OFFER.lockNote}
            </p>
          </div>
        )}
      </div>

      <PlanTable paidActive={paidActive} />

      {!active && !managed && data.isOwner && billing.polarCustomerId ? (
        <button
          type="button"
          onClick={() => void redirectTo('portal')}
          className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {pending === 'portal' ? 'Opening…' : 'Invoices and payment details'}
        </button>
      ) : null}
    </div>
  )
}
