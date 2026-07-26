import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import type { AppRouterContext } from '~/types/dashboard'

const emptyRouterContext: AppRouterContext = {
  googleEnabled: false,
  user: null,
  app: null,
  siteSetupComplete: false,
  siteDisplayName: null,
}

export function getRouter() {
  return createRouter({
    routeTree,
    context: emptyRouterContext,
    defaultPreload: 'intent',
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