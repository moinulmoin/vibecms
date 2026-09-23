import { BRAND, FREE_TIER, LAUNCH_OFFER, MEDIA, PRICING } from "@vc/config";
import { Check } from "./icons";
import { GREEN_BG, GREEN_CTA, H2, LEAD, PANEL, SectionShell } from "./primitives";

const INCLUDED = [
  "Unlimited published posts",
  "Your own domain",
  "Indexed by search engines",
  `${MEDIA.paidStorageLabel} of media on R2`,
  "MCP, REST API, and CLI",
  "Versions, restore, activity log",
  "Analytics, including AI traffic",
  "Newsletter signups",
  "Four themes, your accent and fonts",
  "JSON export, anytime",
] as const;

export function HostingPricing({ loginUrl }: { loginUrl: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
          <div data-reveal className="min-w-0">
            <h2 id="pricing-title" className={H2}>
              One plan for one
              <br />
              serious blog.
            </h2>
            <p className={`mt-4 max-w-md ${LEAD}`}>
              Start free, no card. Connect your agent and publish up to{" "}
              {FREE_TIER.publishedPosts} posts. Subscribe for everything else.
            </p>
            <p className="mt-4 max-w-md text-sm leading-[1.6] text-muted-foreground">
              Less than a Claude subscription, and it runs the whole blog.
            </p>
            <p className="mt-8 text-sm leading-[1.6] text-muted-foreground">
              Prefer your own Cloudflare account?{" "}
              <a
                className="text-foreground underline decoration-[color:var(--hairline)] underline-offset-4 hover:decoration-current"
                href={BRAND.repoUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Self-host it free
              </a>
              .
            </p>
          </div>

          <div className={`p-7 sm:p-9 ${PANEL}`} data-reveal data-d="1">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              <div>
                <p className="text-[15px] font-medium text-foreground">{PRICING.planName}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-brand-bright">
                  <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden="true" />
                  Launch pricing
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-display text-4xl font-semibold tracking-[-0.03em] text-foreground">
                  <span className="sr-only">Now </span>${LAUNCH_OFFER.monthlyUsd}
                  <span className="text-base font-medium text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <s className="decoration-muted-foreground/60">
                    <span className="sr-only">Normally </span>${PRICING.monthlyUsd}
                  </s>{" "}
                  · or ${LAUNCH_OFFER.annualUsd}/year{" "}
                  <s className="decoration-muted-foreground/60">
                    <span className="sr-only">instead of </span>${PRICING.annualUsd}
                  </s>
                </p>
              </div>
            </div>

            <ul className="mt-8 grid gap-x-6 gap-y-3 border-t border-[color:var(--hairline)] pt-7 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li className="flex gap-3 text-sm leading-6 text-secondary-foreground" key={item}>
                  <Check className="mt-1 size-4 shrink-0 text-brand-bright" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <a
                className={`h-12 px-7 text-[15px] ${GREEN_CTA}`}
                href={loginUrl}
                style={{ background: GREEN_BG }}
              >
                Start free
              </a>
              <p className="text-[13px] leading-5 text-muted-foreground">
                {LAUNCH_OFFER.applyNote} {LAUNCH_OFFER.lockNote}
              </p>
            </div>
          </div>
        </div>
      </SectionShell>
    </section>
  );
}
