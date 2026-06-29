"use client";

import { useEffect, useState } from "react";

// Looping hero story shown as a real coding-agent terminal session: you ask the
// agent to publish, it routes the post THROUGH vibecms (the green line fills
// across the vibecms node), and the post goes live.
const PROMPT = 'publish "Shipping with MCP"';

type Phase = "typing" | "publishing" | "live";

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
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (reduced) {
      setTyped(PROMPT);
      setPhase("live");
      return;
    }
    let i = 0;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(setTimeout(() => !cancelled && fn(), ms));

    const run = () => {
      setTyped("");
      setPhase("typing");
      i = 0;
      const type = () => {
        if (cancelled) return;
        if (i <= PROMPT.length) {
          setTyped(PROMPT.slice(0, i));
          i += 1;
          timers.push(setTimeout(type, 48));
        } else {
          at(650, () => setPhase("publishing"));
          at(2000, () => setPhase("live"));
          at(5600, run);
        }
      };
      at(700, type);
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const publishing = phase === "publishing";
  const published = phase === "live";
  const active = publishing || published;

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-1">
      {/* Agent terminal session */}
      <div className={`relative min-w-0 overflow-hidden ${panel}`}>
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">agent · claude</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-brand-bright">
            <span className="size-1.5 rounded-full bg-brand-bright animate-vc-pulse" aria-hidden /> mcp
          </span>
        </div>
        <div className="min-h-[176px] px-4 py-4 text-left font-mono text-[12.5px] leading-[1.95]">
          {/* you */}
          <div className="text-foreground">
            <span className="text-brand-bright">&gt;</span>{" "}
            <span className="break-all">{typed}</span>
            {phase === "typing" && (
              <span
                className="ml-0.5 inline-block h-3.5 w-[6px] translate-y-[2px] bg-brand-bright animate-vc-blink"
                aria-hidden
              />
            )}
          </div>
          {/* agent */}
          <div
            className={`mt-1.5 transition-opacity duration-500 ${phase === "typing" ? "opacity-0" : "opacity-100"}`}
          >
            <div className="text-muted-foreground">
              <span className={`text-brand-bright ${publishing ? "animate-vc-pulse" : ""}`}>●</span>{" "}
              {published ? "published to vibecms" : "routing through vibecms…"}
            </div>
            <div
              className={`text-brand-bright transition-opacity duration-500 ${published ? "opacity-100" : "opacity-0"}`}
            >
              → live at blog.acme.com
            </div>
          </div>
        </div>
      </div>

      {/* Connector - the post flows THROUGH vibecms */}
      <div className="flex items-center justify-center" aria-hidden="true">
        <div className="relative flex w-16 items-center justify-center md:h-24 md:w-28">
          {/* desktop horizontal track */}
          <div className="absolute hidden h-1 w-full overflow-hidden rounded-full [background:var(--hairline)] md:block">
            <div
              className="h-full rounded-full bg-brand-bright shadow-[0_0_12px_var(--brand-bright)] transition-[width] duration-[800ms] ease-out"
              style={{ width: active ? "100%" : "0%" }}
            />
          </div>
          {/* mobile vertical track */}
          <div className="absolute block h-14 w-1 overflow-hidden rounded-full [background:var(--hairline)] md:hidden">
            <div
              className="w-full rounded-full bg-brand-bright shadow-[0_0_12px_var(--brand-bright)] transition-[height] duration-[800ms] ease-out"
              style={{ height: active ? "100%" : "0%" }}
            />
          </div>
          {/* vibecms node */}
          <span
            className={`relative z-10 grid size-14 place-items-center rounded-2xl ring-1 transition-all duration-500 [background:var(--surface-panel-from)] ${
              active
                ? "scale-105 ring-brand-bright/70 shadow-[0_0_30px_oklch(0.8107_0.1705_152.72/0.5)]"
                : "scale-100 ring-brand-bright/30"
            }`}
          >
            <img src="/brand/icon.svg" alt="" className="size-9" />
          </span>
        </div>
      </div>

      {/* Live post */}
      <div
        className={`relative min-w-0 overflow-hidden ${panel} transition-opacity duration-700 ${published ? "opacity-100" : "opacity-45"}`}
      >
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            blog.acme.com/shipping-with-mcp
          </span>
          <span
            className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors duration-500 ${
              published
                ? "text-brand-bright ring-1 ring-brand-bright/35 [background:oklch(0.8107_0.1705_152.72/0.12)]"
                : "text-muted-foreground ring-1 ring-[color:var(--hairline)]"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${published ? "bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" : "bg-muted-foreground/40"}`}
            />
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
