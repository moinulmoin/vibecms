import { readFormStatus } from "@vc/config";
import { getPosts } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, ConfirmSubmit, Field, FieldLabel, Input, Select, SubmitButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, StatusAlert, formatDate } from "./app-layout";

type PostsProps = { request: Request; ctx: { app?: AppUserContext } };

export const Posts = async ({ request, ctx }: PostsProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const hasFilters = Boolean(status || search);
  const posts = await getPosts(
    ctx.app,
    status === "draft" || status === "published" || status === "scheduled" || status === "archived" ? status : undefined,
    search,
  );
  const formStatus = readFormStatus(url.searchParams);

  return (
    <AppShell current="/app/posts" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Posts" title="Manage Writing" description="Draft, publish, archive, and review every post the dashboard or agents create." action={<Button asChild><a href="/app/posts/new">New post</a></Button>} />
      <StatusAlert status={formStatus} />
      <Panel title="All Posts">
        <form className="mb-5 flex flex-wrap items-end gap-2" method="get" action="/app/posts">
          <Field className="w-full gap-2 sm:w-72">
            <FieldLabel className="sr-only" htmlFor="posts-search">Search posts</FieldLabel>
            <Input id="posts-search" name="search" placeholder="Search title, slug, excerpt" defaultValue={search ?? ""} />
          </Field>
          <Field className="w-full gap-2 sm:w-44">
            <FieldLabel className="sr-only" htmlFor="posts-status">Status</FieldLabel>
            <Select id="posts-status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="scheduled">Scheduled</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Button className="h-9" type="submit">Filter</Button>
        </form>
        {posts.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <a className="font-medium text-foreground no-underline hover:underline" href={`/app/posts/${post.id}/edit`}>{post.title}</a>
                    <p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">/{post.slug} · {post.excerpt || "No excerpt yet"}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{post.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(post.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild size="sm" variant="outline"><a href={`/app/posts/${post.id}/edit`}>Edit</a></Button>
                      {post.status !== "published" ? <form method="post" action={`/app/posts/${post.id}/publish`}><SubmitButton size="sm" pendingText="Publishing…">Publish</SubmitButton></form> : null}
                      {post.status !== "archived" ? <form method="post" action={`/app/posts/${post.id}/archive`}><ConfirmSubmit size="sm" confirmLabel="Confirm archive" helperText="Archiving hides this post from the public blog.">Archive</ConfirmSubmit></form> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <EmptyState title={hasFilters ? "No posts match" : "No posts yet"} description={hasFilters ? "Clear the filters or try a different search to review existing drafts and published posts." : "Create the first post manually, then connect an MCP/API token when you are ready for trusted agents to help."} action={hasFilters ? <Button asChild variant="outline"><a href="/app/posts">Clear filters</a></Button> : <Button asChild><a href="/app/posts/new">New post</a></Button>} />}
      </Panel>
    </AppShell>
  );
};
