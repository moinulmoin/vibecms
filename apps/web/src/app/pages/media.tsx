import { getMedia } from "@/server/media";
import type { AppUserContext } from "@/server/onboarding";
import { Button, Input, Label } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel } from "./app-layout";

export const Media = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const assets = await getMedia(ctx.app);
  return (
    <AppShell current="/app/media" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Media" title="Images" description="Upload only blog media: JPEG, PNG, WebP, and GIF. Native video and generic file hosting stay blocked." />
      <Panel title="Upload image" meta="JPEG, PNG, WebP, GIF · 10MB max">
          <form className="grid gap-4 md:grid-cols-[1fr_18rem] md:items-end" method="post" action="/app/media/upload" encType="multipart/form-data">
            <Label className="grid min-h-40 place-items-center gap-3 rounded-2xl border border-dashed bg-muted/30 p-6 text-center text-muted-foreground">
              <span className="text-sm font-medium text-foreground">Drop in a blog image</span>
              <span className="text-xs leading-5">Upload cover art or inline post images. Video and arbitrary files are intentionally blocked.</span>
              <Input className="max-w-sm bg-background" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" required />
            </Label>
            <div className="grid gap-3">
              <Label className="grid gap-2 text-muted-foreground">Alt text<Input name="altText" maxLength={180} placeholder="Describe the image for readers" /></Label>
              <Button type="submit">Upload image</Button>
            </div>
          </form>
      </Panel>
      <Panel title="Library" meta={`${assets.length} assets`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <article className="grid gap-3 rounded-xl border bg-card p-3" key={asset.id}>
                <img className="aspect-[4/3] w-full rounded-lg bg-muted object-cover" src={`/media-assets/${asset.id}`} alt={asset.altText ?? asset.filename} />
                <div>
                  <strong className="block truncate text-sm">{asset.filename}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{asset.altText || "No alt text"}</p>
                </div>
                <code className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">/media-assets/{asset.id}</code>
              </article>
            ))}
          </div>
          {assets.length === 0 ? <EmptyState title="No media yet" description="Upload a cover image or inline post image to start building your blog library." /> : null}
      </Panel>
    </AppShell>
  );
};
