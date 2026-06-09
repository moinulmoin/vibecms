import { MEDIA, readFormStatus } from "@vc/config";
import { getMedia } from "@/server/media";
import type { AppUserContext } from "@/server/onboarding";
import { Field, FieldDescription, FieldLabel, Input, SubmitButton } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, StatusAlert } from "./app-layout";

export const Media = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const assets = await getMedia(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);
  return (
    <AppShell current="/app/media" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Media" title="Images" description={`Upload only blog media: ${MEDIA.formatsLabel}. Native video and generic file hosting stay blocked.`} />
      <StatusAlert status={status} />
      <Panel title="Upload Image" meta={`${MEDIA.formatsLabel} · ${MEDIA.maxImageLabel} max`}>
        <form className="grid gap-4 md:grid-cols-[1fr_18rem] md:items-end" method="post" action="/app/media/upload" encType="multipart/form-data">
          <Field className="min-h-40 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
            <FieldLabel htmlFor="media-file" className="text-sm font-medium text-foreground">Drop in a blog image</FieldLabel>
            <FieldDescription>Upload cover art or inline post images. Video and arbitrary files are intentionally blocked.</FieldDescription>
            <Input id="media-file" className="max-w-sm bg-background" type="file" name="file" accept={MEDIA.mimeTypes.join(",")} required />
          </Field>
          <div className="grid gap-3">
            <Field>
              <FieldLabel htmlFor="media-alt">Alt Text</FieldLabel>
              <Input id="media-alt" name="altText" maxLength={180} placeholder="Describe the image for readers" />
            </Field>
            <SubmitButton pendingText="Uploading…">Upload image</SubmitButton>
          </div>
        </form>
      </Panel>
      <Panel title="Library" meta={`${assets.length} assets`}>
        {assets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assets.map((asset) => (
              <article className="grid gap-3 rounded-xl border border-border bg-card p-3" key={asset.id}>
                <img className="aspect-[4/3] w-full rounded-lg bg-muted object-cover" src={`/media-assets/${asset.id}`} alt={asset.altText ?? asset.filename} loading="lazy" />
                <div>
                  <strong className="block truncate text-sm">{asset.filename}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{asset.altText || "No alt text"}</p>
                </div>
                <code className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">/media-assets/{asset.id}</code>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No media yet" description="Upload a cover image or inline post image to start building your blog library." />}
      </Panel>
    </AppShell>
  );
};
