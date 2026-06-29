import { createFileRoute } from '@tanstack/react-router'
import { serveAsset } from '~/server/media'

export const Route = createFileRoute('/media-assets/$assetId')({
  server: {
    handlers: {
      GET: async ({ params }) => serveAsset(params.assetId),
    },
  },
})