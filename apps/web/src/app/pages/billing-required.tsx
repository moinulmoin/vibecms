import { ENTITLEMENTS, MEDIA, PRICING, readFormStatus } from "@vc/config";
import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, SubmitButton } from "@vc/ui";
import { CheckIcon } from "@radix-ui/react-icons";
import { OnboardingFrame, Panel, StatusAlert } from "./app-layout";

export const BillingRequired = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  if (isSelfHosted()) return new Response(null, { status: 302, headers: { Location: "/app" } });
  const billing = await getBilling(ctx.app.workspaceId);
  const status = readFormStatus(new URL(request.url).searchParams);

  return (
    <OnboardingFrame phase="Billing">
      <div className="grid gap-4">
        <StatusAlert status={status} />
        <Panel
          title={PRICING.monthlyLabel}
          meta={
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{PRICING.planName}</span>
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.08em]">
                {billing?.status ?? "none"}
              </Badge>
            </span>
          }
        >
          <p className="mb-5 font-sans text-sm leading-6 text-muted-foreground">
            or {PRICING.annualLabel} billed yearly. Cancel anytime from the customer portal.
          </p>
          <ul className="grid gap-3 text-sm text-muted-foreground">
            {ENTITLEMENTS.map((entitlement) => (
              <li key={entitlement} className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden="true" />
                <span className="font-sans">{entitlement}</span>
              </li>
            ))}
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden="true" />
              <span className="font-sans">{MEDIA.paidStorageLabel} media storage</span>
            </li>
          </ul>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <form method="post" action="/app/billing/checkout">
              <SubmitButton className="h-11 w-full rounded-xl" name="interval" value="monthly" pendingText="Starting checkout…">
                Subscribe monthly
              </SubmitButton>
            </form>
            <form method="post" action="/app/billing/checkout">
              <SubmitButton className="h-11 w-full rounded-xl" name="interval" value="yearly" variant="outline" pendingText="Starting checkout…">
                Subscribe yearly
              </SubmitButton>
            </form>
          </div>
          <p className="mt-5 font-mono text-[11px] leading-5 text-muted-foreground">
            Drafting, agent access, and your first published post are free. Subscribe to publish more posts, upload media, and make your blog search-indexable. Cancel anytime from the customer portal.
          </p>
        </Panel>
      </div>
    </OnboardingFrame>
  );
};