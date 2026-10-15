import { createFileRoute } from '@tanstack/react-router'
import { validatePostsSearch } from '~/lib/dashboard-search'
import { requirePostEditorAccess } from '~/lib/dashboard-role'

// The editor itself is rendered by the parent /dashboard/posts route.
export const Route = createFileRoute('/dashboard/posts/$postId/edit')({
  validateSearch: validatePostsSearch,
  beforeLoad: ({ context }) => requirePostEditorAccess(context),
  component: () => null,
})
