import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Bot, ExternalLink, FileText, Inbox, Pencil, Plus, RefreshCw, Rocket, RotateCcw, Search, X } from 'lucide-react'
import { Input, Select } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import type { DashboardPostSummary } from '~/types/dashboard'
import { archivePostMutation, loadPostsPage, unarchivePostMutation } from '~/lib/api-client'
import { Button, LoadError, formatDateTime, formatRelative } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, PageTabs, StatusBadge } from '~/components/dashboard/blocks'
import { Tabs } from '~/components/ui/tabs'
import { useToast } from '~/components/Toaster'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { emptyDashboardStatusSearch, emptyPostEditorSearch, postsListSearch, type PostsListSearch } from '~/lib/dashboard-search'
import { hasPendingChanges, isAgentActor, reviewLabel } from '~/lib/post-review'

/**
 * Last-change actor label for the posts list. Single-human workspace: a human
 * change with an empty profile name is the owner ("you"); unnamed token/agent
 * changes read as "agent".
 */
export function actorDisplayName(updatedByType: string | null, updatedByName: string | null): string {
  const name = updatedByName?.trim()
  if (name) return name
  return updatedByType === 'api_key' || updatedByType === 'agent' ? 'agent' : 'you'
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Needs review' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
] as const

const SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Newest' },
  { value: 'published', label: 'Recently published' },
  { value: 'title', label: 'Title A–Z' },
] as const

const SEARCH_DEBOUNCE_MS = 250

function normalizeStatus(value: string | undefined) {
  return STATUS_TABS.some((tab) => tab.value === value && value !== 'all') ? value : undefined
}

function normalizeSort(value: string | undefined) {
  return SORTS.some((sort) => sort.value === value && value !== 'updated') ? value : undefined
}

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  review: {
    title: 'Nothing waiting on you',
    description: 'Agent drafts and unpublished changes to live posts show up here.',
  },
  draft: { title: 'No drafts', description: 'New posts from you or your agents start as drafts.' },
  published: { title: 'Nothing published yet', description: 'Published posts appear here once they are live.' },
  archived: { title: 'Nothing archived', description: 'Archived posts are hidden from your blog but keep their history.' },
}

export function PostsPage({ search, canEdit }: { search: PostsListSearch; canEdit: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const status = normalizeStatus(search.status)
  const sort = normalizeSort(search.sort)
  const searchQuery = search.search?.trim() || undefined
  const [searchDraft, setSearchDraft] = useState(searchQuery ?? '')
  const lastPushedSearch = useRef(searchQuery ?? '')
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ postId: string; message: string; retry: () => void } | null>(null)

  const params = { status, search: searchQuery, sort }
  const query = useInfiniteQuery({
    queryKey: ['posts', { ...params, list: true }],
    queryFn: ({ pageParam, signal }) => loadPostsPage({ ...params, offset: pageParam || undefined }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.reduce((total, page) => total + page.posts.length, 0) : undefined,
    placeholderData: keepPreviousData,
  })

  // External URL changes (tab links, clear button, back/forward) win over the draft.
  useEffect(() => {
    if ((searchQuery ?? '') !== lastPushedSearch.current) {
      lastPushedSearch.current = searchQuery ?? ''
      setSearchDraft(searchQuery ?? '')
    }
  }, [searchQuery])

  useEffect(() => {
    const next = searchDraft.trim()
    if (next === lastPushedSearch.current) return
    const timer = window.setTimeout(() => {
      lastPushedSearch.current = next
      void navigate({
        to: '/dashboard/posts',
        replace: true,
        search: postsListSearch({ status, sort, search: next || undefined }),
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchDraft, navigate, status, sort])

  function setListParams(next: { status?: string; sort?: string }) {
    void navigate({
      to: '/dashboard/posts',
      search: postsListSearch({
        status: normalizeStatus('status' in next ? next.status : status),
        sort: normalizeSort('sort' in next ? next.sort : sort),
        search: searchQuery,
      }),
    })
  }

  async function runRowMutation(post: DashboardPostSummary, action: 'archive' | 'restore') {
    const key = `${post.id}:${action}`
    setRowPending(key)
    setRowError(null)
    const retry = () => void runRowMutation(post, action)
    try {
      const result = action === 'archive'
        ? await archivePostMutation({ postId: post.id })
        : await unarchivePostMutation({ postId: post.id })
      if (result.kind === 'error') throw new Error(result.code)
      toast(
        action === 'archive'
          ? { variant: 'success', title: 'Post archived', message: `“${post.title}” is hidden from your blog. History is kept.` }
          : { variant: 'success', title: 'Restored to draft', message: `“${post.title}” is a draft again.` },
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['posts'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ])
    } catch {
      setRowError({ postId: post.id, message: `Could not ${action} this post.`, retry })
    } finally {
      setRowPending(null)
    }
  }

  if (query.isError && !query.data) {
    return <LoadError message="Could not load posts." />
  }
  if (!query.data) {
    return <PageSkeleton variant="table" />
  }

  const pages = query.data.pages
  const posts = pages.flatMap((page) => page.posts)
  const publicBaseUrl = pages[0]?.publicBaseUrl ?? null
  const hasFilters = Boolean(status || searchQuery)
  const emptyCopy = searchQuery
    ? { title: 'No posts match', description: `Nothing matches “${searchQuery}”${status ? ' in this view' : ''}.` }
    : status
      ? EMPTY_COPY[status]
      : null

  return (
    <>
      <PageHeader
        title="Posts"
        description="Everything you and your agents write. Nothing goes live until you publish it."
        action={canEdit ? (
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}><Plus aria-hidden data-icon="inline-start" /> New post</Link>
          </Button>
        ) : undefined}
      />
      <Tabs value={status ?? 'all'} onValueChange={(value) => setListParams({ status: value })} className="gap-0">
        <PageTabs label="Filter posts" tabs={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))} />
      </Tabs>

      <div className="-mt-2 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search posts"
            placeholder="Search title, slug, excerpt"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchDraft) {
                event.preventDefault()
                setSearchDraft('')
              }
            }}
            className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchDraft ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchDraft('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="w-full sm:ml-auto sm:w-48">
          <Select aria-label="Sort posts" value={sort ?? 'updated'} onChange={(event) => setListParams({ sort: event.currentTarget.value })}>
            {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
      </div>

      {posts.length ? (
        <div className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ul className="grid">
            {posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                canEdit={canEdit}
                publicBaseUrl={publicBaseUrl}
                pendingKey={rowPending}
                error={rowError?.postId === post.id ? rowError : null}
                onArchive={() => runRowMutation(post, 'archive')}
                onRestore={() => void runRowMutation(post, 'restore')}
              />
            ))}
          </ul>
          {query.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                <RefreshCw aria-hidden data-icon="inline-start" />
                {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
          {query.isFetchNextPageError ? (
            <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-destructive" role="alert">
              Could not load more posts.
              <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={() => void query.fetchNextPage()}>
                Try again
              </Button>
            </p>
          ) : null}
        </div>
      ) : hasFilters && emptyCopy ? (
        <EmptyState
          icon={searchQuery ? <Search /> : status === 'review' ? <Inbox /> : <FileText />}
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={searchQuery ? (
            <Button type="button" variant="outline" onClick={() => setSearchDraft('')}>Clear search</Button>
          ) : undefined}
        />
      ) : (
        <EmptyState
          icon={<FileText />}
          title="No posts yet"
          description={canEdit
            ? 'Connect an agent to draft your first post, or start one yourself.'
            : 'No posts have been drafted or published for this site yet.'}
          action={canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>
                  <Rocket aria-hidden data-icon="inline-start" /> Connect an agent
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                  <Pencil aria-hidden data-icon="inline-start" /> Write a post
                </Link>
              </Button>
            </div>
          ) : undefined}
        />
      )}
    </>
  )
}

function PostRow({
  post,
  canEdit,
  publicBaseUrl,
  pendingKey,
  error,
  onArchive,
  onRestore,
}: {
  post: DashboardPostSummary
  canEdit: boolean
  publicBaseUrl: string | null
  pendingKey: string | null
  error: { message: string; retry: () => void } | null
  onArchive: () => Promise<void>
  onRestore: () => void
}) {
  const review = reviewLabel(post)
  const agentWrote = isAgentActor(post.latestActorType ?? post.updatedByType)
  const liveUrl = post.status === 'published' && publicBaseUrl ? `${publicBaseUrl}/${post.slug}` : null
  const editorLink = { to: '/dashboard/posts/$postId/edit' as const, params: { postId: post.id }, search: emptyPostEditorSearch }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-[color:var(--hairline)] py-4 first:pt-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_11rem_9.5rem_auto]">
      <div className="col-span-2 min-w-0 md:col-span-1">
        <div className="flex min-w-0 items-center gap-2">
          {agentWrote ? (
            <span title="Last written by an agent" className="shrink-0 text-muted-foreground">
              <Bot aria-hidden className="size-4" />
              <span className="sr-only">Agent</span>
            </span>
          ) : null}
          {canEdit ? (
            <Link
              {...editorLink}
              className="truncate font-display text-base font-semibold tracking-[-0.015em] text-foreground no-underline hover:underline"
            >
              {post.title || 'Untitled'}
            </Link>
          ) : (
            <strong className="truncate font-display text-base font-semibold tracking-[-0.015em] text-foreground">{post.title || 'Untitled'}</strong>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          <span className="font-mono text-xs">/{post.slug}</span>
          {post.excerpt ? <><span aria-hidden> · </span>{post.excerpt}</> : null}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 md:contents">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={post.status} className="w-fit" />
          {review && hasPendingChanges(post) ? (
            <StatusBadge status="pending" label="Changes" className="w-fit normal-case" />
          ) : review ? (
            <StatusBadge status="pending" label="Review" className="w-fit normal-case" />
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          <time dateTime={new Date(post.updatedAt * 1000).toISOString()} title={formatDateTime(post.updatedAt)}>
            {formatRelative(post.updatedAt)}
          </time>
          <span aria-hidden> · </span>
          <span title={post.updatedByName ?? undefined}>{actorDisplayName(post.updatedByType, post.updatedByName)}</span>
        </p>
      </div>

      <div className="flex items-center justify-end gap-1">
        {review && canEdit ? (
          <Button asChild size="sm" variant="outline">
            <Link {...editorLink}>Review</Link>
          </Button>
        ) : null}
        {liveUrl ? (
          <Button asChild size="icon" variant="ghost" className="size-8">
            <a href={liveUrl} target="_blank" rel="noreferrer" title="View live" aria-label={`View “${post.title}” live`}>
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : null}
        {canEdit && post.status === 'archived' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pendingKey === `${post.id}:restore`}
            onClick={onRestore}
          >
            <RotateCcw aria-hidden data-icon="inline-start" />
            {pendingKey === `${post.id}:restore` ? 'Restoring…' : 'Restore'}
          </Button>
        ) : null}
        {canEdit && post.status !== 'archived' ? (
          <SpaConfirmButton
            size="sm"
            confirmLabel="Archive?"
            pendingLabel="Archiving…"
            title="Archive"
            disabled={pendingKey === `${post.id}:archive`}
            onConfirm={onArchive}
          >
            <Archive aria-hidden />
            <span className="sr-only">Archive “{post.title}”</span>
          </SpaConfirmButton>
        ) : null}
      </div>

      {error ? (
        <p className="col-span-full flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
          {error.message}
          <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={error.retry}>
            Try again
          </Button>
        </p>
      ) : null}
    </li>
  )
}
