import { QueryCache, QueryClient, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import {
  DashboardApiError,
  loadActivityPage,
  loadAnalyticsPage,
  loadAppRouterContext,
  loadBillingPage,
  loadConnectPage,
  loadDashboardOverview,
  loadMediaPage,
  loadOnboardingStatus,
  loadNewsletterSettings,
  loadPersonalization,
  loadPostEditorPage,
  loadPostsPage,
  loadSettingsPage,
  loadSetupPage,
  loadSubscribersPage,
  listPostVersionsFn,
} from '~/lib/api-client'
import { pinnedDashboardSiteId } from '~/lib/site-pin'
import { clearSessionSecrets } from '~/lib/token-flash'
import type { AnalyticsRange, AppRouterContext } from '~/types/dashboard'

export const signedOutContext: AppRouterContext = {
  googleEnabled: false,
  githubEnabled: false,
  user: null,
  app: null,
  apps: [],
  siteSetupComplete: false,
  siteDisplayName: null,
}

function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof DashboardApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

/**
 * A page query answered 401: the session ended (expired, or signed out in
 * another tab). Cached data belongs to the old session, so drop it and start
 * over at the login page instead of showing an unrecoverable error.
 */
function handleUnauthorized(client: QueryClient) {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return
  clearSessionSecrets()
  client.clear()
  window.location.assign('/login')
}

export function createDashboardQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] === 'context') return
        if (error instanceof DashboardApiError && error.status === 401) handleUnauthorized(client)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  })
  return client
}

/**
 * Any write can change what other screens show (a theme save bumps the site's
 * conflict token used by Settings, a publish changes Posts and Overview, a key
 * delete adds Activity). Mark every cached page stale — without refetching the
 * active ones, which refresh themselves — so the next visit reloads it.
 */
export function markDashboardDataStale(client: QueryClient) {
  void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'context', refetchType: 'none' })
}

/** App-wide cache. Route loaders prefetch into it; pages read with useQuery. */
export const queryClient = createDashboardQueryClient()

// Keyed by the site this tab pinned, not the live context: a switch in another
// tab refreshes context, and re-keying would swap a mounted form for a skeleton.
function tenantKey<T extends readonly unknown[]>(...parts: T) {
  const siteId = pinnedDashboardSiteId() ?? queryClient.getQueryData<AppRouterContext>(['context'])?.app?.siteId ?? 'no-site'
  return [...parts, siteId] as const
}

// Shared query option objects are imported before context loads. Resolve their
// keys when a page uses them, after the selected site is known.
function scopedOptions<T extends { queryKey: readonly unknown[] }>(options: T, key: () => readonly unknown[]): T {
  Object.defineProperty(options, 'queryKey', { enumerable: true, get: key })
  return options
}

export const queryKeys = {
  context: ['context'] as const,
  get overview() { return tenantKey('overview') },
  posts: (params: { status?: string; search?: string; offset?: number; sort?: string; list?: boolean; tagSource?: boolean }) => tenantKey('posts', params),
  postsAll: ['posts'] as const,
  postEditor: (postId: string | undefined) => tenantKey('post-editor', postId ?? 'new'),
  postVersions: (postId: string) => tenantKey('post-versions', postId),
  activity: (actor: 'all' | 'human' | 'agent') => tenantKey('activity', actor),
  activityAll: ['activity'] as const,
  get media() { return tenantKey('media') },
  get connect() { return tenantKey('connect') },
  get settings() { return tenantKey('settings') },
  get billing() { return tenantKey('billing') },
  analytics: (range: AnalyticsRange) => tenantKey('analytics', range),
  subscribers: (params: { search?: string; status?: string; offset?: number }) => tenantKey('subscribers', params),
  subscribersAll: ['subscribers'] as const,
  get newsletter() { return tenantKey('newsletter') },
  get personalization() { return tenantKey('personalization') },
  get setup() { return tenantKey('setup') },
  onboardingStatus: (keyId: string | null) => tenantKey('onboarding-status', keyId),
}

/** Session + site context. Cached so navigation and hover preloads don't wait on it. */
export const contextQuery = queryOptions({
  queryKey: queryKeys.context,
  queryFn: async ({ signal }) => {
    try {
      return await loadAppRouterContext(signal)
    } catch (error) {
      if (error instanceof DashboardApiError && error.status === 401) return signedOutContext
      throw error
    }
  },
  // Short, and revalidated in the background on navigation (see __root), so a
  // sign-out or account switch in another tab is noticed quickly.
  staleTime: 60_000,
})

export const overviewQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.overview,
  queryFn: ({ signal }) => loadDashboardOverview(signal),
}), () => queryKeys.overview)

export function postsQuery(params: { status?: string; search?: string; offset?: number }) {
  return queryOptions({
    queryKey: queryKeys.posts(params),
    queryFn: ({ signal }) => loadPostsPage(params, signal),
  })
}

export function postEditorQuery(postId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.postEditor(postId),
    queryFn: ({ signal }) => loadPostEditorPage({ postId }, signal),
    staleTime: 0,
  })
}

export function postVersionsQuery(postId: string) {
  return queryOptions({
    queryKey: queryKeys.postVersions(postId),
    queryFn: ({ signal }) => listPostVersionsFn({ postId }, signal),
  })
}

export function activityQuery(actor: 'all' | 'human' | 'agent' = 'all') {
  return infiniteQueryOptions({
    queryKey: queryKeys.activity(actor),
    queryFn: ({ signal, pageParam }) =>
      loadActivityPage({ offset: pageParam, actor: actor === 'all' ? undefined : actor }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.reduce((count, page) => count + page.events.length, 0) : undefined,
  })
}

export const mediaQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.media,
  queryFn: ({ signal }) => loadMediaPage(signal),
}), () => queryKeys.media)

export const connectQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.connect,
  queryFn: ({ signal }) => loadConnectPage(signal),
}), () => queryKeys.connect)

export const settingsQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.settings,
  queryFn: ({ signal }) => loadSettingsPage(signal),
}), () => queryKeys.settings)

export const billingQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.billing,
  queryFn: ({ signal }) => loadBillingPage(signal),
}), () => queryKeys.billing)

export function analyticsQuery(range: AnalyticsRange) {
  return queryOptions({
    queryKey: queryKeys.analytics(range),
    queryFn: ({ signal }) => loadAnalyticsPage(range, signal),
    staleTime: 5 * 60_000,
  })
}

export function subscribersQuery(params: { search?: string; status?: string; offset?: number }) {
  return queryOptions({
    queryKey: queryKeys.subscribers(params),
    queryFn: ({ signal }) => loadSubscribersPage(params, signal),
  })
}

export const newsletterQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.newsletter,
  queryFn: ({ signal }) => loadNewsletterSettings(signal),
}), () => queryKeys.newsletter)

export const personalizationQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.personalization,
  queryFn: ({ signal }) => loadPersonalization(signal),
}), () => queryKeys.personalization)

export function onboardingStatusQuery(keyId: string | null) {
  return queryOptions({
    queryKey: queryKeys.onboardingStatus(keyId),
    queryFn: ({ signal }) => loadOnboardingStatus({ keyId, signal }),
    staleTime: 0,
  })
}

export const setupQuery = scopedOptions(queryOptions({
  queryKey: queryKeys.setup,
  queryFn: ({ signal }) => loadSetupPage(signal),
  staleTime: Infinity,
}), () => queryKeys.setup)

/**
 * Re-read session context after a change that affects it (setup, rename, site
 * switch). Pass the router to re-run route guards with the fresh context.
 */
export async function refreshContext(router?: { invalidate: () => Promise<void> }) {
  await queryClient.fetchQuery({ ...contextQuery, staleTime: 0 })
  if (router) await router.invalidate()
}

/**
 * Route-loader helper: start warming the cache and wait briefly, so a fast
 * response renders the page complete (no skeleton flash) while a slow one
 * never holds navigation for more than `budgetMs`. Never throws.
 */
export function warm(promise: Promise<unknown>, budgetMs = 200): Promise<void> {
  return Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, budgetMs)),
  ])
}
