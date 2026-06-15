import { Button } from "@vc/ui";
import { ENTITLEMENTS, MEDIA, PRICING } from "@vc/config";
import { ArrowRightIcon, CheckIcon, LightningBoltIcon } from "@radix-ui/react-icons";
import { GreenCard, GlassCard, MonoEyebrow, SectionShell } from "./primitives";

const cloudChecks = [
  "Zero infrastructure to manage",
  "Automatic updates and backups",
  "Managed media and CDN",
] as const;

const selfHostRows = [
  "Full source on GitHub",
  "Your infrastructure, your data",
  "Same scoped-MCP publishing",
] as const;

const pricingChecklist = [
  ...ENTITLEMENTS,
  "Unlimited drafts",
  `${MEDIA.paidStorageLabel} media on R2`,
  "Fast managed hosting",
  "RSS, sitemap and SEO",
] as const;

export function HostingPricing() {
  return (
    <>
      <section id="self-host">
        <SectionShell className="pb-0 md:pb-0">
          <div data-reveal>
            <MonoEyebrow label="Hosting" />
            <h2 className="mt-4 max-w-xl font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
              Hosted for speed.
              <br />
              Self-hosted for control.
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div data-reveal data-d="1">
              <GlassCard className="h-full p-7">
                <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-brand-bright/10 ring-1 ring-brand-bright/20">
                  <LightningBoltIcon className="size-5 text-brand-bright" aria-hidden />
                </div>
                <h3 className="font-display text-[1.375rem] font-semibold tracking-[-0.02em] text-foreground">
                  {PRICING.planName}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  We run the Workers setup, scaling, updates, and storage - so you focus on the
                  publication.
                </p>
                <ul className="mt-6 space-y-3 text-sm leading-6 text-muted-foreground">
                  {cloudChecks.map((item) => (
                    <li className="flex gap-3" key={item}>
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
            <div data-reveal data-d="2">
              <GlassCard className="h-full p-7">
                <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-brand-bright/10 ring-1 ring-brand-bright/20">
                  <ArrowRightIcon className="size-5 text-brand-bright" aria-hidden />
                </div>
                <h3 className="font-display text-[1.375rem] font-semibold tracking-[-0.02em] text-foreground">
                  Open source
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Deploy to your own Workers with D1 and R2. Inspect the code, keep the same
                  agent-aware model.
                </p>
                <ul className="mt-6 space-y-3 text-sm leading-6 text-muted-foreground">
                  {selfHostRows.map((item) => (
                    <li className="flex gap-3" key={item}>
                      <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-brand-bright" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
          </div>
        </SectionShell>
      </section>

      <section id="pricing">
        <SectionShell className="pt-14 md:pt-20">
          <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
            <div data-reveal>
              <MonoEyebrow label="Pricing" />
              <h2 className="mt-4 max-w-md font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
                One plan for one
                <br />
                serious blog.
              </h2>
              <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
                Simple enough to start today. Complete enough to run a real publication - with agent
                help through MCP.
              </p>
            </div>
            <GreenCard className="relative overflow-hidden p-8 sm:p-9" data-reveal data-d="1">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brand-bright-foreground/15 pb-6">
                <div>
                  <p className="font-display text-xl font-semibold tracking-[-0.02em]">
                    {PRICING.planName}
                  </p>
                  <p className="mt-1 text-sm text-brand-bright-foreground/70">
                    Self-host free, or go hosted. Cancel anytime.
                  </p>
                </div>
                <p className="font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                  ${PRICING.monthlyUsd}
                  <span className="text-lg font-medium text-brand-bright-foreground/75">
                    /mo · or {PRICING.annualLabel}
                  </span>
                </p>
              </div>
              <Button
                asChild
                className="mt-6 h-12 w-full rounded-xl border-0 bg-brand-bright-foreground text-[15px] font-semibold text-brand-bright shadow-none hover:bg-brand-bright-foreground/90 sm:w-auto sm:px-8"
                size="lg"
              >
                <a className="no-underline" href="/login">
                  Get started
                </a>
              </Button>
              <ul className="mt-8 grid gap-x-6 gap-y-3 border-y border-brand-bright-foreground/15 py-7 sm:grid-cols-2">
                {pricingChecklist.map((item) => (
                  <li className="flex gap-3 text-sm leading-6 text-brand-bright-foreground/90" key={item}>
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-bright-foreground" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-6 text-brand-bright-foreground/70">
                Self-host for free - same agent-aware publishing, your own storage and infrastructure.
              </p>
            </GreenCard>
          </div>
        </SectionShell>
      </section>
    </>
  );
}