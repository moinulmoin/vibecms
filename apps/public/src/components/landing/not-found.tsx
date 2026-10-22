import { ArrowRight } from "./icons";
import { GHOST_CTA, GREEN_BG, GREEN_CTA, H2, LEAD } from "./primitives";

/**
 * Branded 404 body for the product site (unknown marketing and docs paths).
 * Static markup, no hydration; rendered by `pages/internal/not-found.astro`.
 */
export function MarketingNotFound() {
  return (
    <section className="relative mx-auto flex min-h-[60dvh] w-full max-w-[720px] flex-col justify-center px-5 py-20 sm:px-7">
        <p className="font-mono text-xs text-brand-bright">// 404</p>
        <h1 className={`mt-3 ${H2}`}>This page doesn't exist.</h1>
        <p className={`mt-4 max-w-[52ch] ${LEAD}`}>
          The link may be old, or the address has a typo. Start from the home page or the docs.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a className={`${GREEN_CTA} min-h-[44px] gap-1.5 px-[18px] text-sm`} style={{ background: GREEN_BG }} href="/">
            Go home <ArrowRight />
          </a>
          <a className={`${GHOST_CTA} min-h-[44px] px-[18px] text-sm`} href="/docs">
            Read the docs
          </a>
        </div>
        <p className="mt-10 font-mono text-xs text-muted-foreground">
          Agents: start at{" "}
          <a className="text-foreground underline-offset-2 hover:underline" href="/llms.txt">
            /llms.txt
          </a>
        </p>
    </section>
  );
}
