import { createServerFn } from '@tanstack/react-start'
import { ogOrigin } from '~/server/og-origin.server'

/** Server fn exposing the absolute site origin to route loaders (for absolute og:image). */
export const getOgOrigin = createServerFn({ method: 'GET' }).handler(async () => ogOrigin())
