import { useQuery } from '@tanstack/react-query'
import { MessageFounderLink } from '~/components/dashboard/PlanActions'
import { billingQuery } from '~/lib/queries'

/**
 * Operator abuse suspension (docs/blog-suspension.md), above every dashboard
 * page while it lasts: what visitors see, why, that nothing was deleted, and
 * how to reach us. Publish, schedule and upload answer with the same refusal.
 */
export function SuspendedBanner() {
  const { data } = useQuery(billingQuery)
  const suspension = data?.suspension
  if (!suspension) return null
  return (
    <section
      aria-label="Blog suspended"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3"
    >
      <p className="flex min-w-0 items-start gap-2.5 text-[0.9375rem] leading-6 text-foreground">
        <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-destructive" />
        <span>
          This blog is suspended and not publicly visible.{suspension.reason ? ` Reason: ${suspension.reason.replace(/[.!?]?$/, '.')}` : ''} Nothing was
          deleted; publishing, scheduling and uploads are paused.
        </span>
      </p>
      <MessageFounderLink />
    </section>
  )
}
