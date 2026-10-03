/** TanStack Router treats validated search keys as required (value may be `undefined`). */

export type DashboardStatusSearch = {
  ok: string | undefined
  error: string | undefined
}

export type PostsListSearch = DashboardStatusSearch & {
  status: string | undefined
  search: string | undefined
  sort?: string | undefined
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
    sort: typeof search.sort === 'string' ? search.sort : undefined,
    ...validateDashboardSearch(search),
  }
}

export const SETTINGS_TABS = ['site', 'voice', 'domain', 'billing', 'export'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** Legacy tab names from old links. `theme` and `newsletter` are redirected by the route. */
const SETTINGS_TAB_ALIASES: Record<string, SettingsTab | 'theme' | 'newsletter'> = {
  general: 'site',
  data: 'export',
  theme: 'theme',
  newsletter: 'newsletter',
}

export function validateSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const raw = typeof search.tab === 'string' ? search.tab : undefined
  const resolved = raw ? (SETTINGS_TAB_ALIASES[raw] ?? raw) : undefined
  const tab =
    resolved === 'theme' || resolved === 'newsletter' || SETTINGS_TABS.some((value) => value === resolved)
      ? resolved
      : undefined
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