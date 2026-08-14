import { createFileRoute } from '@tanstack/react-router'
import { PostsPage } from '~/components/dashboard/PostsPage'
import { validatePostsSearch } from '~/lib/dashboard-search'
import { canManageDashboardContent } from '~/lib/dashboard-role'

export const Route = createFileRoute('/dashboard/posts/')({
  validateSearch: validatePostsSearch,
  component: PostsRoute,
})

function PostsRoute() {
  const search = Route.useSearch()
  const { app } = Route.useRouteContext()
  return <PostsPage search={search} canEdit={canManageDashboardContent(app?.actor.role)} />
}
