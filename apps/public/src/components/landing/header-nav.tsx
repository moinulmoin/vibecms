const navItems = [
  ["Features", "features"],
  ["Agents", "agents"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
] as const;

const linkBase =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground";
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
