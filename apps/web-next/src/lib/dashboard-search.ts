/** TanStack Router treats validated search keys as required (value may be `undefined`). */

export type PostsListSearch = {
  status: string | undefined
  search: string | undefined
  ok: string | undefined
  error: string | undefined
}

/** Child routes under `/app/posts` inherit the list search keys. */
export type PostEditorSearch = PostsListSearch

export const emptyPostsListSearch: PostsListSearch = {
  status: undefined,
  search: undefined,
  ok: undefined,
  error: undefined,
}

export const emptyPostEditorSearch: PostEditorSearch = emptyPostsListSearch

export function postsListSearch(overrides: Partial<PostsListSearch> = {}): PostsListSearch {
  return { ...emptyPostsListSearch, ...overrides }
}

export function postEditorSearch(overrides: Partial<PostEditorSearch> = {}): PostEditorSearch {
  return postsListSearch(overrides)
}

export function statusSearchFromMutation(result: { kind: 'ok' | 'error'; code: string }): PostsListSearch {
  return postsListSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
}