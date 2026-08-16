import { BRAND } from "@vc/config";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { GHOST_CTA, GREEN_BG, GREEN_CTA, Glow } from "./primitives";
import { HeaderNav, MobileNav } from "./header-nav";
import { HeroDemo } from "./hero-demo";

const agents = [
  ["Claude", "claude.svg"],
  ["Codex", "codex.svg"],
  ["Pi", "pi.svg"],
  ["OpenCode", "opencode.svg"],
  ["Amp", "amp.svg"],
  ["Droid", "droid.svg"],
] as const;

export function HeaderHero({ loginUrl }: { loginUrl: string }) {
  return (
    <>
      <header className="sticky top-0 z-[60] bg-background/70 backdrop-blur-xl">
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
              href={loginUrl}
            >
              Start free
            </a>
          </div>
        </div>
      </header>

      <section className="relative mx-auto max-w-[1080px] px-5 pb-16 pt-16 text-center sm:px-7 sm:pt-24 md:pb-20">
        <div data-reveal>
          <h1 className="mx-auto max-w-[15ch] text-balance font-display text-[clamp(2.5rem,6vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-foreground">
            CMS for <span className="text-brand-bright">AI agents.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[460px] text-balance text-lg leading-[1.6] text-muted-foreground">
            Your coding agent publishes to your blog through scoped MCP. You own every
            post; it never sees your login.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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

          <div className="mt-9 flex flex-col items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">
              Works with your agents
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
              {agents.map(([name, file]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
                >
                  <img
                    src={`/brand/agents/${file}`}
                    alt=""
                    className="size-[18px]"
                    aria-hidden="true"
                  />
                  {name}
                </span>
              ))}
              <span className="text-[13px] font-medium text-muted-foreground/70">
                + any MCP client
              </span>
            </div>
          </div>
        </div>

        <div className="relative mx-auto mt-12 max-w-[1000px]" data-reveal data-d="1">
          <Glow className="left-1/2 top-1/4 h-[440px] w-[820px] -translate-x-1/2 opacity-45" />
          <div className="relative z-10">
            <HeroDemo />
          </div>
        </div>
      </section>
    </>
  );
}
