import { ENTITLEMENTS, MEDIA, PRICING } from "@vc/config";
import { CheckIcon } from "@radix-ui/react-icons";
import { GREEN_BG, GREEN_CTA, GlassCard, SectionShell } from "./primitives";

const pricingChecklist = [
  ...ENTITLEMENTS,
  "Custom domain",
  "4 designed themes",
  "Typed REST API & CLI",
  "Unlimited drafts",
  `${MEDIA.paidStorageLabel} media on R2`,
  "SEO & AI visibility built in",
  "Managed hosting on Cloudflare",
] as const;

export function HostingPricing({ loginUrl }: { loginUrl: string }) {
  return (
    <section id="pricing">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
          <div data-reveal>
            <h2 className="max-w-md text-balance font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
              One plan for one
              <br />
              serious blog.
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
              Jump in free, no card - set up your blog, connect your agents, and see
              it publish. One plan unlocks unlimited publishing, your own domain, and
              the full API.
            </p>
            <p className="mt-6 font-mono text-[13px] leading-6 text-muted-foreground">
              Or self-host free - same scoped-MCP publishing, your own infrastructure.
            </p>
          </div>
          <GlassCard className="relative overflow-hidden p-8 sm:p-9" data-reveal data-d="1">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                  {PRICING.planName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Cancel anytime.</p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
                  ${PRICING.monthlyUsd}
                  <span className="text-lg font-medium text-muted-foreground">/mo</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  or {PRICING.annualLabel}{" "}
                  <span className="text-brand-bright">· 2 months free</span>
                </p>
              </div>
            </div>
            <a
              className={`mt-7 h-12 w-full px-8 text-[15px] sm:w-auto ${GREEN_CTA}`}
              href={loginUrl}
              style={{ background: GREEN_BG }}
            >
              Start free
            </a>
            <p className="mt-3 text-center text-[12.5px] leading-5 text-muted-foreground">
              Free to try - no card, no commitment.
            </p>
            <ul className="mt-8 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {pricingChecklist.map((item) => (
                <li className="flex gap-3 text-sm leading-6 text-muted-foreground" key={item}>
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      </SectionShell>
    </section>
  );
}
