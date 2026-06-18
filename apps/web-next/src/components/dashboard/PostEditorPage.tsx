'use client'

import type { Asset, Post } from '@vc/core'
import { Field, FieldDescription, FieldLabel, Input, Select, Textarea } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  archivePostMutation,
  createPostMutation,
  loadPostEditorPage,
  publishPostMutation,
  updatePostMutation,
} from '~/server/posts-page-fn'
import { Button, PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { MarkdownEditor, PostSlugFromTitle, UnsavedChangesGuard } from '~/components/dashboard/MarkdownEditor'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { emptyPostsListSearch, emptyPostEditorSearch, postEditorSearch, statusSearchFromMutation } from '~/lib/dashboard-search'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'

function tagsFromForm(form: FormData) {
  const raw = form.get('tags')
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function payloadFromForm(form: FormData) {
  const cover = form.get('coverAssetId')
  return {
    title: String(form.get('title') ?? '').trim(),
    slug: String(form.get('slug') ?? '').trim(),
    excerpt: String(form.get('excerpt') ?? '').trim() || undefined,
    contentMarkdown: String(form.get('contentMarkdown') ?? ''),
    coverAssetId: typeof cover === 'string' && cover.length > 0 ? cover : null,
    tags: tagsFromForm(form).join(', '),
  }
}

export function NewPostEditorPage() {
  return <PostEditorShell postId={undefined} />
}

export function EditPostEditorPage({ postId }: { postId: string }) {
  return <PostEditorShell postId={postId} />
}

function PostEditorShell({ postId }: { postId?: string }) {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
  const [post, setPost] = useState<Post | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savePending, setSavePending] = useState(false)
  const [publishPending, setPublishPending] = useState(false)
  const [archivePending, setArchivePending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadPostEditorPage({ data: { postId } })
      .then((result) => {
        if (cancelled) return
        setPost(result.post)
        setAssets(result.assets)
        setMissing(result.missing)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }
    setSavePending(true)
    try {
      const payload = payloadFromForm(new FormData(form))
      const result = postId
        ? await updatePostMutation({ data: { postId, ...payload } })
        : await createPostMutation({ data: payload })
      if (result.kind === 'ok' && !postId && result.postId) {
        await navigate({
          to: '/app/posts/$postId/edit',
          params: { postId: result.postId },
          search: postEditorSearch({ ok: result.code }),
        })
        const refreshed = await loadPostEditorPage({ data: { postId: result.postId } })
        setPost(refreshed.post)
        setAssets(refreshed.assets)
        setMissing(refreshed.missing)
        return
      }
      const editorSearch = postEditorSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code })
      if (postId) {
        await navigate({ to: '/app/posts/$postId/edit', params: { postId }, search: editorSearch })
        if (result.kind === 'ok') {
          const refreshed = await loadPostEditorPage({ data: { postId } })
          setPost(refreshed.post)
        }
      } else {
        await navigate({ to: '/app/posts/new', search: editorSearch })
      }
    } finally {
      setSavePending(false)
    }
  }

  async function handlePublish() {
    if (!postId) return
    setPublishPending(true)
    try {
      const result = await publishPostMutation({ data: { postId } })
      await navigate({
        to: '/app/posts',
        search: statusSearchFromMutation(result),
      })
    } finally {
      setPublishPending(false)
    }
  }

  async function handleArchive() {
    if (!postId) return
    setArchivePending(true)
    try {
      const result = await archivePostMutation({ data: { postId } })
      await navigate({
        to: '/app/posts',
        search: statusSearchFromMutation(result),
      })
    } finally {
      setArchivePending(false)
    }
  }

  if (loading) {
    return <p className="font-mono text-sm text-muted-foreground">Loading editor…</p>
  }

  const statusKicker = post ? post.status : 'New post'

  return (
    <>
      <PageHeader
        kicker={statusKicker}
        title={post ? 'Edit Post' : 'Create Post'}
        description="Write in Markdown, attach a cover image, and keep every save versioned for rollback and audit history."
        action={
          <Button asChild variant="outline">
            <Link to="/app/posts" search={emptyPostsListSearch}>Back to posts</Link>
          </Button>
        }
      />
      <StatusAlert status={formStatus} />
      {missing ? (
        <Panel title="Post Not Found">
          <p className="font-sans text-sm text-muted-foreground">Post not found.</p>
        </Panel>
      ) : (
        <form
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
          onSubmit={(event) => void handleSave(event)}
        >
          <UnsavedChangesGuard message="You have unsaved post changes. Leave without saving?" />
          <PostSlugFromTitle enabled={!post} />
          <Panel title="Draft">
            <div className="grid gap-4">
              <Field>
                <FieldLabel
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                  htmlFor="post-title"
                >
                  Title
                </FieldLabel>
                <Input
                  id="post-title"
                  className="h-11 font-display text-lg font-semibold tracking-[-0.02em]"
                  name="title"
                  required
                  maxLength={160}
                  defaultValue={post?.title ?? ''}
                />
              </Field>
              <Field>
                <FieldLabel
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                  htmlFor="post-markdown"
                >
                  Markdown
                </FieldLabel>
                <MarkdownEditor assets={assets} defaultValue={post?.contentMarkdown ?? ''} />
                <FieldDescription className="font-sans">
                  Markdown is rendered with the same safe renderer as the public blog.
                </FieldDescription>
              </Field>
            </div>
          </Panel>
          <aside className="grid gap-3 lg:sticky lg:top-6">
            <Panel
              title="Publish Settings"
              meta={
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand-bright">
                  {post?.status ?? 'draft'}
                </span>
              }
            >
              <div className="grid gap-4">
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-slug"
                  >
                    Slug
                  </FieldLabel>
                  <Input
                    id="post-slug"
                    className="font-mono text-sm"
                    name="slug"
                    required
                    maxLength={120}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    aria-describedby="post-slug-help"
                    defaultValue={post?.slug ?? ''}
                  />
                  <FieldDescription id="post-slug-help" className="font-sans">
                    Lowercase letters, numbers, and hyphens.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-excerpt"
                  >
                    Excerpt
                  </FieldLabel>
                  <Textarea id="post-excerpt" name="excerpt" maxLength={500} rows={4} defaultValue={post?.excerpt ?? ''} />
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-tags"
                  >
                    Tags
                  </FieldLabel>
                  <Input id="post-tags" name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(', ') ?? ''} />
                </Field>
                <Field>
                  <FieldLabel
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor="post-cover"
                  >
                    Cover Image
                  </FieldLabel>
                  <div className="rounded-xl p-3 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
                    <Select id="post-cover" name="coverAssetId" defaultValue={post?.coverAssetId ?? ''}>
                      <option value="">No cover image</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Field>
                <p className="rounded-xl p-3 font-sans text-sm leading-6 text-muted-foreground ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
                  Every save creates a post version and activity event, whether the change comes from you, an API token, or
                  an agent.
                </p>
              </div>
            </Panel>
            <Panel title="Actions">
              <div className="grid gap-2">
                <PendingSubmitButton pending={savePending} pendingText="Saving…">
                  Save draft
                </PendingSubmitButton>
                {post && post.status !== 'published' ? (
                  <PendingSubmitButton
                    type="button"
                    pending={publishPending}
                    pendingText="Publishing…"
                    onClick={() => void handlePublish()}
                  >
                    Publish
                  </PendingSubmitButton>
                ) : null}
                {post && post.status !== 'archived' ? (
                  <SpaConfirmButton
                    confirmLabel="Confirm archive"
                    helperText="Archiving hides this post from the public blog."
                    disabled={archivePending}
                    onConfirm={() => void handleArchive()}
                  >
                    Archive
                  </SpaConfirmButton>
                ) : null}
              </div>
            </Panel>
          </aside>
        </form>
      )}
    </>
  )
}