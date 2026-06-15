import { BRAND } from "@vc/config";
import {
  ArrowRightIcon,
  CounterClockwiseClockIcon,
  Pencil2Icon,
} from "@radix-ui/react-icons";
import { DotGrid, Glow, GlassCard, Pill } from "./primitives";
import { TerminalType } from "./terminal-type";

const navItems = [
  ["Features", "#features"],
  ["Agents", "#agents"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
] as const;

const builtOn = ["Cloudflare Workers", "D1", "R2"] as const;

function panelChromeClassName(extra?: string) {
  return [
    "rounded-[18px] ring-1 ring-[color:var(--hairline)] shadow-[inset_0_1px_0_var(--hairline),0_24px_50px_-36px_oklch(0_0_0/0.9)]",
    "[background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export function HeaderHero() {
  return (
    <>
      <header className="sticky top-0 z-[60] border-b border-border/60 bg-background/80 backdrop-blur-xl [box-shadow:0_1px_0_var(--hairline)]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-4 sm:px-7">
          <a
            className="flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground no-underline"
            href="/"
          >
            <span
              className="grid size-[30px] place-items-center rounded-[9px] font-display text-[13px] font-bold tracking-[-0.04em] text-brand-bright-foreground shadow-[0_6px_16px_-6px_oklch(0.8107_0.1705_152.72/0.7),inset_0_1px_0_var(--hairline)]"
              style={{
                background:
                  "linear-gradient(155deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
              }}
              aria-hidden="true"
            >
              VC
            </span>
            {BRAND.name}
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map(([label, href]) => (
              <a
                key={href}
                className="text-sm font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
                href={href}
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 sm:gap-3.5">
            <a
              className="whitespace-nowrap text-sm font-medium text-secondary-foreground no-underline transition-colors hover:text-foreground"
              href="/login"
            >
              Sign in
            </a>
            <a
              className="whitespace-nowrap rounded-[10px] px-[18px] py-2.5 text-sm font-semibold text-brand-bright-foreground no-underline shadow-[0_8px_20px_-8px_oklch(0.8107_0.1705_152.72/0.7),inset_0_1px_0_var(--hairline)]"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
              }}
              href="/login"
            >
              Get started
            </a>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 px-5 pb-10 pt-16 sm:px-7 sm:pt-20 md:grid-cols-[1.02fr_1.18fr] md:gap-14 md:pb-16 md:pt-[88px]">
        <div data-reveal data-d="1">
          <Pill pulse className="mb-6">
            Markdown / Media / Versions / MCP
          </Pill>

          <h1 className="font-display text-[clamp(2.5rem,5.6vw,4.375rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-foreground">
            CMS for humans
            <br />
            <span className="text-brand-bright">and AI agents.</span>
          </h1>

          <p className="mt-5 max-w-[440px] text-lg leading-[1.62] text-muted-foreground">
            Write in Markdown. Manage media and versions. Let trusted agents draft, update, and
            publish through scoped MCP - without ever handing over your login.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              className="inline-flex items-center whitespace-nowrap rounded-xl px-[22px] py-3.5 text-[15px] font-semibold text-brand-bright-foreground no-underline shadow-[0_8px_20px_-8px_oklch(0.8107_0.1705_152.72/0.7),inset_0_1px_0_var(--hairline)]"
              style={{
                background:
                  "linear-gradient(180deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
              }}
              href="#pricing"
            >
              Get started
            </a>
            <a
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-[22px] py-3.5 text-[15px] font-semibold text-secondary-foreground no-underline ring-1 ring-[color:var(--hairline)] [background:var(--surface-glass)]"
              href="#self-host"
            >
              Self-host
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </a>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-5 sm:gap-[22px]">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Built on
            </span>
            <div className="flex flex-wrap items-center gap-4 text-[13px] font-medium text-muted-foreground">
              {builtOn.map((label, i) => (
                <span key={label} className="inline-flex items-center gap-4">
                  {i > 0 ? (
                    <span className="text-border" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="relative min-h-[340px] md:min-h-[400px]" data-reveal data-d="2">
          <Glow className="left-1/2 top-1/2 h-[520px] w-[640px] -translate-x-1/2 -translate-y-1/3 opacity-90" />
          <DotGrid className="inset-[-12%] opacity-40" />

          <div className={`relative z-10 overflow-hidden ${panelChromeClassName()}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3.5 py-2.5 sm:px-4">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="size-2.5 rounded-full bg-destructive/80" />
                <span className="size-2.5 rounded-full bg-accent/80" />
                <span className="size-2.5 rounded-full bg-brand-bright/80" />
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-xs text-muted-foreground [background:var(--surface-glass-strong)]">
                <Pencil2Icon className="size-3 text-brand-bright" aria-hidden="true" />
                shipping-with-mcp.md
              </div>
              <div className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand-bright ring-1 ring-brand-bright/25 [background:oklch(0.8107_0.1705_152.72/0.12)]">
                <span
                  className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)] animate-vc-pulse"
                  aria-hidden="true"
                />
                agent / drafting
              </div>
            </div>

            <div className="grid min-h-[296px] grid-cols-1 sm:grid-cols-2">
              <div className="border-border/40 bg-background/40 px-5 py-5 font-mono text-[12.5px] leading-8 shadow-[1px_0_0_var(--hairline)] sm:border-r">
                <div className="text-brand-bright"># Shipping with MCP</div>
                <div className="text-muted-foreground/40">&nbsp;</div>
                <div className="text-muted-foreground">We let agents publish without</div>
                <div className="text-muted-foreground">
                  handing over <span className="text-brand-bright">**the keys**</span>.
                </div>
                <div className="text-muted-foreground/40">&nbsp;</div>
                <div className="text-muted-foreground/80">- Scoped tokens</div>
                <div className="text-muted-foreground/80">- Full version trail</div>
                <div className="text-muted-foreground">
                  - Live preview
                  <span
                    className="ml-0.5 inline-block h-4 w-2 align-[-3px] bg-brand-bright animate-vc-blink"
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div className="px-5 py-5 [background:linear-gradient(180deg,var(--surface-glass-strong),transparent)]">
                <div className="mb-3.5 font-display text-[19px] font-semibold tracking-[-0.02em] text-foreground">
                  Shipping with MCP
                </div>
                <div className="mb-2 h-2 w-full rounded bg-muted-foreground/20" />
                <div className="mb-2 h-2 w-[86%] rounded bg-muted-foreground/20" />
                <div className="mb-4 h-2 w-[64%] rounded bg-muted-foreground/15" />
                <div className="grid h-[88px] place-items-center rounded-[10px] font-mono text-[11px] text-muted-foreground ring-1 ring-brand-bright/15 [background:linear-gradient(135deg,oklch(0.8107_0.1705_152.72/0.16),oklch(0.8107_0.1705_152.72/0.04))]">
                  media / hero.webp
                </div>
              </div>
            </div>
          </div>

          <GlassCard className="absolute -right-2 -top-5 z-20 hidden animate-vc-float px-4 py-3 sm:block md:-right-[18px] md:-top-[22px]">
            <div className="flex items-center gap-2">
              <span
                className="grid size-8 place-items-center rounded-lg text-brand-bright ring-1 ring-brand-bright/20 [background:oklch(0.8107_0.1705_152.72/0.15)]"
                aria-hidden="true"
              >
                <CounterClockwiseClockIcon className="size-3.5" />
              </span>
              <div>
                <div className="text-xs font-semibold text-foreground">Published v12</div>
                <div className="font-mono text-[10px] text-muted-foreground">agent · 2s ago</div>
              </div>
            </div>
          </GlassCard>

          <div
            className={`absolute -bottom-6 -left-4 z-20 hidden w-[min(300px,calc(100%-1rem))] sm:block md:-bottom-[30px] md:-left-[26px] ${panelChromeClassName()}`}
          >
            <div className="flex items-center gap-2 border-b border-border/40 px-3.5 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                mcp / scoped call
              </span>
            </div>
            <div className="px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] text-muted-foreground">
              <span className="text-brand-bright">$</span> <TerminalType />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}