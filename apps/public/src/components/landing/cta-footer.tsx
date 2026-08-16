import { ArrowRightIcon } from "@radix-ui/react-icons";
import { BRAND, LEGAL } from "@vc/config";
import { GHOST_CTA, GREEN_BG, GREEN_CTA, Glow, SectionShell } from "./primitives";

const productLinks = [
  ["Features", "#features"],
  ["Agents", "#agents"],
  ["Pricing", "#pricing"],
] as const;

const legalLinks = [
  ["Privacy", LEGAL.privacy],
  ["Terms", LEGAL.terms],
  ["Support", LEGAL.support],
] as const;

const makerLinks = [
  ["Ideaplexa", "https://ideaplexa.com"],
  ["VoiceTypr", "https://voicetypr.com"],
  ["ChadNext", "https://chadnext.moinulmoin.com"],
] as const;

export function CtaFooter({
  loginUrl,
  apiDocsUrl,
}: {
  loginUrl: string;
  apiDocsUrl: string;
}) {
  const year = new Date().getFullYear();
  const deployLinks = [
    ["GitHub", BRAND.repoUrl],
    ["API docs", apiDocsUrl],
    ["Docs", "/docs"],
  ] as const;
  const accountLinks = [
    ["Sign in", loginUrl],
    ["Start free", loginUrl],
  ] as const;

  return (
    <>
      <SectionShell className="pb-10 md:pb-14">
        <div
          className="relative overflow-hidden rounded-[22px] px-6 py-14 text-center ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] sm:px-10 md:py-[76px]"
          data-reveal
        >
          <Glow className="pointer-events-none absolute left-1/2 -top-24 size-[min(560px,90vw)] -translate-x-1/2 opacity-60" />
          <img
            src="/brand/icon.svg"
            alt=""
            className="relative mx-auto mb-7 size-16 animate-vc-float sm:size-[68px]"
            aria-hidden="true"
          />
          <h2 className="relative mx-auto max-w-[18ch] text-balance font-display text-[clamp(1.875rem,4.4vw,3.25rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
            Your agents. Your content.{" "}
            <span className="text-brand-bright">Your call.</span>
          </h2>
          <p className="relative mx-auto mt-4 max-w-[460px] text-balance text-base leading-7 text-muted-foreground">
            Scoped MCP, a full version trail, and your login never leaves your hands.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <a
              className={`${GREEN_CTA} min-h-[44px] px-[22px] py-3.5 text-[15px]`}
              style={{ background: GREEN_BG }}
              href={loginUrl}
            >
              Start free
            </a>
            <a
              className={`${GHOST_CTA} min-h-[44px] px-[22px] py-3.5 text-[15px]`}
              href={BRAND.repoUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              View on GitHub
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </SectionShell>

      <footer className="py-12">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-7">
          <div
            className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5"
            data-reveal
          >
            <div className="sm:col-span-2 lg:col-span-1">
              <a
                className="mb-4 inline-flex items-center gap-2.5 font-display text-base font-semibold tracking-[-0.02em] text-foreground no-underline"
                href="/"
              >
                <img
                  src="/brand/icon.svg"
                  alt=""
                  className="size-8 rounded-lg"
                  aria-hidden="true"
                />
                <span className="font-mono text-[15px] font-medium lowercase tracking-tight text-foreground">
                  vibecms<span className="text-brand-bright">.</span>
                </span>
              </a>
              <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                The CMS your agents publish into.
              </p>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs text-brand-bright">
                Product
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {productLinks.map(([label, href]) => (
                  <a className="inline-flex min-h-[44px] items-center no-underline hover:text-foreground" href={href} key={label}>
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs text-brand-bright">
                Legal
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground" aria-label="Legal">
                {legalLinks.map(([label, href]) => (
                  <a
                    className="inline-flex min-h-[44px] items-center no-underline hover:text-foreground"
                    href={href}
                    key={label}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs text-brand-bright">
                Resources
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {deployLinks.map(([label, href]) => (
                  <a
                    className="inline-flex min-h-[44px] items-center no-underline hover:text-foreground"
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
              <p className="mb-4 font-mono text-xs text-brand-bright">
                Account
              </p>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                {accountLinks.map(([label, href]) => (
                  <a className="inline-flex min-h-[44px] items-center no-underline hover:text-foreground" href={href} key={label}>
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
            © {year} vibecms - a product of{" "}
            <a
              className="text-muted-foreground underline-offset-2 hover:text-foreground"
              href="https://ideaplexa.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Ideaplexa LLC
            </a>
            .
          </p>
          <p className="mt-2 font-mono text-[11px] tracking-[0.04em] text-muted-foreground/60">
            Also from the maker:{" "}
            {makerLinks.map(([label, href], index) => (
              <span key={label}>
                {index > 0 ? " · " : ""}
                <a
                  className="underline-offset-2 hover:text-muted-foreground"
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {label}
                </a>
              </span>
            ))}
          </p>
        </div>
      </footer>
    </>
  );
}
