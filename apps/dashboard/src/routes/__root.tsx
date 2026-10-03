import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { StatusToaster, ToastProvider } from '~/components/Toaster'
import { contextQuery, queryClient } from '~/lib/queries'
import type { AppRouterContext } from '~/types/dashboard'
import appCss from '~/styles.css?url'

export const Route = createRootRouteWithContext<AppRouterContext>()({
  // Cached: navigation and hover preloads reuse the session context instead of
  // waiting on it; once stale it revalidates in the background so a sign-out
  // elsewhere is picked up. Mutations that change it call refreshContext().
  beforeLoad: () => queryClient.ensureQueryData({ ...contextQuery, revalidateIfStale: true }),
  head: () => ({
    meta: [
      { title: 'vibecms' },
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