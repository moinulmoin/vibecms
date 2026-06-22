import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary'
import { NotFound } from './components/NotFound'
import type { AppRouterContext } from '~/server/auth-context-types'

const emptyRouterContext: AppRouterContext = {
  authUrl: '',
  googleEnabled: false,
  user: null,
  app: null,
  siteSetupComplete: false,
  siteDisplayName: null,
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    context: emptyRouterContext,
    defaultPreload: 'intent',
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
  })

  return router
}