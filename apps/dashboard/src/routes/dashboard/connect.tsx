import { createFileRoute, redirect } from '@tanstack/react-router'
import { ConnectPage } from '~/components/dashboard/ConnectPage'
import { isAgentClient, type AgentClient } from '~/components/dashboard/ConnectAgent'
import { validateDashboardSearch, type DashboardStatusSearch } from '~/lib/dashboard-search'
import { connectQuery, queryClient, warm } from '~/lib/queries'

type ConnectSearch = DashboardStatusSearch & { client?: AgentClient }

export const Route = createFileRoute('/dashboard/connect')({
  beforeLoad: ({ context }) => {
    if (context.app?.actor.role === 'viewer') {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: (search: Record<string, unknown>): ConnectSearch => ({
    ...validateDashboardSearch(search),
    ...(isAgentClient(search.client) ? { client: search.client } : {}),
  }),
  loader: () => warm(queryClient.prefetchQuery(connectQuery)),
  component: ConnectPage,
})
