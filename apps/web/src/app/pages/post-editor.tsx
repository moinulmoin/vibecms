import type { Asset, Post } from "@vc/core";
import { readFormStatus, type FormStatus } from "@vc/config";
import { getPostForEditing } from "@/server/cms";
import { getMedia } from "@/server/media";
import type { AppUserContext } from "@/server/onboarding";
import { Button, ConfirmSubmit, Field, FieldDescription, FieldLabel, Input, Select, SubmitButton, Textarea } from "@vc/ui";
import { AppShell, PageHeader, Panel, StatusAlert } from "./app-layout";
import { MarkdownEditor, PostSlugFromTitle, UnsavedChangesGuard } from "./markdown-editor";

type EditorProps = { request: Request; params: { postId?: string }; ctx: { app?: AppUserContext } };

export const NewPost = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const assets = await getMedia(ctx.app);
  const formStatus = readFormStatus(new URL(request.url).searchParams);
  return <PostEditor app={ctx.app} assets={assets} formStatus={formStatus} />;
};

export const EditPost = async ({ request, params, ctx }: EditorProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const post = params.postId ? await getPostForEditing(ctx.app, params.postId) : null;
  const assets = await getMedia(ctx.app);
  const formStatus = readFormStatus(new URL(request.url).searchParams);
  if (!post) return <PostEditor app={ctx.app} missing assets={assets} formStatus={formStatus} />;
  return <PostEditor app={ctx.app} post={post} assets={assets} formStatus={formStatus} />;
};

type PostEditorProps = {
  post?: Post | null;
  app: AppUserContext;
  assets?: Asset[];
  missing?: boolean;
  formStatus: FormStatus | null;
};

function PostEditor({ app, post, assets = [], missing, formStatus }: PostEditorProps) {
  const action = post ? `/app/posts/${post.id}/update` : "/app/posts/create";
  const statusKicker = post ? post.status : "New post";
  return (
    <AppShell current="/app/posts" userEmail={app.user.email}>
      <PageHeader
        kicker={statusKicker}
        title={post ? "Edit Post" : "Create Post"}
        description="Write in Markdown, attach a cover image, and keep every save versioned for rollback and audit history."
        action={
          <Button asChild variant="outline">
            <a href="/app/posts">Back to posts</a>
          </Button>
        }
      />
      <StatusAlert status={formStatus} />
      {missing ? (
        <Panel title="Post Not Found">
          <p className="font-sans text-sm text-muted-foreground">Post not found.</p>
        </Panel>
      ) : (
        <form className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start" method="post" action={action}>
          <UnsavedChangesGuard message="You have unsaved post changes. Leave without saving?" />
          <PostSlugFromTitle enabled={!post} />
          <Panel title="Draft">
            <div className="grid gap-4">
              <Field>
                <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-title">
                  Title
                </FieldLabel>
                <Input id="post-title" className="h-11 font-display text-lg font-semibold tracking-[-0.02em]" name="title" required maxLength={160} defaultValue={post?.title ?? ""} />
              </Field>
              <Field>
                <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-markdown">
                  Markdown
                </FieldLabel>
                <MarkdownEditor assets={assets} defaultValue={post?.contentMarkdown ?? ""} />
                <FieldDescription className="font-sans">Markdown is rendered with the same safe renderer as the public blog.</FieldDescription>
              </Field>
            </div>
          </Panel>
          <aside className="grid gap-3 lg:sticky lg:top-6">
            <Panel
              title="Publish Settings"
              meta={<span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand-bright">{post?.status ?? "draft"}</span>}
            >
              <div className="grid gap-4">
                <Field>
                  <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-slug">
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
                    defaultValue={post?.slug ?? ""}
                  />
                  <FieldDescription id="post-slug-help" className="font-sans">
                    Lowercase letters, numbers, and hyphens.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-excerpt">
                    Excerpt
                  </FieldLabel>
                  <Textarea id="post-excerpt" name="excerpt" maxLength={500} rows={4} defaultValue={post?.excerpt ?? ""} />
                </Field>
                <Field>
                  <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-tags">
                    Tags
                  </FieldLabel>
                  <Input id="post-tags" name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(", ") ?? ""} />
                </Field>
                <Field>
                  <FieldLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="post-cover">
                    Cover Image
                  </FieldLabel>
                  <div className="rounded-xl p-3 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
                    <Select id="post-cover" name="coverAssetId" defaultValue={post?.coverAssetId ?? ""}>
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
                  Every save creates a post version and activity event, whether the change comes from a human, API token, or agent.
                </p>
              </div>
            </Panel>
            <Panel title="Actions">
              <div className="grid gap-2">
                <SubmitButton pendingText="Saving…">Save draft</SubmitButton>
                {post && post.status !== "published" ? (
                  <SubmitButton formAction={`/app/posts/${post.id}/publish`} pendingText="Publishing…">
                    Publish
                  </SubmitButton>
                ) : null}
                {post && post.status !== "archived" ? (
                  <ConfirmSubmit variant="destructive" formAction={`/app/posts/${post.id}/archive`} confirmLabel="Confirm archive" helperText="Archiving hides this post from the public blog.">
                    Archive
                  </ConfirmSubmit>
                ) : null}
              </div>
            </Panel>
          </aside>
        </form>
      )}
    </AppShell>
  );
}