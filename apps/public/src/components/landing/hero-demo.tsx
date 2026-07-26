// Looping hero story shown as a real coding-agent terminal session: you ask the
// agent to publish, it routes the post THROUGH vibecms (the green line fills
// across the vibecms node), and the post goes live. Phase animation is driven
// by marketing-interactions.js.
export const HERO_PROMPT = 'publish "Shipping with MCP"';

const panel =
  "rounded-2xl ring-1 ring-[color:var(--hairline)] shadow-[inset_0_1px_0_var(--hairline),0_30px_60px_-42px_oklch(0_0_0/0.9)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]";

function Dots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="size-2.5 rounded-full bg-destructive/70" />
      <span className="size-2.5 rounded-full bg-accent/70" />
      <span className="size-2.5 rounded-full bg-brand-bright/70" />
    </div>
  );
}

export function HeroDemo() {
  return (
    <div
      className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-1"
      data-hero-demo
      data-hero-prompt={HERO_PROMPT}
      data-phase="typing"
    >
      {/* Agent terminal session */}
      <div className={`relative min-w-0 overflow-hidden ${panel}`}>
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">agent · claude</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-brand-bright">
            <span className="size-1.5 rounded-full bg-brand-bright animate-vc-pulse" aria-hidden /> mcp
          </span>
        </div>
        <div className="min-h-[176px] px-4 py-4 text-left font-mono text-[12.5px] leading-[1.95]">
          <div className="text-foreground">
            <span className="text-brand-bright">&gt;</span>{" "}
            <span className="break-all" data-hero-typed />
            <span
              className="ml-0.5 inline-block h-3.5 w-[6px] translate-y-[2px] bg-brand-bright animate-vc-blink"
              aria-hidden
              data-hero-cursor
            />
          </div>
          <div className="mt-1.5 opacity-0 transition-opacity duration-500" data-hero-agent>
            <div className="text-muted-foreground">
              <span className="text-brand-bright" data-hero-agent-dot>
                ●
              </span>{" "}
              <span data-hero-agent-status>routing through vibecms…</span>
            </div>
            <div className="text-brand-bright opacity-0 transition-opacity duration-500" data-hero-live-line>
              → live at blog.acme.com
            </div>
          </div>
        </div>
      </div>

      {/* Connector - the post flows THROUGH vibecms */}
      <div className="flex items-center justify-center" aria-hidden="true">
        <div className="relative flex w-16 items-center justify-center md:h-24 md:w-28">
          <div className="absolute hidden h-1 w-full overflow-hidden rounded-full [background:var(--hairline)] md:block">
            <div
              className="h-full rounded-full bg-brand-bright shadow-[0_0_12px_var(--brand-bright)] transition-[width] duration-[800ms] ease-out"
              style={{ width: "0%" }}
              data-hero-track-h
            />
          </div>
          <div className="absolute block h-14 w-1 overflow-hidden rounded-full [background:var(--hairline)] md:hidden">
            <div
              className="w-full rounded-full bg-brand-bright shadow-[0_0_12px_var(--brand-bright)] transition-[height] duration-[800ms] ease-out"
              style={{ height: "0%" }}
              data-hero-track-v
            />
          </div>
          <span
            className="relative z-10 grid size-14 scale-100 place-items-center rounded-2xl ring-1 ring-brand-bright/30 transition-all duration-500 [background:var(--surface-panel-from)]"
            data-hero-node
          >
            <img src="/brand/icon.svg" alt="" className="size-9" />
          </span>
        </div>
      </div>

      {/* Live post */}
      <div
        className={`relative min-w-0 overflow-hidden opacity-45 transition-opacity duration-700 ${panel}`}
        data-hero-post
      >
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            blog.acme.com/shipping-with-mcp
          </span>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold text-muted-foreground ring-1 ring-[color:var(--hairline)] transition-colors duration-500"
            data-hero-live-badge
          >
            <span className="size-1.5 rounded-full bg-muted-foreground/40" data-hero-live-dot />
            live
          </span>
        </div>
        <div className="min-h-[176px] px-5 py-4 text-left">
          <div className="font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground">
            Shipping with MCP
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">by claude · just now</div>
          <div className="mt-4 space-y-2.5">
            <div className="h-2 w-full rounded bg-muted-foreground/20" />
            <div className="h-2 w-[88%] rounded bg-muted-foreground/15" />
            <div className="h-2 w-[72%] rounded bg-muted-foreground/15" />
          </div>
        </div>
      </div>
    </div>
  );
}
