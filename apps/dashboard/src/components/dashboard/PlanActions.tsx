import { FORM_STATUS, supportMailto } from '@vc/config'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@vc/ui'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useBillingRedirect } from '~/components/dashboard/useBillingRedirect'
import { billingQuery } from '~/lib/queries'
import type { BillingPageLoadResult } from '~/types/dashboard'

/** Free-plan caps the server refuses with; each one is answered with Get Cloud. */
export const PLAN_CAP_CODES = ['billing_required', 'draft_limit', 'media_quota_free'] as const
export type PlanCapCode = (typeof PLAN_CAP_CODES)[number]

export function isPlanCapCode(code: string | null | undefined): code is PlanCapCode {
  return typeof code === 'string' && (PLAN_CAP_CODES as readonly string[]).includes(code)
}

/**
 * One click to Cloud checkout (the existing monthly checkout at the launch
 * price as configured). Only the owner can buy: for anyone else checkout
 * answers "Only the workspace owner can do that." as a toast. `newTab` where
 * leaving the page could lose unsaved writing (the editor).
 */
export function GetCloudButton({ variant = 'outline', size = 'sm', newTab = false, autoFocus = false }: { variant?: 'default' | 'outline'; size?: 'sm' | 'default'; newTab?: boolean; autoFocus?: boolean }) {
  const { pending, redirectTo } = useBillingRedirect()
  return (
    <PendingSubmitButton
      type="button"
      size={size}
      variant={variant}
      className="shrink-0"
      autoFocus={autoFocus}
      pending={pending === 'monthly'}
      pendingText="Opening checkout…"
      onClick={() => void redirectTo('monthly', { newTab })}
    >
      Get Cloud
    </PendingSubmitButton>
  )
}

/**
 * A free-plan cap the server refused: guidance, not an error. A neutral
 * surface, the cap's name, the shared limit message (nothing already online
 * goes away), then the way forward. `action` is Get Cloud where the page has
 * no better place for it; the publish dialog puts Get Cloud in its footer.
 */
export function PlanLimitNotice({
  code,
  message,
  action,
  onDismiss,
  plansInNewTab = false,
}: {
  code: PlanCapCode
  message: string
  action?: ReactNode
  onDismiss?: () => void
  plansInNewTab?: boolean
}) {
  return (
    <div role="alert" className="grid gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">{FORM_STATUS[code]?.title ?? 'Free plan limit reached'}</p>
      <p className="leading-6 text-muted-foreground">{message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {action}
        <Link
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          to="/dashboard/settings"
          search={{ ok: undefined, error: undefined, tab: 'billing' }}
          {...(plansInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          Compare plans
        </Link>
        {onDismiss ? (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground sm:ml-auto" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function planLabel(data: BillingPageLoadResult): string {
  if (data.selfHosted) return 'Self-hosted'
  if (data.managed?.effective) return 'Sponsored by AutoSEOPilot'
  if (data.billing.status === 'past_due') return 'Cloud (payment failed)'
  if (data.billing.status === 'active') return 'Cloud'
  return 'Free'
}

/** The support address with the blog's address and plan filled in. */
export function useFounderMailto(): string {
  const { data } = useQuery(billingQuery)
  const lines = data ? [`Blog: ${data.publicUrl ?? 'not set up yet'}`, `Plan: ${planLabel(data)}`] : []
  return supportMailto('Message for the founder', lines)
}

/** "Message the founder": opens the support address, no chat. */
export function MessageFounderLink({ className }: { className?: string }) {
  const href = useFounderMailto()
  return (
    <a
      href={href}
      className={className ?? 'inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground'}
    >
      <MessageSquare aria-hidden className="size-4" />
      Message the founder
    </a>
  )
}
