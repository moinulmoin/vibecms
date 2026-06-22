import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/server/auth'
import { maybeRejectOtpSendRateLimit } from '~/server/auth-guards'

async function handleAuth(request: Request) {
  const rateLimited = await maybeRejectOtpSendRateLimit(request)
  if (rateLimited) return rateLimited
  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
})