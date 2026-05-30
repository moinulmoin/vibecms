import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vc/ui";

export const BillingRequired = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  if (isSelfHosted()) return new Response(null, { status: 302, headers: { Location: "/app" } });
  const billing = await getBilling(ctx.app.workspaceId);

  return (
    <main className="min-h-screen bg-muted/35 p-4 text-foreground md:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 lg:grid-cols-[.9fr_1.1fr]">
        <section>
          <a href="/" className="text-sm font-semibold text-foreground no-underline">VibeCMS</a>
          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Card-required trial</p>
          <h1 className="mt-3 max-w-xl text-balance text-4xl font-semibold tracking-[-0.05em] md:text-6xl">Start the trial before opening the dashboard.</h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground md:text-base">
            Your blog is configured. To protect hosted blogs, media storage, and MCP/API access from abuse, VibeCMS starts through Polar checkout with a card-required 7-day trial.
          </p>
        </section>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardDescription>One plan</CardDescription>
              <Badge variant="outline">{billing?.status ?? "none"}</Badge>
            </div>
            <CardTitle className="text-3xl font-semibold tracking-[-0.04em]">$9/month</CardTitle>
            <CardDescription>or $99/year after a 7-day trial. Cancel anytime from the customer portal.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 p-6">
            <ul className="grid gap-3 text-sm text-muted-foreground">
              <li>✓ 1 hosted blog</li>
              <li>✓ Unlimited posts</li>
              <li>✓ 5GB paid media storage</li>
              <li>✓ Scoped MCP/API access</li>
              <li>✓ Activity and post version history</li>
            </ul>
            <div className="grid gap-2 sm:grid-cols-2">
              <form method="post" action="/app/billing/checkout"><Button className="w-full" name="interval" value="monthly" type="submit">Start monthly trial</Button></form>
              <form method="post" action="/app/billing/checkout"><Button className="w-full" name="interval" value="yearly" variant="outline" type="submit">Start yearly trial</Button></form>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Trial sites are noindexed until paid. Publishing, media uploads, and API/MCP access require an active trial or subscription.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
