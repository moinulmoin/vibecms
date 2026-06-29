import { createFileRoute } from '@tanstack/react-router'
import { NewPostEditorPage } from '~/components/dashboard/PostEditorPage'
import type { PostsListSearch } from '~/lib/dashboard-search'

function validatePostsSearch(search: Record<string, unknown>): PostsListSearch {
  return {
    status: typeof search.status === 'string' ? search.status : undefined,
    search: typeof search.search === 'string' ? search.search : undefined,
    ok: typeof search.ok === 'string' ? search.ok : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }
}

export const Route = createFileRoute('/app/posts/new')({
  validateSearch: validatePostsSearch,
  component: NewPostEditorPage,
})