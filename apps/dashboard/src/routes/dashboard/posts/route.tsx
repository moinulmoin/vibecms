import { createFileRoute } from '@tanstack/react-router'
import { PostEditorPage } from '~/components/dashboard/PostEditorPage'

// Persistent parent for the posts list and editor. The editor renders here (not in
// the child Outlet) so /new -> /$postId/edit after the first save keeps one shell.
export const Route = createFileRoute('/dashboard/posts')({
  component: PostEditorPage,
})
