import { BRAND, MEDIA, PRICING, readFormStatus } from "@vc/config";
import { getSiteSetup } from "@/server/onboarding";
import type { AppUserContext } from "@/server/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldDescription, FieldGroup, FieldLabel, Input, SubmitButton, Textarea } from "@vc/ui";
import { OnboardingFrame, StatusAlert } from "./app-layout";

export const Setup = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const site = await getSiteSetup(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);

  return (
    <OnboardingFrame phase="Step 1 of 1">
      <div className="grid gap-4">
        <StatusAlert status={status} />
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4"><strong className="block text-foreground">1 blog</strong>per subscription</div>
          <div className="rounded-2xl border border-border bg-card p-4"><strong className="block text-foreground">{PRICING.trialDays} days</strong>{PRICING.trialLabel}</div>
          <div className="rounded-2xl border border-border bg-card p-4"><strong className="block text-foreground">{MEDIA.trialStorageLabel}</strong>trial media cap</div>
        </div>
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader className="border-b border-border">
            <CardDescription className="text-xs font-medium uppercase tracking-[0.2em]">Blog Setup</CardDescription>
            <CardTitle className="text-3xl font-semibold tracking-[-0.05em]">Create your hosted blog</CardTitle>
            <CardDescription>Only the essentials. You can edit posts, media, tokens, and billing after this.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form method="post" action="/app/setup/complete" className="grid gap-6">
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="name">Blog Name</FieldLabel>
                  <Input id="name" name="name" required maxLength={80} defaultValue={site.name} placeholder="Moin's Notes" />
                  <FieldDescription>This appears in the dashboard and public blog header.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="slug">Default Slug</FieldLabel>
                  <Input id="slug" name="slug" required maxLength={42} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={site.slug} placeholder="moins-notes" />
                  <FieldDescription>Lowercase letters, numbers, and hyphens. Custom domains can come later.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="description">Description <span className="text-muted-foreground">optional</span></FieldLabel>
                  <Textarea id="description" name="description" maxLength={220} rows={4} defaultValue={site.description} placeholder={`A short blog about building products with humans and AI agents on ${BRAND.name}.`} />
                </Field>
              </FieldGroup>
              <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">Trial sites are noindexed until paid. You still get the full dashboard and scoped agent access.</p>
                <SubmitButton className="h-11 rounded-xl px-6" pendingText="Saving…">Open dashboard</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </OnboardingFrame>
  );
};
