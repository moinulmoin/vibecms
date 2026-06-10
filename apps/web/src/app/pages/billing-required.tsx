import { ENTITLEMENTS, MEDIA, PRICING, readFormStatus } from "@vc/config";
import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, SubmitButton } from "@vc/ui";
import { OnboardingFrame, StatusAlert } from "./app-layout";

export const BillingRequired = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  if (isSelfHosted()) return new Response(null, { status: 302, headers: { Location: "/app" } });
  const billing = await getBilling(ctx.app.workspaceId);
  const status = readFormStatus(new URL(request.url).searchParams);

  return (
    <OnboardingFrame phase="Billing">
      <div className="grid gap-4">
        <StatusAlert status={status} />
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader className="border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <CardDescription>{PRICING.planName}</CardDescription>
              <Badge variant="outline">{billing?.status ?? "none"}</Badge>
            </div>
            <CardTitle className="text-3xl font-semibold tracking-[-0.04em]">{PRICING.monthlyLabel}</CardTitle>
            <CardDescription>or {PRICING.annualLabel} after a {PRICING.trialLabel}. Cancel anytime from the customer portal.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 p-6">
            <ul className="grid gap-3 text-sm text-muted-foreground">
              {ENTITLEMENTS.map((entitlement) => <li key={entitlement}>✓ {entitlement}</li>)}
              <li>✓ {MEDIA.paidStorageLabel} paid media storage</li>
            </ul>
            <div className="grid gap-2 sm:grid-cols-2">
              <form method="post" action="/app/billing/checkout"><SubmitButton className="w-full" name="interval" value="monthly" pendingText="Starting checkout…">Start monthly trial</SubmitButton></form>
              <form method="post" action="/app/billing/checkout"><SubmitButton className="w-full" name="interval" value="yearly" variant="outline" pendingText="Starting checkout…">Start yearly trial</SubmitButton></form>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Trial sites are noindexed until paid. Publishing, media uploads, and agent access require an active trial or subscription.</p>
          </CardContent>
        </Card>
      </div>
    </OnboardingFrame>
  );
};
