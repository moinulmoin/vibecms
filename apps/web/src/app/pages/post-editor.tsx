import { getPostForEditing } from "@/server/cms";
import { getMedia } from "@/server/media";
import type { AppUserContext } from "@/server/onboarding";
import { Button, Input, Label, Textarea } from "@vc/ui";
import { AppShell, PageHeader, Panel } from "./app-layout";

type EditorProps = { params: { postId?: string }; ctx: { app?: AppUserContext } };

export const NewPost = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const assets = await getMedia(ctx.app);
  return <PostEditor app={ctx.app} assets={assets} />;
};

export const EditPost = async ({ params, ctx }: EditorProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const post = params.postId ? await getPostForEditing(ctx.app, params.postId) : null;
  const assets = await getMedia(ctx.app);
  if (!post) return <PostEditor app={ctx.app} missing assets={assets} />;
  return <PostEditor app={ctx.app} post={post} assets={assets} />;
};

type PostEditorProps = {
  post?: Awaited<ReturnType<typeof getPostForEditing>>;
  app: AppUserContext;
  assets?: Awaited<ReturnType<typeof getMedia>>;
  missing?: boolean;
};

function PostEditor({ app, post, assets = [], missing }: PostEditorProps) {
  const action = post ? `/app/posts/${post.id}/update` : "/app/posts/create";
  return (
    <AppShell current="/app/posts" userEmail={app.user.email}>
        <PageHeader kicker={post ? post.status : "New post"} title={post ? "Edit post" : "Create post"} description="Write in Markdown, attach a cover image, and keep every save versioned for rollback and audit history." action={<Button asChild variant="outline"><a href="/app/posts">Back to posts</a></Button>} />
        {missing ? (
          <Panel title="Post not found"><p className="text-sm text-muted-foreground">Post not found.</p></Panel>
        ) : (
          <form className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start" method="post" action={action}>
            <Panel title="Draft">
              <div className="grid gap-4">
                <Label className="grid gap-2 text-muted-foreground">
                  Title
                  <Input className="h-11 text-lg font-medium" name="title" required maxLength={160} defaultValue={post?.title ?? ""} />
                </Label>
                <Label className="grid gap-2 text-muted-foreground">
                  Markdown
                  <Textarea name="contentMarkdown" className="min-h-[32rem] font-mono leading-6" maxLength={500000} defaultValue={post?.contentMarkdown ?? ""} />
                </Label>
              </div>
            </Panel>
            <aside className="grid gap-3 lg:sticky lg:top-6">
              <Panel title="Publish settings" meta={post?.status ?? "draft"}>
                <div className="grid gap-4">
                  <Label className="grid gap-2 text-muted-foreground">
                    Slug
                    <Input name="slug" required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={post?.slug ?? ""} />
                  </Label>
                  <Label className="grid gap-2 text-muted-foreground">
                    Excerpt
                    <Textarea name="excerpt" maxLength={500} rows={4} defaultValue={post?.excerpt ?? ""} />
                  </Label>
                  <Label className="grid gap-2 text-muted-foreground">
                    Tags
                    <Input name="tags" placeholder="launch, notes" defaultValue={post?.tags.join(", ") ?? ""} />
                  </Label>
                  <Label className="grid gap-2 text-muted-foreground">
                    Cover image
                    <select className="h-9 rounded-lg border border-[#b8ad93] bg-card px-3 text-sm" name="coverAssetId" defaultValue={post?.coverAssetId ?? ""}>
                      <option value="">No cover image</option>
                      {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
                    </select>
                  </Label>
                  <p className="rounded-lg bg-muted p-3 text-sm leading-6 text-muted-foreground">Every save creates a post version and activity event, whether the change comes from a human, API token, or agent.</p>
                </div>
              </Panel>
              <Panel title="Actions">
                <div className="grid gap-2">
                  <Button type="submit">Save draft</Button>
                  {post && post.status !== "published" ? <Button type="submit" formAction={`/app/posts/${post.id}/publish`}>Publish live</Button> : null}
                  {post && post.status !== "archived" ? <Button type="submit" variant="outline" formAction={`/app/posts/${post.id}/archive`}>Archive</Button> : null}
                </div>
              </Panel>
            </aside>
          </form>
        )}
    </AppShell>
  );
}
