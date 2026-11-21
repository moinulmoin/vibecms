import { createFileRoute, redirect } from '@tanstack/react-router'
import { selectDashboardApp, suspendDashboardMutations } from '~/lib/api-client'
import { validateDashboardSearch, type DashboardStatusSearch } from '~/lib/dashboard-search'
import { clearSessionSecrets } from '~/lib/token-flash'

type BillingSearch = DashboardStatusSearch & { site: string | undefined }

/**
 * Plan & billing lives in Settings. This URL stays for Polar return links and
 * for failed-payment emails, whose `site` names the blog the email is about:
 * an owner of several blogs lands on that blog's billing, not the one selected.
 */
export const Route = createFileRoute('/dashboard/billing')({
  validateSearch: (search: Record<string, unknown>): BillingSearch => ({
    ...validateDashboardSearch(search),
    site: typeof search.site === 'string' ? search.site : undefined,
  }),
  beforeLoad: async ({ search, context }) => {
    const target = search.site ? context.apps.find((app) => app.siteId === search.site) : undefined
    if (target && target.siteId !== context.app?.siteId) {
      await selectDashboardApp({ workspaceId: target.workspaceId, siteId: target.siteId })
      suspendDashboardMutations()
      clearSessionSecrets()
      window.location.assign('/dashboard/settings?tab=billing')
    }
    throw redirect({ to: '/dashboard/settings', search: { ok: search.ok, error: search.error, tab: 'billing' } })
  },
})
