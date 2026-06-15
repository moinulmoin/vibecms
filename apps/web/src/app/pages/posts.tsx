import { readFormStatus } from "@vc/config";
import { getPosts } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, ConfirmSubmit, Field, FieldLabel, Input, Select, SubmitButton } from "@vc/ui";
import { AppShell, DataRow, EmptyState, PageHeader, Panel, StatusAlert, formatDate } from "./app-layout";

type PostsProps = { request: Request; ctx: { app?: AppUserContext } };

export const Posts = async ({ request, ctx }: PostsProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const hasFilters = Boolean(status || search);
  const posts = await getPosts(
    ctx.app,
    status === "draft" || status === "published" || status === "archived" ? status : undefined,
    search,
  );
  const formStatus = readFormStatus(url.searchParams);

  return (
    <AppShell current="/app/posts" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Posts" title="Manage Writing" description="Draft, publish, archive, and review every post the dashboard or agents create." action={<Button asChild><a href="/app/posts/new">New post</a></Button>} />
      <StatusAlert status={formStatus} />
      <Panel title="All Posts">
        <form
          className="mb-5 flex flex-wrap items-end gap-3 rounded-xl p-4 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
          method="get"
          action="/app/posts"
        >
          <Field className="w-full gap-2 sm:w-72">
            <FieldLabel className="sr-only font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground" htmlFor="posts-search">
              Search posts
            </FieldLabel>
            <Input id="posts-search" name="search" placeholder="Search title, slug, excerpt" defaultValue={search ?? ""} />
          </Field>
          <Field className="w-full gap-2 sm:w-44">
            <FieldLabel className="sr-only font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground" htmlFor="posts-status">
              Status
            </FieldLabel>
            <Select id="posts-status" name="status" defaultValue={status ?? ""}>
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
            <div className="grid gap-3 md:hidden">
              {posts.map((post) => (
                <article
                  className="relative grid gap-3 overflow-hidden rounded-2xl p-4 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
                  key={post.id}
                >
                  <div className="min-w-0">
                    <a className="font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-brand-bright hover:underline" href={`/app/posts/${post.id}/edit`}>
                      {post.title}
                    </a>
                    <p className="mt-1.5 break-words font-mono text-[11px] leading-5 text-muted-foreground">
                      <span className="text-brand-bright/90">/{post.slug}</span>
                      <span className="text-muted-foreground"> · </span>
                      {post.excerpt || "No excerpt yet"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <Badge variant="outline" className="font-mono text-[10px] normal-case tracking-normal">
                      {post.status}
                    </Badge>
                    <span>Updated {formatDate(post.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button asChild size="sm" variant="outline">
                      <a href={`/app/posts/${post.id}/edit`}>Edit</a>
                    </Button>
                    {post.status !== "published" ? (
                      <form method="post" action={`/app/posts/${post.id}/publish`}>
                        <SubmitButton size="sm" pendingText="Publishing…">
                          Publish
                        </SubmitButton>
                      </form>
                    ) : null}
                    {post.status !== "archived" ? (
                      <form method="post" action={`/app/posts/${post.id}/archive`}>
                        <ConfirmSubmit size="sm" confirmLabel="Confirm archive" helperText="Archiving hides this post from the public blog.">
                          Archive
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-2xl ring-1 ring-[color:var(--hairline)] md:block">
              <div className="hidden border-b border-border bg-muted/35 px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground md:grid md:grid-cols-[1.5fr_.55fr_.7fr_1fr] md:gap-3">
                <span>Post</span>
                <span>Status</span>
                <span>Updated</span>
                <span className="text-right">Actions</span>
              </div>
              {posts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.55fr_.7fr_1fr] md:items-center" key={post.id}>
                  <div className="min-w-0">
                    <a className="font-display text-sm font-semibold tracking-[-0.02em] text-foreground no-underline hover:text-brand-bright hover:underline" data-row-key href={`/app/posts/${post.id}/edit`}>
                      {post.title}
                    </a>
                    <p className="mt-1 max-w-xl truncate font-mono text-[11px] text-muted-foreground">
                      <span className="text-brand-bright/90">/{post.slug}</span>
                      <span> · </span>
                      {post.excerpt || "No excerpt yet"}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit font-mono text-[10px] capitalize">
                    {post.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{formatDate(post.updatedAt)}</span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={`/app/posts/${post.id}/edit`}>Edit</a>
                    </Button>
                    {post.status !== "published" ? (
                      <form method="post" action={`/app/posts/${post.id}/publish`}>
                        <SubmitButton size="sm" pendingText="Publishing…">
                          Publish
                        </SubmitButton>
                      </form>
                    ) : null}
                    {post.status !== "archived" ? (
                      <form method="post" action={`/app/posts/${post.id}/archive`}>
                        <ConfirmSubmit size="sm" confirmLabel="Confirm archive" helperText="Archiving hides this post from the public blog.">
                          Archive
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </div>
                </DataRow>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? "No posts match" : "No posts yet"}
            description={
              hasFilters
                ? "Clear the filters or try a different search to review existing drafts and published posts."
                : "Create the first post manually, then connect an agent token when you are ready for trusted agents to help."
            }
            action={
              hasFilters ? (
                <Button asChild variant="outline">
                  <a href="/app/posts">Clear filters</a>
                </Button>
              ) : (
                <Button asChild>
                  <a href="/app/posts/new">New post</a>
                </Button>
              )
            }
          />
        )}
      </Panel>
    </AppShell>
  );
};