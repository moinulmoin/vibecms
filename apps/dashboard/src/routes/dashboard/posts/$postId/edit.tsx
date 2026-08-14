import { createFileRoute } from '@tanstack/react-router'
import { EditPostEditorPage } from '~/components/dashboard/PostEditorPage'
import { validatePostsSearch } from '~/lib/dashboard-search'
import { requirePostEditorAccess } from '~/lib/dashboard-role'

export const Route = createFileRoute('/dashboard/posts/$postId/edit')({
  validateSearch: validatePostsSearch,
  beforeLoad: ({ context }) => requirePostEditorAccess(context),
  component: EditPostRoute,
})

function EditPostRoute() {
  const { postId } = Route.useParams()
  return <EditPostEditorPage postId={postId} />
}