/** TanStack Router treats validated search keys as required (value may be `undefined`). */

export type DashboardStatusSearch = {
  ok: string | undefined
  error: string | undefined
}

export type PostsListSearch = DashboardStatusSearch & {
  status: string | undefined
  search: string | undefined
}

export type SettingsSearch = DashboardStatusSearch & {
  tab: string | undefined
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

export function validatePostsSearch(search: Record<string, unknown>): PostsListSearch {
  return {
    status: typeof search.status === 'string' ? search.status : undefined,
    search: typeof search.search === 'string' ? search.search : undefined,
    ...validateDashboardSearch(search),
  }
}

const SETTINGS_TABS: Record<string, true> = { general: true, theme: true, voice: true, domain: true, billing: true, data: true }

export function validateSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const tab = typeof search.tab === 'string' && SETTINGS_TABS[search.tab] ? search.tab : undefined
  return {
    ok: typeof search.ok === 'string' ? search.ok : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    tab,
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