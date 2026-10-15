// Looping hero story: the person asks their agent in chat, the agent drafts and
// sends a private preview, the person approves a time, and that exact version
// goes live. Steps are advanced by marketing-interactions.js until the visitor
// pauses or picks a step; without JS (or with reduced motion) the whole
// conversation and the live post are shown.

import { Pause, Play } from "./icons";
import { GHOST_CTA } from "./primitives";

export const HERO_POST = {
  title: "What shipped this week",
  previewUrl: "blog.acme.com/preview/8f3a…",
  liveUrl: "blog.acme.com/what-shipped-this-week",
} as const;

type Turn = { step: number; from: "you" | "agent"; text: string; meta?: string };

export const HERO_TURNS: Turn[] = [
  { step: 1, from: "you", text: "Write up this week's release notes. Show me before it goes out." },
  { step: 2, from: "agent", text: `Drafted “${HERO_POST.title}”. Here's a private preview.`, meta: HERO_POST.previewUrl },
  { step: 3, from: "you", text: "Looks good. Publish it Tuesday at 9." },
  { step: 4, from: "agent", text: "Scheduled version 3 for Tue 09:00.", meta: "you can change or cancel it anytime" },
];

// Final state for SSR; the script replays the steps from 1.
const LAST_STEP = 5;

export const HERO_STEPS = ["Ask", "Preview", "Approve", "Schedule", "Live"] as const;

const panel =
  "rounded-2xl ring-1 ring-[color:var(--hairline)] shadow-[inset_0_1px_0_var(--hairline),0_30px_60px_-42px_oklch(0_0_0/0.9)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]";

function Dots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="size-2.5 rounded-full bg-muted-foreground/25" />
      <span className="size-2.5 rounded-full bg-muted-foreground/25" />
      <span className="size-2.5 rounded-full bg-muted-foreground/25" />
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const mine = turn.from === "you";
  return (
    <li
      className={`flex transition-[opacity,transform] duration-500 ease-out ${mine ? "justify-end" : "justify-start"}`}
      data-hero-turn={turn.step}
    >
      <div className={`max-w-[88%] ${mine ? "text-right" : "text-left"}`}>
        <p
          className={[
            "inline-block rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-[1.5]",
            mine
              ? "rounded-br-md bg-foreground/[0.09] text-foreground"
              : "rounded-bl-md text-foreground/90 ring-1 ring-[color:var(--hairline)]",
          ].join(" ")}
        >
          {turn.text}
          {turn.meta ? (
            <span
              className={`mt-1 block font-mono text-[11px] ${turn.step === 2 ? "text-brand-bright" : "text-muted-foreground"}`}
            >
              {turn.meta}
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

export function HeroDemo() {
  return (
    <div
      data-hero-demo
      data-step={LAST_STEP}
      data-preview-url={HERO_POST.previewUrl}
      data-live-url={HERO_POST.liveUrl}
    >
    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(0,1.05fr)_auto_minmax(0,0.95fr)] md:gap-1">
      {/* The conversation with the agent */}
      <div className={`relative min-w-0 overflow-hidden ${panel}`}>
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">you · claude</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden /> vibecms connected
          </span>
        </div>
        <ol className="flex min-h-[236px] flex-col gap-2.5 px-4 py-4" aria-label="Example conversation">
          {HERO_TURNS.map((turn) => (
            <Bubble key={turn.step} turn={turn} />
          ))}
        </ol>
      </div>

      {/* The post flows through vibecms */}
      <div className="flex items-center justify-center" aria-hidden="true">
        <div className="relative flex w-16 items-center justify-center md:h-24 md:w-24">
          <div className="absolute hidden h-px w-full [background:var(--hairline)] md:block" />
          <div className="absolute block h-10 w-px [background:var(--hairline)] md:hidden" />
          <span
            className="relative z-10 grid size-12 place-items-center rounded-2xl ring-1 ring-brand-bright/30 transition-[box-shadow] duration-500 [background:var(--surface-panel-from)]"
            data-hero-node
          >
            <img src="/brand/icon.svg" alt="" className="size-8" />
          </span>
        </div>
      </div>

      {/* The blog post */}
      <div className={`relative min-w-0 overflow-hidden transition-opacity duration-700 ${panel}`} data-hero-post>
        <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4 py-2.5">
          <Dots />
          <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground" data-hero-url>
            {HERO_POST.liveUrl}
          </span>
        </div>
        <div className="px-5 py-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">version 3</span>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] text-brand-bright ring-1 ring-brand-bright/35"
              data-hero-badge
            >
              <span className="size-1.5 rounded-full bg-brand-bright" data-hero-badge-dot />
              <span data-hero-badge-label>live</span>
            </span>
          </div>
          <div className="mt-3 font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">
            {HERO_POST.title}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground" data-hero-byline>
            by claude · approved by you
          </div>
          <div className="mt-4 space-y-2.5" aria-hidden="true">
            <div className="h-2 w-full rounded bg-muted-foreground/20" />
            <div className="h-2 w-[90%] rounded bg-muted-foreground/15" />
            <div className="h-2 w-[76%] rounded bg-muted-foreground/15" />
            <div className="h-2 w-[84%] rounded bg-muted-foreground/15" />
          </div>
          <div className="mt-5 rounded-lg bg-muted-foreground/[0.07] px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-muted-foreground">
            <span className="text-foreground/80">## Highlights</span>
            <br />- Scheduled publishing
            <br />- Private preview links
          </div>
        </div>
      </div>
    </div>
    <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-3">
      {/* Below sm the five steps sit in a balanced 3 + 2 grid (six tracks, two
          per pill; row two starts at track two so it centers). From sm up they
          flow in one row. */}
      <div role="group" aria-label="Demo steps" className="grid grid-cols-6 gap-1.5 sm:flex sm:items-center sm:justify-center">
        {HERO_STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            data-hero-goto={i + 1}
            aria-current={i + 1 === LAST_STEP ? "step" : undefined}
            className="group col-span-2 inline-flex min-h-[36px] items-center justify-center gap-2 rounded-full px-3 font-mono text-[11px] text-muted-foreground transition-colors duration-200 hover:text-foreground aria-[current=step]:text-foreground aria-[current=step]:[background:var(--surface-glass-strong)] aria-[current=step]:ring-1 aria-[current=step]:ring-[color:var(--hairline)] [&:nth-child(4)]:col-start-2"
          >
            <span className="size-1.5 rounded-full bg-muted-foreground/50 transition-colors duration-200 group-aria-[current=step]:bg-brand-bright" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {/* Autoplay pause (WCAG 2.2.2). Shown by marketing-interactions.js only when the demo animates. */}
      <button
        type="button"
        hidden
        data-hero-toggle
        aria-label="Pause demo"
        className={`${GHOST_CTA} group min-h-[36px] px-3 font-mono text-[11px]`}
      >
        <Pause className="size-3.5 group-data-[paused]:hidden" />
        <Play className="hidden size-3.5 group-data-[paused]:block" />
        <span data-hero-toggle-label>Pause</span>
      </button>
    </div>
    </div>
  );
}
