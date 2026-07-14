import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { StatusToaster, ToastProvider } from '~/components/Toaster'
import { loadAppRouterContext } from '~/lib/api-client'
import { DashboardApiError } from '~/lib/api-client'
import type { AppRouterContext } from '~/types/dashboard'
import appCss from '~/styles.css?url'

export const Route = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: async () => {
    try {
      return await loadAppRouterContext()
    } catch (error) {
      if (error instanceof DashboardApiError && error.status === 401) {
        return {
          googleEnabled: false,
          user: null,
          app: null,
          siteSetupComplete: false,
          siteDisplayName: null,
        }
      }
      throw error
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  component: RootLayout,
})

function RootLayout() {
  return (
    <ToastProvider>
      <Outlet />
      <StatusToaster />
    </ToastProvider>
  )
}