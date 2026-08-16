import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { GlassCard } from "./primitives";

const navItems = [
  ["Features", "features"],
  ["Agents", "agents"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
] as const;

// Nav text links keep the compact desktop density; the ::after inset extends
// the hit area to ~44px tall without disturbing the header height/underline.
const linkBase =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']";
const underlineBase =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-0";

/** Static nav; active section state is driven by marketing-interactions.js. */
export function HeaderNav() {
  return (
    <nav className="hidden items-center gap-8 md:flex" data-landing-nav>
      {navItems.map(([label, id]) => (
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
 * without JavaScript; marketing-interactions.js adds outside-click/Escape/
 * link-click closing.
 */
export function MobileNav({ loginUrl }: { loginUrl: string }) {
  return (
    <details className="relative md:hidden" data-mobile-nav>
      <summary
        aria-label="Open section menu"
        className="flex min-h-[44px] cursor-pointer list-none select-none items-center gap-2 rounded-lg px-2 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <HamburgerMenuIcon className="size-4" aria-hidden="true" />
        <span className="hidden min-[380px]:inline">Menu</span>
      </summary>
      <GlassCard className="absolute right-0 top-full z-[70] mt-1 w-44 p-1.5">
        <nav aria-label="Sections" className="flex flex-col">
          <a
            href={loginUrl}
            data-mobile-nav-link
            className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground sm:hidden"
          >
            Sign in
          </a>
          {navItems.map(([label, id]) => (
            <a
              key={id}
              href={`#${id}`}
              data-mobile-nav-link
              className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground"
            >
              {label}
            </a>
          ))}
          <a
            href="/docs"
            data-mobile-nav-link
            className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground"
          >
            Docs
          </a>
        </nav>
      </GlassCard>
    </details>
  );
}
