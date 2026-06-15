import { Button } from "@vc/ui";
import { BRAND } from "@vc/config";
import { Glow, SectionShell } from "./primitives";

const productLinks = [
  ["Features", "#features"],
  ["Agents", "#agents"],
  ["Pricing", "#pricing"],
] as const;

const deployLinks = [
  ["Self-host", "#self-host"],
  ["GitHub", BRAND.repoUrl],
  ["Docs", `${BRAND.repoUrl}#readme`],
] as const;

const accountLinks = [
  ["Sign in", "/login"],
  ["Get started", "/login"],
] as const;

export function CtaFooter() {
  const year = new Date().getFullYear();

  return (
    <>
      <SectionShell className="pb-10 md:pb-14">
        <div
          className="relative overflow-hidden rounded-[18px] p-8 sm:p-10 md:p-12 ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
          data-reveal
        >
          <Glow className="pointer-events-none absolute -right-20 -top-24 size-[min(420px,70vw)] opacity-80" />
          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <h2 className="max-w-xl font-display text-[clamp(1.875rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground">
                Start simple. Add
                <br />
                agents when you&apos;re ready.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
                Write in Markdown, keep every version, and let trusted agents publish through scoped
                MCP.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  asChild
                  className="h-12 rounded-xl px-6 text-[15px] font-semibold active:translate-y-px"
                  size="lg"
                >
                  <a className="no-underline" href="/login">
                    Get started
                  </a>
                </Button>
                <Button
                  asChild
                  className="h-12 rounded-xl border-[color:var(--hairline)] bg-transparent px-6 text-[15px] font-semibold active:translate-y-px"
                  size="lg"
                  variant="outline"
                >
                  <a className="no-underline" href="#self-host">
                    Self-host
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end" data-reveal data-d="2">
              <div
                className="flex size-28 items-center justify-center rounded-2xl font-display text-3xl font-bold tracking-[-0.04em] text-brand-bright-foreground shadow-[inset_0_1px_0_var(--hairline),0_40px_80px_-30px_var(--glow-primary)] animate-vc-float sm:size-32 sm:text-4xl"
                style={{
                  background:
                    "linear-gradient(160deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
                }}
                aria-hidden
              >
                VC
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <footer className="border-t border-border py-12">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-7">
          <div
            className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4"
            data-reveal
          >
            <div className="sm:col-span-2 lg:col-span-1">
              <a
                className="mb-4 inline-flex items-center gap-2.5 font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline"
                href="/"
              >
                <span
                  className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-brand-bright-foreground"
                  style={{
                    background:
                      "linear-gradient(160deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
                  }}
                >
                  VC
                </span>
                {BRAND.name}
              </a>
              <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                A calm Markdown CMS with media, versions, and scoped MCP - for humans and the agents
                they trust.
              </p>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.14em] text-brand-bright">
                Product
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {productLinks.map(([label, href]) => (
                  <a className="no-underline hover:text-foreground" href={href} key={label}>
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.14em] text-brand-bright">
                Deploy
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {deployLinks.map(([label, href]) => (
                  <a
                    className="no-underline hover:text-foreground"
                    href={href}
                    key={label}
                    {...(href.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {})}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.14em] text-brand-bright">
                Account
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {accountLinks.map(([label, href]) => (
                  <a className="no-underline hover:text-foreground" href={href} key={label}>
                    {label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
          <p
            className="mt-10 font-mono text-xs tracking-[0.08em] text-muted-foreground"
            data-reveal
            data-d="1"
          >
            © {year} {BRAND.name} · Markdown · Media · Versions · MCP
          </p>
        </div>
      </footer>
    </>
  );
}