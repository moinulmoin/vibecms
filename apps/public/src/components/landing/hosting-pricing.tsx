import { BRAND, FREE_TIER, LAUNCH_OFFER, MEDIA, PRICING } from "@vc/config";
import { Check } from "./icons";
import { GREEN_BG, GREEN_CTA, H2, LEAD, PANEL, SectionLight, SectionShell } from "./primitives";
import { startFreeUrl } from "../../lib/landing-links";

const INCLUDED = [
  "Unlimited posts",
  "Your own domain",
  "Indexed by search engines",
  `${MEDIA.paidStorageLabel} of media on R2`,
  "Unlimited agent requests (fair use)",
  "MCP, REST API, and CLI",
  "Private previews and scheduling",
  "Versions, restore, activity log",
  "A key per agent, with its own access",
  "Analytics, including AI traffic",
  "Newsletter signups",
  "Four themes, your accent and fonts",
  "JSON export, anytime",
] as const;

export function HostingPricing({ loginUrl }: { loginUrl: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title">
      <SectionShell className="isolate">
        <SectionLight x="70%" y="50%" alpha={0.15} />
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
          <div data-reveal className="min-w-0">
            <h2 id="pricing-title" className={H2}>
              One plan for one
              <br />
              serious blog.
            </h2>
            <p className={`mt-4 max-w-md ${LEAD}`}>
              Start free: {FREE_TIER.publishedPosts} published posts, {FREE_TIER.drafts} drafts at a time, {FREE_TIER.images} images, no card.
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

          <div className={`p-7 sm:p-9 ${PANEL}`} data-reveal data-d="1" data-pricing data-period="monthly">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
              <div>
                <p className="text-[15px] font-medium text-foreground">{PRICING.planName}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-brand-bright">
                  <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden="true" />
                  {LAUNCH_OFFER.phaseLabel}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-display text-4xl font-semibold tracking-[-0.03em] text-foreground">
                  <span data-for-period="monthly">
                    <span className="sr-only">Now </span>${LAUNCH_OFFER.monthlyUsd}
                    <span className="text-base font-medium text-muted-foreground">/month</span>
                  </span>
                  <span data-for-period="yearly">
                    <span className="sr-only">Now </span>${LAUNCH_OFFER.annualUsd}
                    <span className="text-base font-medium text-muted-foreground">/year</span>
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span data-for-period="monthly">
                    <span className="font-medium text-brand-bright">{LAUNCH_OFFER.monthlyPercentOff}% off</span> · normally{" "}
                    <s className="decoration-muted-foreground/60">${PRICING.monthlyUsd}</s>
                  </span>
                  <span data-for-period="yearly">
                    <span className="font-medium text-brand-bright">{LAUNCH_OFFER.annualPercentOff}% off</span> · normally{" "}
                    <s className="decoration-muted-foreground/60">${PRICING.annualUsd}</s> · ${(LAUNCH_OFFER.annualUsd / 12).toFixed(2)}/month
                  </span>
                </p>
              </div>
            </div>

            <div
              className="mt-6 inline-grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1 ring-1 ring-[color:var(--hairline)]"
              role="group"
              aria-label="Billing period"
            >
              {(["monthly", "yearly"] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  data-period-pick={period}
                  aria-pressed={period === "monthly" ? "true" : "false"}
                  className="min-h-[34px] rounded-[9px] px-4 text-[13px] font-medium capitalize text-muted-foreground transition-colors duration-200 hover:text-foreground aria-pressed:bg-foreground/[0.09] aria-pressed:text-foreground"
                >
                  {period}
                </button>
              ))}
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
                href={startFreeUrl(loginUrl)}
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
