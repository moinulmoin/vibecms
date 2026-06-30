/** TanStack Router treats validated search keys as required (value may be `undefined`). */

export type DashboardStatusSearch = {
  ok: string | undefined
  error: string | undefined
}

export type PostsListSearch = DashboardStatusSearch & {
  status: string | undefined
  search: string | undefined
}

/** Child routes under `/dashboard/posts` inherit the list search keys. */
export type PostEditorSearch = PostsListSearch

export const emptyDashboardStatusSearch: DashboardStatusSearch = {
  ok: undefined,
  error: undefined,
}

export const emptyPostsListSearch: PostsListSearch = {
  status: undefined,
  search: undefined,
  ok: undefined,
  error: undefined,
}

export const emptyPostEditorSearch: PostEditorSearch = emptyPostsListSearch

export function validateDashboardSearch(search: Record<string, unknown>): DashboardStatusSearch {
  return {
    ok: typeof search.ok === 'string' ? search.ok : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }
}

export function dashboardStatusSearch(overrides: Partial<DashboardStatusSearch> = {}): DashboardStatusSearch {
  return { ...emptyDashboardStatusSearch, ...overrides }
}

export function postsListSearch(overrides: Partial<PostsListSearch> = {}): PostsListSearch {
  return { ...emptyPostsListSearch, ...overrides }
}

export function postEditorSearch(overrides: Partial<PostEditorSearch> = {}): PostEditorSearch {
  return postsListSearch(overrides)
}

export function statusSearchFromMutation(result: { kind: 'ok' | 'error'; code: string }): PostsListSearch {
  return postsListSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
}