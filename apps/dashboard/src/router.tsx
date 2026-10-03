import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { signedOutContext } from '~/lib/queries'

export function getRouter() {
  return createRouter({
    routeTree,
    context: signedOutContext,
    defaultPreload: 'intent',
    // Data lives in the TanStack Query cache; let loaders run on every preload
    // and let the query cache decide whether anything actually refetches.
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 400,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
