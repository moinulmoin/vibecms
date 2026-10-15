import { GREEN_BG, GREEN_CTA } from "./primitives";
import { Menu, X } from "./icons";
import { startFreeUrl } from "../../lib/landing-links";

// Page order: control → agents → connection → features → pricing → FAQ.
export const NAV_ITEMS = [
  ["Agents", "agents"],
  ["Features", "features"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
] as const;

// Nav text links keep the compact desktop density; the ::before inset extends
// the hit area to ~44px tall without disturbing the header height/underline.
// marketing-interactions.js swaps only the text-* and scale-x-* active classes.
const linkBase =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']";
const underlineBase =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-0";

const mobileLink =
  "flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground";

/** Shared landing banner; rendered by LandingLayout outside <main>. */
export function LandingHeader({ loginUrl }: { loginUrl: string }) {
  return (
    <header
      className="sticky top-0 z-[60] border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-300 data-[scrolled]:border-[color:var(--hairline)] data-[scrolled]:bg-background/60 data-[scrolled]:backdrop-blur-xl"
      data-landing-header
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-4 sm:px-7">
        <a
          className="relative flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground no-underline before:absolute before:-inset-y-2 before:inset-x-[-4px] before:content-['']"
          href="/"
        >
          <img
            src="/brand/icon.svg"
            alt=""
            width={30}
            height={30}
            className="size-[30px] rounded-[9px] shadow-[0_6px_16px_-6px_oklch(0.8107_0.1705_152.72/0.55)]"
            aria-hidden="true"
          />
          <span className="font-mono text-[16px] font-medium lowercase tracking-tight text-foreground">
            vibecms<span className="text-brand-bright">.</span>
          </span>
        </a>

        <HeaderNav />

        <div className="flex items-center gap-2.5 sm:gap-3.5">
          <MobileNav loginUrl={loginUrl} />
          <a
            className="hidden min-h-[44px] items-center whitespace-nowrap text-sm font-medium text-secondary-foreground no-underline transition-colors hover:text-foreground sm:inline-flex"
            href={loginUrl}
          >
            Sign in
          </a>
          <a
            className={`${GREEN_CTA} min-h-[44px] px-[18px] text-sm`}
            style={{ background: GREEN_BG }}
            href={startFreeUrl(loginUrl)}
          >
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

/** Static nav; active section state is driven by marketing-interactions.js. */
function HeaderNav() {
  return (
    <nav aria-label="Primary" className="hidden items-center gap-8 md:flex" data-landing-nav>
      {NAV_ITEMS.map(([label, id]) => (
        <a
          key={id}
          href={`#${id}`}
          data-nav-section={id}
          className={linkBase}
        >
          {label}
          <span className={underlineBase} aria-hidden="true" data-nav-underline />
        </a>
      ))}
      <a className={linkBase} href="/docs">
        Docs
      </a>
    </nav>
  );
}

/**
 * Compact section menu for narrow viewports. A disclosure widget so it works
 * without JavaScript (the browser exposes its expanded state);
 * marketing-interactions.js adds the Menu/Close label, outside-click, Escape,
 * focus-leave and link-click closing, and locks page scroll while open.
 */
function MobileNav({ loginUrl }: { loginUrl: string }) {
  return (
    <details className="group relative md:hidden" data-mobile-nav>
      <summary className="flex min-h-[44px] cursor-pointer list-none select-none items-center gap-2 rounded-lg px-2 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground group-open:text-foreground [&::-webkit-details-marker]:hidden">
        <Menu className="size-4 group-open:hidden" />
        <X className="hidden size-4 group-open:block" />
        <span className="sr-only min-[380px]:not-sr-only" data-mobile-nav-label>
          Menu
        </span>
      </summary>
      <div className="absolute right-0 top-full z-[70] mt-1 w-44 rounded-[18px] bg-popover p-1.5 text-popover-foreground shadow-menu ring-1 ring-[color:var(--hairline)]">
        <nav aria-label="Sections" className="flex flex-col">
          <a href={loginUrl} data-mobile-nav-link className={`${mobileLink} sm:hidden`}>
            Sign in
          </a>
          {NAV_ITEMS.map(([label, id]) => (
            <a key={id} href={`#${id}`} data-mobile-nav-link className={mobileLink}>
              {label}
            </a>
          ))}
          <a href="/docs" data-mobile-nav-link className={mobileLink}>
            Docs
          </a>
        </nav>
      </div>
    </details>
  );
}
