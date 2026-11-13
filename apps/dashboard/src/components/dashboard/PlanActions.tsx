import { supportMailto } from '@vc/config'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useBillingRedirect } from '~/components/dashboard/useBillingRedirect'
import { billingQuery } from '~/lib/queries'
import type { BillingPageLoadResult } from '~/types/dashboard'

/**
 * One click to Cloud checkout (the existing monthly checkout at the launch
 * price as configured). Only the owner can buy: for anyone else checkout
 * answers "Only the workspace owner can do that." as a toast. `newTab` where
 * leaving the page could lose unsaved writing (the editor).
 */
export function GetCloudButton({ variant = 'outline', newTab = false }: { variant?: 'default' | 'outline'; newTab?: boolean }) {
  const { pending, redirectTo } = useBillingRedirect()
  return (
    <PendingSubmitButton
      type="button"
      size="sm"
      variant={variant}
      className="shrink-0"
      pending={pending === 'monthly'}
      pendingText="Opening checkout…"
      onClick={() => void redirectTo('monthly', { newTab })}
    >
      Get Cloud
    </PendingSubmitButton>
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
