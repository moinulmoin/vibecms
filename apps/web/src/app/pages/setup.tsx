import { getSiteSetup } from "@/server/onboarding";
import type { AppUserContext } from "@/server/onboarding";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldDescription, FieldGroup, FieldLabel, Input, Textarea } from "@vc/ui";

export const Setup = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const site = await getSiteSetup(ctx.app);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[.9fr_1.1fr] lg:px-10">
        <section className="grid gap-8">
          <a href="/" className="w-fit text-sm font-black tracking-[-0.04em] text-foreground no-underline">VibeCMS</a>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-muted-foreground">Step 1 of 1</p>
            <h1 className="mt-4 max-w-xl text-balance text-5xl font-black leading-[.94] tracking-[-0.075em] sm:text-7xl">Set up your hosted blog.</h1>
            <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-muted-foreground">
              Choose the public blog name, reserve a default slug, and optionally add one sentence for SEO and social previews.
            </p>
          </div>
          <div className="grid max-w-lg gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-2xl border bg-card p-4"><strong className="block text-foreground">1 blog</strong>per subscription</div>
            <div className="rounded-2xl border bg-card p-4"><strong className="block text-foreground">7 days</strong>card-required trial</div>
            <div className="rounded-2xl border bg-card p-4"><strong className="block text-foreground">500MB</strong>trial media cap</div>
          </div>
        </section>

        <Card className="rounded-3xl shadow-2xl shadow-black/5">
          <CardHeader className="border-b">
            <CardDescription className="text-xs font-black uppercase tracking-[0.2em]">Blog setup</CardDescription>
            <CardTitle className="text-3xl font-black tracking-[-0.05em]">Create your hosted blog</CardTitle>
            <CardDescription>Only the essentials. You can edit posts, media, tokens, and billing after this.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form method="post" action="/app/setup/complete" className="grid gap-6">
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="name">Blog name</FieldLabel>
                  <Input id="name" name="name" required maxLength={80} defaultValue={site.name} placeholder="Moin's Notes" />
                  <FieldDescription>This appears in the dashboard and public blog header.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="slug">Default slug</FieldLabel>
                  <Input id="slug" name="slug" required maxLength={42} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={site.slug} placeholder="moins-notes" />
                  <FieldDescription>Lowercase letters, numbers, and hyphens. Custom domains can come later.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="description">Description <span className="text-muted-foreground">optional</span></FieldLabel>
                  <Textarea id="description" name="description" maxLength={220} rows={4} defaultValue={site.description} placeholder="A short blog about building products with humans and AI agents." />
                </Field>
              </FieldGroup>
              <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">Trial sites are noindexed until paid. You still get the full dashboard and MCP/API access.</p>
                <Button className="h-11 rounded-xl px-6" type="submit">Open dashboard</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
