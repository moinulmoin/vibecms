/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import * as React from 'react'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import appCss from '~/styles.css?url'
import { BRAND } from '@vc/config'
import { seo } from '~/utils/seo'
import { loadAppRouterContext, type AppRouterContext } from '~/server/auth-context'

export const Route = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: async () => loadAppRouterContext(),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        name: 'theme-color',
        content: '#f6f8f4',
        media: '(prefers-color-scheme: light)',
      },
      {
        name: 'theme-color',
        content: '#0c100e',
        media: '(prefers-color-scheme: dark)',
      },
      ...seo({
        title: `${BRAND.name} | ${BRAND.tagline}`,
        description: BRAND.description,
      }),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        href: '/favicon-light.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        rel: 'icon',
        href: '/favicon-dark.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
      {
        rel: 'preload',
        href: '/fonts/HankenGrotesk-Variable.woff2',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: '/fonts/SpaceGrotesk-Variable.woff2',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: '/fonts/JetBrainsMono-Variable.woff2',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}