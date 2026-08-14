import { createFileRoute } from '@tanstack/react-router'
import { NewPostEditorPage } from '~/components/dashboard/PostEditorPage'
import { validatePostsSearch } from '~/lib/dashboard-search'
import { requirePostEditorAccess } from '~/lib/dashboard-role'

export const Route = createFileRoute('/dashboard/posts/new')({
  validateSearch: validatePostsSearch,
  beforeLoad: ({ context }) => requirePostEditorAccess(context),
  component: NewPostEditorPage,
})