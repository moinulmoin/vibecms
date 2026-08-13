'use client'

import { useEffect, useRef, useState } from 'react'
import { ArchiveIcon, FileTextIcon, MagnifyingGlassIcon, MixerHorizontalIcon, Pencil2Icon, PlusIcon, ReloadIcon, RocketIcon } from '@radix-ui/react-icons'
import { Field, FieldLabel, Input, Select } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import type { DashboardPostSummary } from '~/types/dashboard'
import {
  archivePostMutation,
  loadPostsPage,
  publishPostMutation,
} from '~/lib/api-client'
import {
  Button,
  DataRow,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  formatDate,
} from '~/components/dashboard/DashboardLayout'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { postsListSearch, emptyPostsListSearch, emptyPostEditorSearch, type PostsListSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { StatusBadge } from '~/components/dashboard/blocks'

export function postListRefreshError(action: 'publish' | 'archive') {
  return `Post ${action === 'publish' ? 'published' : 'archived'}, but the list could not refresh.`
}

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

function PostsSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </>
  )
}

export function PostsPage({ search }: { search: PostsListSearch }) {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<DashboardPostSummary[] | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ key: string; message: string; retry: () => void } | null>(null)
  const [listRefreshError, setListRefreshError] = useState<string | null>(null)

  const statusFilter =
    search.status === 'draft' || search.status === 'published' || search.status === 'archived'
      ? search.status
      : undefined
  const searchQuery = search.search?.trim() || undefined
  const hasFilters = Boolean(statusFilter || searchQuery)

  useEffect(() => {
    let cancelled = false
    void loadPostsPage({ status: search.status, search: search.search })
      .then((result) => {
        if (!cancelled) {
          setPosts(result.posts)
          setHasMore(result.hasMore)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load posts.')
      })
    return () => {
      cancelled = true
    }
  }, [search.status, search.search])

  async function publishApprovedVersion(postId: string, versionNumber: number | null) {
    if (versionNumber === null) return { kind: 'error' as const, code: 'not_found' }
    return publishPostMutation({ postId, expectedVersionNumber: versionNumber })
  }

  async function refreshPosts() {
    setListRefreshError(null)
    try {
      const refreshed = await loadPostsPage({ status: search.status, search: search.search })
      setPosts(refreshed.posts)
      setHasMore(refreshed.hasMore)
    } catch {
      setListRefreshError('The post list could not refresh. Your current list is still available.')
    }
  }

  async function runRowMutation(
    key: string,
    action: 'publish' | 'archive',
    mutate: () => Promise<{ kind: 'ok' | 'error'; code: string }>,
  ) {
    setRowPending(key)
    let successCode = ''
    setRowError(null)
    try {
      const result = await mutate()
      if (result.kind === 'error') {
        setRowError({
          key,
          message: `Could not ${action} this post. Try again.`,
          retry: () => void runRowMutation(key, action, mutate),
        })
        return
      }
      successCode = result.code
    } catch {
      setRowError({
        key,
        message: `Could not ${action} this post. Try again.`,
        retry: () => void runRowMutation(key, action, mutate),
      })
      return
    } finally {
      setRowPending(null)
    }

    try {
      await navigate({
        to: '/dashboard/posts',
        search: postsListSearch({ status: search.status, search: search.search, ok: successCode }),
      })
      const refreshed = await loadPostsPage({ status: search.status, search: search.search })
      setPosts(refreshed.posts)
      setHasMore(refreshed.hasMore)
    } catch {
      setListRefreshError(postListRefreshError(action))
    }

  }

  const loadingMoreRef = useRef(false)
  async function loadMore() {
    if (!posts || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const result = await loadPostsPage({ status: search.status, search: search.search, offset: posts.length })
      setPosts((prev) => [...(prev ?? []), ...result.posts])
      setHasMore(result.hasMore)
    } catch {
      setLoadMoreError('Could not load more posts. Your current list is still available.')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  if (loadError) {
    return <LoadError message={loadError} />
  }
  if (!posts) {
    return <PostsSkeleton />
  }

  return (
    <>
      <PageHeader
        title="Posts"
        description="Draft, review, publish, and restore every post—whether it came from you or an agent."
        action={
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}><PlusIcon aria-hidden data-icon="inline-start" /> New post</Link>
          </Button>
        }
      />
      <Panel title="All posts">
        {posts.length > 0 || hasFilters ? (
          <form
            className="mb-4 flex flex-wrap items-end gap-3 border-b border-[color:var(--hairline)] pb-4"
            method="get"
            onSubmit={(event) => {
              event.preventDefault()
              const form = event.currentTarget
              const nextStatus = (form.elements.namedItem('status') as HTMLSelectElement | null)?.value ?? ''
              const nextSearch = (form.elements.namedItem('search') as HTMLInputElement | null)?.value?.trim() ?? ''
              void navigate({
                to: '/dashboard/posts',
                search: postsListSearch({ status: nextStatus || undefined, search: nextSearch || undefined }),
              })
            }}
          >
            <Field className="w-full gap-2 sm:w-72">
              <FieldLabel className="sr-only font-mono text-[11px] text-muted-foreground" htmlFor="posts-search">
                Search posts
              </FieldLabel>
              <Input id="posts-search" name="search" placeholder="Search title, slug, excerpt" defaultValue={searchQuery ?? ''} />
            </Field>
            <Field className="w-full gap-2 sm:w-44">
              <FieldLabel className="sr-only font-mono text-[11px] text-muted-foreground" htmlFor="posts-status">
                Status
              </FieldLabel>
              <Select id="posts-status" name="status" defaultValue={statusFilter ?? ''}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Button className="h-9" type="submit">
              <MixerHorizontalIcon aria-hidden data-icon="inline-start" /> Filter
            </Button>
          </form>
        ) : null}
        {posts.length ? (
          <>
            <div className="grid gap-0 md:hidden">
              {posts.map((post) => (
                <article className="grid gap-3 border-b border-foreground/[0.065] py-4 last:border-b-0" key={post.id}>
                  <div className="min-w-0">
                    <Link
                      className="font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-primary hover:underline"
                      to="/dashboard/posts/$postId/edit"
                      search={emptyPostEditorSearch}
                      params={{ postId: post.id }}
                    >
                      {post.title}
                    </Link>
                    <p className="mt-1.5 break-words font-mono text-[11px] leading-5 text-muted-foreground">
                      <span className="text-primary/90">/{post.slug}</span>
                      <span className="text-muted-foreground"> · </span>
                      {post.excerpt || 'No excerpt yet'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <StatusBadge status={post.status} />
                    <span className="truncate">By {actorDisplayName(post.updatedByType, post.updatedByName)}</span>
                    <span className="tabular-nums">Updated {formatDate(post.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dashboard/posts/$postId/edit" search={emptyPostEditorSearch} params={{ postId: post.id }}>
                        <Pencil2Icon aria-hidden data-icon="inline-start" /> Edit
                      </Link>
                    </Button>
                    {post.status !== 'published' ? (
                      <PendingSubmitButton
                        size="sm"
                        pending={rowPending === `${post.id}:publish`}
                        pendingText="Publishing…"
                        onClick={() =>
                          void runRowMutation(`${post.id}:publish`, 'publish', () =>
                            publishApprovedVersion(post.id, post.versionNumber),
                          )
                        }
                      >
                        <RocketIcon aria-hidden data-icon="inline-start" /> Publish
                      </PendingSubmitButton>
                    ) : null}
                    {post.status !== 'archived' ? (
                      <SpaConfirmButton
                        size="sm"
                        confirmLabel="Confirm archive"
                        helperText="Archiving hides this post from the public blog."
                        disabled={rowPending === `${post.id}:archive`}
                        onConfirm={() =>
                          runRowMutation(`${post.id}:archive`, 'archive', () =>
                            archivePostMutation({ postId: post.id }),
                          )
                        }
                      >
                        <ArchiveIcon aria-hidden data-icon="inline-start" /> Archive
                      </SpaConfirmButton>
                    ) : null}
                  </div>
                  {rowError?.key.startsWith(`${post.id}:`) ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      <span>{rowError.message}</span>{' '}
                      <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={rowError.retry}>
                        Try again
                      </Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="hidden md:grid md:gap-0">
              <div className="grid grid-cols-[1.5fr_.5fr_.55fr_.6fr_.85fr] gap-3 px-1 pb-1 font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <span>Post</span>
                <span>Status</span>
                <span>By</span>
                <span>Updated</span>
                <span className="text-right">Actions</span>
              </div>
              {posts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.5fr_.55fr_.6fr_.85fr] md:items-center" key={post.id}>
                  <div className="min-w-0">
                    <Link
                      className="font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-primary hover:underline"
                      data-row-key
                      to="/dashboard/posts/$postId/edit"
                      search={emptyPostEditorSearch}
                      params={{ postId: post.id }}
                    >
                      {post.title}
                    </Link>
                    <p className="mt-1 max-w-xl truncate font-mono text-xs text-muted-foreground">
                      <span className="text-primary/90">/{post.slug}</span>
                      <span> · </span>
                      {post.excerpt || 'No excerpt yet'}
                    </p>
                  </div>
                  <StatusBadge status={post.status} className="w-fit" />
                  <span
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={post.updatedByName ?? undefined}
                  >
                    {actorDisplayName(post.updatedByType, post.updatedByName)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDate(post.updatedAt)}</span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dashboard/posts/$postId/edit" search={emptyPostEditorSearch} params={{ postId: post.id }}>
                        <Pencil2Icon aria-hidden data-icon="inline-start" /> Edit
                      </Link>
                    </Button>
                    {post.status !== 'published' ? (
                      <PendingSubmitButton
                        size="sm"
                        pending={rowPending === `${post.id}:publish`}
                        pendingText="Publishing…"
                        onClick={() =>
                          void runRowMutation(`${post.id}:publish`, 'publish', () =>
                            publishApprovedVersion(post.id, post.versionNumber),
                          )
                        }
                      >
                        <RocketIcon aria-hidden data-icon="inline-start" /> Publish
                      </PendingSubmitButton>
                    ) : null}
                    {post.status !== 'archived' ? (
                      <SpaConfirmButton
                        size="sm"
                        confirmLabel="Confirm archive"
                        helperText="Archiving hides this post from the public blog."
                        disabled={rowPending === `${post.id}:archive`}
                        onConfirm={() =>
                          runRowMutation(`${post.id}:archive`, 'archive', () =>
                            archivePostMutation({ postId: post.id }),
                          )
                        }
                      >
                        <ArchiveIcon aria-hidden data-icon="inline-start" /> Archive
                      </SpaConfirmButton>
                    ) : null}
                  </div>
                  {rowError?.key.startsWith(`${post.id}:`) ? (
                    <div className="col-span-full rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      <span>{rowError.message}</span>{' '}
                      <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={rowError.retry}>
                        Try again
                      </Button>
                    </div>
                  ) : null}
                </DataRow>
              ))}
            </div>
            {hasMore || loadMoreError ? (
              <>
                {hasMore ? (
                  <div className="mt-3 flex justify-center">
                    <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                      <ReloadIcon aria-hidden data-icon="inline-start" />
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                ) : null}
                {loadMoreError ? (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-destructive" role="alert">
                    <span>{loadMoreError}</span>
                    <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={() => void loadMore()}>
                      Try again
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {listRefreshError ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-destructive" role="alert">
                <span>{listRefreshError}</span>
                <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={() => void refreshPosts()}>
                  Reload posts
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={hasFilters ? <MagnifyingGlassIcon /> : <FileTextIcon />}
            title={hasFilters ? 'No posts match' : 'No posts yet'}
            description={
              hasFilters
                ? 'Clear the filters or try a different search to review existing drafts and published posts.'
                : 'Connect an agent to draft your first post through the approval-first flow, or start one manually.'
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link to="/dashboard/posts" search={emptyPostsListSearch}><MixerHorizontalIcon aria-hidden data-icon="inline-start" /> Clear filters</Link>
                </Button>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>
                      <RocketIcon aria-hidden data-icon="inline-start" /> Publish with agent
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                      <Pencil2Icon aria-hidden data-icon="inline-start" /> Write manually
                    </Link>
                  </Button>
                </div>
              )
            }
          />
        )}
      </Panel>
    </>
  )
}