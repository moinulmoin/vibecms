import { ENTITLEMENTS, MEDIA, PRICING } from "@vc/config";
import { CheckIcon } from "@radix-ui/react-icons";
import { GlassCard, MonoEyebrow, SectionShell } from "./primitives";

const pricingChecklist = [
  ...ENTITLEMENTS,
  "Unlimited drafts",
  `${MEDIA.paidStorageLabel} media on R2`,
  "Fast managed hosting",
  "RSS, sitemap and SEO",
] as const;

const ctaGreen =
  "inline-flex h-12 w-full items-center justify-center whitespace-nowrap rounded-xl px-8 text-[15px] font-semibold text-brand-bright-foreground no-underline shadow-[0_8px_20px_-8px_oklch(0.8107_0.1705_152.72/0.7),inset_0_1px_0_var(--hairline)] sm:w-auto";

export function HostingPricing() {
  return (
    <section id="pricing">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
          <div data-reveal>
            <MonoEyebrow label="Pricing" />
            <h2 className="mt-4 max-w-md text-balance font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
              One plan for one
              <br />
              serious blog.
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
              Everything you need to run a real publication - with agent publishing through MCP.
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
              <p className="font-display text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
                ${PRICING.monthlyUsd}
                <span className="text-lg font-medium text-muted-foreground">
                  /mo · or {PRICING.annualLabel}
                </span>
              </p>
            </div>
            <a
              className={`mt-7 ${ctaGreen}`}
              href="/login"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
              }}
            >
              Get started
            </a>
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
