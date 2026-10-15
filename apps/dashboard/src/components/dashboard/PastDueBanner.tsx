import { CreditCard } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useBillingRedirect } from '~/components/dashboard/useBillingRedirect'
import { OWNER_PAYMENT_NOTE, pastDueMessage, usePastDueState } from '~/lib/billing-grace'
import { billingQuery } from '~/lib/queries'

/** Failed-renewal notice above every dashboard page; recovery goes through the customer portal. */
export function PastDueBanner() {
  const { data } = useQuery(billingQuery)
  const state = usePastDueState(data)
  const { pending, redirectTo } = useBillingRedirect()
  if (!state || !data || data.selfHosted) return null

  return (
    <section
      aria-label="Payment status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3"
    >
      <p className="flex min-w-0 items-center gap-2.5 text-[0.9375rem] leading-6 text-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        {pastDueMessage(state, data.managed?.effective === true)}
      </p>
      {data.isOwner ? (
        <PendingSubmitButton
          type="button"
          size="sm"
          variant="outline"
          pending={pending === 'portal'}
          pendingText="Opening…"
          onClick={() => void redirectTo('portal')}
        >
          <CreditCard aria-hidden data-icon="inline-start" /> Update payment
        </PendingSubmitButton>
      ) : (
        <p className="text-sm text-muted-foreground">{OWNER_PAYMENT_NOTE}</p>
      )}
    </section>
  )
}
