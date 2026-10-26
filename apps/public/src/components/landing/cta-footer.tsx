import { BRAND, LEGAL } from "@vc/config";
import { ArrowRight } from "./icons";
import { NAV_ITEMS } from "./header-nav";
import { GHOST_CTA, GREEN_BG, GREEN_CTA, SectionLight, SectionShell } from "./primitives";
import { AUTOSEOPILOT_URL, startFreeUrl } from "../../lib/landing-links";

type FooterLink = { label: string; href: string; external?: boolean };

const productLinks: FooterLink[] = NAV_ITEMS.map(([label, id]) => ({ label, href: `#${id}` }));

const legalLinks: FooterLink[] = [
  { label: "Privacy", href: LEGAL.privacy },
  { label: "Terms", href: LEGAL.terms },
  { label: "Support", href: LEGAL.support },
];

const makerLinks = [
  ["VoiceTypr", "https://voicetypr.com"],
  ["AutoSEOPilot", AUTOSEOPILOT_URL],
  ["Ideaplexa", "https://ideaplexa.com"],
  ["ChadNext", "https://chadnext.moinulmoin.com"],
] as const;

// Shared footer link target: 44px on touch widths, 24px minimum from sm up.
const FOOTER_LINK =
  "inline-flex min-h-[44px] items-center underline-offset-2 hover:text-foreground sm:min-h-6";
const EXTERNAL = { rel: "noopener noreferrer", target: "_blank" } as const;

/** Closing call to action, the last section inside <main>. */
export function CtaSection({ loginUrl }: { loginUrl: string }) {
  return (
    <section id="start" aria-label="Start free">
      <SectionShell className="pb-10 md:pb-14">
        <div className="relative isolate py-10 text-center md:py-16" data-reveal>
          <SectionLight x="50%" y="46%" size={1000} alpha={0.13} />
          <img
            src="/brand/icon.svg"
            alt=""
            className="relative mx-auto mb-7 size-16 animate-vc-float sm:size-[68px]"
            aria-hidden="true"
          />
          <h2 className="relative mx-auto max-w-[16ch] text-balance font-display text-[clamp(2rem,4.6vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
            Your agent is ready to write.{" "}
            <span className="text-brand-bright">Give it a blog.</span>
          </h2>
          <p className="relative mx-auto mt-4 max-w-[440px] text-balance text-base leading-7 text-muted-foreground">
            Free to start, no card. Connect your agent and publish your first
            post today.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <a
              className={`${GREEN_CTA} min-h-[44px] px-[22px] py-3.5 text-[15px]`}
              style={{ background: GREEN_BG }}
              href={startFreeUrl(loginUrl)}
            >
              Start free
            </a>
            <a
              className={`${GHOST_CTA} min-h-[44px] px-[22px] py-3.5 text-[15px]`}
              href={BRAND.repoUrl}
              {...EXTERNAL}
            >
              View on GitHub
              <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </SectionShell>
    </section>
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      <nav className="flex flex-col text-sm text-muted-foreground" aria-label={title}>
        {links.map(({ label, href, external }) => (
          <a className={`${FOOTER_LINK} no-underline`} href={href} key={label} {...(external ? EXTERNAL : {})}>
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** Shared landing contentinfo; rendered by LandingLayout outside <main>. */
export function LandingFooter({
  loginUrl,
  apiDocsUrl,
}: {
  loginUrl: string;
  apiDocsUrl: string;
}) {
  const year = new Date().getFullYear();
  // First-party destinations (docs, API docs) open in place; only off-site links open a new tab.
  const resourceLinks: FooterLink[] = [
    { label: "GitHub", href: BRAND.repoUrl, external: true },
    { label: "API docs", href: apiDocsUrl },
    { label: "Docs", href: "/docs" },
  ];
  const accountLinks: FooterLink[] = [
    { label: "Sign in", href: loginUrl },
    { label: "Start free", href: startFreeUrl(loginUrl) },
  ];

  return (
    <footer className="py-12">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-7">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
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
              CMS for AI agents.
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
          <FooterColumn title="Resources" links={resourceLinks} />
          <FooterColumn title="Account" links={accountLinks} />
        </div>
        <div className="mt-10 flex flex-col gap-2 font-mono text-xs leading-5 text-muted-foreground md:flex-row md:items-center md:justify-between md:gap-6">
          <p className="text-pretty">
            © {year} vibecms - a product of{" "}
            <a
              className={`${FOOTER_LINK} whitespace-nowrap align-middle text-muted-foreground`}
              href="https://ideaplexa.com"
              {...EXTERNAL}
            >
              Ideaplexa LLC
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center gap-x-3">
            <span className="w-full sm:w-auto">Also from the maker:</span>
            {makerLinks.map(([label, href], index) => (
              <span className="inline-flex items-center gap-3 whitespace-nowrap" key={label}>
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <a className={FOOTER_LINK} href={href} {...EXTERNAL}>
                  {label}
                </a>
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
