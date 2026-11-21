import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTransition } from 'react'
import { Button } from '~/components/ui/button'
import { selectDashboardApp, suspendDashboardMutations } from '~/lib/api-client'
import { setupAuthClient } from '~/lib/auth-client'
import { validateDashboardSearch, type DashboardStatusSearch } from '~/lib/dashboard-search'
import { queryClient } from '~/lib/queries'
import { clearSessionSecrets } from '~/lib/token-flash'

type BillingSearch = DashboardStatusSearch & { site: string | undefined }

/**
 * Plan & billing lives in Settings. This URL stays for Polar return links and
 * for failed-payment emails, whose `site` names the blog the email is about:
 * an owner of several blogs lands on that blog's billing, not the one selected,
 * and an account that cannot open that blog never sees another blog's billing.
 */
export const Route = createFileRoute('/dashboard/billing')({
  validateSearch: (search: Record<string, unknown>): BillingSearch => ({
    ...validateDashboardSearch(search),
    site: typeof search.site === 'string' ? search.site : undefined,
  }),
  beforeLoad: async ({ search, context }) => {
    if (search.site && search.site !== context.app?.siteId) {
      const target = context.apps.find((app) => app.siteId === search.site)
      if (!target) return
      await selectDashboardApp({ workspaceId: target.workspaceId, siteId: target.siteId })
      suspendDashboardMutations()
      clearSessionSecrets()
      window.location.assign('/dashboard/settings?tab=billing')
      return new Promise<never>(() => {})
    }
    throw redirect({ to: '/dashboard/settings', search: { ok: search.ok, error: search.error, tab: 'billing' } })
  },
  component: BillingLinkForAnotherAccount,
})

function BillingLinkForAnotherAccount() {
  const [isPending, startTransition] = useTransition()
  const switchAccount = () => {
    const returnTo = window.location.pathname + window.location.search
    startTransition(() => {
      void setupAuthClient().signOut({
        fetchOptions: {
          onSuccess: () => {
            clearSessionSecrets()
            queryClient.clear()
            window.location.assign(`/login?${new URLSearchParams({ returnTo })}`)
          },
        },
      })
    })
  }
  return (
    <section className="mx-auto max-w-xl py-12">
      <h1 className="text-xl font-semibold">Sign in as the blog's owner to update payment</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This payment link is for a blog managed from another account. Switch to that account and you'll land right on its Plan &amp;
        billing, ready to update the card.
      </p>
      <Button className="mt-4" onClick={switchAccount} disabled={isPending}>
        Switch account
      </Button>
    </section>
  )
}
