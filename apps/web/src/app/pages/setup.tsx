import { BRAND, MEDIA, readFormStatus } from "@vc/config";
import { getSiteSetup } from "@/server/onboarding";
import type { AppUserContext } from "@/server/onboarding";
import { Field, FieldDescription, FieldGroup, FieldLabel, Input, SubmitButton, Textarea } from "@vc/ui";
import { OnboardingFrame, Panel, StatusAlert } from "./app-layout";

export const Setup = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const site = await getSiteSetup(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);

  return (
    <OnboardingFrame phase="Step 1 of 1">
      <div className="grid gap-4">
        <StatusAlert status={status} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
            <strong className="block font-display text-sm font-semibold text-foreground">1 blog</strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">per subscription</span>
          </div>
          <div className="rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
            <strong className="block font-display text-sm font-semibold text-brand-bright">{MEDIA.paidStorageLabel}</strong>
            <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">media storage</span>
          </div>
        </div>
        <Panel title="Create your hosted blog" meta="Blog setup">
          <p className="mb-6 font-sans text-sm leading-6 text-muted-foreground">
            Only the essentials. You can edit posts, media, tokens, and billing after this.
          </p>
          <form method="post" action="/app/setup/complete" className="grid gap-6">
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="name" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Blog Name
                </FieldLabel>
                <Input id="name" name="name" required maxLength={80} defaultValue={site.name} placeholder="Moin's Notes" />
                <FieldDescription>This appears in the dashboard and public blog header.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="slug" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Default Slug
                </FieldLabel>
                <Input id="slug" name="slug" required maxLength={42} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={site.slug} placeholder="moins-notes" />
                <FieldDescription>Lowercase letters, numbers, and hyphens. Custom domains can come later.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Description <span className="normal-case tracking-normal text-muted-foreground">optional</span>
                </FieldLabel>
                <Textarea id="description" name="description" maxLength={220} rows={4} defaultValue={site.description} placeholder={`A short blog about building products with humans and AI agents on ${BRAND.name}.`} />
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[11px] leading-5 text-muted-foreground">
                Draft for free and publish your first post to try it live. Subscribe to publish more and upload media.
              </p>
              <SubmitButton className="h-11 rounded-xl px-6" pendingText="Saving…">
                Continue
              </SubmitButton>
            </div>
          </form>
        </Panel>
      </div>
    </OnboardingFrame>
  );
};