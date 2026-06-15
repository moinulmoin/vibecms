import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

export const Route = createFileRoute('/api/env-probe')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          hasTokenPepper: Boolean(env.TOKEN_PEPPER && env.TOKEN_PEPPER.length > 0),
          appEnv: env.APP_ENV,
        }),
    },
  },
})