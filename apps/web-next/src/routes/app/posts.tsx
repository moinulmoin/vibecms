import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/dashboard/DashboardLayout'

export const Route = createFileRoute('/app/posts')({
  component: PostsPlaceholder,
})

function PostsPlaceholder() {
  return (
    <PageHeader kicker="Posts" title="Posts" description="Post list and editor will be ported in the next migration step." />
  )
}