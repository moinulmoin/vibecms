import { createFileRoute, redirect } from '@tanstack/react-router'
import { validateDashboardSearch } from '~/lib/dashboard-search'

/** Plan & billing lives in Settings. This URL stays for Polar return links. */
export const Route = createFileRoute('/dashboard/billing')({
  validateSearch: validateDashboardSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/dashboard/settings', search: { ok: search.ok, error: search.error, tab: 'billing' } })
  },
})
