/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import * as React from 'react'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { StatusToaster, ToastProvider } from '~/components/Toaster'
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
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'icon', href: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
      { rel: 'manifest', href: '/site.webmanifest' },
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
        <ToastProvider>
          {children}
          <StatusToaster />
        </ToastProvider>
        <Scripts />
      </body>
    </html>
  )
}