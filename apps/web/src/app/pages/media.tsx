import { MEDIA, readFormStatus } from "@vc/config";
import { getMedia } from "@/server/media";
import type { AppUserContext } from "@/server/onboarding";
import { UploadIcon } from "@radix-ui/react-icons";
import { Field, FieldDescription, FieldLabel, Input, SubmitButton } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, StatusAlert } from "./app-layout";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

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
          <Field className="relative min-h-44 place-items-center overflow-hidden rounded-2xl border border-dashed border-border p-6 text-center ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] focus-within:border-brand-bright/50 focus-within:ring-2 focus-within:ring-brand-bright/25">
            <UploadIcon aria-hidden className="mb-3 size-8 text-brand-bright/80" />
            <FieldLabel htmlFor="media-file" className="font-display text-sm font-medium text-foreground">Drop in a blog image</FieldLabel>
            <FieldDescription id="media-file-help" className="max-w-sm">Upload cover art or inline post images. Video and arbitrary files are intentionally blocked.</FieldDescription>
            <Input id="media-file" className="mt-3 max-w-sm bg-background" type="file" name="file" accept={MEDIA.mimeTypes.join(",")} required aria-describedby="media-file-help" />
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
              <article
                className="grid min-w-0 gap-3 overflow-hidden rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
                key={asset.id}
              >
                <img className="aspect-[4/3] w-full rounded-xl bg-muted object-cover ring-1 ring-[color:var(--hairline)]" width={640} height={480} src={`/media-assets/${asset.id}`} alt={asset.altText ?? asset.filename} loading="lazy" />
                <div className="min-w-0">
                  <strong className="block truncate font-mono text-sm text-foreground">{asset.filename}</strong>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-brand-bright">{formatBytes(asset.sizeBytes)}</p>
                  <p className="mt-1 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">{asset.altText || "No alt text"}</p>
                </div>
                <code className="block truncate rounded-lg bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground ring-1 ring-[color:var(--hairline)]">/media-assets/{asset.id}</code>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No media yet" description="Upload a cover image or inline post image to start building your blog library." />}
      </Panel>
    </AppShell>
  );
};