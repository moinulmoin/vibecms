import { FREE_TIER, LAUNCH_OFFER, MEDIA, PRICING } from '@vc/config'
import { Check, CreditCard, Minus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn, Skeleton } from '@vc/ui'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { StatusBadge } from '~/components/dashboard/blocks'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useBillingRedirect } from '~/components/dashboard/useBillingRedirect'
import { OWNER_PAYMENT_NOTE, formatBillingDate, pastDueMessage, usePastDueState } from '~/lib/billing-grace'
import { claimMessage, servingMessage, useClaimWindowState, useServingState } from '~/lib/claim-window'
import { billingQuery } from '~/lib/queries'

type Allowance = string | boolean

/** One truth for what each plan includes, in words ("Unlimited") rather than symbols. */
export const PLAN_ROWS: Array<{ label: string; free: Allowance; paid: Allowance }> = [
  { label: 'Published posts', free: String(FREE_TIER.publishedPosts), paid: 'Unlimited' },
  { label: 'Drafts', free: `${FREE_TIER.drafts} at a time`, paid: 'Unlimited' },
  { label: 'Versions', free: 'Unlimited', paid: 'Unlimited' },
  { label: 'Agent keys', free: true, paid: true },
  { label: 'Image uploads', free: `${FREE_TIER.images} images`, paid: MEDIA.paidStorageLabel },
  { label: 'Agent requests', free: 'Limited', paid: 'Unlimited (fair use)' },
  { label: 'Found by search engines', free: false, paid: true },
  { label: 'Your own domain', free: false, paid: true },
  { label: 'No "Published with vibecms" link', free: false, paid: true },
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
  const { pending, redirectTo } = useBillingRedirect()
  const pastDueState = usePastDueState(query.data)
  // The claim window ("keep your blog"): present while a revoked AutoSEOPilot
  // sponsorship waits to be claimed.
  const claim = query.data && !query.data.selfHosted ? query.data.claim : null
  const claimState = useClaimWindowState(claim)
  // What visitors see right now, separate from deletion: a blog that was
  // claimed and then lost its subscription is never deleted, but it can be
  // paused.
  const serving = query.data && !query.data.selfHosted ? query.data.serving : null
  const servingNow = useServingState(serving)

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
  // Recover failed renewals in the portal, even if sponsorship still covers the blog.
  const pastDue = pastDueState !== null
  const sponsored = data.managed?.effective === true
  const managed = data.managed && !active && !pastDue ? data.managed : null
  // Failed renewals keep paid features through the grace window; sponsorship keeps them regardless.
  const paidActive = active || sponsored || pastDueState?.kind === 'grace'
  const periodEnd = active && billing.currentPeriodEnd ? formatBillingDate(billing.currentPeriodEnd * 1000) : null
  const ending = active && billing.cancelAtPeriodEnd === true

  return (
    <div className="grid gap-8">
      <div className="flex max-w-2xl flex-wrap items-start justify-between gap-4 rounded-xl border border-border p-5">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
            {managed ? 'Sponsored plan' : active || pastDue ? 'Paid plan' : 'Free plan'}
            {billing.status !== 'none' && !managed ? <StatusBadge status={billing.status} /> : null}
            {managed ? <StatusBadge status={managed.effective ? 'active' : managed.status === 'revoked' ? 'canceled' : 'unknown'} label={managed.effective ? 'Active' : 'Ended'} /> : null}
          </p>
          <p className={cn('text-[0.9375rem] leading-7', ending || pastDue ? 'text-foreground' : 'text-muted-foreground')}>
            {managed
              ? managed.effective
                ? 'AutoSEOPilot covers this blog. Everything is unlocked.'
                : claim
                  ? claimMessage(claim, claimState ?? 'grace')
                  : (serving && servingNow && servingMessage(serving, servingNow)) ||
                    'Your subscription ended. Posts stay online and nothing was deleted.'
              : active
                ? ending
                  ? periodEnd
                    ? `Ends ${periodEnd}. Everything stays unlocked until then.`
                    : 'Your subscription is set to end. Everything stays unlocked until then.'
                  : periodEnd
                    ? `Renews ${periodEnd}.`
                    : 'Everything is unlocked.'
                : pastDueState
                  ? pastDueMessage(pastDueState, sponsored)
                  : billing.status === 'canceled'
                    ? 'Your subscription ended. Posts stay online and nothing was deleted.'
                    : `Free includes ${FREE_TIER.publishedPosts} published posts, ${FREE_TIER.drafts} drafts at a time, and ${FREE_TIER.images} images. Subscribe for unlimited posts.`}
          </p>
        </div>
        {!data.isOwner ? (
          <p className="text-sm text-muted-foreground">{pastDue ? OWNER_PAYMENT_NOTE : 'Only the owner can change the plan.'}</p>
        ) : pastDue ? (
          <PendingSubmitButton type="button" pending={pending === 'portal'} pendingText="Opening…" onClick={() => void redirectTo('portal')}>
            <CreditCard aria-hidden data-icon="inline-start" /> Update payment
          </PendingSubmitButton>
        ) : active ? (
          <PendingSubmitButton type="button" variant="outline" pending={pending === 'portal'} pendingText="Opening…" onClick={() => void redirectTo('portal')}>
            <CreditCard aria-hidden data-icon="inline-start" /> Manage subscription
          </PendingSubmitButton>
        ) : managed?.effective ? null : (
          <div className="flex flex-wrap gap-2">
            <PendingSubmitButton type="button" pending={pending === 'monthly'} pendingText="Opening checkout…" disabled={pending !== null} onClick={() => void redirectTo('monthly')}>
              Upgrade · {LAUNCH_OFFER.monthlyLabel} ({LAUNCH_OFFER.monthlyPercentOff}% off)
            </PendingSubmitButton>
            <PendingSubmitButton type="button" variant="outline" pending={pending === 'yearly'} pendingText="Opening checkout…" disabled={pending !== null} onClick={() => void redirectTo('yearly')}>
              Yearly · {LAUNCH_OFFER.annualLabel} ({LAUNCH_OFFER.annualPercentOff}% off)
            </PendingSubmitButton>
            <p className="basis-full text-xs text-muted-foreground">
              Launch price (normally {PRICING.monthlyLabel}). {LAUNCH_OFFER.lockNote}
            </p>
          </div>
        )}
      </div>

      <PlanTable paidActive={paidActive} />

      {!active && !pastDue && !managed && data.isOwner && billing.polarCustomerId ? (
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
