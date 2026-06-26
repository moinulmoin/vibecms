'use client'

import { Field, FieldLabel, Input, Select, cn } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { PostSummary } from '@vc/core'
import {
  archivePostMutation,
  loadPostsPage,
  publishPostMutation,
} from '~/server/posts-page-fn'
import {
  Button,
  DataRow,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  StatusAlert,
  formatDate,
} from '~/components/dashboard/DashboardLayout'
import { Badge } from '~/components/ui/badge'
import { Skeleton } from '~/components/ui/skeleton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { postsListSearch, emptyPostsListSearch, emptyPostEditorSearch, type PostsListSearch } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'

function StatusBadge({ status, className }: { status: string; className?: string }) {
  if (status === 'published') {
    return (
      <Badge
        className={cn(
          'gap-1.5 border-brand-bright/30 bg-brand-bright/10 capitalize text-primary',
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        {status}
      </Badge>
    )
  }
  if (status === 'archived') {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1.5 border-dashed capitalize text-muted-foreground/70', className)}
      >
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        {status}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn('capitalize', className)}>
      {status}
    </Badge>
  )
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
  const formStatus = useFormStatusFromSearch()
  const [posts, setPosts] = useState<PostSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)

  const statusFilter =
    search.status === 'draft' || search.status === 'published' || search.status === 'archived'
      ? search.status
      : undefined
  const searchQuery = search.search?.trim() || undefined
  const hasFilters = Boolean(statusFilter || searchQuery)

  useEffect(() => {
    let cancelled = false
    void loadPostsPage({ data: { status: search.status, search: search.search } })
      .then((result) => {
        if (!cancelled) setPosts(result.posts)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load posts.')
      })
    return () => {
      cancelled = true
    }
  }, [search.status, search.search])

  async function runRowMutation(
    key: string,
    mutate: () => Promise<{ kind: 'ok' | 'error'; code: string }>,
  ) {
    setRowPending(key)
    try {
      const result = await mutate()
      const params = postsListSearch({
        status: search.status,
        search: search.search,
        ...(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
      })
      await navigate({ to: '/app/posts', search: params })
      const refreshed = await loadPostsPage({ data: { status: search.status, search: search.search } })
      setPosts(refreshed.posts)
    } finally {
      setRowPending(null)
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
        kicker="Posts"
        title="Manage Writing"
        description="Draft, publish, archive, and review every post the dashboard or agents create."
        action={
          <Button asChild>
            <Link to="/app/posts/new" search={emptyPostEditorSearch}>New post</Link>
          </Button>
        }
      />
      <StatusAlert status={formStatus} />
      <Panel title="All Posts">
        <form
          className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-muted/50 p-3"
          method="get"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const nextStatus = (form.elements.namedItem('status') as HTMLSelectElement | null)?.value ?? ''
            const nextSearch = (form.elements.namedItem('search') as HTMLInputElement | null)?.value?.trim() ?? ''
            void navigate({
              to: '/app/posts',
              search: postsListSearch({ status: nextStatus || undefined, search: nextSearch || undefined }),
            })
          }}
        >
          <Field className="w-full gap-2 sm:w-72">
            <FieldLabel className="sr-only font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground" htmlFor="posts-search">
              Search posts
            </FieldLabel>
            <Input id="posts-search" name="search" placeholder="Search title, slug, excerpt" defaultValue={searchQuery ?? ''} />
          </Field>
          <Field className="w-full gap-2 sm:w-44">
            <FieldLabel className="sr-only font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground" htmlFor="posts-status">
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
            Filter
          </Button>
        </form>
        {posts.length ? (
          <>
            <div className="grid gap-2 md:hidden">
              {posts.map((post) => (
                <article className="grid gap-3 rounded-xl bg-muted/50 p-4" key={post.id}>
                  <div className="min-w-0">
                    <Link
                      className="font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-primary hover:underline"
                      to="/app/posts/$postId/edit"
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
                    <span className="tabular-nums">Updated {formatDate(post.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/posts/$postId/edit" search={emptyPostEditorSearch} params={{ postId: post.id }}>
                        Edit
                      </Link>
                    </Button>
                    {post.status !== 'published' ? (
                      <PendingSubmitButton
                        size="sm"
                        pending={rowPending === `${post.id}:publish`}
                        pendingText="Publishing…"
                        onClick={() =>
                          void runRowMutation(`${post.id}:publish`, () =>
                            publishPostMutation({ data: { postId: post.id } }),
                          )
                        }
                      >
                        Publish
                      </PendingSubmitButton>
                    ) : null}
                    {post.status !== 'archived' ? (
                      <SpaConfirmButton
                        size="sm"
                        confirmLabel="Confirm archive"
                        helperText="Archiving hides this post from the public blog."
                        disabled={rowPending === `${post.id}:archive`}
                        onConfirm={() =>
                          runRowMutation(`${post.id}:archive`, () =>
                            archivePostMutation({ data: { postId: post.id } }),
                          )
                        }
                      >
                        Archive
                      </SpaConfirmButton>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:grid md:gap-1.5">
              <div className="grid grid-cols-[1.5fr_.55fr_.7fr_1fr] gap-3 px-3 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <span>Post</span>
                <span>Status</span>
                <span>Updated</span>
                <span className="text-right">Actions</span>
              </div>
              {posts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.55fr_.7fr_1fr] md:items-center" key={post.id}>
                  <div className="min-w-0">
                    <Link
                      className="font-display text-sm font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-primary hover:underline"
                      data-row-key
                      to="/app/posts/$postId/edit"
                      search={emptyPostEditorSearch}
                      params={{ postId: post.id }}
                    >
                      {post.title}
                    </Link>
                    <p className="mt-1 max-w-xl truncate font-mono text-[11px] text-muted-foreground">
                      <span className="text-primary/90">/{post.slug}</span>
                      <span> · </span>
                      {post.excerpt || 'No excerpt yet'}
                    </p>
                  </div>
                  <StatusBadge status={post.status} className="w-fit" />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDate(post.updatedAt)}</span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/posts/$postId/edit" search={emptyPostEditorSearch} params={{ postId: post.id }}>
                        Edit
                      </Link>
                    </Button>
                    {post.status !== 'published' ? (
                      <PendingSubmitButton
                        size="sm"
                        pending={rowPending === `${post.id}:publish`}
                        pendingText="Publishing…"
                        onClick={() =>
                          void runRowMutation(`${post.id}:publish`, () =>
                            publishPostMutation({ data: { postId: post.id } }),
                          )
                        }
                      >
                        Publish
                      </PendingSubmitButton>
                    ) : null}
                    {post.status !== 'archived' ? (
                      <SpaConfirmButton
                        size="sm"
                        confirmLabel="Confirm archive"
                        helperText="Archiving hides this post from the public blog."
                        disabled={rowPending === `${post.id}:archive`}
                        onConfirm={() =>
                          runRowMutation(`${post.id}:archive`, () =>
                            archivePostMutation({ data: { postId: post.id } }),
                          )
                        }
                      >
                        Archive
                      </SpaConfirmButton>
                    ) : null}
                  </div>
                </DataRow>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'No posts match' : 'No posts yet'}
            description={
              hasFilters
                ? 'Clear the filters or try a different search to review existing drafts and published posts.'
                : 'Create the first post manually, then connect an agent token when you are ready for trusted agents to help.'
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <Link to="/app/posts" search={emptyPostsListSearch}>Clear filters</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/app/posts/new" search={emptyPostEditorSearch}>New post</Link>
                </Button>
              )
            }
          />
        )}
      </Panel>
    </>
  )
}