import { useState } from 'react'
import { useToast } from '~/components/Toaster'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { checkoutBillingMutation, portalBillingMutation } from '~/lib/api-client'

export type BillingRedirect = 'monthly' | 'yearly' | 'portal'

/** Opens Polar checkout or the customer portal; one request at a time, failures surface as toasts. */
export function useBillingRedirect() {
  const { toast } = useToast()
  const [pending, setPending] = useState<BillingRedirect | null>(null)

  async function redirectTo(action: BillingRedirect) {
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

  return { pending, redirectTo }
}
