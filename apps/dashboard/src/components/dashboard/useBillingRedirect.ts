import { useState } from 'react'
import { useToast } from '~/components/Toaster'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { checkoutBillingMutation, portalBillingMutation } from '~/lib/api-client'

export type BillingRedirect = 'monthly' | 'yearly' | 'portal'

/**
 * Opens Polar checkout or the customer portal; one request at a time, failures
 * surface as toasts. `newTab` keeps the current page (the editor's unsaved
 * writing): the tab opens during the click, so popup blockers allow it, and
 * gets the URL once it arrives.
 */
export function useBillingRedirect() {
  const { toast } = useToast()
  const [pending, setPending] = useState<BillingRedirect | null>(null)

  async function redirectTo(action: BillingRedirect, options: { newTab?: boolean } = {}) {
    if (pending) return
    setPending(action)
    const tab = options.newTab ? window.open('', '_blank') : null
    if (tab) tab.opener = null
    try {
      const result = action === 'portal' ? await portalBillingMutation() : await checkoutBillingMutation({ interval: action })
      if (result.kind === 'ok') {
        if (tab) tab.location.href = result.url
        else window.location.assign(result.url)
        return
      }
      tab?.close()
      toast(resolveFormStatus({ error: result.code }) ?? { variant: 'error', title: 'Checkout didn’t open', message: 'Try again.' })
    } catch {
      tab?.close()
      toast({ variant: 'error', title: 'Checkout didn’t open', message: 'Check your connection and try again.' })
    } finally {
      setPending(null)
    }
  }

  return { pending, redirectTo }
}
