import { createFileRoute } from '@tanstack/react-router'
import { apiV1App } from '~/server/api/app'

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: ({ request }) => apiV1App.fetch(request),
      POST: ({ request }) => apiV1App.fetch(request),
      PUT: ({ request }) => apiV1App.fetch(request),
      PATCH: ({ request }) => apiV1App.fetch(request),
      DELETE: ({ request }) => apiV1App.fetch(request),
      OPTIONS: ({ request }) => apiV1App.fetch(request),
      HEAD: ({ request }) => apiV1App.fetch(request),
    },
  },
})