import { MonoEyebrow, SectionShell } from "./primitives";

const FLOW_STEPS = [
  {
    n: "1",
    tag: "Write",
    text: "Draft in the dashboard editor, or let an agent draft through MCP.",
  },
  {
    n: "2",
    tag: "Preview",
    text: "Render Markdown, attach media, and inspect any version.",
  },
  {
    n: "3",
    tag: "Publish",
    text: "Go live from the UI, or via a scoped agent call.",
  },
  {
    n: "4",
    tag: "Trace",
    text: "Every important change lands in one shared activity trail.",
  },
] as const;

const stepCard =
  "relative z-[1] rounded-2xl p-[22px] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] shadow-[inset_0_1px_0_var(--hairline),0_24px_50px_-36px_oklch(0_0_0/0.9)]";

export function PublishingFlow() {
  return (
    <SectionShell className="pt-[110px]">
      <div data-reveal className="mb-11 max-w-[560px]">
        <MonoEyebrow label="The flow" className="mb-4" />
        <h2 className="font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
          From draft to published,
          <br />
          with the trail intact.
        </h2>
        <p className="mt-4 text-[16.5px] leading-relaxed text-muted-foreground">
          Humans and agents use different doors into the same command layer - so
          the log always stays coherent.
        </p>
      </div>

      <div
        data-reveal
        data-d="1"
        className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-[18px]"
      >
        <div
          className="pointer-events-none absolute top-[30px] right-[8%] left-[8%] z-0 hidden h-0.5 bg-gradient-to-r from-transparent via-brand-bright/35 to-transparent lg:block"
          aria-hidden="true"
        />
        {FLOW_STEPS.map((step, index) => (
          <div
            key={step.tag}
            className={stepCard}
            data-reveal
            data-d={String(Math.min(index + 2, 5))}
          >
            <div className="mb-[18px] grid size-10 place-items-center rounded-[11px] bg-gradient-to-b from-card to-background font-display text-[15px] font-semibold text-brand-bright shadow-[inset_0_0_0_1px_oklch(0.8107_0.1705_152.72/0.22)]">
              {step.n}
            </div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-brand-bright">
              {step.tag}
            </div>
            <p className="text-[13.5px] leading-[1.55] text-muted-foreground">
              {step.text}
            </p>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}